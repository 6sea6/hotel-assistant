// Extend collection metrics through browser cleanup and desktop writeback.
function finishDesktopCaptureTiming(result, startedAt, manualWaitIntervals = [], now = Date.now()) {
  const previous = result.performance || {};
  const collectionStart = Number(previous.startedAtMs || startedAt);
  const measuredAt = Number(previous.measuredAtMs || now);
  const totalMs = Math.max(
    now - startedAt,
    Number(previous.totalMs || 0) +
      Math.max(0, now - measuredAt) +
      Math.max(0, collectionStart - startedAt)
  );
  const manualWaitMs = manualWaitIntervals.reduce(
    (sum, [start, end]) => sum + Math.max(0, end - start),
    0
  );
  const [pauseStart, pauseEnd] = previous.checkpointPauseInterval || [0, 0];
  const overlapMs = manualWaitIntervals.reduce(
    (sum, [start, end]) => sum + Math.max(0, Math.min(end, pauseEnd) - Math.max(start, pauseStart)),
    0
  );
  const manualMs = Number(previous.manualWaitMs || 0) + manualWaitMs;
  return {
    ...result,
    performance: {
      ...previous,
      collectionTotalMs: previous.totalMs ?? null,
      totalMs,
      manualWaitMs: manualMs,
      activeMs: Math.max(
        0,
        totalMs -
          manualMs -
          Number(previous.pausedMs || 0) +
          overlapMs -
          Number(previous.cooldownMs || 0)
      ),
      measuredAtMs: now
    }
  };
}
module.exports = { finishDesktopCaptureTiming };
