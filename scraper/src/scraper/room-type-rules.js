const { normalizeText } = require('../utils');

const ROOM_TYPES = {
  BIG_BED: '大床房',
  TWIN: '双床房',
  BIG_BED_OR_TWIN: '大床房/双床房',
  FAMILY: '家庭房',
  TRIPLE: '三床房'
};

const BED_SIZE_SEGMENT = '(?:\\d+(?:\\.\\d+)?米)';
const OPTIONAL_BED_SIZE_SEGMENT = `(?:${BED_SIZE_SEGMENT})?`;
const SINGLE_BED_REGEX = new RegExp(`(\\d)张${OPTIONAL_BED_SIZE_SEGMENT}(?:单人床|小床|沙发床)${OPTIONAL_BED_SIZE_SEGMENT}`, 'g');
const DOUBLE_BED_REGEX = new RegExp(`(\\d)张${OPTIONAL_BED_SIZE_SEGMENT}双人床${OPTIONAL_BED_SIZE_SEGMENT}`, 'g');
const QUEEN_BED_REGEX = new RegExp(`(\\d)张${OPTIONAL_BED_SIZE_SEGMENT}(?:大床|特大床)${OPTIONAL_BED_SIZE_SEGMENT}`, 'g');
const BUNK_BED_REGEX = /(\d)张上下铺/g;

function countMatchedBeds(text, pattern) {
  return [...String(text || '').matchAll(pattern)].reduce((sum, match) => sum + Number(match[1] || 1), 0);
}

function getBedTypeCounts(text) {
  const normalizedText = normalizeText(text);
  return {
    singleBedCount: countMatchedBeds(normalizedText, SINGLE_BED_REGEX),
    doubleBedCount: countMatchedBeds(normalizedText, DOUBLE_BED_REGEX),
    queenBedCount: countMatchedBeds(normalizedText, QUEEN_BED_REGEX),
    bunkBedCount: countMatchedBeds(normalizedText, BUNK_BED_REGEX)
  };
}

function hasExplicitTwinTitle(text) {
  return /双床房|双床|双人房/.test(normalizeText(text));
}

function hasExplicitBigBedTitle(text) {
  return /大床房|大床|特大床/.test(normalizeText(text));
}

function hasMixedBeds({ singleBedCount, doubleBedCount, queenBedCount }) {
  return (doubleBedCount > 0 || queenBedCount > 0) && singleBedCount > 0;
}

function isAlternativeBetweenSingleBedStyles(text, counts, bedCount = null) {
  const normalizedText = normalizeText(text);
  return /或/.test(normalizedText)
    && /(?:大床|特大床)/.test(normalizedText)
    && /双人床/.test(normalizedText)
    && !/(?:单人床|小床|双床)/.test(normalizedText)
    && counts.singleBedCount === 0
    && counts.doubleBedCount === 1
    && (bedCount === null || bedCount === 1);
}

function deriveSingleDoubleBedRoomType(title, bedCount) {
  if (hasExplicitBigBedTitle(title)) {
    return ROOM_TYPES.BIG_BED;
  }
  if (hasExplicitTwinTitle(title)) {
    return ROOM_TYPES.TWIN;
  }
  if (bedCount !== null && bedCount >= 2) {
    return ROOM_TYPES.TWIN;
  }
  return ROOM_TYPES.BIG_BED;
}

function deriveSuiteRoomType(bedText) {
  const normalizedBedText = normalizeText(bedText);
  const counts = getBedTypeCounts(normalizedBedText);

  if (/或/.test(normalizedBedText) && /(?:大床|特大床)/.test(normalizedBedText) && /(?:双床|双人床|单人床|小床)/.test(normalizedBedText)) {
    return ROOM_TYPES.BIG_BED_OR_TWIN;
  }
  if (/(?:大床|特大床)/.test(normalizedBedText) && /(?:双床|双人床|单人床|小床|沙发床)/.test(normalizedBedText)) {
    return ROOM_TYPES.FAMILY;
  }
  if (counts.queenBedCount >= 2 && counts.singleBedCount === 0 && counts.doubleBedCount === 0) {
    return ROOM_TYPES.TWIN;
  }
  if (/(?:大床|特大床)/.test(normalizedBedText)) {
    return ROOM_TYPES.BIG_BED;
  }
  if (/双床|双人床|单人床|小床/.test(normalizedBedText)) {
    return ROOM_TYPES.TWIN;
  }
  return '';
}

function deriveRoomTypeFromStructuredBed({ title, bedTitle, bedCount }) {
  const normalizedTitle = normalizeText(title);
  const normalizedBedTitle = normalizeText(bedTitle);
  const counts = getBedTypeCounts(normalizedBedTitle);

  if (isAlternativeBetweenSingleBedStyles(normalizedBedTitle, counts, bedCount)) {
    return deriveSingleDoubleBedRoomType(normalizedTitle, bedCount);
  }
  if (/或/.test(normalizedBedTitle) && /大床|特大床/.test(normalizedBedTitle) && /单人床|双人床|小床/.test(normalizedBedTitle)) {
    return ROOM_TYPES.BIG_BED_OR_TWIN;
  }
  if (hasMixedBeds(counts)) {
    return ROOM_TYPES.FAMILY;
  }
  if (/(?:大床|特大床|双人床|双床|单人床|小床)/.test(normalizedBedTitle) && /沙发床/.test(normalizedBedTitle)) {
    return ROOM_TYPES.FAMILY;
  }
  if (counts.singleBedCount >= 3 && counts.doubleBedCount === 0 && counts.queenBedCount === 0) {
    return ROOM_TYPES.TRIPLE;
  }
  if (counts.singleBedCount >= 2 && counts.doubleBedCount === 0 && counts.queenBedCount === 0) {
    return ROOM_TYPES.TWIN;
  }
  if (counts.queenBedCount >= 2 && counts.singleBedCount === 0 && counts.doubleBedCount === 0) {
    return ROOM_TYPES.TWIN;
  }
  if (counts.queenBedCount >= 1 && counts.singleBedCount === 0 && counts.doubleBedCount === 0) {
    return ROOM_TYPES.BIG_BED;
  }
  if (counts.doubleBedCount >= 1 && counts.singleBedCount === 0 && counts.queenBedCount === 0) {
    if (counts.doubleBedCount >= 2) {
      return ROOM_TYPES.TWIN;
    }
    return deriveSingleDoubleBedRoomType(normalizedTitle, bedCount);
  }
  return null;
}

function deriveRoomTypeFromFallbackSignals({ title, bedText }) {
  const normalizedTitle = normalizeText(title);
  const normalizedBedText = normalizeText(bedText);
  const counts = getBedTypeCounts(normalizedBedText);

  if (isAlternativeBetweenSingleBedStyles(normalizedBedText, counts)) {
    return deriveSingleDoubleBedRoomType(normalizedTitle, null);
  }
  if (/或/.test(normalizedBedText) && /(?:大床|特大床)/.test(normalizedBedText) && /(?:双床|双人床|单人床|小床)/.test(normalizedBedText)) {
    return ROOM_TYPES.BIG_BED_OR_TWIN;
  }
  if (hasMixedBeds(counts)) {
    return ROOM_TYPES.FAMILY;
  }
  if (/三床房|三人房/.test(normalizedTitle)) {
    return ROOM_TYPES.TRIPLE;
  }
  if (/双人房/.test(normalizedTitle)) {
    return ROOM_TYPES.TWIN;
  }
  if (counts.singleBedCount >= 3 && counts.doubleBedCount === 0 && counts.queenBedCount === 0 && counts.bunkBedCount === 0) {
    return ROOM_TYPES.TRIPLE;
  }
  if (counts.singleBedCount >= 2 && counts.doubleBedCount === 0 && counts.queenBedCount === 0 && counts.bunkBedCount === 0) {
    return ROOM_TYPES.TWIN;
  }
  if (counts.queenBedCount >= 2 && counts.singleBedCount === 0 && counts.doubleBedCount === 0 && counts.bunkBedCount === 0) {
    return ROOM_TYPES.TWIN;
  }
  if (counts.bunkBedCount > 0) {
    return '';
  }
  if (/家庭房/.test(normalizedTitle)) {
    return ROOM_TYPES.FAMILY;
  }
  if (/沙发床/.test(normalizedBedText) && /(?:大床|特大床|双床|双人床|单人床|小床)/.test(normalizedBedText)) {
    return ROOM_TYPES.FAMILY;
  }
  if (hasExplicitTwinTitle(normalizedTitle)) {
    return ROOM_TYPES.TWIN;
  }
  if (hasExplicitBigBedTitle(normalizedTitle)) {
    return ROOM_TYPES.BIG_BED;
  }
  if (/套房/.test(normalizedTitle)) {
    return deriveSuiteRoomType(normalizedBedText);
  }
  return '';
}

module.exports = {
  ROOM_TYPES,
  deriveRoomTypeFromFallbackSignals,
  deriveRoomTypeFromStructuredBed,
  deriveSingleDoubleBedRoomType,
  getBedTypeCounts,
  hasExplicitBigBedTitle,
  hasExplicitTwinTitle,
  isAlternativeBetweenSingleBedStyles
};
