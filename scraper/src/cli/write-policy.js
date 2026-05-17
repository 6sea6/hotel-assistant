const { isRestrictedPostConfirmationFreeCancellation, normalizeText } = require('../utils');

function classifyWriteCancelPolicy(cancelPolicy) {
  const text = normalizeText(cancelPolicy);
  if (!text) {
    return 'assumed_cancellable';
  }
  if (
    /不可取消|不可(随时)?取消|不支持取消|确认(后)?不(可|能)取消|一经确认.*不可(改|退)|预订(后)?不(可|能)(改|退)/.test(
      text
    )
  ) {
    return 'non_cancellable';
  }
  if (isRestrictedPostConfirmationFreeCancellation(text)) {
    return 'restricted_free_cancellation';
  }
  return 'cancellable';
}

function shouldSkipHotelWrite(roomRecords) {
  const records = Array.isArray(roomRecords) ? roomRecords.filter(Boolean) : [];
  return (
    records.length > 0 &&
    records.every((roomRecord) => {
      const cancelType = classifyWriteCancelPolicy(roomRecord.cancel_policy);
      return cancelType === 'non_cancellable' || cancelType === 'restricted_free_cancellation';
    })
  );
}

module.exports = {
  classifyWriteCancelPolicy,
  shouldSkipHotelWrite
};
