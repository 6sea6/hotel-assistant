const fs = require('fs');
const path = require('path');

function appVersion() {
  for (const filename of [
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar', 'package.json'),
    path.resolve(__dirname, '../../package.json'),
    path.resolve(__dirname, '../package.json')
  ].filter(Boolean)) {
    try {
      return JSON.parse(fs.readFileSync(filename, 'utf8')).version || 'unknown';
    } catch (_error) {
      /* Try the next runtime layout. */
    }
  }
  return 'unknown';
}

function createTaskMetrics(controller, cache, startedAt = Date.now()) {
  let start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  const initial = { ...controller?.metrics };
  let firstResultAt = null;
  let manualWaitMs = 0;
  let pausedMs = 0;
  let checkpointPauseInterval = null;
  const failures = {};
  return {
    restoreCheckpoint(checkpoint) {
      if (!checkpoint.enabled) return;
      start = checkpoint.startedAt;
      pausedMs = checkpoint.pausedDurationMs;
      checkpointPauseInterval = [checkpoint.previousPausedAt, checkpoint.resumedAt];
      const times = [...checkpoint.completed.values()]
        .map((item) => Date.parse(item.result.collectedAt))
        .filter(Number.isFinite);
      if (times.length) firstResultAt = Math.min(...times);
    },
    recordResult(result = {}) {
      if (result.pageSnapshot?.capture_complete === false)
        failures.incomplete = (failures.incomplete || 0) + 1;
      firstResultAt ??= Date.now();
    },
    recordFailure(kind) {
      failures[kind] = (failures[kind] || 0) + 1;
    },
    recordManualWait(ms) {
      manualWaitMs += ms;
    },
    finish(result) {
      const access = Object.fromEntries(
        Object.entries(controller?.metrics || {}).map(([key, value]) => [
          key,
          value - (initial[key] || 0)
        ])
      );
      const items = result.batchMode ? result.items || [] : [result];
      const valid = items.filter(
        (item) =>
          (item.success || ['updated', 'cleared', 'resumed'].includes(item.status)) &&
          item.pageSnapshot?.capture_complete !== false &&
          !item.accessIssue &&
          !item.pageSnapshot?.login_required
      );
      const totalMs = Math.max(0, Date.now() - start);
      const failed = items.filter(
        (item) =>
          item.success === false ||
          item.pageSnapshot?.capture_complete === false ||
          item.status === 'error' ||
          item.status === 'skipped'
      ).length;
      return {
        ...result,
        performance: {
          ...result.performance,
          totalMs,
          startedAtMs: start,
          measuredAtMs: Date.now(),
          activeMs: Math.max(0, totalMs - manualWaitMs - pausedMs - (access.cooldownMs || 0)),
          manualWaitMs,
          pausedMs,
          checkpointPauseInterval,
          cooldownMs: access.cooldownMs || 0,
          firstResultMs: firstResultAt === null ? null : firstResultAt - start,
          validResultCount: valid.length,
          criticalBusinessRequestCount: access.businessRequests || 0,
          duplicateRequestCount: access.duplicateRequests || 0,
          mergedQueryCount: cache?.hits || 0,
          failureCountByKind: { ...failures },
          failureRate: items.length ? failed / items.length : 0,
          failureRateByKind: Object.fromEntries(
            Object.entries(failures).map(([kind, count]) => [
              kind,
              items.length ? count / items.length : null
            ])
          ),
          pauseCount: access.pauses || 0,
          recoveryCount: access.recoveries || 0,
          actionsAfterRisk: access.actionsAfterRisk || 0,
          inFlightAtPause: access.inFlightAtPause || 0,
          access
        }
      };
    }
  };
}

module.exports = { appVersion, createTaskMetrics };
