const path = require('path');
const { buildListResultsSummary, describeExpandedInput } = require('./ctrip-list');
const { ensureDir, slugify } = require('./utils');
const { setup_perf_logger, PerfTimer, BatchStats } = require('./runtime/perf');
const {
  assertNotCancelled,
  createTransitCache,
  durationSince,
  isCancellationError,
  isReportDisabled,
  normalizeBatchConcurrency,
  resolveBatchCaptureStrategy
} = require('./task-context');
const { emitBatchItemDone, emitBatchItemError, emitBatchItemStart } = require('./task-events');
const { SingleDetailRunner } = require('./single-detail-runner');
const {
  buildBatchOutputPayload,
  buildBatchResult,
  buildUncollectedHotelPerfRecord
} = require('./batch-result-builder');
const {
  cleanupBatchArtifacts,
  prepareBatchCollections,
  writeBatchAppData,
  writeBatchLatestRunSummary,
  writeBatchReportArtifact
} = require('./batch-artifact-writer');
const { createBatchEdgeWorkerPool } = require('./batch-edge-worker-pool');
const { getEffectiveBoundedConcurrency, runBoundedWorkers } = require('./bounded-worker-runner');
const { runPreparedDetailBatch } = require('./prepared-detail-batch-collector');
const {
  AdaptiveDetailScheduler,
  isSoftPriceFailureResult
} = require('./adaptive-detail-scheduler');

const MAX_BATCH_CONCURRENCY = 3;
const MAX_TRANSIT_CONCURRENCY = 3;
const DEFAULT_UNCOLLECTED_RETRY_COUNT = 2;
const CTRIP_RISK_CONTROL_ABORT_CODE = 'CTRIP_RISK_CONTROL_203_ABORT';
const DEFAULT_RISK_CONTROL_RETRY_COUNT = 0;
const DEFAULT_RISK_CONTROL_RETRY_DELAY_MS = 20 * 1000;

function normalizeSpiderErrorCodes(codes = []) {
  return (Array.isArray(codes) ? codes : [codes])
    .map((code) => Number(code))
    .filter((code) => Number.isFinite(code));
}

function summarizeSnapshotRiskSignals(pageSnapshot = {}) {
  const snapshot = pageSnapshot && typeof pageSnapshot === 'object' ? pageSnapshot : {};
  const sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
  const spiderErrorCodes = [
    ...normalizeSpiderErrorCodes(snapshot.spider_error_codes),
    ...sources.flatMap((source) => normalizeSpiderErrorCodes(source && source.spider_error_codes))
  ];
  const riskText = [
    snapshot.login_reason,
    snapshot.login_stage,
    snapshot.wait_reason,
    snapshot.error,
    ...sources.flatMap((source) =>
      source ? [source.login_reason, source.login_stage, source.wait_reason, source.error] : []
    )
  ]
    .filter(Boolean)
    .join(' ');

  return {
    spiderErrorCodes,
    hasSpider203: spiderErrorCodes.includes(203),
    hasVisiblePriceSource: sources.some(
      (source) => source && source.room_price_visible && !source.login_required
    ),
    riskText
  };
}

function isCtripRiskControlSnapshot(pageSnapshot = {}) {
  const signals = summarizeSnapshotRiskSignals(pageSnapshot);
  if (pageSnapshot.room_price_visible || signals.hasVisiblePriceSource) {
    return false;
  }

  return Boolean(
    signals.hasSpider203 ||
    (pageSnapshot &&
      pageSnapshot.login_required &&
      /203|风控|反爬|anti-?spider|risk_control/i.test(signals.riskText))
  );
}

function isCtripRiskControlResult(childResult = {}) {
  if (!childResult || typeof childResult !== 'object') {
    return false;
  }

  const pageSnapshot = childResult.pageSnapshot || childResult.page_snapshot || {};
  const eligibleCount = Math.max(
    0,
    Number(childResult.eligibleCount || 0),
    Array.isArray(childResult.eligible_rooms) ? childResult.eligible_rooms.length : 0
  );
  const signals = summarizeSnapshotRiskSignals(pageSnapshot);
  if (eligibleCount > 0 || pageSnapshot.room_price_visible || signals.hasVisiblePriceSource) {
    return false;
  }

  return isCtripRiskControlSnapshot(pageSnapshot);
}

function getCtripRiskControlReason(childResult = {}, preparedScrape = {}) {
  const pageSnapshot =
    childResult.pageSnapshot ||
    childResult.page_snapshot ||
    (preparedScrape.scraped && preparedScrape.scraped.page_snapshot) ||
    {};
  const signals = summarizeSnapshotRiskSignals(pageSnapshot);
  return (
    pageSnapshot.login_reason ||
    signals.riskText ||
    '携程房价接口返回 203 或触发风控，已停止剩余批量采集。'
  );
}

function createCtripRiskControlAbortError({
  childResult = {},
  preparedScrape = {},
  hotelInput = {}
}) {
  const reason = getCtripRiskControlReason(childResult, preparedScrape);
  const hotelId =
    childResult.hotelId ||
    hotelInput.hotelId ||
    (preparedScrape.context &&
      preparedScrape.context.hotelInput &&
      preparedScrape.context.hotelInput.hotelId) ||
    '';
  const message = hotelId
    ? `检测到携程 203/风控，已停止批量采集（hotelId=${hotelId}）：${reason}`
    : `检测到携程 203/风控，已停止批量采集：${reason}`;
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = CTRIP_RISK_CONTROL_ABORT_CODE;
  error.reason = reason;
  error.hotelId = hotelId;
  return error;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function normalizeRiskControlRetryCount(args = {}, batchOptions = {}) {
  const explicit =
    args.riskControlRetries ?? args['risk-control-retries'] ?? batchOptions.riskControlRetries;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return Math.min(2, normalizeNonNegativeInteger(explicit, DEFAULT_RISK_CONTROL_RETRY_COUNT));
  }

  return DEFAULT_RISK_CONTROL_RETRY_COUNT;
}

function normalizeRiskControlRetryDelayMs(args = {}, batchOptions = {}) {
  const explicit =
    args.riskControlRetryDelayMs ??
    args['risk-control-retry-delay-ms'] ??
    batchOptions.riskControlRetryDelayMs ??
    process.env.CTRIP_RISK_CONTROL_RETRY_DELAY_MS;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return Math.min(
      10 * 60 * 1000,
      normalizeNonNegativeInteger(explicit, DEFAULT_RISK_CONTROL_RETRY_DELAY_MS)
    );
  }

  return DEFAULT_RISK_CONTROL_RETRY_DELAY_MS;
}

function delayWithSignal(delayMs, signal = null) {
  const ms = normalizeNonNegativeInteger(delayMs, 0);
  if (ms <= 0) {
    assertNotCancelled(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeout = null;
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('任务已取消'));
    };

    if (signal && signal.aborted) {
      onAbort();
      return;
    }

    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function formatDelaySeconds(delayMs) {
  return Math.max(0, Math.ceil(Number(delayMs || 0) / 1000));
}

function createAsyncLimiter(maxConcurrency) {
  const concurrency = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
  const queue = [];
  let active = 0;

  const runNext = () => {
    while (active < concurrency && queue.length > 0) {
      const entry = queue.shift();
      active += 1;
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };

  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
}

function resolveMaxBatchConcurrency(_args = {}, batchOptions = {}) {
  if (batchOptions.maxConcurrency) {
    return Math.min(Number(batchOptions.maxConcurrency), MAX_BATCH_CONCURRENCY);
  }

  return MAX_BATCH_CONCURRENCY;
}

function normalizeUncollectedRetryCount(args = {}, batchOptions = {}) {
  const explicit =
    args.batchUncollectedRetries ??
    args['batch-uncollected-retries'] ??
    batchOptions.batchUncollectedRetries;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    const parsed = Number(explicit);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  return args['auto-edge'] ? DEFAULT_UNCOLLECTED_RETRY_COUNT : 0;
}

function isRetryableUncollectedResult(childResult) {
  if (!childResult || childResult.error || Number(childResult.eligibleCount || 0) > 0) {
    return false;
  }

  if (isCtripRiskControlResult(childResult)) {
    return false;
  }

  if (isSoftPriceFailureResult(childResult)) {
    return false;
  }

  const snapshot = childResult.pageSnapshot || {};
  if (snapshot.login_required) {
    return false;
  }

  const candidateCount = Math.max(
    0,
    Number(snapshot.room_candidates_count || 0),
    Number(snapshot.raw_room_candidates_count || 0)
  );
  if (candidateCount <= 0) {
    return false;
  }

  const signals = summarizeSnapshotRiskSignals(snapshot);
  if (snapshot.room_price_visible || signals.hasVisiblePriceSource) {
    return false;
  }

  return Boolean(
    snapshot.edge_fallback_used ||
    snapshot.api_replay_used ||
    /edge|api|missing_price|retry_after/i.test(
      `${snapshot.capture_method || ''} ${snapshot.wait_reason || ''}`
    )
  );
}

class BatchOrchestrator {
  constructor(context, options = {}) {
    this.context = context;
    this.options = options;
    this.singleDetailRunner = options.singleDetailRunner || new SingleDetailRunner();
    this.riskControlCooldownPromise = null;
    this.detailScheduler = null;
  }

  getBatchOptions() {
    return {
      ...(this.context.options || {}),
      ...this.options
    };
  }

  async run() {
    const batchOptions = this.getBatchOptions();
    const concurrency = normalizeBatchConcurrency(this.context.args, batchOptions);
    this.detailScheduler = this.createDetailScheduler(concurrency, batchOptions);

    if (concurrency > 1) {
      return this.runConcurrent({ concurrency, batchOptions });
    }

    return this.runSequential({ concurrency, batchOptions });
  }

  createDetailScheduler(concurrency, batchOptions = {}) {
    const { args = {}, perf = null } = this.context;
    const configuredStartIntervalMs =
      batchOptions.detailStartIntervalMs ??
      args.detailStartIntervalMs ??
      args['detail-start-interval-ms'];
    const configuredWarmupHotelCount =
      batchOptions.warmupHotelCount ?? args.warmupHotelCount ?? args['warmup-hotel-count'];
    return new AdaptiveDetailScheduler({
      maxConcurrency: Math.min(
        concurrency,
        resolveMaxBatchConcurrency(this.context.args, batchOptions)
      ),
      detailStartIntervalMs: configuredStartIntervalMs ?? (Number(concurrency) > 1 ? 2000 : 0),
      degradedStartIntervalMs:
        batchOptions.degradedStartIntervalMs ??
        args.degradedStartIntervalMs ??
        args['degraded-start-interval-ms'],
      warmupHotelCount: configuredWarmupHotelCount ?? (Number(concurrency) > 1 ? 3 : 0),
      softWindowSize:
        batchOptions.softRiskWindowSize ?? args.softRiskWindowSize ?? args['soft-risk-window-size'],
      softFailureThreshold:
        batchOptions.softRiskFailureThreshold ??
        args.softRiskFailureThreshold ??
        args['soft-risk-failure-threshold'],
      recoveryCleanCount:
        batchOptions.recoveryCleanCount ?? args.recoveryCleanCount ?? args['recovery-clean-count'],
      degradedConcurrency: 2,
      perf
    });
  }

  isRiskControlScrapeEvent(type, message, details = {}) {
    const text = `${type || ''} ${message || ''} ${details.stage || ''} ${details.reason || ''}`;
    return type === 'edge:login-required' && /203|风控|反爬|anti-?spider|risk_control/i.test(text);
  }

  buildScheduledScrapeEventForwarder(baseForwarder, index, total) {
    return (type, message, details = {}) => {
      if (this.isRiskControlScrapeEvent(type, message, details)) {
        this.detailScheduler?.tripCircuit(details.reason || message, {
          page_index: index,
          hotel_count: total,
          event_type: type,
          login_stage: details.stage || ''
        });
      }
      if (typeof baseForwarder === 'function') {
        baseForwarder(type, message, details);
      }
    };
  }

  async runConcurrent({ concurrency, batchOptions }) {
    const total = this.context.expandedInputs.hotelInputs.length;
    const effectiveConcurrency = getEffectiveBoundedConcurrency({
      requestedConcurrency: concurrency,
      total,
      maxConcurrency: resolveMaxBatchConcurrency(this.context.args, batchOptions)
    });

    if (effectiveConcurrency <= 1) {
      return this.runSequential({ concurrency, batchOptions });
    }

    if (this.context.edgeParallelDisabledReason) {
      return this.runSequential({
        concurrency,
        batchOptions,
        parallelRequestedButDisabled: true,
        parallelDisabledReason: this.context.edgeParallelDisabledReason
      });
    }

    let edgeWorkerPool = null;
    try {
      edgeWorkerPool = await createBatchEdgeWorkerPool({
        args: this.context.args,
        effectiveTemplate: this.context.effectiveTemplate,
        concurrency: effectiveConcurrency,
        existingWorker: this.context.existingEdgeWorker || null,
        preparedUserDataDirs: this.context.preparedEdgeWorkerProfileDirs || []
      });
    } catch (error) {
      return this.runSequential({
        concurrency,
        batchOptions,
        parallelRequestedButDisabled: true,
        parallelDisabledReason: error && error.message ? error.message : String(error)
      });
    }

    try {
      return await this.runConcurrentWorkers({
        concurrency,
        effectiveConcurrency,
        batchOptions,
        edgeWorkers: edgeWorkerPool ? edgeWorkerPool.workers : []
      });
    } finally {
      if (edgeWorkerPool) {
        await edgeWorkerPool.close();
      }
    }
  }

  createBatchRuntime({ concurrency }) {
    const { taskId, expandedInputs } = this.context;
    const batchPerf = this.context.perf
      ? this.context.perf.child({
          taskId,
          hotelCount: expandedInputs.hotelInputs.length,
          taskKind: 'batch_collect',
          mode: 'batch_collect'
        })
      : new PerfTimer(setup_perf_logger(), {
          taskId,
          hotelCount: expandedInputs.hotelInputs.length,
          taskKind: 'batch_collect',
          mode: 'batch_collect'
        });
    const batchStats = new BatchStats(batchPerf, {
      hotelCount: expandedInputs.hotelInputs.length,
      taskKind: 'batch_collect'
    });
    const batchPhase = batchPerf.phase('batch_total', {
      hotelCount: expandedInputs.hotelInputs.length,
      taskKind: 'batch_collect',
      concurrency
    });

    return {
      batchPerf,
      batchStats,
      batchPhase
    };
  }

  createPerformance({
    concurrency,
    effectiveConcurrency = 1,
    parallelRequestedButDisabled = concurrency > 1 && effectiveConcurrency === 1,
    parallelDisabledReason = ''
  }) {
    const { expandedInputs } = this.context;
    return {
      totalMs: 0,
      itemMs: 0,
      writeMs: 0,
      outputWriteMs: 0,
      cleanupMs: 0,
      listExpansion:
        expandedInputs.performance ||
        (expandedInputs.summary && expandedInputs.summary.performance) ||
        null,
      items: [],
      concurrency,
      effectiveConcurrency,
      parallelRequestedButDisabled,
      parallelDisabledReason
    };
  }

  async runSequential({
    concurrency,
    batchOptions,
    parallelRequestedButDisabled = concurrency > 1,
    parallelDisabledReason = ''
  }) {
    const { emit, signal, outputDir, expandedInputs, reportLevel = 'normal' } = this.context;
    const reportDisabled = isReportDisabled(reportLevel);
    const { batchPerf, batchStats, batchPhase } = this.createBatchRuntime({ concurrency });

    try {
      emit('batch:start', '正在批量采集携程酒店页面', {
        summary: describeExpandedInput(expandedInputs),
        concurrency,
        requestedConcurrency: concurrency,
        effectiveConcurrency: 1,
        parallelRequestedButDisabled,
        parallelDisabledReason
      });

      if (parallelRequestedButDisabled) {
        batchPerf.event('parallel_requested_but_disabled', {
          phase: 'batch_total',
          status: 'fallback_serial',
          requested_concurrency: concurrency,
          effective_concurrency: 1,
          reason: parallelDisabledReason
        });
      }

      const batchStartedAt = Date.now();
      const batchItemsDir = path.join(outputDir, 'batch-items');
      if (!reportDisabled) {
        ensureDir(batchItemsDir);
      }
      const performance = this.createPerformance({
        concurrency,
        effectiveConcurrency: 1,
        parallelRequestedButDisabled,
        parallelDisabledReason
      });
      const { results: itemResults } = await this.runPreparedBatchItems({
        concurrency: 1,
        effectiveConcurrency: 1,
        batchItemsDir,
        batchOptions,
        batchPerf,
        batchStats,
        reportDisabled,
        signal,
        edgeWorkers: []
      });

      return await this.finalizeBatchResult({
        batchStartedAt,
        batchPerf,
        batchStats,
        batchPhase,
        itemResults,
        performance,
        reportDisabled
      });
    } catch (error) {
      batchPhase.error(error, {
        hotelCount: expandedInputs.hotelInputs.length
      });
      throw error;
    }
  }

  async runConcurrentWorkers({
    concurrency,
    effectiveConcurrency,
    batchOptions,
    edgeWorkers = []
  }) {
    const { emit, signal, outputDir, expandedInputs, reportLevel = 'normal' } = this.context;
    const reportDisabled = isReportDisabled(reportLevel);
    const { batchPerf, batchStats, batchPhase } = this.createBatchRuntime({ concurrency });

    try {
      emit('batch:start', '正在批量采集携程酒店页面', {
        summary: describeExpandedInput(expandedInputs),
        concurrency,
        requestedConcurrency: concurrency,
        effectiveConcurrency,
        parallelRequestedButDisabled: false
      });

      const batchStartedAt = Date.now();
      const batchItemsDir = path.join(outputDir, 'batch-items');
      if (!reportDisabled) {
        ensureDir(batchItemsDir);
      }
      const performance = this.createPerformance({
        concurrency,
        effectiveConcurrency,
        parallelRequestedButDisabled: false
      });
      const { results: itemResults } = await this.runPreparedBatchItems({
        concurrency,
        effectiveConcurrency,
        batchItemsDir,
        batchOptions,
        batchPerf,
        batchStats,
        reportDisabled,
        signal,
        edgeWorkers
      });

      return await this.finalizeBatchResult({
        batchStartedAt,
        batchPerf,
        batchStats,
        batchPhase,
        itemResults: itemResults.filter(Boolean),
        performance,
        reportDisabled
      });
    } catch (error) {
      batchPhase.error(error, {
        hotelCount: expandedInputs.hotelInputs.length
      });
      throw error;
    }
  }

  createPreparedBatchDetailContext({
    hotelInput,
    index,
    total,
    worker,
    batchItemsDir,
    batchOptions,
    batchPerf,
    reportDisabled,
    transitCache,
    signal
  }) {
    const {
      args,
      startedAt,
      taskId,
      emit,
      outputDir,
      template,
      matchedTemplate,
      effectiveTemplate,
      compareAppSettings,
      effectiveDestination,
      reportLevel = 'normal',
      scrapeEventForwarder = null
    } = this.context;

    assertNotCancelled(signal);
    const itemEffectiveTemplate =
      worker && worker.effectiveTemplate ? worker.effectiveTemplate : effectiveTemplate;
    emitBatchItemStart(emit, { index, total, taskId, hotelInput });

    const childOutputPath = reportDisabled
      ? ''
      : path.join(
          batchItemsDir,
          `batch-item-${String(index).padStart(3, '0')}-${hotelInput.hotelId || 'hotel'}.json`
        );

    return {
      context: {
        args,
        startedAt,
        taskId: `${taskId}-${index}`,
        emit,
        signal,
        outputDir,
        template,
        matchedTemplate,
        effectiveTemplate: itemEffectiveTemplate,
        compareAppSettings,
        effectiveDestination,
        hotelInput,
        outputPath: childOutputPath,
        autoEdge: Boolean(args['auto-edge']),
        transitCache,
        writeAppData: false,
        perf: batchPerf,
        pageIndex: index,
        reportLevel,
        isBatchItem: true,
        captureStrategy: resolveBatchCaptureStrategy(
          args,
          batchOptions,
          Boolean(args['auto-edge'])
        ),
        edgeParallelCancelPolicy: batchOptions.edgeParallelCancelPolicy,
        scrapeEventForwarder: this.buildScheduledScrapeEventForwarder(
          scrapeEventForwarder,
          index,
          total
        )
      },
      meta: {
        itemStartedAt: Date.now(),
        hotelInput
      }
    };
  }

  async mapPreparedBatchResult({
    preparedResult,
    detailContext,
    index,
    total,
    meta,
    batchOptions,
    batchPerf,
    batchStats,
    signal
  }) {
    const { taskId, emit } = this.context;
    const hotelInput = meta.hotelInput;
    if (isCtripRiskControlResult(preparedResult.result)) {
      this.detailScheduler?.tripCircuit(getCtripRiskControlReason(preparedResult.result), {
        page_index: index,
        hotel_count: total,
        hotelId: hotelInput.hotelId
      });
      this.abortForCtripRiskControl({
        childResult: preparedResult.result,
        detailContext,
        hotelInput,
        index,
        total,
        batchPerf
      });
    }

    preparedResult = await this.retryUncollectedPreparedResult({
      preparedResult,
      detailContext,
      hotelInput,
      index,
      total,
      batchOptions,
      batchPerf,
      signal
    });
    const childResult = preparedResult.result;
    childResult.inputIndex = index;
    childResult.inputSource = hotelInput.source;
    childResult.hotelId = hotelInput.hotelId;
    childResult.listCandidate = hotelInput.listCandidate || null;

    const durationMs = durationSince(meta.itemStartedAt);
    const performanceItem = {
      index,
      hotelId: hotelInput.hotelId,
      hotelName: childResult.hotelName,
      durationMs,
      detail: childResult.performance || null
    };
    batchStats.recordTask({
      taskId: `${taskId}-${index}`,
      status: 'success',
      elapsedMs: durationMs,
      index,
      hotelId: hotelInput.hotelId,
      hotelName: childResult.hotelName,
      url: hotelInput.url,
      waitDataMs:
        (childResult.performance &&
          childResult.performance.scrape &&
          childResult.performance.scrape.waitDataMs) ||
        0,
      edgeMs:
        (childResult.performance &&
          childResult.performance.scrape &&
          childResult.performance.scrape.edgeCaptureMs) ||
        0,
      apiReplayMs:
        (childResult.performance &&
          childResult.performance.scrape &&
          childResult.performance.scrape.directReplayMs) ||
        0,
      htmlMs:
        (childResult.performance &&
          childResult.performance.scrape &&
          childResult.performance.scrape.htmlMs) ||
        0,
      transitMs: (childResult.performance && childResult.performance.transitMs) || 0,
      saveMs:
        ((childResult.performance && childResult.performance.outputWriteMs) || 0) +
        ((childResult.performance && childResult.performance.appWriteMs) || 0),
      captureMethod: (childResult.pageSnapshot && childResult.pageSnapshot.capture_method) || '',
      waitReason: (childResult.pageSnapshot && childResult.pageSnapshot.wait_reason) || ''
    });

    const uncollectedItem = buildUncollectedHotelPerfRecord({
      index,
      hotelInput,
      childResult,
      durationMs
    });
    if (uncollectedItem) {
      batchPerf.event('uncollected_hotel', {
        phase: 'batch_total',
        status: 'skipped',
        pageIndex: index,
        hotelCount: total,
        ...uncollectedItem
      });
    }

    emitBatchItemDone(emit, { index, total, taskId, hotelInput, childResult });

    return {
      index,
      hotelInput,
      childResult,
      childPayload: preparedResult.outputPayload || null,
      savedHtmlFiles: Array.isArray(preparedResult.savedHtmlFiles)
        ? preparedResult.savedHtmlFiles
        : [],
      failedItem: null,
      durationMs,
      performanceItem,
      uncollectedItem
    };
  }

  async waitForRiskControlCooldown(signal = null) {
    if (!this.riskControlCooldownPromise) {
      return;
    }

    assertNotCancelled(signal);
    await this.riskControlCooldownPromise;
    assertNotCancelled(signal);
  }

  async startRiskControlCooldown({
    delayMs,
    index,
    total,
    hotelInput,
    reason,
    retryCount,
    batchPerf,
    signal
  }) {
    const seconds = formatDelaySeconds(delayMs);
    if (batchPerf) {
      batchPerf.event('batch_risk_control_cooldown', {
        phase: 'batch_total',
        status: delayMs > 0 ? 'waiting' : 'skipped',
        pageIndex: index,
        hotelCount: total,
        retry_count: retryCount,
        delay_ms: delayMs,
        delay_seconds: seconds,
        hotelId: hotelInput.hotelId,
        hotelName: hotelInput.hotelName || '',
        url: hotelInput.url,
        reason
      });
    }
    this.context.emit(
      'batch:risk-cooldown',
      delayMs > 0
        ? `检测到携程 203/风控，暂停 ${seconds} 秒后重试当前酒店`
        : '检测到携程 203/风控，正在重试当前酒店',
      {
        pageIndex: index,
        hotelCount: total,
        retryCount,
        delayMs,
        delaySeconds: seconds,
        hotelId: hotelInput.hotelId,
        url: hotelInput.url,
        reason
      }
    );

    const cooldownPromise = delayWithSignal(delayMs, signal);
    this.riskControlCooldownPromise = cooldownPromise;
    try {
      await cooldownPromise;
    } finally {
      if (this.riskControlCooldownPromise === cooldownPromise) {
        this.riskControlCooldownPromise = null;
      }
    }
  }

  async retryRiskControlPreparedResult({
    preparedResult,
    detailContext,
    hotelInput,
    index,
    total,
    batchOptions,
    batchPerf,
    signal
  }) {
    const maxRetries = normalizeRiskControlRetryCount(this.context.args, batchOptions);
    if (maxRetries <= 0 || !detailContext || !isCtripRiskControlResult(preparedResult.result)) {
      return preparedResult;
    }

    const delayMs = normalizeRiskControlRetryDelayMs(this.context.args, batchOptions);
    let bestPreparedResult = preparedResult;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const reason = getCtripRiskControlReason(bestPreparedResult.result);
      await this.startRiskControlCooldown({
        delayMs,
        index,
        total,
        hotelInput,
        reason,
        retryCount: attempt,
        batchPerf,
        signal
      });

      assertNotCancelled(signal);
      batchPerf.event('batch_risk_control_retry', {
        phase: 'batch_total',
        status: 'retrying',
        pageIndex: index,
        hotelCount: total,
        retry_count: attempt,
        hotelId: hotelInput.hotelId,
        hotelName: bestPreparedResult.result && bestPreparedResult.result.hotelName,
        url: hotelInput.url,
        reason
      });
      this.context.emit('batch:risk-retry', '正在重试触发 203/风控的酒店', {
        pageIndex: index,
        hotelCount: total,
        retryCount: attempt,
        hotelId: hotelInput.hotelId,
        url: hotelInput.url,
        reason
      });

      const retryContext = {
        ...detailContext,
        taskId: `${detailContext.taskId}-risk-retry${attempt}`
      };
      try {
        const retryPreparedResult = await this.singleDetailRunner.run(retryContext);
        const stillBlocked = isCtripRiskControlResult(retryPreparedResult.result);
        const retrySignals = summarizeSnapshotRiskSignals(
          (retryPreparedResult.result && retryPreparedResult.result.pageSnapshot) || {}
        );
        batchPerf.event('batch_risk_control_retry_result', {
          phase: 'batch_total',
          status: stillBlocked ? 'still_blocked' : 'resolved',
          pageIndex: index,
          hotelCount: total,
          retry_count: attempt,
          hotelId: hotelInput.hotelId,
          hotelName: retryPreparedResult.result && retryPreparedResult.result.hotelName,
          url: hotelInput.url,
          eligible_count: retryPreparedResult.result && retryPreparedResult.result.eligibleCount,
          room_price_visible: Boolean(
            retryPreparedResult.result &&
            retryPreparedResult.result.pageSnapshot &&
            retryPreparedResult.result.pageSnapshot.room_price_visible
          ),
          spider_error_codes: retrySignals.spiderErrorCodes
        });

        bestPreparedResult = retryPreparedResult;
        if (!stillBlocked) {
          return bestPreparedResult;
        }
      } catch (error) {
        if (isCancellationError(error, signal)) {
          throw error;
        }
        batchPerf.event('batch_risk_control_retry_error', {
          phase: 'batch_total',
          status: 'error',
          pageIndex: index,
          hotelCount: total,
          retry_count: attempt,
          hotelId: hotelInput.hotelId,
          url: hotelInput.url,
          error_type: error && error.name ? error.name : 'Error',
          error_message: error && error.message ? error.message : String(error)
        });
        break;
      }
    }

    return bestPreparedResult;
  }

  abortForCtripRiskControl({
    childResult = {},
    preparedScrape = {},
    detailContext = null,
    hotelInput = {},
    index,
    total,
    batchPerf
  }) {
    const { emit } = this.context;
    const reason = getCtripRiskControlReason(childResult, preparedScrape);
    const resolvedHotelInput =
      hotelInput ||
      (detailContext && detailContext.hotelInput) ||
      (preparedScrape.context && preparedScrape.context.hotelInput) ||
      {};
    const pageSnapshot =
      childResult.pageSnapshot ||
      childResult.page_snapshot ||
      (preparedScrape.scraped && preparedScrape.scraped.page_snapshot) ||
      {};
    const signals = summarizeSnapshotRiskSignals(pageSnapshot);

    if (batchPerf) {
      batchPerf.event('batch_risk_control_abort', {
        phase: 'batch_total',
        status: 'aborted',
        pageIndex: index,
        hotelCount: total,
        hotelId: childResult.hotelId || resolvedHotelInput.hotelId,
        hotelName: childResult.hotelName || '',
        url: childResult.resolvedUrl || resolvedHotelInput.url || '',
        reason,
        spider_error_codes: signals.spiderErrorCodes
      });
    }
    emit('batch:aborted', '检测到携程 203/风控，已停止剩余批量采集', {
      pageIndex: index,
      hotelCount: total,
      hotelId: childResult.hotelId || resolvedHotelInput.hotelId,
      url: childResult.resolvedUrl || resolvedHotelInput.url || '',
      reason,
      spiderErrorCodes: signals.spiderErrorCodes
    });

    throw createCtripRiskControlAbortError({
      childResult,
      preparedScrape,
      hotelInput: resolvedHotelInput
    });
  }

  async mapPreparedBatchError({ error, index, total, meta, batchStats }) {
    const { taskId, emit, expandedInputs } = this.context;
    const hotelInput = (meta && meta.hotelInput) || expandedInputs.hotelInputs[index - 1] || {};
    const failedItem = {
      index,
      url: hotelInput.url,
      source: hotelInput.source,
      hotelId: hotelInput.hotelId,
      error: error && error.message ? error.message : String(error)
    };
    batchStats.recordTask({
      taskId: `${taskId}-${index}`,
      status: 'failed',
      elapsedMs: 0,
      index,
      hotelId: hotelInput.hotelId,
      url: hotelInput.url
    });
    emitBatchItemError(emit, { index, total, taskId, hotelInput, failedItem });

    return {
      index,
      hotelInput,
      childResult: null,
      childPayload: null,
      savedHtmlFiles: [],
      failedItem,
      durationMs: 0,
      performanceItem: null,
      uncollectedItem: null
    };
  }

  async runPipelinedBatchItems({
    concurrency,
    effectiveConcurrency,
    batchItemsDir,
    batchOptions,
    batchPerf,
    batchStats,
    reportDisabled,
    signal,
    edgeWorkers = [],
    transitCache
  }) {
    const { expandedInputs } = this.context;
    const transitConcurrency = Math.min(MAX_TRANSIT_CONCURRENCY, effectiveConcurrency);
    const limitTransit = createAsyncLimiter(transitConcurrency);
    const resultSettlements = [];
    const trackResultPromise = (resultPromise) => {
      resultSettlements.push(
        Promise.resolve(resultPromise).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason })
        )
      );
      return resultPromise;
    };

    const scrapeRun = await runBoundedWorkers({
      items: expandedInputs.hotelInputs,
      requestedConcurrency: concurrency,
      workerContexts: edgeWorkers,
      maxConcurrency: effectiveConcurrency,
      signal,
      runItem: async ({ item: hotelInput, index, total, worker }) => {
        let detailContext = null;
        let meta = null;
        let schedulerStarted = false;
        let schedulerRecorded = false;

        try {
          await this.detailScheduler.beforeStart({ index, total, signal });
          schedulerStarted = true;
          const preparedContext = this.createPreparedBatchDetailContext({
            hotelInput,
            index,
            total,
            worker,
            batchItemsDir,
            batchOptions,
            batchPerf,
            reportDisabled,
            transitCache,
            signal
          });
          detailContext = preparedContext.context;
          meta = preparedContext.meta;
          const preparedScrape = await this.singleDetailRunner.collectPreparedScrape(detailContext);
          this.detailScheduler.recordOutcome(preparedScrape.scraped || {}, { index, total });
          schedulerRecorded = true;
          const resultPromise = limitTransit(async () => {
            try {
              assertNotCancelled(signal);
              const preparedResult =
                await this.singleDetailRunner.completePreparedScrape(preparedScrape);
              return this.mapPreparedBatchResult({
                preparedResult,
                detailContext,
                index,
                total,
                meta,
                batchOptions,
                batchPerf,
                batchStats,
                signal
              });
            } catch (error) {
              if (isCancellationError(error, signal)) {
                throw error;
              }
              return this.mapPreparedBatchError({ error, index, total, meta, batchStats });
            }
          });
          trackResultPromise(resultPromise);
          return { index, resultPromise };
        } catch (error) {
          if (schedulerStarted && !schedulerRecorded) {
            this.detailScheduler.recordError(error, { index, total });
          }
          if (isCancellationError(error, signal)) {
            throw error;
          }
          const resultPromise = Promise.resolve(
            this.mapPreparedBatchError({ error, index, total, meta, batchStats })
          );
          trackResultPromise(resultPromise);
          return { index, resultPromise };
        }
      }
    });

    const settledResults = await Promise.all(resultSettlements);
    const rejected = settledResults.find((result) => result.status === 'rejected');
    if (rejected) {
      throw rejected.reason;
    }

    const results = settledResults
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter(Boolean)
      .sort((left, right) => left.index - right.index);

    return {
      ...scrapeRun,
      results
    };
  }

  async runPreparedBatchItems({
    concurrency,
    effectiveConcurrency,
    batchItemsDir,
    batchOptions,
    batchPerf,
    batchStats,
    reportDisabled,
    signal,
    edgeWorkers = []
  }) {
    const { expandedInputs } = this.context;
    const transitCache = createTransitCache();

    const supportsPipeline =
      effectiveConcurrency > 1 &&
      this.singleDetailRunner &&
      typeof this.singleDetailRunner.collectPreparedScrape === 'function' &&
      typeof this.singleDetailRunner.completePreparedScrape === 'function';

    if (supportsPipeline) {
      return this.runPipelinedBatchItems({
        concurrency,
        effectiveConcurrency,
        batchItemsDir,
        batchOptions,
        batchPerf,
        batchStats,
        reportDisabled,
        signal,
        edgeWorkers,
        transitCache
      });
    }

    return runPreparedDetailBatch({
      items: expandedInputs.hotelInputs,
      requestedConcurrency: concurrency,
      workerContexts: edgeWorkers,
      maxConcurrency: effectiveConcurrency,
      signal,
      singleDetailRunner: this.singleDetailRunner,
      createDetailContext: async ({ item: hotelInput, index, total, worker }) => {
        await this.detailScheduler.beforeStart({ index, total, signal });
        try {
          const preparedContext = this.createPreparedBatchDetailContext({
            hotelInput,
            index,
            total,
            worker,
            batchItemsDir,
            batchOptions,
            batchPerf,
            reportDisabled,
            transitCache,
            signal
          });
          preparedContext.meta = {
            ...(preparedContext.meta || {}),
            schedulerStarted: true,
            schedulerRecorded: false
          };
          return preparedContext;
        } catch (error) {
          this.detailScheduler.recordError(error, { index, total });
          throw error;
        }
      },
      mapPreparedResult: async ({ preparedResult, detailContext, index, total, meta }) => {
        this.detailScheduler.recordOutcome(preparedResult.result || {}, { index, total });
        if (meta) meta.schedulerRecorded = true;
        return this.mapPreparedBatchResult({
          preparedResult,
          detailContext,
          index,
          total,
          meta,
          batchOptions,
          batchPerf,
          batchStats,
          signal
        });
      },
      mapDetailError: async ({ error, index, total, meta }) => {
        if (meta && meta.schedulerStarted && !meta.schedulerRecorded) {
          this.detailScheduler.recordError(error, { index, total });
          meta.schedulerRecorded = true;
        }
        return this.mapPreparedBatchError({ error, index, total, meta, batchStats });
      }
    });
  }

  async retryUncollectedPreparedResult({
    preparedResult,
    detailContext,
    hotelInput,
    index,
    total,
    batchOptions,
    batchPerf,
    signal
  }) {
    const maxRetries = normalizeUncollectedRetryCount(this.context.args, batchOptions);
    if (maxRetries <= 0 || !detailContext || !isRetryableUncollectedResult(preparedResult.result)) {
      return preparedResult;
    }

    let bestPreparedResult = preparedResult;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      if (!isRetryableUncollectedResult(bestPreparedResult.result)) {
        break;
      }

      assertNotCancelled(signal);
      batchPerf.event('batch_item_uncollected_retry', {
        phase: 'batch_total',
        status: 'retrying',
        pageIndex: index,
        hotelCount: total,
        retry_count: attempt,
        hotelId: hotelInput.hotelId,
        hotelName: bestPreparedResult.result && bestPreparedResult.result.hotelName,
        url: hotelInput.url,
        eligible_count: bestPreparedResult.result && bestPreparedResult.result.eligibleCount,
        wait_reason:
          bestPreparedResult.result &&
          bestPreparedResult.result.pageSnapshot &&
          bestPreparedResult.result.pageSnapshot.wait_reason,
        capture_method:
          bestPreparedResult.result &&
          bestPreparedResult.result.pageSnapshot &&
          bestPreparedResult.result.pageSnapshot.capture_method
      });

      const retryContext = {
        ...detailContext,
        taskId: `${detailContext.taskId}-retry${attempt}`
      };
      try {
        const retryPreparedResult = await this.singleDetailRunner.run(retryContext);
        const previousEligible = Number(bestPreparedResult.result.eligibleCount || 0);
        const retryEligible = Number(retryPreparedResult.result.eligibleCount || 0);
        batchPerf.event('batch_item_uncollected_retry_result', {
          phase: 'batch_total',
          status: retryEligible > 0 ? 'success' : 'still_uncollected',
          pageIndex: index,
          hotelCount: total,
          retry_count: attempt,
          hotelId: hotelInput.hotelId,
          hotelName: retryPreparedResult.result && retryPreparedResult.result.hotelName,
          url: hotelInput.url,
          eligible_count: retryEligible,
          previous_eligible_count: previousEligible
        });

        if (retryEligible > previousEligible) {
          bestPreparedResult = retryPreparedResult;
        }
        if (retryEligible > 0) {
          break;
        }
      } catch (error) {
        if (isCancellationError(error, signal)) {
          throw error;
        }
        batchPerf.event('batch_item_uncollected_retry_error', {
          phase: 'batch_total',
          status: 'error',
          pageIndex: index,
          hotelCount: total,
          retry_count: attempt,
          hotelId: hotelInput.hotelId,
          url: hotelInput.url,
          error_type: error && error.name ? error.name : 'Error',
          error_message: error && error.message ? error.message : String(error)
        });
      }
    }

    return bestPreparedResult;
  }

  async finalizeBatchResult({
    batchStartedAt,
    batchPerf,
    batchStats,
    batchPhase,
    itemResults,
    performance,
    reportDisabled
  }) {
    const {
      args,
      startedAt,
      emit,
      latestRunPath,
      outputDir,
      template,
      matchedTemplate,
      effectiveTemplate,
      compareAppSettings,
      expandedInputs,
      reportLevel = 'normal'
    } = this.context;

    const {
      childResults,
      resultPayloads,
      failedItems,
      savedHtmlFiles,
      uncollectedItems,
      performanceItems,
      itemMs,
      allHotels
    } = prepareBatchCollections({
      itemResults,
      reportDisabled
    });

    performance.itemMs = itemMs;
    performance.items = performanceItems;
    performance.scheduler = this.detailScheduler ? this.detailScheduler.snapshot() : null;

    const writeResult = await writeBatchAppData({
      args,
      emit,
      batchPerf,
      allHotels,
      resultPayloads,
      reportDisabled,
      performance
    });

    const outputPath = reportDisabled
      ? ''
      : path.resolve(
          args.out ||
            path.join(
              outputDir,
              `batch-${slugify(effectiveTemplate.template_name || (matchedTemplate && matchedTemplate.name) || 'ctrip-hotels')}.json`
            )
        );

    const cleanupResult = await cleanupBatchArtifacts({
      args,
      batchPerf,
      outputDir,
      outputPath,
      reportLevel,
      reportDisabled,
      resultPayloads,
      savedHtmlFiles,
      allHotels,
      performance
    });
    performance.totalMs = durationSince(batchStartedAt);

    const listResultsSummary = reportDisabled
      ? null
      : buildListResultsSummary(expandedInputs.listResults || []);

    if (!reportDisabled) {
      const buildReportStartedAt = Date.now();
      const outputPayload = await batchPerf.runPhase(
        'build_report',
        { hotelCount: allHotels.length, reportLevel },
        async () =>
          buildBatchOutputPayload({
            args,
            template,
            matchedTemplate,
            effectiveTemplate,
            compareAppSettings,
            expandedInputs,
            resultPayloads,
            childResults,
            failedItems,
            allHotels,
            writeResult,
            performance,
            reportLevel,
            listResultsSummary
          })
      );
      performance.buildReportMs = durationSince(buildReportStartedAt);

      await writeBatchReportArtifact({
        batchPerf,
        outputPath,
        outputPayload,
        performance,
        reportLevel,
        allHotels
      });
    }

    const result = buildBatchResult({
      startedAt,
      outputPath,
      effectiveTemplate,
      matchedTemplate,
      expandedInputs,
      allHotels,
      childResults,
      failedItems,
      compareAppSettings,
      writeResult,
      cleanupResult,
      performance,
      reportLevel
    });

    await writeBatchLatestRunSummary({
      batchPerf,
      latestRunPath,
      result,
      allHotels
    });
    emit('task:done', '批量采集任务完成', {
      inputMode: expandedInputs.inputMode,
      hotelCount: expandedInputs.hotelInputs.length,
      eligibleCount: result.eligibleCount,
      failedCount: failedItems.length,
      wrote: Boolean(writeResult)
    });
    batchStats.flush({
      hotelCount: expandedInputs.hotelInputs.length,
      elapsed_ms: performance.totalMs,
      list_expand_ms:
        (performance.listExpansion &&
          (performance.listExpansion.listCollectMs || performance.listExpansion.totalMs)) ||
        0,
      child_phase_sum:
        performance.itemMs +
        performance.writeMs +
        performance.outputWriteMs +
        performance.cleanupMs,
      uncollected_count: uncollectedItems.length,
      uncollected_items: uncollectedItems,
      status: failedItems.length ? 'partial' : 'success'
    });
    batchPhase.end(failedItems.length ? 'partial' : 'success', {
      hotelCount: expandedInputs.hotelInputs.length,
      elapsed_ms: performance.totalMs
    });

    return result;
  }
}

async function runBatchHotelImportTask(context) {
  return new BatchOrchestrator(context).run();
}

module.exports = {
  BatchOrchestrator,
  runBatchHotelImportTask
};
