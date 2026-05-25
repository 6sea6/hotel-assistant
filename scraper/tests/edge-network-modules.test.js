const assert = require('assert');
const test = require('node:test');

const {
  isRoomListNetworkResponse,
  buildEdgeResponseReadPlan
} = require('../src/scraper/edge-capture-modules/network-response-classifier');
const {
  decodeEdgeResponseBody,
  readEdgeResponseBodyWithRetry,
  withTimeout
} = require('../src/scraper/edge-capture-modules/response-body-reader');
const {
  buildResponseEntryDiagnostics
} = require('../src/scraper/edge-capture-modules/response-parser');
const {
  buildEdgeDomExtractExpression,
  buildLightweightEdgeDomExtractExpression
} = require('../src/scraper/edge-capture-modules/dom-extract-script');
const {
  detectCtripLoginPromptFromText
} = require('../src/scraper/edge-capture-modules/login-detection');

test('network response classifier detects Ctrip room list API URLs', () => {
  assert.equal(
    isRoomListNetworkResponse('https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList'),
    true
  );
  assert.equal(isRoomListNetworkResponse('https://example.test/api/hotelRoomPriceInfo'), true);
  assert.equal(isRoomListNetworkResponse('https://example.test/log.json'), false);
});

test('network response classifier prioritizes latest room responses before other entries', () => {
  const entries = [
    ['room-old', { url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList' }],
    ['analytics', { url: 'https://example.test/log.json' }],
    ['room-new', { url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList' }],
    ['room-pop', { url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomPopInfo' }]
  ];

  assert.deepEqual(
    buildEdgeResponseReadPlan(entries).map(([requestId]) => requestId),
    ['room-new', 'room-old', 'room-pop', 'analytics']
  );
});

test('response body reader decodes base64 bodies and tracks timeout retry stats', async () => {
  assert.equal(
    decodeEdgeResponseBody({
      body: Buffer.from('{"rooms":[]}', 'utf8').toString('base64'),
      base64Encoded: true
    }),
    '{"rooms":[]}'
  );

  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 5),
    (error) => error && error.code === 'EDGE_RESPONSE_BODY_TIMEOUT'
  );

  let attemptCount = 0;
  const result = await readEdgeResponseBodyWithRetry({
    connection: {
      send: async () => {
        attemptCount += 1;
        if (attemptCount === 1) {
          return new Promise(() => {});
        }
        return { body: '{"ok":true}', base64Encoded: false };
      }
    },
    sessionId: 'session-1',
    requestId: 'request-1',
    isRoomResponse: true,
    timeoutMs: 5,
    maxAttempts: 2
  });

  assert.equal(result.body, '{"ok":true}');
  assert.equal(result.retryCount, 1);
  assert.equal(result.timeoutCount, 1);
  assert.equal(result.error, null);
});

test('response parser diagnostics counts room, non-room, duplicate, and unique URLs', () => {
  const diagnostics = buildResponseEntryDiagnostics([
    ['room-a', { url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList' }],
    ['room-b', { url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList' }],
    ['other', { url: 'https://example.test/log.json' }]
  ]);

  assert.equal(diagnostics.responseParseEntryCount, 3);
  assert.equal(diagnostics.roomResponseEntryCount, 2);
  assert.equal(diagnostics.nonRoomResponseEntryCount, 1);
  assert.equal(diagnostics.uniqueResponseUrlCount, 2);
  assert.equal(diagnostics.duplicateResponseUrlCount, 1);
});

test('login detection identifies Ctrip login prompts without matching normal room text', () => {
  assert.equal(detectCtripLoginPromptFromText('扫码登录 手机号登录 登录后查看低价').detected, true);
  assert.equal(detectCtripLoginPromptFromText('武汉酒店 房型 每晚 ¥288').detected, false);
});

test('DOM extract script builders return room-oriented JavaScript strings', () => {
  const fullExpression = buildEdgeDomExtractExpression();
  const lightweightExpression = buildLightweightEdgeDomExtractExpression();

  assert.equal(typeof fullExpression, 'string');
  assert.equal(typeof lightweightExpression, 'string');
  assert.match(fullExpression, /大床房/);
  assert.match(fullExpression, /更多房型/);
  assert.match(lightweightExpression, /大床房/);
  assert.match(lightweightExpression, /JSON\.stringify/);
});
