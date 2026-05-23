function shouldEnablePerfLog(options = {}) {
  if (options.enabled === true) return true;
  return process.env.HOTEL_COLLECTOR_ENV === 'dev' && process.env.ENABLE_PERF_LOG === '1';
}

function setup_perf_logger(options = {}) {
  if (!shouldEnablePerfLog(options)) {
    return require('./noop-perf').setup_perf_logger(options);
  }
  return require('./file-perf').setup_perf_logger({ ...options, enabled: true });
}

const filePerf = require('./file-perf');
const noopPerf = require('./noop-perf');

module.exports = {
  setup_perf_logger,
  PerfTimer: filePerf.PerfTimer,
  BatchStats: filePerf.BatchStats,
  shouldEnablePerfLog
};
