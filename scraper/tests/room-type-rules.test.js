const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROOM_TYPES,
  deriveRoomTypeFromFallbackSignals,
  deriveRoomTypeFromStructuredBed,
  getBedTypeCounts,
  hasExplicitBigBedTitle,
  hasExplicitTwinTitle,
  isAlternativeBetweenSingleBedStyles
} = require('../src/scraper/room-type-rules');

test('getBedTypeCounts treats sofa bed as single bed', () => {
  assert.deepEqual(getBedTypeCounts('1张大床 + 1张沙发床'), {
    singleBedCount: 1,
    doubleBedCount: 0,
    queenBedCount: 1,
    bunkBedCount: 0
  });
});

test('title hints distinguish big-bed and twin labels', () => {
  assert.equal(hasExplicitBigBedTitle('雅致大床房'), true);
  assert.equal(hasExplicitTwinTitle('豪华双床房'), true);
});

test('deriveRoomTypeFromStructuredBed keeps a single double bed under a big-bed title as big-bed room', () => {
  assert.equal(
    deriveRoomTypeFromStructuredBed({
      title: '雅致大床房',
      bedTitle: '1张1.5米双人床',
      bedCount: 1
    }),
    ROOM_TYPES.BIG_BED
  );
});

test('two king-size beds are treated as twin room', () => {
  assert.equal(
    deriveRoomTypeFromStructuredBed({
      title: '尊享景观房',
      bedTitle: '2张2米特大床',
      bedCount: 2
    }),
    ROOM_TYPES.TWIN
  );

  assert.equal(
    deriveRoomTypeFromFallbackSignals({
      title: '马哥孛罗套房',
      bedText: '马哥孛罗套房 2张2米特大床'
    }),
    ROOM_TYPES.TWIN
  );
});

test('single-bed alternatives stay as big-bed room instead of ambiguous big-bed-or-twin', () => {
  const counts = getBedTypeCounts('1张大床 或 1张双人床');

  assert.equal(isAlternativeBetweenSingleBedStyles('1张大床 或 1张双人床', counts, 1), true);
  assert.equal(
    deriveRoomTypeFromStructuredBed({
      title: '智能豪华大床房',
      bedTitle: '1张大床 或 1张双人床',
      bedCount: 1
    }),
    ROOM_TYPES.BIG_BED
  );
});

test('deriveRoomTypeFromFallbackSignals keeps suite handling and mixed-bed family handling intact', () => {
  assert.equal(
    deriveRoomTypeFromFallbackSignals({
      title: '行政套房',
      bedText: '行政套房 1张大床 或 2张单人床'
    }),
    ROOM_TYPES.BIG_BED_OR_TWIN
  );

  assert.equal(
    deriveRoomTypeFromFallbackSignals({
      title: '欢友家庭房-配亲子沙发床',
      bedText: '欢友家庭房-配亲子沙发床 1张大床 + 1张沙发床'
    }),
    ROOM_TYPES.FAMILY
  );
});

test('big-bed versus twin alternatives still stay ambiguous when twin signals are real', () => {
  assert.equal(
    deriveRoomTypeFromStructuredBed({
      title: '行政套房',
      bedTitle: '1张大床 或 2张单人床',
      bedCount: 2
    }),
    ROOM_TYPES.BIG_BED_OR_TWIN
  );
});
