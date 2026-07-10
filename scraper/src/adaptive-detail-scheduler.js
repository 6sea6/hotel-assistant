const DEFAULT_DETAIL_START_INTERVAL_MS = 2000;
const DEFAULT_DEGRADED_START_INTERVAL_MS = 3000;
const DEFAULT_WARMUP_HOTEL_COUNT = 3;
const DEFAULT_SOFT_WINDOW_SIZE = 10;
const DEFAULT_SOFT_FAILURE_THRESHOLD = 2;
const DEFAULT_RECOVERY_CLEAN_COUNT = 10;
const CTRIP_RISK_CONTROL_ABORT_CODE = 'CTRIP_RISK_CONTROL_203_ABORT';

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.floor(number);
}

function normalizePositiveInteger(value, fallback = 1) {
  return Math.max(1, normalizeNonNegativeInteger(value, fallback));
}

function normalizeSpiderErrorCodes(codes = []) {
  return (Array.isArray(codes) ? codes : [codes])
    .map((code) => Number(code))
    .filter((code) => Number.isFinite(code));
}

function getPageSnapshot(result = {}) {
  return result.pageSnapshot || result.page_snapshot || {};
}

function summarizeRiskSignals(result = {}) {
  const snapshot = getPageSnapshot(result);
  const sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
  const spiderErrorCodes = [
    ...normalizeSpiderErrorCodes(snapshot.spider_error_codes),
    ...sources.flatMap((source) => normalizeSpiderErrorCodes(source && source.spider_error_codes))
  ];
  const riskText = [
    snapshot.login_reason,
    snapshot.login_stage,
    snapshot.wait_reason,
    snapshot.error,
    ...sources.flatMap((source) =>
      source ? [source.login_reason, source.login_stage, source.wait_reason, source.error] : []
    )
  ]
    .filter(Boolean)
    .join(' ');
  const roomPriceVisible = Boolean(
    snapshot.room_price_visible ||
    sources.some((source) => source && source.room_price_visible && !source.login_required)
  );
  const edgeAttempted = Boolean(
    snapshot.edge_fallback_used || sources.some((source) => source && source.source === 'edge-cdp')
  );

  return {
    snapshot,
    sources,
    spiderErrorCodes,
    riskText,
    roomPriceVisible,
    edgeAttempted,
    hasSpider203:
      spiderErrorCodes.includes(203) ||
      /(?:错误码|error(?:\s*code)?)\s*[:=]?\s*203|风控|反爬|anti-?spider|risk_control/i.test(
        riskText
      )
  };
}

function isHardRiskControlResult(result = {}) {
  const signals = summarizeRiskSignals(result);
  return Boolean(signals.hasSpider203 && !signals.roomPriceVisible);
}

function isSoftPriceFailureResult(result = {}) {
  const signals = summarizeRiskSignals(result);
  if (signals.hasSpider203 || signals.snapshot.booking_unavailable || signals.roomPriceVisible) {
    return false;
  }

  const totalPrice = result.totalPrice ?? result.total_price;
  const hasNoPrice = totalPrice === null || totalPrice === undefined || totalPrice === '';
  return Boolean(signals.edgeAttempted && hasNoPrice);
}

function createRiskControlAbortError(reason = '') {
  const error = new Error(reason || '检测到携程 203/风控，已停止剩余批量采集。');
  error.name = 'AbortError';
  error.code = CTRIP_RISK_CONTROL_ABORT_CODE;
  error.reason = reason || '';
  return error;
}

function delayWithSignal(delayMs, signal = null) {
  const ms = normalizeNonNegativeInteger(delayMs, 0);
  if (ms <= 0) {
    if (signal && signal.aborted) {
      return Promise.reject(createRiskControlAbortError('任务已取消'));
    }
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeout = null;
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createRiskControlAbortError('任务已取消'));
    };
    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

class AdaptiveDetailScheduler {
  constructor(options = {}) {
    this.maxConcurrency = Math.min(3, normalizePositiveInteger(options.maxConcurrency, 1));
    this.detailStartIntervalMs = normalizeNonNegativeInteger(
      options.detailStartIntervalMs,
      DEFAULT_DETAIL_START_INTERVAL_MS
    );
    this.degradedStartIntervalMs = Math.max(
      this.detailStartIntervalMs,
      normalizeNonNegativeInteger(
        options.degradedStartIntervalMs,
        DEFAULT_DEGRADED_START_INTERVAL_MS
      )
    );
    this.warmupHotelCount = normalizeNonNegativeInteger(
      options.warmupHotelCount,
      DEFAULT_WARMUP_HOTEL_COUNT
    );
    this.softWindowSize = normalizePositiveInteger(
      options.softWindowSize,
      DEFAULT_SOFT_WINDOW_SIZE
    );
    this.softFailureThreshold = normalizePositiveInteger(
      options.softFailureThreshold,
      DEFAULT_SOFT_FAILURE_THRESHOLD
    );
    this.recoveryCleanCount = normalizePositiveInteger(
      options.recoveryCleanCount,
      DEFAULT_RECOVERY_CLEAN_COUNT
    );
    this.degradedConcurrency = Math.min(
      this.maxConcurrency,
      normalizePositiveInteger(options.degradedConcurrency, 2)
    );
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.delay = typeof options.delay === 'function' ? options.delay : delayWithSignal;
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    this.perf = options.perf || null;

    this.mode = this.warmupHotelCount > 0 ? 'warmup' : 'normal';
    this.activeCount = 0;
    this.startedCount = 0;
    this.completedCount = 0;
    this.lastStartAt = null;
    this.softWindow = [];
    this.cleanAfterDegrade = 0;
    this.riskControlCount = 0;
    this.circuitReason = '';
    this.startQueue = Promise.resolve();
    this.changeWaiters = new Set();
  }

  getAllowedConcurrency() {
    if (this.completedCount < this.warmupHotelCount) {
      return 1;
    }
    return this.mode === 'degraded' ? this.degradedConcurrency : this.maxConcurrency;
  }

  getStartIntervalMs() {
    return this.mode === 'degraded' ? this.degradedStartIntervalMs : this.detailStartIntervalMs;
  }

  getSoftFailureCount() {
    return this.softWindow.filter(Boolean).length;
  }

  snapshot(extra = {}) {
    const softFailureCount = this.getSoftFailureCount();
    const observedSoftWindowSize = this.softWindow.length;
    return {
      scheduler_mode: this.mode,
      configured_max_concurrency: this.maxConcurrency,
      effective_concurrency: this.getAllowedConcurrency(),
      detail_start_interval_ms: this.getStartIntervalMs(),
      warmup_hotel_count: this.warmupHotelCount,
      started_count: this.startedCount,
      completed_count: this.completedCount,
      active_count: this.activeCount,
      recent_soft_failure_count: softFailureCount,
      recent_soft_failure_rate:
        observedSoftWindowSize > 0 ? softFailureCount / observedSoftWindowSize : 0,
      soft_window_size: observedSoftWindowSize,
      risk_control_count: this.riskControlCount,
      circuit_open: Boolean(this.circuitReason),
      circuit_reason: this.circuitReason,
      ...extra
    };
  }

  emit(event, fields = {}) {
    const snapshot = this.snapshot(fields);
    if (this.perf && typeof this.perf.event === 'function') {
      this.perf.event(event, { phase: 'batch_schedule', ...snapshot });
    }
    if (this.onEvent) {
      this.onEvent(event, snapshot);
    }
  }

  notifyChange() {
    const waiters = [...this.changeWaiters];
    this.changeWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }

  waitForChange(signal = null) {
    if (this.circuitReason) {
      return Promise.reject(createRiskControlAbortError(this.circuitReason));
    }
    if (signal && signal.aborted) {
      return Promise.reject(createRiskControlAbortError('任务已取消'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.changeWaiters.delete(onChange);
        reject(createRiskControlAbortError('任务已取消'));
      };
      const onChange = () => {
        signal?.removeEventListener?.('abort', onAbort);
        resolve();
      };
      this.changeWaiters.add(onChange);
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  assertOpen() {
    if (this.circuitReason) {
      throw createRiskControlAbortError(this.circuitReason);
    }
  }

  async beforeStart({ index = null, total = null, signal = null } = {}) {
    let releaseQueue = null;
    const previous = this.startQueue;
    this.startQueue = new Promise((resolve) => {
      releaseQueue = resolve;
    });
    await previous;

    try {
      let readyToStart = false;
      while (!readyToStart) {
        this.assertOpen();
        if (signal && signal.aborted) {
          throw createRiskControlAbortError('任务已取消');
        }
        if (this.activeCount >= this.getAllowedConcurrency()) {
          await this.waitForChange(signal);
          continue;
        }
        const elapsedSinceStart =
          this.lastStartAt === null ? Infinity : this.now() - this.lastStartAt;
        const waitMs = Math.max(0, this.getStartIntervalMs() - elapsedSinceStart);
        if (waitMs > 0) {
          await this.delay(waitMs, signal);
          continue;
        }
        readyToStart = true;
      }

      this.activeCount += 1;
      this.startedCount += 1;
      this.lastStartAt = this.now();
      const snapshot = this.snapshot({ page_index: index, hotel_count: total });
      this.emit('batch_schedule_start', { page_index: index, hotel_count: total });
      return snapshot;
    } finally {
      releaseQueue?.();
    }
  }

  recordOutcome(result = {}, { index = null, total = null } = {}) {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.completedCount += 1;

    if (isHardRiskControlResult(result)) {
      const signals = summarizeRiskSignals(result);
      this.tripCircuit(
        signals.snapshot.login_reason || signals.riskText || '检测到携程 203/风控。',
        { page_index: index, hotel_count: total, spider_error_codes: signals.spiderErrorCodes }
      );
      return this.snapshot({ page_index: index, hotel_count: total });
    }

    const softFailure = isSoftPriceFailureResult(result);
    this.softWindow.push(softFailure);
    if (this.softWindow.length > this.softWindowSize) {
      this.softWindow.shift();
    }

    const previousMode = this.mode;
    if (this.completedCount >= this.warmupHotelCount && this.mode === 'warmup') {
      this.mode = 'normal';
    }
    if (this.mode === 'degraded') {
      this.cleanAfterDegrade = softFailure ? 0 : this.cleanAfterDegrade + 1;
      if (this.cleanAfterDegrade >= this.recoveryCleanCount) {
        this.mode = 'normal';
        this.cleanAfterDegrade = 0;
        this.softWindow = [];
      }
    } else if (this.getSoftFailureCount() >= this.softFailureThreshold) {
      this.mode = 'degraded';
      this.cleanAfterDegrade = 0;
    }

    this.emit('batch_schedule_outcome', {
      page_index: index,
      hotel_count: total,
      soft_price_failure: softFailure,
      previous_scheduler_mode: previousMode,
      scheduler_mode_changed: previousMode !== this.mode
    });
    this.notifyChange();
    return this.snapshot({ page_index: index, hotel_count: total });
  }

  recordError(error, { index = null, total = null } = {}) {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.completedCount += 1;
    this.emit('batch_schedule_error', {
      page_index: index,
      hotel_count: total,
      error_type: error && error.name ? error.name : 'Error',
      error_message: error && error.message ? error.message : String(error || '')
    });
    this.notifyChange();
  }

  tripCircuit(reason = '', fields = {}) {
    if (!this.circuitReason) {
      this.circuitReason = reason || '检测到携程 203/风控。';
      this.riskControlCount += 1;
      this.emit('batch_schedule_circuit_open', fields);
    }
    this.notifyChange();
  }
}

module.exports = {
  AdaptiveDetailScheduler,
  CTRIP_RISK_CONTROL_ABORT_CODE,
  DEFAULT_DEGRADED_START_INTERVAL_MS,
  DEFAULT_DETAIL_START_INTERVAL_MS,
  DEFAULT_RECOVERY_CLEAN_COUNT,
  DEFAULT_SOFT_FAILURE_THRESHOLD,
  DEFAULT_SOFT_WINDOW_SIZE,
  DEFAULT_WARMUP_HOTEL_COUNT,
  createRiskControlAbortError,
  isHardRiskControlResult,
  isSoftPriceFailureResult,
  summarizeRiskSignals
};
