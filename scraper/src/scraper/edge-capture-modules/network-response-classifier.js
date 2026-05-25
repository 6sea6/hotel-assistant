function isRoomListNetworkResponse(url = '') {
  const normalizedUrl = String(url || '').toLowerCase();
  if (!normalizedUrl) {
    return false;
  }

  return (
    /gethotelroomlist|gethotelroompopinfo|hotelroom|roomlist|roomprice|roompriceinfo/.test(
      normalizedUrl
    ) ||
    (normalizedUrl.includes('/restapi/soa2/') &&
      normalizedUrl.includes('hotel') &&
      normalizedUrl.includes('room'))
  );
}

function getEdgeNetworkWaitCount(roomRequestMeta, requestMeta) {
  if (roomRequestMeta && roomRequestMeta.size > 0) {
    return roomRequestMeta.size;
  }

  return requestMeta && requestMeta.size ? requestMeta.size : 0;
}

function getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta) {
  const roomResponseCount = roomRequestMeta && roomRequestMeta.size ? roomRequestMeta.size : 0;
  const hasRoomResponses = roomResponseCount > 0;
  const hasMultipleRoomResponses = roomResponseCount >= 2;
  return {
    stableMs: hasMultipleRoomResponses ? 300 : hasRoomResponses ? 650 : 1200,
    maxWaitMs: 4500,
    intervalMs: hasMultipleRoomResponses ? 100 : hasRoomResponses ? 150 : 200,
    networkWaitCount: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
    roomResponseSeen: hasRoomResponses,
    roomResponseCount,
    waitMode: hasMultipleRoomResponses
      ? 'multiple_room_responses'
      : hasRoomResponses
        ? 'single_room_response'
        : 'all_tracked_responses'
  };
}

function getPrioritizedEdgeResponseEntries(requestMeta) {
  const entries = [
    ...(requestMeta && typeof requestMeta.entries === 'function' ? requestMeta.entries() : [])
  ];
  const roomEntries = entries.filter(([, meta]) => isRoomListNetworkResponse(meta && meta.url));
  const otherEntries = entries.filter(([, meta]) => !isRoomListNetworkResponse(meta && meta.url));
  return [...roomEntries, ...otherEntries];
}

function buildEdgeResponseReadPlan(entries) {
  const roomGroups = new Map();
  const roomGroupOrder = [];
  const otherEntries = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const [, meta] = entry;
    if (!isRoomListNetworkResponse(meta && meta.url)) {
      otherEntries.push(entry);
      continue;
    }
    const urlKey = String((meta && meta.url) || '');
    if (!roomGroups.has(urlKey)) {
      roomGroups.set(urlKey, []);
      roomGroupOrder.push(urlKey);
    }
    roomGroups.get(urlKey).push(entry);
  }

  const roomEntries = [];
  for (const urlKey of roomGroupOrder) {
    const group = roomGroups.get(urlKey) || [];
    for (let index = group.length - 1; index >= 0; index -= 1) {
      roomEntries.push(group[index]);
    }
  }

  return [...roomEntries, ...otherEntries];
}

function shouldSkipEdgeResponseAfterRoomSuccess(meta = {}, state = {}) {
  if (!state.fastPathComplete) {
    return false;
  }

  return !isRoomListNetworkResponse(meta.url || '');
}

module.exports = {
  isRoomListNetworkResponse,
  getEdgeNetworkWaitCount,
  getEdgeNetworkWaitOptions,
  getPrioritizedEdgeResponseEntries,
  buildEdgeResponseReadPlan,
  shouldSkipEdgeResponseAfterRoomSuccess
};
