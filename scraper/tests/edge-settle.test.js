const test = require('node:test');
const assert = require('node:assert/strict');

function installMock(modulePath, exports) {
  const resolvedPath = require.resolve(modulePath);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return resolvedPath;
}

function clearModules(paths) {
  for (const modulePath of paths) {
    delete require.cache[modulePath];
  }
}

function createPerfRecorder(records = []) {
  return {
    phase(phase, fields = {}) {
      return {
        end(status = 'success', extra = {}) {
          records.push({ event: 'phase', phase, status, ...fields, ...extra });
        },
        error(error, extra = {}) {
          records.push({
            event: 'phase_error',
            phase,
            status: 'error',
            error_message: error && error.message ? error.message : String(error),
            ...fields,
            ...extra
          });
        }
      };
    },
    event(event, fields = {}) {
      records.push({ event, ...fields });
    }
  };
}

test('settleRoomListInEdgeSession emits split settle phases and aggregate stats', async () => {
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      if (expression.includes('edge_settle_close_panels')) {
        throw new Error('phase marker should not be in browser expression');
      }
      return JSON.stringify({
        clickedCount: 1,
        scrollCount: 2,
        containerCount: 1,
        documentHeightBefore: 1000,
        documentHeightAfter: 1200,
        bodyTextLength: 3000,
        roomKeywordCount: 8
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const records = [];
    let trackedUrlCount = 0;
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => {
        trackedUrlCount += 1;
        return trackedUrlCount;
      }
    });

    const phases = records.map((record) => record.phase);
    assert.deepEqual(phases, [
      'edge_settle_close_panels',
      'edge_settle_initial_expand',
      'edge_settle_main_scroll',
      'edge_settle_scroll_containers',
      'edge_settle_bottom_expand',
      'edge_settle_return_top'
    ]);
    assert.equal(stats.clickedCount, 6);
    assert.equal(stats.scrollCount, 12);
    assert.equal(stats.containerCount, 1);
    assert.ok(stats.totalMs >= 0);
    assert.equal(records[0].clicked_count, 1);
    assert.equal(records[0].scroll_count, 2);
    assert.equal(records[0].container_count, 1);
    assert.equal(typeof records[0].tracked_url_count_before, 'number');
    assert.equal(typeof records[0].tracked_url_count_after, 'number');
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession exposes click de-duplication stats', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      return JSON.stringify({
        clickedCount: 1,
        skippedDuplicateClickCount: 2,
        genericClickCount: 1,
        scrollCount: 2,
        containerCount: 1,
        documentHeightBefore: 1000,
        documentHeightAfter: 1200,
        bodyTextLength: 3000,
        roomKeywordCount: 8
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const records = [];
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => 0
    });

    assert.equal(stats.clickedCount, 6);
    assert.equal(stats.skippedDuplicateClickCount, 12);
    assert.equal(stats.genericClickCount, 6);
    assert.equal(records[0].skipped_duplicate_click_count, 2);
    assert.equal(records[0].generic_click_count, 1);
    assert.ok(
      expressions.some((expression) => expression.includes('__ctripSettleClickedElements'))
    );
    assert.ok(expressions.some((expression) => expression.includes('MAX_GENERIC_EXPAND_CLICKS')));
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession exposes likely room container selection stats', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isScrollContainersStep = expression.includes('await scrollAllContainers');
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: 1,
        containerCount: isScrollContainersStep ? 1 : 0,
        likelyContainerCount: isScrollContainersStep ? 1 : 0,
        fallbackContainerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
        bodyTextLength: 2000,
        roomKeywordCount: 6
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const records = [];
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => 0
    });

    assert.equal(stats.likelyContainerCount, 1);
    assert.equal(stats.fallbackContainerCount, 0);
    const containerRecord = records.find(
      (record) => record.phase === 'edge_settle_scroll_containers'
    );
    assert.equal(containerRecord.likely_container_count, 1);
    assert.equal(containerRecord.fallback_container_count, 0);
    assert.ok(
      expressions.some((expression) => expression.includes('selectLikelyRoomScrollContainers'))
    );
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession skips bottom expand when room list is already stable', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isInitialExpand =
        expression.includes('const clickStats = clickExpandButtons') &&
        !expression.includes('document.body.scrollHeight');
      const isMainScroll = expression.includes('stableHeightRounds');
      const isScrollContainersStep = expression.includes('await scrollAllContainers');
      return JSON.stringify({
        clickedCount: isInitialExpand || isMainScroll ? 1 : 0,
        scrollCount: isScrollContainersStep ? 3 : 1,
        containerCount: isScrollContainersStep ? 1 : 0,
        likelyContainerCount: isScrollContainersStep ? 1 : 0,
        fallbackContainerCount: 0,
        documentHeightBefore: 30000,
        documentHeightAfter: 30000,
        bodyTextLength: 4000,
        roomKeywordCount: 120
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const records = [];
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => 0
    });

    const bottomRecord = records.find((record) => record.phase === 'edge_settle_bottom_expand');
    assert.equal(bottomRecord.status, 'skipped');
    assert.equal(bottomRecord.skipped_bottom_expand_count, 1);
    assert.equal(stats.skippedBottomExpandCount, 1);
    assert.equal(
      expressions.some((expression) =>
        expression.includes('window.scrollTo({ top: document.body.scrollHeight')
      ),
      false
    );
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession treats duplicate skipped clicks as stable for bottom expand', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isInitialExpand =
        expression.includes('const clickStats = clickExpandButtons') &&
        !expression.includes('document.body.scrollHeight');
      const isMainScroll = expression.includes('stableHeightRounds');
      const isScrollContainersStep = expression.includes('await scrollAllContainers');
      return JSON.stringify({
        clickedCount: isInitialExpand || isMainScroll ? 1 : 0,
        skippedDuplicateClickCount: isScrollContainersStep ? 3 : 0,
        scrollCount: isScrollContainersStep ? 3 : 1,
        containerCount: isScrollContainersStep ? 1 : 0,
        likelyContainerCount: isScrollContainersStep ? 1 : 0,
        fallbackContainerCount: 0,
        documentHeightBefore: 30000,
        documentHeightAfter: 30000,
        bodyTextLength: 4000,
        roomKeywordCount: 120
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const records = [];
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => 0
    });

    const bottomRecord = records.find((record) => record.phase === 'edge_settle_bottom_expand');
    assert.equal(bottomRecord.status, 'skipped');
    assert.equal(bottomRecord.skipped_bottom_expand_count, 1);
    assert.equal(stats.skippedBottomExpandCount, 1);
    assert.equal(
      expressions.some((expression) =>
        expression.includes('window.scrollTo({ top: document.body.scrollHeight')
      ),
      false
    );
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('edge page ready performs a short confirmation after navigate ready signal', async () => {
  const waitCalls = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    waitForSessionCondition: async (
      connection,
      sessionId,
      expression,
      timeoutMs,
      intervalMs
    ) => {
      waitCalls.push({ connection, sessionId, expression, timeoutMs, intervalMs });
      return true;
    }
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  delete require.cache[networkCapturePath];

  try {
    const {
      waitForEdgePageReadyAfterNavigate
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const result = await waitForEdgePageReadyAfterNavigate({
      perf: createPerfRecorder(records),
      connection: { send() {} },
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'create',
      navigateSignal: {
        reason: 'page_ready_signal',
        elapsedMs: 321,
        roomResponseSeen: false,
        roomTrackedUrlCount: 0,
        trackedUrlCount: 3
      }
    });

    assert.equal(result.skipped, false);
    assert.equal(waitCalls.length, 1);
    assert.equal(waitCalls[0].sessionId, 'session-1');
    assert.equal(waitCalls[0].timeoutMs <= 1800, true);
    assert.equal(records.length, 1);
    assert.equal(records[0].phase, 'edge_page_ready');
    assert.equal(records[0].status, 'success');
    assert.equal(records[0].confirmation_mode, 'short_context_stability_check');
    assert.equal(records[0].navigate_wait_reason, 'page_ready_signal');
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath]);
  }
});

test('edge settle retries once after transient execution context destruction', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  delete require.cache[networkCapturePath];

  try {
    const {
      isTransientEdgeExecutionContextError,
      settleRoomListWithEdgeRetry
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const waitCalls = [];
    let settleAttempts = 0;
    const result = await settleRoomListWithEdgeRetry({
      perf: createPerfRecorder(records),
      connection: { send() {} },
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'create',
      navigateSignal: { reason: 'page_ready_signal' },
      trackedUrls: new Set(['https://example.test/room-api']),
      settleRoomList: async () => {
        settleAttempts += 1;
        if (settleAttempts === 1) {
          throw new Error('Execution context was destroyed.');
        }
        return {
          totalMs: 123,
          clickedCount: 2,
          scrollCount: 3,
          containerCount: 1
        };
      },
      waitForPageReady: async (args) => {
        waitCalls.push(args);
        return { confirmed: true };
      }
    });

    assert.equal(isTransientEdgeExecutionContextError(new Error('Execution context was destroyed.')), true);
    assert.equal(settleAttempts, 2);
    assert.equal(waitCalls.length, 1);
    assert.equal(waitCalls[0].navigateSignal.reason, 'retry_after_settle_context_destroyed');
    assert.equal(result.retryCount, 1);
    assert.equal(result.retryReason, 'execution_context_destroyed');
    assert.equal(result.stats.clickedCount, 2);
    assert.deepEqual(
      records.find((record) => record.event === 'edge_settle_retry'),
      {
        event: 'edge_settle_retry',
        phase: 'edge_settle_room_list',
        status: 'retry',
        url: 'https://example.test/hotel',
        captureMethod: 'html_then_edge_cdp',
        targetMode: 'create',
        retry_count: 1,
        retry_reason: 'execution_context_destroyed',
        tracked_url_count: 1,
        error_type: 'Error',
        error_message: 'Execution context was destroyed.'
      }
    );
  } finally {
    clearModules([networkCapturePath]);
  }
});

test('edge response parse retries room response body reads before dropping room API data', async () => {
  const extractorPath = installMock('../src/scraper/structured-extractor', {
    collectRoomCandidatesFromPayload: (payload) =>
      payload && payload.roomName
        ? [
            {
              title: payload.roomName,
              standard_title: payload.roomName,
              price: 288,
              prices: [288],
              occupancy: 2,
              cancelPolicy: '免费取消',
              source: 'edge-api'
            }
          ]
        : []
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  delete require.cache[networkCapturePath];

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    let bodyReadCount = 0;
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async () => {
          bodyReadCount += 1;
          if (bodyReadCount === 1) {
            throw new Error('No data found for resource with given identifier');
          }
          return {
            body: JSON.stringify({ roomName: '标准大床房' }),
            base64Encoded: false
          };
        }
      },
      sessionId: 'session-1',
      requestMeta: new Map([
        [
          'room-request',
          {
            url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
            mimeType: 'application/json'
          }
        ]
      ]),
      template: { roomType: '大床房', occupancy: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(bodyReadCount, 2);
    assert.equal(stats.roomResponseCount, 1);
    assert.equal(stats.responseBodyRetryCount, 1);
    assert.equal(stats.roomResponseBodyErrorCount, 0);
    assert.equal(stats.responseParseCandidateCount, 1);
    assert.equal(roomBlocks.length, 1);
  } finally {
    clearModules([networkCapturePath, extractorPath, debugPath]);
  }
});

test('edge response parse times out stuck response body reads instead of hanging task', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  delete require.cache[networkCapturePath];

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const stats = await Promise.race([
      parseEdgeNetworkResponses({
        connection: {
          send: async () => new Promise(() => {})
        },
        sessionId: 'session-1',
        requestMeta: new Map([
          [
            'room-request',
            {
              url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
              mimeType: 'application/json'
            }
          ]
        ]),
        template: { roomType: '大床房', occupancy: 2 },
        roomBlocks: [],
        spiderErrorCodes: new Set(),
        debugHotelId: '112433891',
        responseBodyTimeoutMs: 5,
        roomResponseBodyMaxAttempts: 1
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('parseEdgeNetworkResponses did not finish')), 80)
      )
    ]);

    assert.equal(stats.parsedResponseCount, 0);
    assert.equal(stats.roomResponseBodyErrorCount, 1);
    assert.equal(stats.roomResponseBodyTimeoutCount, 1);
  } finally {
    clearModules([networkCapturePath]);
  }
});

test('edge network wait count prefers room-related responses without dropping parse metadata', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  delete require.cache[networkCapturePath];
  const {
    getEdgeNetworkWaitCount,
    getEdgeNetworkWaitOptions,
    isRoomListNetworkResponse,
    detectCtripLoginPromptFromText,
    isEdgeRoomFastPathComplete,
    getPrioritizedEdgeResponseEntries,
    shouldSkipEdgeResponseAfterRoomSuccess,
    getEdgeBlockedResourcePatterns,
    configureEdgeStaticResourceBlocking,
    waitForEdgeNavigateSignal,
    waitForEdgePageReadyAfterNavigate
  } = require('../src/scraper/edge-capture-modules/network-capture');

  const requestMeta = new Map([
    ['analytics', { url: 'https://example.test/log.json', mimeType: 'application/json' }],
    [
      'room',
      {
        url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
        mimeType: 'application/json'
      }
    ]
  ]);
  const roomRequestMeta = new Map([['room', requestMeta.get('room')]]);

  assert.equal(
    isRoomListNetworkResponse('https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList'),
    true
  );
  assert.equal(isRoomListNetworkResponse('https://example.test/log.json'), false);
  assert.equal(getEdgeNetworkWaitCount(roomRequestMeta, requestMeta), 1);
  assert.equal(getEdgeNetworkWaitCount(new Map(), requestMeta), 2);
  assert.equal(getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta).stableMs < 1200, true);
  assert.equal(getEdgeNetworkWaitOptions(new Map(), requestMeta).stableMs, 1200);
  assert.equal(
    getEdgeNetworkWaitOptions(
      new Map([
        ['room-a', requestMeta.get('room')],
        ['room-b', requestMeta.get('room')]
      ]),
      requestMeta
    ).stableMs,
    400
  );
  assert.equal(typeof waitForEdgePageReadyAfterNavigate, 'function');
  assert.equal(detectCtripLoginPromptFromText('扫码登录 手机号登录 登录后查看低价').detected, true);
  assert.equal(detectCtripLoginPromptFromText('武汉酒店 房型 每晚 ¥288').detected, false);

  const prioritizedEntries = getPrioritizedEdgeResponseEntries(requestMeta);
  assert.deepEqual(
    prioritizedEntries.map(([requestId]) => requestId),
    ['room', 'analytics']
  );
  assert.equal(
    shouldSkipEdgeResponseAfterRoomSuccess(
      { url: 'https://example.test/log.json', mimeType: 'application/json' },
      { fastPathComplete: true }
    ),
    true
  );
  assert.equal(
    shouldSkipEdgeResponseAfterRoomSuccess(
      { url: 'https://example.test/hotel/detail.json', mimeType: 'application/json' },
      { fastPathComplete: true }
    ),
    false
  );
  assert.equal(
    shouldSkipEdgeResponseAfterRoomSuccess(
      { url: 'https://example.test/log.json', mimeType: 'application/json' },
      { fastPathComplete: false }
    ),
    false
  );
  assert.equal(
    isEdgeRoomFastPathComplete(
      [
        {
          title: '标准大床房',
          standard_title: '标准大床房',
          price: 288,
          prices: [288],
          occupancy: 2,
          cancelPolicy: '免费取消'
        }
      ],
      { room_count: 2, room_type: '大床房' }
    ),
    true
  );
  assert.equal(
    isEdgeRoomFastPathComplete(
      [
        {
          title: '标准大床房',
          standard_title: '标准大床房',
          price: 288,
          prices: [288],
          occupancy: 2,
          cancelPolicy: '免费取消'
        }
      ],
      { room_count: 3, room_type: '三人房' }
    ),
    false
  );

  const blockedPatterns = getEdgeBlockedResourcePatterns();
  assert.ok(blockedPatterns.some((pattern) => pattern.includes('*.png')));
  assert.ok(blockedPatterns.some((pattern) => pattern.includes('*.woff2')));
  assert.equal(
    blockedPatterns.some((pattern) => pattern.includes('*.js')),
    false
  );
  assert.equal(
    blockedPatterns.some((pattern) => pattern.includes('*.css')),
    false
  );

  const sent = [];
  const result = await configureEdgeStaticResourceBlocking(
    {
      send: async (method, params, sessionId) => {
        sent.push({ method, params, sessionId });
      }
    },
    'session-1'
  );
  assert.equal(result.enabled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'Network.setBlockedURLs');
  assert.equal(sent[0].sessionId, 'session-1');
  assert.deepEqual(sent[0].params.urls, blockedPatterns);

  let listenerRemoved = false;
  const signal = await waitForEdgeNavigateSignal({
    connection: {
      addListener() {
        return () => {
          listenerRemoved = true;
        };
      }
    },
    sessionId: 'session-1',
    roomRequestMeta: new Map([['room', requestMeta.get('room')]]),
    trackedUrls: new Set(),
    timeoutMs: 1000,
    pollMs: 10
  });
  assert.equal(signal.reason, 'room_response');
  assert.equal(signal.roomResponseSeen, true);
  assert.equal(listenerRemoved, true);
});
