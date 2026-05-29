const { appendHotelsToStore, getCompareAppStorePath } = require('./compare-app-bridge');
const { shouldSkipHotelWrite } = require('./cli/write-policy');

const SKIP_WRITE_REASON =
  '所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则整家跳过，未直写比较助手。';
const SKIP_BATCH_WRITE_REASON =
  '所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则整批跳过，未直写比较助手。';
const SKIP_BATCH_ITEM_WRITE_REASON =
  '该酒店所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则跳过。';

function buildSkippedWriteResult(hotels, reason = SKIP_WRITE_REASON) {
  return {
    storePath: getCompareAppStorePath(),
    operation: 'skipped',
    skippedCount: hotels.length,
    reason
  };
}

function writeSingleHotelRecords(eligibleRoomRecords, deps = {}) {
  const appendFn = deps.appendHotelsToStore || appendHotelsToStore;
  if (shouldSkipHotelWrite(eligibleRoomRecords)) {
    return buildSkippedWriteResult(eligibleRoomRecords);
  }

  return appendFn(eligibleRoomRecords, { replaceExistingGroup: true });
}

function writeBatchHotelRecords({ allHotels, resultPayloads, reportDisabled }, deps = {}) {
  const appendFn = deps.appendHotelsToStore || appendHotelsToStore;

  if (shouldSkipHotelWrite(allHotels)) {
    return buildSkippedWriteResult(allHotels, SKIP_BATCH_WRITE_REASON);
  }

  if (reportDisabled) {
    return appendFn(allHotels, { replaceExistingGroup: true });
  }

  // Collect writable items and their hotels for a single bulk write
  const writableItems = [];
  const skippedItems = [];
  for (let index = 0; index < resultPayloads.length; index++) {
    const payload = resultPayloads[index];
    const hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
    if (shouldSkipHotelWrite(hotels)) {
      skippedItems.push({
        itemIndex: index + 1,
        ...buildSkippedWriteResult(hotels, SKIP_BATCH_ITEM_WRITE_REASON)
      });
    } else {
      writableItems.push({ itemIndex: index + 1, hotels });
    }
  }

  if (writableItems.length === 0) {
    return skippedItems;
  }

  // Single bulk write for all writable hotels
  const bulkHotels = writableItems.flatMap((item) => item.hotels);
  const bulkResult = appendFn(bulkHotels, { replaceExistingGroup: true });

  // Map bulk results back to per-item structure
  const writableResults = writableItems.map((item, writableIndex) => ({
    itemIndex: item.itemIndex,
    result: {
      ...(Array.isArray(bulkResult) ? bulkResult[0] || {} : bulkResult),
      operation: 'bulk-upserted',
      bulk: true,
      hotelCount: item.hotels.length
    }
  }));

  return [...skippedItems, ...writableResults].sort((a, b) => a.itemIndex - b.itemIndex);
}

module.exports = {
  writeBatchHotelRecords,
  writeSingleHotelRecords
};
