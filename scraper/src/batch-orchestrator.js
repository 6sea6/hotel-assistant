const path = require('path');
const { buildListResultsSummary, describeExpandedInput } = require('./ctrip-list');
const { ensureDir, slugify } = require('./utils');
const { setup_perf_logger, PerfTimer, BatchStats } = require('./runtime/perf');
const {
  assertNotCancelled,
  createTransitCache,
  durationSince,
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
const { getEffectiveBoundedConcurrency } = require('./bounded-worker-runner');
const { runPreparedDetailBatch } = require('./prepared-detail-batch-collector');

const MAX_BATCH_CONCURRENCY = 2;

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
    const total = this.context.expandedInputs.hotelInputs.length;
    const effectiveConcurrency = getEffectiveBoundedConcurrency({
      requestedConcurrency: concurrency,
      total,
      maxConcurrency: batchOptions.maxConcurrency || MAX_BATCH_CONCURRENCY
    });

    if (effectiveConcurrency <= 1) {
      return this.runSequential({ concurrency, batchOptions });
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
    const transitCache = createTransitCache();

    return runPreparedDetailBatch({
      items: expandedInputs.hotelInputs,
      requestedConcurrency: concurrency,
      workerContexts: edgeWorkers,
      maxConcurrency: effectiveConcurrency,
      signal,
      singleDetailRunner: this.singleDetailRunner,
      createDetailContext: async ({ item: hotelInput, index, total, worker }) => {
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
            scrapeEventForwarder
          },
          meta: {
            itemStartedAt: Date.now(),
            hotelInput
          }
        };
      },
      mapPreparedResult: async ({ preparedResult, index, total, meta }) => {
        const hotelInput = meta.hotelInput;
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
          captureMethod:
            (childResult.pageSnapshot && childResult.pageSnapshot.capture_method) || '',
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
      },
      mapDetailError: async ({ error, index, total, meta }) => {
        const hotelInput =
          (meta && meta.hotelInput) || expandedInputs.hotelInputs[index - 1] || {};
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
    });
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

      writeBatchReportArtifact({
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
