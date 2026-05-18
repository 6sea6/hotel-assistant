class NoopPhase {
  end() {}

  error() {}

  async run(callback) {
    return callback();
  }
}

function setup_perf_logger() {
  return {
    enabled: false,
    logPath: '',
    write() {}
  };
}

class PerfTimer {
  constructor(logger = setup_perf_logger(), meta = {}) {
    this.logger = logger;
    this.meta = { ...meta };
    this.enabled = false;
  }

  child(meta = {}) {
    return new PerfTimer(this.logger, {
      ...this.meta,
      ...meta
    });
  }

  phase() {
    return new NoopPhase();
  }

  async runPhase(_phase, _fields, callback) {
    if (typeof _fields === 'function') {
      return _fields();
    }
    return callback();
  }

  event() {}
}

class BatchStats {
  constructor() {
    this.tasks = [];
  }

  recordTask(task = {}) {
    this.tasks.push({ ...task });
  }

  summary(extra = {}) {
    const totalTasks = this.tasks.length;
    const successTasks = this.tasks.filter((task) => task.status === 'success').length;
    const failedTasks = this.tasks.filter((task) => task.status === 'failed').length;
    return {
      totalTasks,
      successTasks,
      failedTasks,
      ...extra
    };
  }

  flush(extra = {}) {
    return this.summary(extra);
  }
}

module.exports = {
  setup_perf_logger,
  PerfTimer,
  BatchStats
};
