const path = require('path');
const { buildListResultsSummary, describeExpandedInput } = require('./ctrip-list');
const { buildRunSummary, writeLatestRunFile } = require('./cli/run-summary');
const { cleanupOutputArtifacts, ensureDir, slugify, writeJsonFile } = require('./utils');
const { setup_perf_logger, PerfTimer, BatchStats } = require('./runtime/perf');
const {
  assertNotCancelled,
  createTransitCache,
  durationSince,
  isReportDisabled,
  normalizeBatchConcurrency,
  resolveBatchCaptureStrategy,
  shouldCleanupOutputArtifactsForRun
} = require('./task-context');
const { emitBatchItemDone, emitBatchItemError, emitBatchItemStart } = require('./task-events');
const { SingleDetailRunner } = require('./single-detail-runner');
const {
  buildBatchOutputPayload,
  buildBatchResult,
  buildUncollectedHotelPerfRecord
} = require('./batch-result-builder');
const { writeBatchHotelRecords } = require('./task-writeback');

class BatchOrchestrator {
  constructor(context, options = {}) {
    this.context = context;
    this.options = options;
    this.singleDetailRunner = options.singleDetailRunner || new SingleDetailRunner();
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

    if (concurrency > 1) {
      return this.runConcurrent({ concurrency, batchOptions });
    }

    return this.runSequential({ concurrency, batchOptions });
  }

  async runConcurrent({ concurrency, batchOptions }) {
    return this.runSequential({ concurrency, batchOptions });
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

  createPerformance({ concurrency }) {
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
      effectiveConcurrency: 1,
      parallelRequestedButDisabled: concurrency > 1
    };
  }

  async runSequential({ concurrency, batchOptions }) {
    const { emit, signal, outputDir, expandedInputs, reportLevel = 'normal' } = this.context;
    const reportDisabled = isReportDisabled(reportLevel);
    const { batchPerf, batchStats, batchPhase } = this.createBatchRuntime({ concurrency });

    try {
      emit('batch:start', '正在批量采集携程酒店页面', {
        summary: describeExpandedInput(expandedInputs),
        concurrency
      });

      if (concurrency > 1) {
        batchPerf.event('parallel_requested_but_disabled', {
          phase: 'batch_total',
          status: 'fallback_serial',
          requested_concurrency: concurrency,
          effective_concurrency: 1
        });
      }

      const batchStartedAt = Date.now();
      const batchItemsDir = path.join(outputDir, 'batch-items');
      if (!reportDisabled) {
        ensureDir(batchItemsDir);
      }
      const performance = this.createPerformance({ concurrency });
      const transitCache = createTransitCache();
      const itemResults = [];

      for (
        let zeroBasedIndex = 0;
        zeroBasedIndex < expandedInputs.hotelInputs.length;
        zeroBasedIndex += 1
      ) {
        const itemResult = await this.runBatchItem({
          index: zeroBasedIndex + 1,
          total: expandedInputs.hotelInputs.length,
          batchItemsDir,
          batchOptions,
          batchPerf,
          batchStats,
          reportDisabled,
          signal,
          transitCache
        });
        itemResults.push(itemResult);
      }

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

  async runBatchItem({
    index,
    total,
    batchItemsDir,
    batchOptions,
    batchPerf,
    batchStats,
    reportDisabled,
    signal,
    transitCache
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
      expandedInputs,
      reportLevel = 'normal',
      scrapeEventForwarder = null
    } = this.context;

    assertNotCancelled(signal);
    const hotelInput = expandedInputs.hotelInputs[index - 1];
    emitBatchItemStart(emit, { index, total, taskId, hotelInput });

    const childOutputPath = reportDisabled
      ? ''
      : path.join(
          batchItemsDir,
          `batch-item-${String(index).padStart(3, '0')}-${hotelInput.hotelId || 'hotel'}.json`
        );

    try {
      const itemStartedAt = Date.now();
      const preparedResult = await this.singleDetailRunner.run({
        args,
        startedAt,
        taskId: `${taskId}-${index}`,
        emit,
        signal,
        outputDir,
        template,
        matchedTemplate,
        effectiveTemplate,
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
        scrapeEventForwarder
      });
      const childResult = preparedResult.result;
      childResult.inputIndex = index;
      childResult.inputSource = hotelInput.source;
      childResult.hotelId = hotelInput.hotelId;
      childResult.listCandidate = hotelInput.listCandidate || null;

      const durationMs = durationSince(itemStartedAt);
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
    } catch (error) {
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

    const orderedItemResults = [...itemResults].sort((left, right) => left.index - right.index);
    const childResults = orderedItemResults
      .map((item) => item.childResult)
      .filter((childResult) => childResult);
    const resultPayloads = orderedItemResults
      .map((item) => item.childPayload)
      .filter((childPayload) => childPayload);
    const failedItems = orderedItemResults
      .map((item) => item.failedItem)
      .filter((failedItem) => failedItem);
    const savedHtmlFiles = orderedItemResults.flatMap((item) =>
      Array.isArray(item.savedHtmlFiles) ? item.savedHtmlFiles : []
    );
    const uncollectedItems = orderedItemResults
      .map((item) => item.uncollectedItem)
      .filter((uncollectedItem) => uncollectedItem);

    performance.itemMs = orderedItemResults.reduce(
      (sum, item) => sum + Number(item.durationMs || 0),
      0
    );
    performance.items = orderedItemResults
      .map((item) => item.performanceItem)
      .filter((performanceItem) => performanceItem);

    const allHotels = reportDisabled
      ? childResults.flatMap((result) =>
          Array.isArray(result.eligibleHotels) ? result.eligibleHotels : []
        )
      : resultPayloads.flatMap((payload) => (Array.isArray(payload.hotels) ? payload.hotels : []));

    let writeResult = null;
    if (args['write-app-data']) {
      emit('write:start', '正在批量写入宾馆比较数据');
      const writeStartedAt = Date.now();
      writeResult = await batchPerf.runPhase(
        'save_data',
        { hotelCount: allHotels.length, taskKind: 'batch_apply' },
        async () => writeBatchHotelRecords({ allHotels, resultPayloads, reportDisabled })
      );
      performance.writeMs = durationSince(writeStartedAt);
    }

    const outputPath = reportDisabled
      ? ''
      : path.resolve(
          args.out ||
            path.join(
              outputDir,
              `batch-${slugify(effectiveTemplate.template_name || (matchedTemplate && matchedTemplate.name) || 'ctrip-hotels')}.json`
            )
        );

    const snapshotFiles = reportDisabled
      ? savedHtmlFiles
      : resultPayloads.flatMap((payload) => {
          const pageSnapshot =
            payload && payload.scrape_debug && payload.scrape_debug.page_snapshot;
          return pageSnapshot && Array.isArray(pageSnapshot.saved_html_files)
            ? pageSnapshot.saved_html_files
            : [];
        });
    let cleanupResult = { deletedFiles: [], skipped: true };
    if (shouldCleanupOutputArtifactsForRun(reportLevel, args)) {
      const cleanupStartedAt = Date.now();
      cleanupResult = await batchPerf.runPhase(
        'close_resource',
        { hotelCount: allHotels.length },
        async () => cleanupOutputArtifacts(outputDir, outputPath, snapshotFiles)
      );
      performance.cleanupMs = durationSince(cleanupStartedAt);
    }
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

      const outputWriteStartedAt = Date.now();
      const writeReportPhase = batchPerf.phase('write_report', {
        hotelCount: allHotels.length,
        reportLevel
      });
      const isFullReport = reportLevel === 'full';
      const measure = writeJsonFile(outputPath, outputPayload, {
        pretty: isFullReport,
        measure: true
      });
      if (measure) {
        performance.reportBytes = measure.bytes;
        performance.reportStringifyMs = measure.stringifyMs;
        performance.reportWriteMs = measure.writeMs;
        performance.reportTotalWriteMs = measure.totalMs;
      }
      writeReportPhase.end('success', {
        report_bytes: measure ? measure.bytes : 0,
        report_stringify_ms: measure ? measure.stringifyMs : 0,
        report_file_write_ms: measure ? measure.writeMs : 0,
        report_total_write_ms: measure ? measure.totalMs : 0
      });
      performance.outputWriteMs = durationSince(outputWriteStartedAt);
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

    await batchPerf.runPhase('write_latest_run', { hotelCount: allHotels.length }, async () => {
      writeLatestRunFile(
        latestRunPath,
        buildRunSummary({
          ...result,
          eligibleHotels: allHotels
        })
      );
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
