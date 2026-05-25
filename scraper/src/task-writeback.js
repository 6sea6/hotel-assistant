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

function writeSingleHotelRecords(eligibleRoomRecords) {
  if (shouldSkipHotelWrite(eligibleRoomRecords)) {
    return buildSkippedWriteResult(eligibleRoomRecords);
  }

  return appendHotelsToStore(eligibleRoomRecords, { replaceExistingGroup: true });
}

function writeBatchHotelRecords({ allHotels, resultPayloads, reportDisabled }) {
  if (shouldSkipHotelWrite(allHotels)) {
    return buildSkippedWriteResult(allHotels, SKIP_BATCH_WRITE_REASON);
  }

  if (reportDisabled) {
    return appendHotelsToStore(allHotels, { replaceExistingGroup: true });
  }

  return resultPayloads.map((payload, index) => {
    const hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
    if (shouldSkipHotelWrite(hotels)) {
      return {
        itemIndex: index + 1,
        ...buildSkippedWriteResult(hotels, SKIP_BATCH_ITEM_WRITE_REASON)
      };
    }

    return {
      itemIndex: index + 1,
      result: appendHotelsToStore(hotels, { replaceExistingGroup: true })
    };
  });
}

module.exports = {
  writeBatchHotelRecords,
  writeSingleHotelRecords
};
