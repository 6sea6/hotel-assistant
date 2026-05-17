function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function areValuesEqual(left, right) {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => areValuesEqual(item, right[index]));
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && areValuesEqual(left[key], right[key])
    );
  }

  return false;
}

function hasNormalizedValueChanged(originalValue, normalizedValue) {
  return !areValuesEqual(originalValue, normalizedValue);
}

module.exports = {
  areValuesEqual,
  hasNormalizedValueChanged,
  isPlainObject
};
