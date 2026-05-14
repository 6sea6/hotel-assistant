const test = require('node:test');
const assert = require('node:assert/strict');

const { findRoomBlocksFromStructuredText } = require('../src/scraper/html-parser');

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
