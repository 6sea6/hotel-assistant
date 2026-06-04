const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractHotelMetaFromHtml,
  findRoomBlocksFromStructuredText
} = require('../src/scraper/html-parser');

test('extractHotelMetaFromHtml tolerates transient empty detail HTML', () => {
  const meta = extractHotelMetaFromHtml(
    '<html><head></head><body></body></html>',
    'https://hotels.ctrip.com/hotels/detail/?hotelId=533161'
  );

  assert.equal(meta.hotelName, '');
  assert.equal(meta.sourceUrl, 'https://hotels.ctrip.com/hotels/detail/?hotelId=533161');
});

test('findRoomBlocksFromStructuredText extracts mixed-bed advanced twin room from DOM-style snippet', () => {
  const blocks = findRoomBlocksFromStructuredText(
    '高级双床间 房型摘要 无早餐 立即确认 在线付 今日价格 ¥530 1张双人床及1张单人床 有窗 禁烟 28-30平方米 6-7层 WiFi免费'
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, '高级双床间');
  assert.equal(blocks[0].standard_title, '家庭房');
  assert.equal(blocks[0].occupancy, 3);
  assert.equal(blocks[0].price, 530);
});

test('findRoomBlocksFromStructuredText ignores implausibly small decorative prices', () => {
  const blocks = findRoomBlocksFromStructuredText(
    '高级大床房 房型摘要 可住人数 2人 今日价格 ¥1 立即确认 高级双床房 房型摘要 可住人数 2人 今日价格 ¥268 立即确认'
  );

  assert.equal(blocks.find((room) => room.title.includes('高级大床房')).price, null);
  assert.equal(blocks.find((room) => room.title.includes('高级双床房')).price, 268);
});
