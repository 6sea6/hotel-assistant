const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractHotelDiamondLevelFromHtml,
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

test('extractHotelMetaFromHtml extracts ctrip diamond level from hotel level aria label', () => {
  const html = `
    <html>
      <body>
        <h1>测试酒店</h1>
        <span class="hotelLevel_hotelLevel__mhh3v" aria-label="4 out of 5 diamonds" role="img">
          <i class="u-icon-ic_new_diamond"></i>
          <i class="u-icon-ic_new_diamond"></i>
          <i class="u-icon-ic_new_diamond"></i>
          <i class="u-icon-ic_new_diamond"></i>
        </span>
        <span>舒适型酒店</span>
      </body>
    </html>
  `;

  const meta = extractHotelMetaFromHtml(
    html,
    'https://hotels.ctrip.com/hotels/detail/?hotelId=533161'
  );

  assert.equal(extractHotelDiamondLevelFromHtml(html), 4);
  assert.equal(meta.ctripDiamondLevel, 4);
});

test('extractHotelDiamondLevelFromHtml falls back to diamond icon count', () => {
  const html = `
    <span class="hotelLevel_hotelLevel__mhh3v">
      <i class="u-icon-ic_new_diamond"></i>
      <i class="u-icon-ic_new_diamond"></i>
      <i class="u-icon-ic_new_diamond"></i>
    </span>
  `;

  assert.equal(extractHotelDiamondLevelFromHtml(html), 3);
});

test('extractHotelDiamondLevelFromHtml reads Ctrip rating circle labels', () => {
  const html = `
    <span class="hotelLevel_hotelLevel__mhh3v hotelLevel_hotelLevelCtrip__yaWUT"
      aria-label="2 out of 5 rating" role="img">
      <i aria-hidden="true" class="smarticon u-icon u-icon-ic_new_circle"></i>
      <i aria-hidden="true" class="smarticon u-icon u-icon-ic_new_circle"></i>
    </span>
  `;

  assert.equal(extractHotelDiamondLevelFromHtml(html), 2);
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

test('findRoomBlocksFromStructuredText ignores per-person breakfast fees before room prices', () => {
  const blocks = findRoomBlocksFromStructuredText(
    '珍宝商务大床房 房型摘要 可住人数 2人 无早餐 addBreakfastFeeTables headers 年龄 费用 ceilInfos 成人 ¥90/人 付款担保暂扣¥1019 立即确认'
  );
  const room = blocks.find((item) => item.title.includes('珍宝商务大床房'));

  assert.ok(room);
  assert.deepEqual(room.prices, [1019]);
  assert.equal(room.price, 1019);
});
