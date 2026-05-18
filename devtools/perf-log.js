const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const crypto = require('crypto');

const DEFAULT_FIELDS = {
  ts: '',
  level: 'info',
  event: '',
  run_id: '',
  task_id: '',
  phase: '',
  elapsed_ms: 0,
  status: '',
  error_type: '',
  error_message: '',
  city: '',
  url: '',
  page_index: null,
  hotel_count: null,
  retry_count: 0,
  captcha_detected: false
};

function normalizeDateSegment(date = new Date()) {
  if (typeof date === 'string' && date) {
    return date;
  }
  return date.toISOString().slice(0, 10);
}

function setup_perf_logger(options = {}) {
  const dateSegment = normalizeDateSegment(options.date);
  const logDir = path.resolve(options.logDir || path.join('logs', 'perf'));
  const logPath = path.resolve(
    options.logPath || path.join(logDir, `collect_perf_${dateSegment}.jsonl`)
  );
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  return {
    enabled: true,
    logPath,
    write(entry = {}) {
      const record = {
        ...DEFAULT_FIELDS,
        ...entry,
        ts: entry.ts || new Date().toISOString(),
        elapsed_ms: Number.isFinite(Number(entry.elapsed_ms)) ? Number(entry.elapsed_ms) : 0,
        retry_count: Number.isFinite(Number(entry.retry_count)) ? Number(entry.retry_count) : 0,
        captcha_detected: Boolean(entry.captcha_detected)
      };
      fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
      return record;
    }
  };
}

function normalizeMeta(meta = {}) {
  return {
    run_id: meta.runId || meta.run_id || '',
    task_id: meta.taskId || meta.task_id || '',
    city: meta.city || '',
    url: meta.url || '',
    page_index: meta.pageIndex ?? meta.page_index ?? null,
    hotel_count: meta.hotelCount ?? meta.hotel_count ?? null,
    retry_count: meta.retryCount ?? meta.retry_count ?? 0,
    captcha_detected: meta.captchaDetected ?? meta.captcha_detected ?? false
  };
}

function normalizeError(error) {
  if (!error) {
    return {
      error_type: '',
      error_message: ''
    };
  }
  return {
    error_type: error.name || 'Error',
    error_message: error.message || String(error)
  };
}

class PerfPhase {
  constructor(timer, phase, fields = {}) {
    this.timer = timer;
    this.phase = phase;
    this.fields = { ...fields };
    this.startedAt = performance.now();
    this.ended = false;
  }

  end(status = 'success', extra = {}) {
    if (this.ended) return null;
    this.ended = true;
    return this.timer.event('phase', {
      ...this.fields,
      ...extra,
      phase: this.phase,
      status,
      elapsed_ms: performance.now() - this.startedAt
    });
  }

  error(error, extra = {}) {
    if (this.ended) return null;
    this.ended = true;
    return this.timer.event('phase_error', {
      ...this.fields,
      ...extra,
      ...normalizeError(error),
      phase: this.phase,
      level: 'error',
      status: 'error',
      elapsed_ms: performance.now() - this.startedAt
    });
  }

  async run(callback) {
    try {
      const result = await callback();
      this.end('success');
      return result;
    } catch (error) {
      this.error(error);
      throw error;
    }
  }
}

class PerfTimer {
  constructor(logger = setup_perf_logger(), meta = {}) {
    this.logger = logger;
    this.meta = normalizeMeta({
      runId: meta.runId || meta.run_id || crypto.randomUUID(),
      ...meta
    });
    this.enabled = Boolean(logger && logger.enabled);
  }

  child(meta = {}) {
    return new PerfTimer(this.logger, {
      ...this.meta,
      ...meta
    });
  }

  phase(phase, fields = {}) {
    return new PerfPhase(this, phase, fields);
  }

  async runPhase(phase, fields = {}, callback = null) {
    if (typeof fields === 'function') {
      return this.phase(phase).run(fields);
    }
    return this.phase(phase, fields).run(callback);
  }

  event(event, fields = {}) {
    if (!this.logger || !this.logger.enabled) return null;
    const normalized = normalizeMeta({
      ...this.meta,
      ...fields
    });
    return this.logger.write({
      ...this.meta,
      ...fields,
      ...normalized,
      event,
      phase: fields.phase || '',
      status: fields.status || '',
      level: fields.level || 'info'
    });
  }
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

class BatchStats {
  constructor(perfTimer, meta = {}) {
    this.perfTimer = perfTimer;
    this.meta = { ...meta };
    this.tasks = [];
  }

  recordTask(task = {}) {
    this.tasks.push({ ...task });
  }

  summary(extra = {}) {
    const durations = this.tasks
      .map((task) => Number(task.elapsedMs ?? task.elapsed_ms ?? 0))
      .filter((value) => Number.isFinite(value));
    const totalTasks = this.tasks.length;
    const successTasks = this.tasks.filter((task) => task.status === 'success').length;
    const failedTasks = this.tasks.filter((task) => task.status === 'failed').length;
    const totalMs = durations.reduce((sum, value) => sum + value, 0);

    return {
      ...this.meta,
      totalTasks,
      successTasks,
      failedTasks,
      averageMs: durations.length ? totalMs / durations.length : 0,
      p90Ms: percentile(durations, 90),
      maxMs: durations.length ? Math.max(...durations) : 0,
      ...extra
    };
  }

  flush(extra = {}) {
    const summary = this.summary(extra);
    if (this.perfTimer && typeof this.perfTimer.event === 'function') {
      this.perfTimer.event('batch_summary', {
        phase: 'batch_total',
        status: failedTasksFromSummary(summary) > 0 ? 'partial' : 'success',
        hotel_count: summary.hotelCount ?? summary.hotel_count ?? summary.totalTasks,
        elapsed_ms: summary.averageMs || 0,
        ...summary
      });
    }
    return summary;
  }
}

function failedTasksFromSummary(summary = {}) {
  return Number(summary.failedTasks || summary.failed_tasks || 0);
}

module.exports = {
  setup_perf_logger,
  PerfTimer,
  BatchStats
};
