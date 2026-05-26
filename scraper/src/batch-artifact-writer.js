const { buildRunSummary, writeLatestRunFile } = require('./cli/run-summary');
const { cleanupOutputArtifacts, writeJsonFile } = require('./utils');
const { durationSince, shouldCleanupOutputArtifactsForRun } = require('./task-context');
const { writeBatchHotelRecords } = require('./task-writeback');

/**
 * @typedef {Object} BatchItemResult
 * @property {number} index
 * @property {object} hotelInput
 * @property {object|null} childResult
 * @property {object|null} childPayload
 * @property {string[]} savedHtmlFiles
 * @property {object|null} failedItem
 * @property {number} durationMs
 * @property {object|null} performanceItem
 * @property {object|null} uncollectedItem
 */

/**
 * @param {{ itemResults: BatchItemResult[], reportDisabled?: boolean }} params
 */
function prepareBatchCollections({ itemResults = [], reportDisabled = false }) {
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
  const performanceItems = orderedItemResults
    .map((item) => item.performanceItem)
    .filter((performanceItem) => performanceItem);
  const itemMs = orderedItemResults.reduce((sum, item) => sum + Number(item.durationMs || 0), 0);
  const allHotels = reportDisabled
    ? childResults.flatMap((result) =>
        Array.isArray(result.eligibleHotels) ? result.eligibleHotels : []
      )
    : resultPayloads.flatMap((payload) => (Array.isArray(payload.hotels) ? payload.hotels : []));

  return {
    orderedItemResults,
    childResults,
    resultPayloads,
    failedItems,
    savedHtmlFiles,
    uncollectedItems,
    performanceItems,
    itemMs,
    allHotels
  };
}

async function writeBatchAppData({
  args,
  emit,
  batchPerf,
  allHotels,
  resultPayloads,
  reportDisabled,
  performance
}) {
  if (!args['write-app-data']) {
    return null;
  }

  emit('write:start', '正在批量写入宾馆比较数据');
  const writeStartedAt = Date.now();
  const writeResult = await batchPerf.runPhase(
    'save_data',
    { hotelCount: allHotels.length, taskKind: 'batch_apply' },
    async () => writeBatchHotelRecords({ allHotels, resultPayloads, reportDisabled })
  );
  performance.writeMs = durationSince(writeStartedAt);
  return writeResult;
}

async function cleanupBatchArtifacts({
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
}) {
  const snapshotFiles = reportDisabled
    ? savedHtmlFiles
    : resultPayloads.flatMap((payload) => {
        const pageSnapshot = payload && payload.scrape_debug && payload.scrape_debug.page_snapshot;
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
  return cleanupResult;
}

function writeBatchReportArtifact({
  batchPerf,
  outputPath,
  outputPayload,
  performance,
  reportLevel,
  allHotels,
  writeJsonFileImpl = writeJsonFile
}) {
  const outputWriteStartedAt = Date.now();
  const writeReportPhase = batchPerf.phase('write_report', {
    hotelCount: allHotels.length,
    reportLevel
  });
  const isFullReport = reportLevel === 'full';
  const measure = writeJsonFileImpl(outputPath, outputPayload, {
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
  return measure;
}

async function writeBatchLatestRunSummary({ batchPerf, latestRunPath, result, allHotels }) {
  await batchPerf.runPhase('write_latest_run', { hotelCount: allHotels.length }, async () => {
    writeLatestRunFile(
      latestRunPath,
      buildRunSummary({
        ...result,
        eligibleHotels: allHotels
      })
    );
  });
}

module.exports = {
  cleanupBatchArtifacts,
  prepareBatchCollections,
  writeBatchAppData,
  writeBatchLatestRunSummary,
  writeBatchReportArtifact
};
