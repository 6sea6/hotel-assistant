const path = require('path');
const { parseArgs } = require('./utils');

function buildTemplateSnapshot(template, source = '') {
  if (!template || typeof template !== 'object') {
    return null;
  }

  return {
    source,
    id: template.id ?? template.template_id ?? null,
    name: template.name || template.template_name || '',
    destination: template.destination || '',
    check_in_date: template.check_in_date || '',
    check_out_date: template.check_out_date || '',
    room_count: template.room_count ?? null,
    created_at: template.created_at || null
  };
}

function normalizeTaskArgs(args = {}) {
  if (Array.isArray(args)) {
    return parseArgs(args);
  }

  return {
    ...args
  };
}

function assertNotCancelled(signal) {
  if (signal && signal.aborted) {
    throw new Error('任务已取消');
  }
}

async function withWorkingDirectory(workingDirectory, task) {
  const normalizedWorkingDirectory = workingDirectory ? path.resolve(workingDirectory) : '';
  if (!normalizedWorkingDirectory) {
    return task();
  }

  const previousCwd = process.cwd();
  process.chdir(normalizedWorkingDirectory);
  try {
    return await task();
  } finally {
    process.chdir(previousCwd);
  }
}

function buildEdgeSessionOptions(effectiveTemplate = {}) {
  return {
    userDataDir: effectiveTemplate.edge_user_data_dir,
    profileDirectory: effectiveTemplate.edge_profile_directory,
    debuggerUrl: effectiveTemplate.edge_debugger_url,
    debuggingPort: effectiveTemplate.edge_debugging_port,
    headless: effectiveTemplate.edge_headless
  };
}

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function isReportDisabled(reportLevel) {
  return reportLevel === 'off';
}

function resolveBatchCaptureStrategy(args = {}, options = {}, autoEdge = false) {
  const explicitCaptureStrategy =
    args.captureStrategy || args['capture-strategy'] || options.captureStrategy || null;
  if (explicitCaptureStrategy) {
    return explicitCaptureStrategy;
  }

  return autoEdge ? 'parallel_edge' : null;
}

function shouldCleanupOutputArtifactsForRun(reportLevel, args = {}) {
  if (!isReportDisabled(reportLevel)) {
    return true;
  }

  return Boolean(
    args['save-html'] ||
    process.env.HOTEL_DEBUG_EDGE_CAPTURE_DIR ||
    process.env.HOTEL_DEBUG_EDGE_CAPTURE === '1'
  );
}

function createTransitCache() {
  return {
    geocode: new Map(),
    places: new Map(),
    nearestSubway: new Map(),
    walkingRoutes: new Map(),
    transitRoutes: new Map()
  };
}

function normalizeBatchConcurrency(args = {}, options = {}) {
  const rawValue = options.concurrency ?? args.concurrency ?? args['batch-concurrency'] ?? 1;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

module.exports = {
  assertNotCancelled,
  buildEdgeSessionOptions,
  buildTemplateSnapshot,
  createTransitCache,
  durationSince,
  isReportDisabled,
  normalizeBatchConcurrency,
  normalizeTaskArgs,
  resolveBatchCaptureStrategy,
  shouldCleanupOutputArtifactsForRun,
  withWorkingDirectory
};
