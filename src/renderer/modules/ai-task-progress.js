import { isRecord } from './ai-task-events.js';

/**
 * Pure result/write/progress helpers for the AI task console.
 *
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskKind} AiTaskKind
 * @typedef {import('../../shared/contracts').AiTaskBackendResult} AiTaskBackendResult
 *
 * @typedef {object} AiBatchWriteStats
 * @property {number} hotelCount
 * @property {number} roomTypeCount
 *
 * @typedef {object} AiBatchProgressEvent
 * @property {string} type
 * @property {number} index
 * @property {number} total
 *
 * @typedef {object} AiProgressStats
 * @property {number} total
 * @property {number} completed
 * @property {number} running
 * @property {number} pending
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function getLatestApplyResult(value) {
  return isRecord(value) && isRecord(value.latestApplyResult) ? value.latestApplyResult : {};
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function getNestedWriteResult(value) {
  if (!isRecord(value)) return undefined;
  const latest = getLatestApplyResult(value);
  return value.writeResult || latest.writeResult;
}

/**
 * @param {AiTaskBackendResult|Record<string, unknown>} [result]
 * @returns {Record<string, unknown>|null}
 */
export function getCollectToolResult(result = {}) {
  if (!Array.isArray(result.toolResults)) return null;
  return (
    result.toolResults.find(
      (item) =>
        item &&
        (item.name === 'collect_and_write_ctrip_hotel' ||
          item.name === 'refresh_existing_ctrip_hotels')
    ) || null
  );
}

/**
 * @param {unknown} writeResult
 * @returns {boolean}
 */
export function hasWriteResult(writeResult) {
  if (Array.isArray(writeResult)) {
    return writeResult.some((item) => {
      if (!isRecord(item)) return false;
      if (item.operation) return item.operation !== 'skipped';
      return hasWriteResult(item.result || getNestedWriteResult(item));
    });
  }
  if (isRecord(writeResult) && writeResult.batchMode) {
    if (Number(writeResult.appliedCount || 0) > 0) {
      return true;
    }
    return (Array.isArray(writeResult.items) ? writeResult.items : []).some(
      (item) => isRecord(item) && hasWriteResult(getNestedWriteResult(item))
    );
  }
  return Boolean(writeResult && (!isRecord(writeResult) || writeResult.operation !== 'skipped'));
}

/**
 * @param {unknown} writeResult
 * @returns {number}
 */
export function countWriteOperations(writeResult) {
  if (Array.isArray(writeResult)) {
    return writeResult.reduce((sum, item) => {
      if (!isRecord(item)) return sum;
      if (item.operation) return item.operation === 'skipped' ? sum : sum + 1;
      return sum + countWriteOperations(item.result || getNestedWriteResult(item));
    }, 0);
  }

  if (isRecord(writeResult) && writeResult.batchMode) {
    return (Array.isArray(writeResult.items) ? writeResult.items : []).reduce((sum, item) => {
      if (!isRecord(item) || item.skipped) return sum;
      return sum + countWriteOperations(getNestedWriteResult(item));
    }, 0);
  }

  return isRecord(writeResult) && writeResult.operation && writeResult.operation !== 'skipped'
    ? 1
    : 0;
}

/**
 * @param {Record<string, unknown>} [value]
 * @returns {number}
 */
export function countEligibleHotels(value = {}) {
  if (Array.isArray(value.eligibleHotels)) return value.eligibleHotels.length;
  if (Number.isFinite(Number(value.eligibleCount))) return Math.max(0, Number(value.eligibleCount));
  if (Array.isArray(value.eligibleRoomTypes)) return value.eligibleRoomTypes.length;
  return 0;
}

/**
 * @param {Record<string, unknown>} [collectResult]
 * @returns {AiBatchWriteStats}
 */
export function getBatchWriteStats(collectResult = {}) {
  const writeResult = collectResult.writeResult;
  if (!hasWriteResult(writeResult)) {
    return {
      hotelCount: 0,
      roomTypeCount: 0
    };
  }

  if (isRecord(writeResult) && writeResult.batchMode) {
    const appliedItems = Array.isArray(writeResult.items)
      ? writeResult.items.filter(
          (item) => isRecord(item) && !item.skipped && hasWriteResult(getNestedWriteResult(item))
        )
      : [];
    const hotelCount = Number.isFinite(Number(writeResult.appliedCount))
      ? Math.max(0, Number(writeResult.appliedCount))
      : appliedItems.length;
    const roomTypeCount = appliedItems.reduce((sum, item) => {
      const latest = getLatestApplyResult(item);
      const itemResult = isRecord(item.item) ? item.item : {};
      const fromItem = countEligibleHotels(itemResult);
      if (fromItem > 0) return sum + fromItem;
      const fromLatest = countEligibleHotels(latest);
      if (fromLatest > 0) return sum + fromLatest;
      return sum + countWriteOperations(item.writeResult);
    }, 0);

    return {
      hotelCount,
      roomTypeCount: roomTypeCount || (hotelCount > 0 ? countEligibleHotels(collectResult) : 0)
    };
  }

  if (Array.isArray(writeResult)) {
    const appliedItems = writeResult.filter(
      (item) => isRecord(item) && hasWriteResult(item.result || getNestedWriteResult(item) || item)
    );
    return {
      hotelCount: appliedItems.length,
      roomTypeCount: countWriteOperations(writeResult)
    };
  }

  return {
    hotelCount: 1,
    roomTypeCount: countEligibleHotels(collectResult) || countWriteOperations(writeResult)
  };
}

/**
 * @param {AiTaskEvent} [event]
 * @returns {AiBatchProgressEvent}
 */
export function parseBatchProgressEvent(event = {}) {
  const type = String(event.type || '');
  const detail = event.details && typeof event.details === 'object' ? event.details : {};
  const message = String(event.message || '');
  const summary = String(detail.summary || '');
  const parsed = {
    type,
    index: Number(detail.index || detail.itemIndex || detail.currentIndex || 0),
    total: Number(detail.total || detail.totalCount || detail.itemCount || detail.hotelCount || 0)
  };

  const startMatch = message.match(/第\s*(\d+)\s*\/\s*(\d+)/);
  if (startMatch) {
    parsed.index = Number(startMatch[1]);
    parsed.total = Number(startMatch[2]);
  }

  const doneMatch = message.match(/第\s*(\d+)\s*家酒店采集(?:完成|失败)/);
  if (!parsed.index && doneMatch) {
    parsed.index = Number(doneMatch[1]);
  }

  if (!parsed.total) {
    const summaryMatch = summary.match(/展开酒店\s*=\s*(\d+)/);
    if (summaryMatch) {
      parsed.total = Number(summaryMatch[1]);
    }
  }

  return parsed;
}

/**
 * @param {AiTaskEvent[]} [events]
 * @param {AiTaskKind} [taskKind]
 * @returns {AiProgressStats|null}
 */
export function buildProgressStats(events = [], taskKind = 'collect') {
  if (taskKind === 'refresh-data') {
    return buildRefreshProgressStats(events);
  }

  const itemStatus = new Map();
  let total = 0;

  for (const event of events || []) {
    const parsed = parseBatchProgressEvent(event);
    if (!parsed.type.startsWith('batch:')) {
      continue;
    }
    if (Number.isFinite(parsed.total) && parsed.total > total) {
      total = parsed.total;
    }
    if (!Number.isFinite(parsed.index) || parsed.index <= 0) {
      continue;
    }
    if (parsed.type === 'batch:item-start') {
      itemStatus.set(parsed.index, 'running');
    } else if (parsed.type === 'batch:item-done' || parsed.type === 'batch:item-error') {
      itemStatus.set(parsed.index, 'completed');
    }
  }

  if (total <= 0) {
    return null;
  }

  const completed = [...itemStatus.values()].filter((status) => status === 'completed').length;
  const running = [...itemStatus.values()].filter((status) => status === 'running').length;
  const pending = Math.max(0, total - completed - running);

  return {
    total,
    completed,
    running,
    pending
  };
}

/**
 * @param {AiTaskEvent[]} [events]
 * @returns {AiProgressStats|null}
 */
export function buildRefreshProgressStats(events = []) {
  let total = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let runningCount = 0;
  const itemStatus = new Map();

  for (const event of events || []) {
    const type = String(event.type || '');
    const detail = event.details && typeof event.details === 'object' ? event.details : {};
    const message = String(event.message || '');

    if (type === 'refresh:item-start') {
      const index = Number(detail.index || 0);
      const eventTotal = Number(detail.total || 0);
      if (eventTotal > total) total = eventTotal;
      if (index > 0) {
        itemStatus.set(index, 'running');
      }
    } else if (type === 'refresh:item-done') {
      const index = Number(detail.index || 0);
      const eventTotal = Number(detail.total || 0);
      if (eventTotal > total) total = eventTotal;
      if (index > 0) {
        itemStatus.set(index, 'completed');
      }
      updatedCount++;
    } else if (type === 'refresh:item-skipped') {
      const index = Number(detail.index || 0);
      const eventTotal = Number(detail.total || 0);
      if (eventTotal > total) total = eventTotal;
      if (index > 0) {
        itemStatus.set(index, 'skipped');
      }
      skippedCount++;
    } else if (type === 'refresh:summary') {
      const summaryTotal = Number(detail.totalHotelCount || 0);
      if (summaryTotal > total) total = summaryTotal;
    } else if (type === 'refresh:load-data' || type.startsWith('refresh:')) {
      const eventTotal = Number(detail.total || 0);
      if (eventTotal > total) total = eventTotal;
    }

    if (!total) {
      const match = message.match(/第\s*\d+\s*\/\s*(\d+)/);
      if (match) {
        total = Math.max(total, Number(match[1]));
      }
    }
  }

  if (total <= 0) {
    return null;
  }

  runningCount = [...itemStatus.values()].filter((status) => status === 'running').length;
  const pending = Math.max(0, total - updatedCount - skippedCount - runningCount);

  return {
    total,
    completed: updatedCount,
    running: runningCount,
    pending
  };
}

/**
 * @param {AiTaskEvent[]} [events]
 * @returns {string}
 */
export function getRefreshCurrentStepKey(events = []) {
  const itemStatus = new Map();
  let total = 0;
  let hasFinalWrite = false;
  let hasFinalSummary = false;
  let hasEdge = false;
  let hasLoadData = false;
  let hasReceived = false;

  for (const event of events || []) {
    const type = String(event.type || '');
    const detail = event.details && typeof event.details === 'object' ? event.details : {};
    const index = Number(detail.index || detail.itemIndex || detail.currentIndex || 0);
    const eventTotal = Number(detail.total || detail.totalHotelCount || 0);

    if (eventTotal > total) total = eventTotal;

    const message = String(event.message || '');
    const match = message.match(/第\s*\d+\s*\/\s*(\d+)/);
    if (match) total = Math.max(total, Number(match[1]));

    if (type === 'task:start') {
      hasReceived = true;
    }

    if (type === 'refresh:load-data' || type === 'refresh:scan-done') {
      hasLoadData = true;
    }

    if (type.startsWith('edge:')) {
      hasEdge = true;
    }

    if (type === 'refresh:item-start' && index > 0) {
      itemStatus.set(index, 'running');
    }

    if (type === 'refresh:item-write' && index > 0) {
      itemStatus.set(index, 'running');
    }

    if ((type === 'refresh:item-done' || type === 'refresh:item-skipped') && index > 0) {
      itemStatus.set(index, 'done');
    }

    if (type === 'refresh:write' && detail.scope === 'final') {
      hasFinalWrite = true;
    }

    if (type === 'refresh:summary') {
      hasFinalSummary = true;
    }
  }

  const statuses = [...itemStatus.values()];
  const hasRunningItem = statuses.some((status) => status === 'running');
  const processedCount = statuses.filter((status) => status === 'done').length;
  const allItemsProcessed = total > 0 && processedCount >= total;

  if (hasRunningItem) return 'refresh';
  if (total > 0 && processedCount > 0 && processedCount < total) return 'refresh';
  if (hasFinalWrite || hasFinalSummary || allItemsProcessed) return 'write';

  if (hasEdge) return 'edge';
  if (hasLoadData) return 'load-data';
  if (hasReceived) return 'received';
  return '';
}
