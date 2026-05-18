function shouldEnablePerfLog() {
  return process.env.HOTEL_COLLECTOR_ENV === 'dev' && process.env.ENABLE_PERF_LOG === '1';
}

function loadPerfImplementation() {
  if (!shouldEnablePerfLog()) {
    return require('./noop-perf');
  }

  try {
    return require('../../../devtools/perf-log');
  } catch (error) {
    console.warn('[perf] 开发版性能日志模块不可用，已回退为空实现:', error.message);
    return require('./noop-perf');
  }
}

module.exports = {
  ...loadPerfImplementation(),
  shouldEnablePerfLog
};
