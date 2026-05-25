function createTaskEmitter(onEvent) {
  return (type, message, details = {}) => {
    if (typeof onEvent !== 'function') {
      return;
    }

    onEvent({
      type,
      message,
      details,
      at: new Date().toISOString()
    });
  };
}

function createScrapeEventForwarder(emit) {
  const notifiedLoginPrompts = new Set();
  return (type, message, details = {}) => {
    if (type === 'edge:login-required') {
      const key = `${type}:${details.reason || message || ''}`;
      if (notifiedLoginPrompts.has(key)) {
        return;
      }
      notifiedLoginPrompts.add(key);
    }
    emit(type, message, details);
  };
}

function buildBatchItemEventDetails({ index, total, taskId, hotelInput = {}, details = {} }) {
  return {
    index,
    total,
    taskId: `${taskId}-${index}`,
    hotelId: hotelInput.hotelId || '',
    url: hotelInput.url || '',
    source: hotelInput.source || '',
    ...details
  };
}

function emitBatchItemStart(emit, { index, total, taskId, hotelInput }) {
  emit('batch:item-start', `正在采集第 ${index}/${total} 家酒店`, {
    ...buildBatchItemEventDetails({ index, total, taskId, hotelInput })
  });
}

function emitBatchItemDone(emit, { index, total, taskId, hotelInput, childResult = {} }) {
  emit('batch:item-done', `第 ${index} 家酒店采集完成`, {
    ...buildBatchItemEventDetails({
      index,
      total,
      taskId,
      hotelInput,
      details: {
        hotelName: childResult.hotelName,
        eligibleCount: childResult.eligibleCount
      }
    })
  });
}

function emitBatchItemError(emit, { index, total, taskId, hotelInput, failedItem = {} }) {
  emit('batch:item-error', `第 ${index} 家酒店采集失败`, {
    ...buildBatchItemEventDetails({
      index,
      total,
      taskId,
      hotelInput,
      details: failedItem
    })
  });
}

module.exports = {
  buildBatchItemEventDetails,
  createScrapeEventForwarder,
  createTaskEmitter,
  emitBatchItemDone,
  emitBatchItemError,
  emitBatchItemStart
};
