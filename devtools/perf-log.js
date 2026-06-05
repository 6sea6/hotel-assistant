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
  captcha_detected: false,
  task_kind: '',
  mode: '',
  wait_reason: '',
  capture_method: '',
  endpoint: '',
  variant_name: '',
  selected_room_source: '',
  selected_room_price_locked: false,
  room_candidates_count: null,
  eligible_room_count: null,
  raw_room_candidates_count: null,
  room_price_visible: false,
  spider_error_codes: [],
  tracked_url_count: null,
  edge_fallback_used: false,
  api_replay_used: false,
  html_room_count: null,
  mobile_room_count: null,
  desktop_room_count: null
};

const FIELD_ALIASES = {
  runId: 'run_id',
  taskId: 'task_id',
  pageIndex: 'page_index',
  hotelCount: 'hotel_count',
  retryCount: 'retry_count',
  captchaDetected: 'captcha_detected',
  taskKind: 'task_kind',
  waitReason: 'wait_reason',
  captureMethod: 'capture_method',
  variantName: 'variant_name',
  selectedRoomSource: 'selected_room_source',
  selectedRoomPriceLocked: 'selected_room_price_locked',
  roomCandidatesCount: 'room_candidates_count',
  eligibleRoomCount: 'eligible_room_count',
  rawRoomCandidatesCount: 'raw_room_candidates_count',
  roomPriceVisible: 'room_price_visible',
  spiderErrorCodes: 'spider_error_codes',
  trackedUrlCount: 'tracked_url_count',
  edgeFallbackUsed: 'edge_fallback_used',
  apiReplayUsed: 'api_replay_used',
  htmlRoomCount: 'html_room_count',
  mobileRoomCount: 'mobile_room_count',
  desktopRoomCount: 'desktop_room_count',
  itemCount: 'item_count',
  succeededCount: 'succeeded_count',
  failedCount: 'failed_count',
  totalElapsedMs: 'total_elapsed_ms',
  itemTotalMsSum: 'item_total_ms_sum',
  averageItemMs: 'average_item_ms',
  p50ItemMs: 'p50_item_ms',
  p90ItemMs: 'p90_item_ms',
  maxItemMs: 'max_item_ms',
  waitDataMs: 'wait_data_ms',
  waitDataTotalMs: 'wait_data_total_ms',
  waitDataAverageMs: 'wait_data_average_ms',
  edgeMs: 'edge_ms',
  edgeTotalMs: 'edge_total_ms',
  apiReplayMs: 'api_replay_ms',
  apiReplayTotalMs: 'api_replay_total_ms',
  htmlMs: 'html_ms',
  htmlTotalMs: 'html_total_ms',
  transitMs: 'transit_ms',
  transitTotalMs: 'transit_total_ms',
  saveMs: 'save_ms',
  saveTotalMs: 'save_total_ms',
  listExpandMs: 'list_expand_ms',
  wallTime: 'wall_time',
  childPhaseSum: 'child_phase_sum',
  nestedPhaseNote: 'nested_phase_note',
  slowestItems: 'slowest_items',
  spiderErrorCode: 'spider_error_code'
};

const SENSITIVE_KEY_PATTERN =
  /(?:cookie|authorization|api[_-]?key|amap[_-]?key|token|secret|password|credential)/i;

function normalizeAliases(fields = {}) {
  const normalized = { ...fields };
  for (const [from, to] of Object.entries(FIELD_ALIASES)) {
    if (
      Object.prototype.hasOwnProperty.call(fields, from) &&
      (normalized[to] === undefined || normalized[to] === null || normalized[to] === '')
    ) {
      normalized[to] = fields[from];
    }
  }
  return normalized;
}

function sanitizeUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch (_error) {
    return value.replace(
      /([?&][^=]*(?:token|authorization|api[_-]?key|amap[_-]?key|secret)[^=]*=)[^&#]*/gi,
      '$1[REDACTED]'
    );
  }
}

function sanitizeString(value) {
  return sanitizeUrl(String(value)).replace(
    /([A-Za-z]:\\Users\\)[^\\/]+/gi,
    '$1[REDACTED]'
  );
}

function sanitizeForLog(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForLog(item, key))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const nextValue = sanitizeForLog(childValue, childKey);
      if (nextValue !== undefined) {
        sanitized[childKey] = nextValue;
      }
    }
    return sanitized;
  }

  return value;
}

function sanitizeRecord(record = {}) {
  return sanitizeForLog(record) || {};
}

const allocatedLogPaths = new Set();

function padTimePart(value, width = 2) {
  return String(value).padStart(width, '0');
}

function normalizeTimestampSegment(date = new Date()) {
  if (typeof date === 'string' && date) {
    return date;
  }

  const timestamp = date instanceof Date ? date : new Date(date);
  const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
  return [
    `${safeTimestamp.getFullYear()}-${padTimePart(safeTimestamp.getMonth() + 1)}-${padTimePart(
      safeTimestamp.getDate()
    )}`,
    `${padTimePart(safeTimestamp.getHours())}-${padTimePart(
      safeTimestamp.getMinutes()
    )}-${padTimePart(safeTimestamp.getSeconds())}-${padTimePart(
      safeTimestamp.getMilliseconds(),
      3
    )}`
  ].join('_');
}

function reserveUniqueLogPath(logPath) {
  const parsed = path.parse(logPath);
  let candidate = logPath;
  let suffix = 2;

  while (allocatedLogPaths.has(candidate) || fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}_${suffix}${parsed.ext}`);
    suffix += 1;
  }

  allocatedLogPaths.add(candidate);
  return candidate;
}

function setup_perf_logger(options = {}) {
  const timestampSegment = normalizeTimestampSegment(options.date);
  const logDir = path.resolve(options.logDir || path.join('logs', 'perf'));
  const requestedLogPath = path.resolve(
    options.logPath || path.join(logDir, `collect_perf_${timestampSegment}.jsonl`)
  );
  const logPath = options.logPath ? requestedLogPath : reserveUniqueLogPath(requestedLogPath);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  return {
    enabled: true,
    logPath,
    write(entry = {}) {
      const normalizedEntry = normalizeAliases(entry);
      const record = sanitizeRecord({
        ...DEFAULT_FIELDS,
        ...normalizedEntry,
        ts: normalizedEntry.ts || new Date().toISOString(),
        elapsed_ms: Number.isFinite(Number(normalizedEntry.elapsed_ms))
          ? Number(normalizedEntry.elapsed_ms)
          : 0,
        retry_count: Number.isFinite(Number(normalizedEntry.retry_count))
          ? Number(normalizedEntry.retry_count)
          : 0,
        captcha_detected: Boolean(normalizedEntry.captcha_detected)
      });
      fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
      return record;
    }
  };
}

function normalizeMeta(meta = {}) {
  const normalized = normalizeAliases(meta);
  return {
    ...normalized,
    run_id: normalized.run_id || '',
    task_id: normalized.task_id || '',
    city: normalized.city || '',
    url: normalized.url || '',
    page_index: normalized.page_index ?? null,
    hotel_count: normalized.hotel_count ?? null,
    retry_count: normalized.retry_count ?? 0,
    captcha_detected: normalized.captcha_detected ?? false,
    task_kind: normalized.task_kind || '',
    mode: normalized.mode || normalized.task_kind || '',
    wait_reason: normalized.wait_reason || '',
    capture_method: normalized.capture_method || ''
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
    const aliasedFields = normalizeAliases(fields);
    const normalized = normalizeMeta({
      ...this.meta,
      ...aliasedFields
    });
    return this.logger.write({
      ...this.meta,
      ...aliasedFields,
      ...normalized,
      event,
      phase: aliasedFields.phase || '',
      status: aliasedFields.status || '',
      level: aliasedFields.level || 'info'
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
    const sumMetric = (...keys) =>
      this.tasks.reduce((sum, task) => {
        const value = keys
          .map((key) => task[key])
          .find((item) => item !== undefined && item !== null);
        const numeric = Number(value || 0);
        return Number.isFinite(numeric) ? sum + numeric : sum;
      }, 0);
    const totalTasks = this.tasks.length;
    const successTasks = this.tasks.filter((task) => task.status === 'success').length;
    const failedTasks = this.tasks.filter((task) => task.status === 'failed').length;
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    const wallTime = Number(
      extra.wall_time ?? extra.wallTime ?? extra.total_elapsed_ms ?? extra.elapsed_ms ?? totalMs
    );
    const waitDataTotalMs = sumMetric('waitDataMs', 'wait_data_ms');
    const slowestItems = [...this.tasks]
      .sort(
        (left, right) =>
          Number(right.elapsedMs ?? right.elapsed_ms ?? 0) -
          Number(left.elapsedMs ?? left.elapsed_ms ?? 0)
      )
      .slice(0, 5)
      .map((task) => ({
        index: task.index ?? null,
        hotelId: task.hotelId ?? task.hotel_id ?? '',
        hotelName: task.hotelName ?? task.hotel_name ?? '',
        url: task.url || '',
        durationMs: Number(task.elapsedMs ?? task.elapsed_ms ?? 0),
        waitDataMs: Number(task.waitDataMs ?? task.wait_data_ms ?? 0),
        captureMethod: task.captureMethod ?? task.capture_method ?? '',
        waitReason: task.waitReason ?? task.wait_reason ?? ''
      }));

    return {
      ...this.meta,
      totalTasks,
      successTasks,
      failedTasks,
      averageMs: durations.length ? totalMs / durations.length : 0,
      p50Ms: percentile(durations, 50),
      p90Ms: percentile(durations, 90),
      maxMs: durations.length ? Math.max(...durations) : 0,
      item_count: totalTasks,
      succeeded_count: successTasks,
      failed_count: failedTasks,
      total_elapsed_ms: Number.isFinite(wallTime) ? wallTime : totalMs,
      item_total_ms_sum: totalMs,
      average_item_ms: durations.length ? totalMs / durations.length : 0,
      p50_item_ms: percentile(durations, 50),
      p90_item_ms: percentile(durations, 90),
      max_item_ms: durations.length ? Math.max(...durations) : 0,
      wait_data_total_ms: waitDataTotalMs,
      wait_data_average_ms: totalTasks ? waitDataTotalMs / totalTasks : 0,
      edge_total_ms: sumMetric('edgeMs', 'edge_ms', 'edgeCaptureMs', 'edge_capture_ms'),
      api_replay_total_ms: sumMetric(
        'apiReplayMs',
        'api_replay_ms',
        'directReplayMs',
        'direct_replay_ms'
      ),
      html_total_ms: sumMetric('htmlMs', 'html_ms'),
      transit_total_ms: sumMetric('transitMs', 'transit_ms'),
      save_total_ms: sumMetric('saveMs', 'save_ms', 'outputWriteMs', 'appWriteMs'),
      list_expand_ms: Number(extra.list_expand_ms ?? extra.listExpandMs ?? 0),
      wall_time: Number.isFinite(wallTime) ? wallTime : totalMs,
      child_phase_sum: Number(extra.child_phase_sum ?? extra.childPhaseSum ?? 0),
      nested_phase_note:
        extra.nested_phase_note ||
        extra.nestedPhaseNote ||
        'nested phases may overlap and must not be added directly to wall_time',
      slowest_items: slowestItems,
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
