const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeTemplateWithArgs, validateTemplate } = require('../src/template-loader');

test('validateTemplate rejects templates above 3 people for scraping', () => {
  const template = mergeTemplateWithArgs(
    {},
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      checkIn: '2026-04-30',
      checkOut: '2026-05-04',
      roomCount: 4
    }
  );

  assert.throws(() => validateTemplate(template), /当前采集仅支持 1-3 人模板/);
});

test('validateTemplate still accepts 3-person templates', () => {
  const template = mergeTemplateWithArgs(
    {},
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      checkIn: '2026-04-30',
      checkOut: '2026-05-04',
      roomCount: 3
    }
  );

  assert.doesNotThrow(() => validateTemplate(template));
});
