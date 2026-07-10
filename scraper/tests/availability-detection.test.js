const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectBookingUnavailableFromText,
  detectBookingUnavailableFromTexts
} = require('../src/scraper/availability-detection');

test('detects real "本酒店目前不接受预订" rendered text', () => {
  const html = '<div class="empty-tip">本酒店目前不接受预订</div><a>查看其他酒店</a>';
  const result = detectBookingUnavailableFromText(html);
  assert.equal(result.detected, true);
  assert.equal(result.reason, '当前日期不接受预订');
});

test('detects "满房" rendered as visible text', () => {
  const html = '<div class="tip">很抱歉，当前日期满房</div>';
  const result = detectBookingUnavailableFromText(html);
  assert.equal(result.detected, true);
  assert.equal(result.reason, '当前日期满房');
});

test('detects "已售完" pattern', () => {
  const result = detectBookingUnavailableFromText('该房型已售完');
  assert.equal(result.detected, true);
  assert.equal(result.reason, '当前日期房型已售完');
});

test('returns not-detected for normal text without unavailable keywords', () => {
  const result = detectBookingUnavailableFromText('<div>榻榻米亲子房 ¥775</div>');
  assert.equal(result.detected, false);
});

test('detectBookingUnavailableFromTexts returns first detected across inputs', () => {
  const results = detectBookingUnavailableFromTexts([
    '<div>正常</div>',
    '<div class="real-tip">本酒店目前不接受预订</div>'
  ]);
  assert.equal(results.detected, true);
  assert.equal(results.reason, '当前日期不接受预订');
});

test('detectBookingUnavailableFromTexts returns not-detected when no input matches', () => {
  const results = detectBookingUnavailableFromTexts([
    '<div>正常房型</div>',
    '<div>有价格</div>'
  ]);
  assert.equal(results.detected, false);
});
