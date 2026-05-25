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

  async run() {
    const {
      args,
      startedAt,
      taskId,
      emit,
      signal,
      latestRunPath,
      outputDir,
      template,
      matchedTemplate,
      effectiveTemplate,
      compareAppSettings,
      effectiveDestination,
      expandedInputs,
      reportLevel = 'normal',
      options: contextOptions = {},
      scrapeEventForwarder = null
    } = this.context;
    const reportDisabled = isReportDisabled(reportLevel);
    const batchOptions = {
      ...contextOptions,
      ...this.options
    };
    const concurrency = normalizeBatchConcurrency(args, batchOptions);

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
      const performance = {
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
      const transitCache = createTransitCache();
      const childResults = [];
      const resultPayloads = [];
      const savedHtmlFiles = [];
      const failedItems = [];
      const uncollectedItems = [];

      for (let index = 0; index < expandedInputs.hotelInputs.length; index += 1) {
        assertNotCancelled(signal);
        const hotelInput = expandedInputs.hotelInputs[index];
        emit(
          'batch:item-start',
          `正在采集第 ${index + 1}/${expandedInputs.hotelInputs.length} 家酒店`,
          {
            index: index + 1,
            total: expandedInputs.hotelInputs.length,
            url: hotelInput.url,
            source: hotelInput.source
          }
        );

        const childOutputPath = reportDisabled
          ? ''
          : path.join(
              batchItemsDir,
              `batch-item-${String(index + 1).padStart(3, '0')}-${hotelInput.hotelId || 'hotel'}.json`
            );

        try {
          const itemStartedAt = Date.now();
          const preparedResult = await this.singleDetailRunner.run({
            args,
            startedAt,
            taskId: `${taskId}-${index + 1}`,
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
            pageIndex: index + 1,
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
          const childPayload = preparedResult.outputPayload;
          if (childPayload) {
            resultPayloads.push(childPayload);
          }
          if (Array.isArray(preparedResult.savedHtmlFiles)) {
            savedHtmlFiles.push(...preparedResult.savedHtmlFiles);
          }
          childResult.inputIndex = index + 1;
          childResult.inputSource = hotelInput.source;
          childResult.hotelId = hotelInput.hotelId;
          childResult.listCandidate = hotelInput.listCandidate || null;
          childResults.push(childResult);
          const itemDurationMs = durationSince(itemStartedAt);
          performance.itemMs += itemDurationMs;
          performance.items.push({
            index: index + 1,
            hotelId: hotelInput.hotelId,
            hotelName: childResult.hotelName,
            durationMs: itemDurationMs,
            detail: childResult.performance || null
          });
          batchStats.recordTask({
            taskId: `${taskId}-${index + 1}`,
            status: 'success',
            elapsedMs: itemDurationMs,
            index: index + 1,
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
            index: index + 1,
            hotelInput,
            childResult,
            durationMs: itemDurationMs
          });
          if (uncollectedItem) {
            uncollectedItems.push(uncollectedItem);
            batchPerf.event('uncollected_hotel', {
              phase: 'batch_total',
              status: 'skipped',
              pageIndex: index + 1,
              hotelCount: expandedInputs.hotelInputs.length,
              ...uncollectedItem
            });
          }
          emit('batch:item-done', `第 ${index + 1} 家酒店采集完成`, {
            index: index + 1,
            total: expandedInputs.hotelInputs.length,
            hotelName: childResult.hotelName,
            eligibleCount: childResult.eligibleCount
          });
        } catch (error) {
          const failedItem = {
            index: index + 1,
            url: hotelInput.url,
            source: hotelInput.source,
            hotelId: hotelInput.hotelId,
            error: error && error.message ? error.message : String(error)
          };
          failedItems.push(failedItem);
          batchStats.recordTask({
            taskId: `${taskId}-${index + 1}`,
            status: 'failed',
            elapsedMs: 0,
            index: index + 1,
            hotelId: hotelInput.hotelId,
            url: hotelInput.url
          });
          emit('batch:item-error', `第 ${index + 1} 家酒店采集失败`, {
            ...failedItem,
            total: expandedInputs.hotelInputs.length
          });
        }
      }

      const allHotels = reportDisabled
        ? childResults.flatMap((result) =>
            Array.isArray(result.eligibleHotels) ? result.eligibleHotels : []
          )
        : resultPayloads.flatMap((payload) =>
            Array.isArray(payload.hotels) ? payload.hotels : []
          );

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
    } catch (error) {
      batchPhase.error(error, {
        hotelCount: expandedInputs.hotelInputs.length
      });
      throw error;
    }
  }
}

async function runBatchHotelImportTask(context) {
  return new BatchOrchestrator(context).run();
}

module.exports = {
  BatchOrchestrator,
  runBatchHotelImportTask
};
