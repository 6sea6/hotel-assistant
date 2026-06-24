const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeTemplateWithArgs, validateTemplate } = require('../src/template-loader');

test('validateTemplate rejects templates above 4 people for scraping', () => {
  const template = mergeTemplateWithArgs(
    {},
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      checkIn: '2026-04-30',
      checkOut: '2026-05-04',
      roomCount: 5
    }
  );

  assert.throws(() => validateTemplate(template), /当前采集仅支持 1-4 人模板/);
});

test('validateTemplate accepts 4-person templates', () => {
  const template = mergeTemplateWithArgs(
    {},
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      checkIn: '2026-04-30',
      checkOut: '2026-05-04',
      roomCount: 4
    }
  );

  assert.doesNotThrow(() => validateTemplate(template));
});

test('validateTemplate can skip ctrip_url only for address search preparation', () => {
  const template = mergeTemplateWithArgs(
    {},
    {
      checkIn: '2026-04-30',
      checkOut: '2026-05-04',
      roomCount: 2
    }
  );

  assert.throws(() => validateTemplate(template), /ctrip_url/);
  assert.doesNotThrow(() => validateTemplate(template, { requireCtripUrl: false }));
});
