function normalizeIntegerLikeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;

  const normalizedText = String(value).trim();
  if (normalizedText === '') return null;

  return /^-?\d+$/.test(normalizedText) ? Number(normalizedText) : normalizedText;
}

function getIdKey(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function allocateUniqueId(preferredId, usedIds, nextIdState) {
  const preferredIdKey = getIdKey(preferredId);

  if (preferredIdKey && !usedIds.has(preferredIdKey)) {
    usedIds.add(preferredIdKey);
    return preferredId;
  }

  if (!Number.isInteger(nextIdState.value)) {
    nextIdState.value = Date.now();
  }

  while (usedIds.has(String(nextIdState.value))) {
    nextIdState.value += 1;
  }

  const allocatedId = nextIdState.value;
  usedIds.add(String(allocatedId));
  nextIdState.value += 1;
  return allocatedId;
}

function idsEqual(left, right) {
  return String(left) === String(right);
}

module.exports = {
  allocateUniqueId,
  getIdKey,
  idsEqual,
  normalizeIntegerLikeValue
};
