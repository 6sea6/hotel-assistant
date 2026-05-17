const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateUniqueId,
  getIdKey,
  idsEqual,
  normalizeIntegerLikeValue
} = require('../src/shared/id-utils');

test('normalizeIntegerLikeValue keeps integer-like IDs stable', () => {
  assert.equal(normalizeIntegerLikeValue(null), null);
  assert.equal(normalizeIntegerLikeValue(undefined), null);
  assert.equal(normalizeIntegerLikeValue(''), null);
  assert.equal(normalizeIntegerLikeValue('  '), null);
  assert.equal(normalizeIntegerLikeValue(12), 12);
  assert.equal(normalizeIntegerLikeValue('0012'), 12);
  assert.equal(normalizeIntegerLikeValue('-7'), -7);
  assert.equal(normalizeIntegerLikeValue(1.5), '1.5');
  assert.equal(normalizeIntegerLikeValue('room-1'), 'room-1');
});

test('ID helpers compare and allocate with string keys', () => {
  assert.equal(getIdKey(null), null);
  assert.equal(getIdKey(''), null);
  assert.equal(getIdKey(42), '42');
  assert.equal(idsEqual(42, '42'), true);

  const usedIds = new Set(['1', '2']);
  const nextIdState = { value: 1 };

  assert.equal(allocateUniqueId('3', usedIds, nextIdState), '3');
  assert.equal(allocateUniqueId('2', usedIds, nextIdState), 4);
  assert.deepEqual([...usedIds], ['1', '2', '3', '4']);
  assert.equal(nextIdState.value, 5);
});
