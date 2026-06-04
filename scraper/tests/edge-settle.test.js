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
    if (modulePath.endsWith('network-capture.js')) {
      for (const relatedModulePath of [
        '../src/scraper/edge-capture-modules/network-response-classifier',
        '../src/scraper/edge-capture-modules/response-body-reader',
        '../src/scraper/edge-capture-modules/response-parser',
        '../src/scraper/edge-capture-modules/dom-extract-script',
        '../src/scraper/edge-capture-modules/login-detection',
        '../src/scraper/edge-capture-modules/edge-retry-policy',
        '../src/scraper/edge-capture-modules/edge-dom-extract',
        '../src/scraper/edge-capture-modules/edge-target-capture',
        '../src/scraper/edge-capture-modules/edge-target-session'
      ]) {
        delete require.cache[require.resolve(relatedModulePath)];
      }
    }
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

test('settleRoomListInEdgeSession skips late DOM settle steps after room API responses are captured', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isMainScroll = expression.includes('stableHeightRounds');
      return JSON.stringify({
        clickedCount: isMainScroll ? 1 : 0,
        scrollCount: isMainScroll ? 7 : 1,
        containerCount: 1,
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
    let roomTrackedUrlCount = 0;
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => 4,
      getRoomTrackedUrlCount: () => roomTrackedUrlCount,
      roomApiFastSettleThreshold: 4,
      onSettleStepComplete(phase) {
        if (phase === 'edge_settle_main_scroll') {
          roomTrackedUrlCount = 4;
        }
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
    assert.equal(
      expressions.some((expression) => expression.includes('await scrollAllContainers')),
      false
    );
    assert.equal(
      expressions.some((expression) =>
        expression.includes('window.scrollTo({ top: document.body.scrollHeight')
      ),
      false
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_scroll_containers').status,
      'skipped'
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_bottom_expand').skip_reason,
      'room_api_fast_path'
    );
    assert.equal(stats.apiFastPathSkippedStepCount, 3);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession skips bottom settle steps after container scroll captures room API', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isScrollContainersStep = expression.includes('await scrollAllContainers');
      return JSON.stringify({
        clickedCount: 0,
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
    let readableRoomResponseCount = 0;
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => 4,
      getRoomTrackedUrlCount: () => readableRoomResponseCount,
      getReadableRoomResponseCount: () => readableRoomResponseCount,
      onSettleStepComplete(phase) {
        if (phase === 'edge_settle_scroll_containers') {
          readableRoomResponseCount = 1;
        }
      }
    });

    assert.equal(
      expressions.some((expression) =>
        expression.includes('window.scrollTo({ top: document.body.scrollHeight')
      ),
      false
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_scroll_containers').status,
      'success'
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_bottom_expand').skip_reason,
      'room_api_fast_path'
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_return_top').skip_reason,
      'room_api_fast_path'
    );
    assert.equal(stats.apiFastPathSkippedStepCount, 2);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession skips main scroll when room API is already captured', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: 1,
        containerCount: 0,
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
      getTrackedUrlCount: () => 3,
      getRoomTrackedUrlCount: () => 1
    });

    assert.equal(
      expressions.some((expression) => expression.includes('stableHeightRounds')),
      false
    );
    assert.equal(
      expressions.some((expression) => expression.includes('await scrollAllContainers')),
      false
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_close_panels').status,
      'success'
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_initial_expand').status,
      'skipped'
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_main_scroll').status,
      'skipped'
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_initial_expand').skip_reason,
      'room_api_fast_path'
    );
    assert.equal(stats.apiFastPathSkippedStepCount, 5);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settleRoomListInEdgeSession keeps scrolling until a room API body is readable', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: expression.includes('stableHeightRounds') ? 3 : 1,
        containerCount: 0,
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
      getTrackedUrlCount: () => 3,
      getRoomTrackedUrlCount: () => 1,
      getReadableRoomResponseCount: () => 0
    });

    assert.equal(
      expressions.some((expression) => expression.includes('stableHeightRounds')),
      true
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_main_scroll').status,
      'success'
    );
    assert.equal(stats.apiFastPathSkippedStepCount, 0);
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
    waitForSessionCondition: async (connection, sessionId, expression, timeoutMs, intervalMs) => {
      waitCalls.push({ connection, sessionId, expression, timeoutMs, intervalMs });
      return true;
    }
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

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

test('network capture exposes shared Edge target capture runner', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  const networkCapture = require('../src/scraper/edge-capture-modules/network-capture');
  assert.equal(typeof networkCapture.runEdgeTargetCapture, 'function');
  assert.equal(Object.keys(networkCapture).includes('runEdgeTargetCapture'), false);
});

test('edge settle retries once after transient execution context destruction', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

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

    assert.equal(
      isTransientEdgeExecutionContextError(new Error('Execution context was destroyed.')),
      true
    );
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

test('settle close panels avoids hotel navigation tabs that recreate execution context', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: 1,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
        bodyTextLength: 3000,
        roomKeywordCount: 8
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder([]),
      getTrackedUrlCount: () => 0
    });

    const browserExpression = expressions.join('\n');
    assert.equal(browserExpression.includes('服务及设施'), false);
    assert.equal(browserExpression.includes('酒店简介'), false);
    assert.equal(browserExpression.includes('订房必读'), false);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle expand helper does not click collapse-only hidden room labels', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: 1,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
        bodyTextLength: 3000,
        roomKeywordCount: 8
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder([]),
      getTrackedUrlCount: () => 0
    });

    const browserExpression = expressions.join('\n');
    assert.equal(browserExpression.includes("const expandTexts = ['展示额外', '隐藏房型'"), false);
    assert.ok(browserExpression.includes('isCollapseOnlyRoomToggle'));
    assert.ok(browserExpression.includes('if (isCollapseOnlyRoomToggle(text)) continue;'));
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle expand helper uses bounded scan selector and records scan diagnostics', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const hasScanDiagnostics =
        expression.includes('scanCandidateCount') &&
        expression.includes('explicitCandidateCount') &&
        expression.includes('genericCandidateCount') &&
        expression.includes('clickScanElapsedMs');
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: 1,
        scanCandidateCount: hasScanDiagnostics ? 12 : 0,
        explicitCandidateCount: hasScanDiagnostics ? 3 : 0,
        genericCandidateCount: hasScanDiagnostics ? 1 : 0,
        clickScanElapsedMs: hasScanDiagnostics ? 4 : 0,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    const browserExpression = expressions.join('\n');
    assert.ok(browserExpression.includes('getExpandScanElements'));
    assert.equal(browserExpression.includes('section, article'), false);
    assert.equal(stats.scanCandidateCount, 72);
    assert.equal(stats.explicitCandidateCount, 18);
    assert.equal(stats.genericCandidateCount, 6);
    assert.equal(stats.clickScanElapsedMs, 24);
    assert.equal(records[0].scan_candidate_count, 12);
    assert.equal(records[0].explicit_candidate_count, 3);
    assert.equal(records[0].generic_candidate_count, 1);
    assert.equal(records[0].click_scan_elapsed_ms, 4);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle main scroll accumulates click scan diagnostics', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isMainScroll = expression.includes('stableHeightRounds');
      const accumulatesMainScan =
        expression.includes('scanCandidateCount += clicked.scanCandidateCount') &&
        expression.includes('explicitCandidateCount += clicked.explicitCandidateCount') &&
        expression.includes('genericCandidateCount += clicked.genericCandidateCount') &&
        expression.includes('clickScanElapsedMs += clicked.clickScanElapsedMs');
      return JSON.stringify({
        clickedCount: isMainScroll ? 2 : 0,
        scrollCount: isMainScroll ? 3 : 1,
        scanCandidateCount: isMainScroll && accumulatesMainScan ? 36 : 0,
        explicitCandidateCount: isMainScroll && accumulatesMainScan ? 9 : 0,
        genericCandidateCount: isMainScroll && accumulatesMainScan ? 3 : 0,
        clickScanElapsedMs: isMainScroll && accumulatesMainScan ? 15 : 0,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    assert.ok(expressions.some((expression) => expression.includes('stableHeightRounds')));
    assert.equal(stats.scanCandidateCount, 36);
    assert.equal(stats.explicitCandidateCount, 9);
    assert.equal(stats.genericCandidateCount, 3);
    assert.equal(stats.clickScanElapsedMs, 15);
    const mainRecord = records.find((record) => record.phase === 'edge_settle_main_scroll');
    assert.equal(mainRecord.scan_candidate_count, 36);
    assert.equal(mainRecord.explicit_candidate_count, 9);
    assert.equal(mainRecord.generic_candidate_count, 3);
    assert.equal(mainRecord.click_scan_elapsed_ms, 15);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle main scroll records staged fallback scan diagnostics', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isMainScroll = expression.includes('stableHeightRounds');
      const usesStagedFallback =
        expression.includes('getExpandScanElements(false)') &&
        expression.includes('getExpandScanElements(true)') &&
        expression.includes('genericFallbackScanCount');
      return JSON.stringify({
        clickedCount: isMainScroll ? 1 : 0,
        scrollCount: isMainScroll ? 2 : 1,
        scanCandidateCount: isMainScroll && usesStagedFallback ? 24 : 0,
        explicitCandidateCount: isMainScroll && usesStagedFallback ? 3 : 0,
        genericCandidateCount: isMainScroll && usesStagedFallback ? 1 : 0,
        clickScanElapsedMs: isMainScroll && usesStagedFallback ? 7 : 0,
        explicitScanCandidateCount: isMainScroll && usesStagedFallback ? 18 : 0,
        fallbackScanCandidateCount: isMainScroll && usesStagedFallback ? 6 : 0,
        genericFallbackScanCount: isMainScroll && usesStagedFallback ? 1 : 0,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    const mainExpression = expressions.find((expression) =>
      expression.includes('stableHeightRounds')
    );
    assert.ok(mainExpression.includes('getExpandScanElements(false)'));
    assert.ok(mainExpression.includes('getExpandScanElements(true)'));
    assert.equal(stats.explicitScanCandidateCount, 18);
    assert.equal(stats.fallbackScanCandidateCount, 6);
    assert.equal(stats.genericFallbackScanCount, 1);
    const mainRecord = records.find((record) => record.phase === 'edge_settle_main_scroll');
    assert.equal(mainRecord.explicit_scan_candidate_count, 18);
    assert.equal(mainRecord.fallback_scan_candidate_count, 6);
    assert.equal(mainRecord.generic_fallback_scan_count, 1);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle main scroll suppresses generic fallback until room signal is stable', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isMainScroll = expression.includes('stableHeightRounds');
      const gatesGenericFallback =
        expression.includes('allowGenericFallback') &&
        expression.includes('roomSignalStableBeforeClick') &&
        expression.includes('genericFallbackSuppressedCount');
      return JSON.stringify({
        clickedCount: isMainScroll ? 1 : 0,
        scrollCount: isMainScroll ? 3 : 1,
        scanCandidateCount: isMainScroll && gatesGenericFallback ? 18 : 0,
        explicitCandidateCount: isMainScroll && gatesGenericFallback ? 3 : 0,
        genericCandidateCount: isMainScroll && gatesGenericFallback ? 1 : 0,
        clickScanElapsedMs: isMainScroll && gatesGenericFallback ? 5 : 0,
        explicitScanCandidateCount: isMainScroll && gatesGenericFallback ? 12 : 0,
        fallbackScanCandidateCount: isMainScroll && gatesGenericFallback ? 6 : 0,
        genericFallbackScanCount: isMainScroll && gatesGenericFallback ? 1 : 0,
        genericFallbackSuppressedCount: isMainScroll && gatesGenericFallback ? 2 : 0,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    const mainExpression = expressions.find((expression) =>
      expression.includes('stableHeightRounds')
    );
    assert.ok(mainExpression.includes('allowGenericFallback'));
    assert.ok(mainExpression.includes('roomSignalStableBeforeClick'));
    assert.equal(stats.genericFallbackSuppressedCount, 2);
    const mainRecord = records.find((record) => record.phase === 'edge_settle_main_scroll');
    assert.equal(mainRecord.generic_fallback_suppressed_count, 2);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle scan is scoped to detected room section and records section diagnostics', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const hasRoomSectionScope =
        expression.includes('getRoomSectionBounds') &&
        expression.includes('isElementInRoomSection') &&
        expression.includes('roomSectionScanOnlyCount') &&
        expression.includes('nonRoomSectionReachedCount');
      return JSON.stringify({
        clickedCount: 0,
        scrollCount: 1,
        scanCandidateCount: hasRoomSectionScope ? 20 : 0,
        explicitCandidateCount: 0,
        genericCandidateCount: 0,
        clickScanElapsedMs: hasRoomSectionScope ? 3 : 0,
        roomSectionDetectedCount: hasRoomSectionScope ? 1 : 0,
        roomSectionScanOnlyCount: hasRoomSectionScope ? 1 : 0,
        nonRoomSectionReachedCount: hasRoomSectionScope ? 1 : 0,
        roomSectionElementCount: hasRoomSectionScope ? 120 : 0,
        roomCardCount: hasRoomSectionScope ? 12 : 0,
        roomExpandButtonCount: hasRoomSectionScope ? 4 : 0,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    const expression = expressions.join('\n');
    assert.ok(expression.includes('getRoomSectionBounds'));
    assert.ok(expression.includes('isElementInRoomSection'));
    assert.equal(stats.roomSectionDetectedCount >= 6, true);
    assert.equal(stats.roomSectionScanOnlyCount >= 6, true);
    assert.equal(stats.nonRoomSectionReachedCount >= 6, true);
    assert.equal(stats.roomCardCount, 12);
    const mainRecord = records.find((record) => record.phase === 'edge_settle_main_scroll');
    assert.equal(mainRecord.room_section_detected_count, 1);
    assert.equal(mainRecord.room_section_scan_only_count, 1);
    assert.equal(mainRecord.non_room_section_reached_count, 1);
    assert.equal(mainRecord.room_card_count, 12);
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle close panels records empty fast path when no panel was closed', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isClosePanelsStep = expression.includes('closeReviewPanels');
      return JSON.stringify({
        clickedCount: 0,
        emptyCloseFastPathCount:
          isClosePanelsStep &&
          expression.includes('if (clickedCount > 0)') &&
          expression.includes('emptyCloseFastPathCount')
            ? 1
            : 0,
        scrollCount: 1,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    assert.ok(expressions.some((expression) => expression.includes('emptyCloseFastPathCount')));
    assert.equal(stats.emptyCloseFastPathCount, 1);
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_close_panels')
        .empty_close_fast_path_count,
      1
    );
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle initial expand records fast path when no expand button was clicked', async () => {
  const expressions = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      expressions.push(expression);
      const isInitialExpand = expression.includes('let initialExpandFastPathCount');
      return JSON.stringify({
        clickedCount: 0,
        initialExpandFastPathCount:
          isInitialExpand &&
          expression.includes('initialExpandFastPathCount') &&
          expression.includes('await sleep(55)')
            ? 1
            : 0,
        scrollCount: 1,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    assert.ok(expressions.some((expression) => expression.includes('initialExpandFastPathCount')));
    assert.equal(stats.initialExpandFastPathCount, 1);
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_initial_expand')
        .initial_expand_fast_path_count,
      1
    );
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('settle step retries transient execution context destruction locally', async () => {
  let evaluateCount = 0;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async () => {
      evaluateCount += 1;
      if (evaluateCount === 1) {
        throw new Error('Execution context was destroyed');
      }
      return JSON.stringify({
        clickedCount: 1,
        scrollCount: 1,
        containerCount: 0,
        documentHeightBefore: 1000,
        documentHeightAfter: 1000,
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
      getTrackedUrlCount: () => 0
    });

    assert.equal(evaluateCount, 7);
    assert.equal(stats.clickedCount, 6);
    assert.equal(
      records.some((record) => record.event === 'phase_error'),
      false
    );
    assert.deepEqual(
      records.find((record) => record.event === 'edge_settle_step_retry'),
      {
        event: 'edge_settle_step_retry',
        phase: 'edge_settle_close_panels',
        retry_count: 1,
        retry_reason: 'execution_context_destroyed'
      }
    );
    assert.equal(
      records.find((record) => record.phase === 'edge_settle_close_panels').retry_count,
      1
    );
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});

test('edge settle waits for execution context stability before settling', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      settleRoomListWithEdgeRetry
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const sequence = [];
    const result = await settleRoomListWithEdgeRetry({
      perf: createPerfRecorder([]),
      connection: { send() {} },
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'create',
      navigateSignal: { reason: 'page_ready_signal' },
      trackedUrls: new Set(),
      waitForContextStable: async () => {
        sequence.push('context_stable');
        return { confirmed: true };
      },
      settleRoomList: async () => {
        sequence.push('settle');
        return {
          totalMs: 100,
          clickedCount: 0,
          scrollCount: 1,
          containerCount: 0
        };
      }
    });

    assert.deepEqual(sequence, ['context_stable', 'settle']);
    assert.equal(result.stats.totalMs, 100);
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
  clearModules([networkCapturePath]);

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
      template: { room_type: '大床房', room_count: 2 },
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

test('edge response parse uses prefetched room body when delayed CDP body reads fail', async () => {
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
  clearModules([networkCapturePath]);

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
          throw new Error('No data found for resource with given identifier');
        }
      },
      sessionId: 'session-1',
      requestMeta: new Map([
        [
          'room-request',
          {
            url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
            mimeType: 'application/json',
            cachedBody: JSON.stringify({ roomName: '标准大床房' }),
            cachedBodyResult: {
              body: JSON.stringify({ roomName: '标准大床房' }),
              retryCount: 0,
              timeoutCount: 0,
              elapsedMs: 4,
              error: null
            }
          }
        ]
      ]),
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(bodyReadCount, 0);
    assert.equal(stats.cachedResponseBodyHitCount, 1);
    assert.equal(stats.cachedRoomResponseBodyHitCount, 1);
    assert.equal(stats.roomResponseCount, 1);
    assert.equal(stats.responseParseCandidateCount, 1);
    assert.equal(roomBlocks.length, 1);
  } finally {
    clearModules([networkCapturePath, extractorPath, debugPath]);
  }
});

test('edge response parse stops reading non-room responses after room API fast path is complete', async () => {
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
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const readRequestIds = [];
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async (_method, params) => {
          readRequestIds.push(params.requestId);
          if (params.requestId === 'room-request') {
            return {
              body: JSON.stringify({ roomName: '标准大床房' }),
              base64Encoded: false
            };
          }
          return {
            body: JSON.stringify({ roomName: '不应读取的补充房型' }),
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
        ],
        [
          'detail-request',
          {
            url: 'https://m.ctrip.com/restapi/soa2/99999/getHotelDetail',
            mimeType: 'application/json'
          }
        ]
      ]),
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.deepEqual(readRequestIds, ['room-request']);
    assert.equal(stats.fastPathComplete, true);
    assert.equal(stats.skippedResponseCount, 1);
    assert.equal(stats.responseParseStoppedReason, 'room_fast_path_complete');
    assert.equal(roomBlocks.length, 1);
  } finally {
    clearModules([networkCapturePath, extractorPath, debugPath]);
  }
});

test('edge response parse reads latest duplicate room response first and skips stale duplicate after success', async () => {
  const roomUrl = 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList';
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
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const readRequestIds = [];
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async (_method, params) => {
          readRequestIds.push(params.requestId);
          if (params.requestId === 'stale-room-request') {
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
          'stale-room-request',
          {
            url: roomUrl,
            mimeType: 'application/json'
          }
        ],
        [
          'fresh-room-request',
          {
            url: roomUrl,
            mimeType: 'application/json'
          }
        ]
      ]),
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.deepEqual(readRequestIds, ['fresh-room-request']);
    assert.equal(stats.responseParseEntryCount, 2);
    assert.equal(stats.duplicateResponseUrlCount, 1);
    assert.equal(stats.roomResponseEntryCount, 2);
    assert.equal(stats.roomResponseCount, 1);
    assert.equal(stats.duplicateRoomResponseSkippedCount, 1);
    assert.equal(stats.roomResponseUrlFallbackCount, 0);
    assert.equal(stats.roomResponseBodyErrorCount, 0);
    assert.equal(roomBlocks.length, 1);
  } finally {
    clearModules([networkCapturePath, extractorPath, debugPath]);
  }
});

test('edge response parse falls back to older duplicate room response when latest request body is unavailable', async () => {
  const roomUrl = 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList';
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
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const readRequestIds = [];
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async (_method, params) => {
          readRequestIds.push(params.requestId);
          if (params.requestId === 'fresh-room-request') {
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
          'stale-room-request',
          {
            url: roomUrl,
            mimeType: 'application/json'
          }
        ],
        [
          'fresh-room-request',
          {
            url: roomUrl,
            mimeType: 'application/json'
          }
        ]
      ]),
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891',
      roomResponseBodyMaxAttempts: 1
    });

    assert.deepEqual(readRequestIds, ['fresh-room-request', 'stale-room-request']);
    assert.equal(stats.roomResponseCount, 1);
    assert.equal(stats.duplicateRoomResponseSkippedCount, 0);
    assert.equal(stats.roomResponseUrlFallbackCount, 1);
    assert.equal(stats.roomResponseBodyErrorCount, 1);
    assert.equal(roomBlocks.length, 1);
  } finally {
    clearModules([networkCapturePath, extractorPath, debugPath]);
  }
});

test('edge response parse reports response entry, duplicate URL, and body byte diagnostics', async () => {
  const roomUrl = 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList';
  const detailUrl = 'https://m.ctrip.com/restapi/soa2/99999/getHotelDetail';
  const roomBody = JSON.stringify({ roomName: '标准大床房' });
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
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const readRequestIds = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async (_method, params) => {
          readRequestIds.push(params.requestId);
          return {
            body: roomBody,
            base64Encoded: false
          };
        }
      },
      sessionId: 'session-1',
      requestMeta: new Map([
        [
          'room-request-1',
          {
            url: roomUrl,
            mimeType: 'application/json'
          }
        ],
        [
          'room-request-2',
          {
            url: roomUrl,
            mimeType: 'application/json'
          }
        ],
        [
          'detail-request',
          {
            url: detailUrl,
            mimeType: 'application/json'
          }
        ]
      ]),
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks: [],
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.deepEqual(readRequestIds, ['room-request-2']);
    assert.equal(stats.responseParseEntryCount, 3);
    assert.equal(stats.uniqueResponseUrlCount, 2);
    assert.equal(stats.duplicateResponseUrlCount, 1);
    assert.equal(stats.roomResponseEntryCount, 2);
    assert.equal(stats.nonRoomResponseEntryCount, 1);
    assert.equal(stats.duplicateRoomResponseSkippedCount, 1);
    assert.equal(stats.responseBodyReadCount, readRequestIds.length);
    assert.equal(stats.responseBodyTotalBytes, Buffer.byteLength(roomBody) * readRequestIds.length);
    assert.equal(stats.responseBodyMaxBytes, Buffer.byteLength(roomBody));
  } finally {
    clearModules([networkCapturePath, extractorPath, debugPath]);
  }
});

test('edge response parse skips raw text fallback when structured room data completes fast path', async () => {
  let rawFallbackCalls = 0;
  const htmlParserPath = installMock('../src/scraper/html-parser', {
    findRoomBlocksFromStructuredText: () => {
      rawFallbackCalls += 1;
      return [
        {
          title: '原始文本不应再解析的房型',
          standard_title: '原始文本不应再解析的房型',
          price: 188,
          prices: [188],
          occupancy: 2,
          source: 'edge-cdp-raw'
        }
      ];
    },
    findRoomBlocksFromHtml: () => [],
    safeJsonParse: (text) => {
      try {
        return JSON.parse(text);
      } catch (_error) {
        return null;
      }
    }
  });
  const extractorPath = installMock('../src/scraper/structured-extractor', {
    collectRoomCandidatesFromPayload: () => [
      {
        title: '标准大床房',
        standard_title: '标准大床房',
        price: 288,
        prices: [288],
        occupancy: 2,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ]
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async () => ({
          body: JSON.stringify({ roomName: '标准大床房' }),
          base64Encoded: false
        })
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
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(rawFallbackCalls, 0);
    assert.equal(stats.rawFallbackSkippedCount, 1);
    assert.equal(stats.rawFallbackUsedCount, 0);
    assert.equal(roomBlocks.length, 1);
    assert.equal(stats.fastPathComplete, true);
  } finally {
    clearModules([networkCapturePath, extractorPath, htmlParserPath, debugPath]);
  }
});

test('edge response parse keeps raw text fallback when structured room data is incomplete', async () => {
  let rawFallbackCalls = 0;
  const htmlParserPath = installMock('../src/scraper/html-parser', {
    findRoomBlocksFromStructuredText: () => {
      rawFallbackCalls += 1;
      return [
        {
          title: '标准大床房',
          standard_title: '标准大床房',
          price: 288,
          prices: [288],
          occupancy: 2,
          cancelPolicy: '免费取消',
          source: 'edge-cdp-raw'
        }
      ];
    },
    findRoomBlocksFromHtml: () => [],
    safeJsonParse: (text) => {
      try {
        return JSON.parse(text);
      } catch (_error) {
        return null;
      }
    }
  });
  const extractorPath = installMock('../src/scraper/structured-extractor', {
    collectRoomCandidatesFromPayload: () => [
      {
        title: '商务单人房',
        standard_title: '商务单人房',
        price: null,
        prices: [],
        occupancy: 1,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ]
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async () => ({
          body: JSON.stringify({ roomName: '商务单人房' }),
          base64Encoded: false
        })
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
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(rawFallbackCalls, 1);
    assert.equal(stats.rawFallbackUsedCount, 1);
    assert.equal(stats.rawFallbackSkippedCount, 0);
    assert.equal(roomBlocks.length, 2);
    assert.equal(stats.fastPathComplete, true);
  } finally {
    clearModules([networkCapturePath, extractorPath, htmlParserPath, debugPath]);
  }
});

test('edge response parse skips raw fallback when structured room data already has prices', async () => {
  let rawFallbackCalls = 0;
  const htmlParserPath = installMock('../src/scraper/html-parser', {
    findRoomBlocksFromStructuredText: () => {
      rawFallbackCalls += 1;
      return [
        {
          title: '原始文本噪声大床房',
          standard_title: '大床房',
          price: 100,
          prices: [100],
          occupancy: 2,
          cancelPolicy: '免费取消',
          source: 'edge-cdp-raw'
        }
      ];
    },
    findRoomBlocksFromHtml: () => [],
    safeJsonParse: (text) => {
      try {
        return JSON.parse(text);
      } catch (_error) {
        return null;
      }
    }
  });
  const extractorPath = installMock('../src/scraper/structured-extractor', {
    collectRoomCandidatesFromPayload: () => [
      {
        title: '商务单人房',
        standard_title: '商务单人房',
        price: 268,
        prices: [268],
        occupancy: 1,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ]
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async () => ({
          body: JSON.stringify({ roomName: '商务单人房' }),
          base64Encoded: false
        })
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
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(rawFallbackCalls, 0);
    assert.equal(stats.rawFallbackUsedCount, 0);
    assert.equal(stats.rawFallbackSkippedCount, 1);
    assert.equal(roomBlocks.length, 1);
    assert.equal(roomBlocks[0].price, 268);
    assert.equal(stats.fastPathComplete, false);
  } finally {
    clearModules([networkCapturePath, extractorPath, htmlParserPath, debugPath]);
  }
});

test('edge response parse prunes earlier raw fallback after structured prices arrive', async () => {
  let rawFallbackCalls = 0;
  const htmlParserPath = installMock('../src/scraper/html-parser', {
    findRoomBlocksFromStructuredText: () => {
      rawFallbackCalls += 1;
      return [
        {
          title: '原始文本噪声大床房',
          standard_title: '大床房',
          price: 100,
          prices: [100],
          occupancy: 2,
          cancelPolicy: '免费取消',
          source: 'edge-cdp-raw'
        }
      ];
    },
    findRoomBlocksFromHtml: () => [],
    safeJsonParse: (text) => {
      try {
        return JSON.parse(text);
      } catch (_error) {
        return null;
      }
    }
  });
  const extractorPath = installMock('../src/scraper/structured-extractor', {
    collectRoomCandidatesFromPayload: (payload) =>
      payload && payload.stage === 'structured'
        ? [
            {
              title: '标准大床房',
              standard_title: '大床房',
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
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async (_method, params) => ({
          body: JSON.stringify({
            stage: params.requestId === 'structured-request' ? 'structured' : 'raw'
          }),
          base64Encoded: false
        })
      },
      sessionId: 'session-1',
      requestMeta: new Map([
        [
          'raw-request',
          {
            url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList?stage=raw',
            mimeType: 'application/json'
          }
        ],
        [
          'structured-request',
          {
            url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList?stage=structured',
            mimeType: 'application/json'
          }
        ]
      ]),
      template: { room_type: '大床房', room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(rawFallbackCalls, 1);
    assert.equal(stats.rawFallbackUsedCount, 1);
    assert.equal(stats.rawFallbackCandidateCount, 1);
    assert.equal(stats.rawFallbackPrunedCount, 1);
    assert.equal(roomBlocks.length, 1);
    assert.equal(roomBlocks[0].title, '标准大床房');
    assert.equal(roomBlocks[0].price, 288);
    assert.equal(stats.fastPathComplete, true);
  } finally {
    clearModules([networkCapturePath, extractorPath, htmlParserPath, debugPath]);
  }
});

test('edge response parse skips raw fallback when structured data matches occupancy-only template', async () => {
  let rawFallbackCalls = 0;
  const htmlParserPath = installMock('../src/scraper/html-parser', {
    findRoomBlocksFromStructuredText: () => {
      rawFallbackCalls += 1;
      return [];
    },
    findRoomBlocksFromHtml: () => [],
    safeJsonParse: (text) => {
      try {
        return JSON.parse(text);
      } catch (_error) {
        return null;
      }
    }
  });
  const extractorPath = installMock('../src/scraper/structured-extractor', {
    collectRoomCandidatesFromPayload: () => [
      {
        title: '舒适双床房',
        standard_title: '双床房',
        price: 288,
        prices: [288],
        occupancy: 2,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ]
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      parseEdgeNetworkResponses
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await parseEdgeNetworkResponses({
      connection: {
        send: async () => ({
          body: JSON.stringify({ roomName: '舒适双床房' }),
          base64Encoded: false
        })
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
      template: { room_count: 2 },
      roomBlocks,
      spiderErrorCodes: new Set(),
      debugHotelId: '112433891'
    });

    assert.equal(rawFallbackCalls, 0);
    assert.equal(stats.rawFallbackSkippedCount, 1);
    assert.equal(stats.rawFallbackUsedCount, 0);
    assert.equal(stats.fastPathComplete, true);
  } finally {
    clearModules([networkCapturePath, extractorPath, htmlParserPath, debugPath]);
  }
});

test('edge DOM extract keeps API rooms and uses short timeout after room API success', async () => {
  let evaluateTimeoutMs = null;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, _expression, options = {}) => {
      evaluateTimeoutMs = options.timeoutMs;
      throw new Error(`CDP Runtime.evaluate timed out after ${options.timeoutMs}ms`);
    },
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const roomBlocks = [
      {
        title: '标准大床房',
        standard_title: '大床房',
        price: 288,
        prices: [288],
        occupancy: 2,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ];

    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(['https://example.test/api/room']),
      debugHotelId: '112433891',
      roomBlocks,
      perf: createPerfRecorder(records),
      apiCaptureComplete: true,
      enableDomSupplement: true
    });

    assert.equal(evaluateTimeoutMs <= 2000, true);
    assert.equal(roomBlocks.length, 1);
    assert.equal(stats.timedOut, true);
    const errorRecord = records.find((record) => record.phase === 'edge_dom_extract');
    assert.equal(errorRecord.event, 'phase_error');
    assert.equal(errorRecord.dom_extract_timeout_ms, evaluateTimeoutMs);
    assert.equal(errorRecord.room_candidates_before, 1);
    assert.equal(errorRecord.room_candidates_after, 1);
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge DOM extract uses lightweight mode when room API capture is complete', async () => {
  let evaluateTimeoutMs = null;
  let evaluatedExpression = '';
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression, options = {}) => {
      evaluateTimeoutMs = options.timeoutMs;
      evaluatedExpression = expression;
      return JSON.stringify({
        bodyText: '选择房间 标准大床房 每晚 ¥288 订房必读',
        bodyHtml: '',
        snippets: ['标准大床房 每晚 ¥288'],
        snapshots: []
      });
    },
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates,
      getEdgeDomExtractTimeoutMs
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const roomBlocks = [
      {
        title: '标准大床房',
        standard_title: '大床房',
        price: 288,
        prices: [288],
        occupancy: 2,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ];

    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(['https://example.test/api/room']),
      debugHotelId: '112433891',
      roomBlocks,
      perf: createPerfRecorder(records),
      apiCaptureComplete: true,
      enableDomSupplement: true
    });

    assert.equal(
      evaluateTimeoutMs,
      getEdgeDomExtractTimeoutMs(roomBlocks, { apiCaptureComplete: true })
    );
    assert.equal(evaluateTimeoutMs, 900);
    assert.equal(
      evaluatedExpression.includes("querySelectorAll('div, li, section, article')"),
      false
    );
    assert.equal(evaluatedExpression.includes('snapshots: []'), true);
    assert.equal(
      roomBlocks.some((room) => room.source === 'edge-api'),
      true
    );
    assert.equal(stats.timedOut, false);
    const phaseRecord = records.find((record) => record.phase === 'edge_dom_extract');
    assert.equal(phaseRecord.event, 'phase');
    assert.equal(phaseRecord.dom_extract_mode, 'api_complete_lightweight');
    assert.equal(phaseRecord.dom_extract_api_complete, true);
    assert.equal(phaseRecord.dom_extract_timeout_ms, 900);
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge DOM extract skips lightweight supplement by default after API capture is complete', async () => {
  let evaluateCalls = 0;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async () => {
      evaluateCalls += 1;
      return JSON.stringify({
        bodyText: '选择房间 标准大床房 每晚 ¥288 订房必读',
        bodyHtml: '',
        snippets: ['标准大床房 每晚 ¥288'],
        snapshots: []
      });
    },
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const roomBlocks = [
      {
        title: '标准大床房',
        standard_title: '大床房',
        price: 288,
        prices: [288],
        occupancy: 2,
        cancelPolicy: '免费取消',
        source: 'edge-api'
      }
    ];

    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(['https://example.test/api/room']),
      debugHotelId: '112433891',
      roomBlocks,
      perf: createPerfRecorder(records),
      apiCaptureComplete: true
    });

    assert.equal(evaluateCalls, 0);
    assert.equal(stats.skipped, true);
    assert.equal(stats.skipReason, 'dom_supplement_disabled');
    assert.equal(roomBlocks.length, 1);
    const phaseRecord = records.find((record) => record.phase === 'edge_dom_extract');
    assert.equal(phaseRecord.status, 'skipped');
    assert.equal(phaseRecord.dom_extract_skip_reason, 'dom_supplement_disabled');
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge DOM extract skips full-page mode when API produced no room candidates', async () => {
  let evaluateTimeoutMs = null;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, _expression, options = {}) => {
      evaluateTimeoutMs = options.timeoutMs;
      throw new Error(`CDP Runtime.evaluate timed out after ${options.timeoutMs}ms`);
    },
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(),
      debugHotelId: '112433891',
      roomBlocks: [],
      perf: createPerfRecorder(records)
    });

    assert.equal(evaluateTimeoutMs, null);
    assert.equal(stats.skipped, true);
    assert.equal(stats.timeoutMs, 6000);
    const phaseRecord = records.find((record) => record.phase === 'edge_dom_extract');
    assert.equal(phaseRecord.status, 'skipped');
    assert.equal(phaseRecord.dom_extract_skip_reason, 'api_capture_incomplete');
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge DOM extract skips full-page mode when API candidates have no visible price', async () => {
  let evaluateTimeoutMs = null;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, _expression, options = {}) => {
      evaluateTimeoutMs = options.timeoutMs;
      throw new Error(`CDP Runtime.evaluate timed out after ${options.timeoutMs}ms`);
    },
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const records = [];
    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(),
      debugHotelId: '112433891',
      roomBlocks: [{ title: '无价大床房', price: null, prices: [], source: 'edge-cdp-raw' }],
      perf: createPerfRecorder(records)
    });

    assert.equal(evaluateTimeoutMs, null);
    assert.equal(stats.skipped, true);
    assert.equal(stats.timeoutMs, 6000);
    const phaseRecord = records.find((record) => record.phase === 'edge_dom_extract');
    assert.equal(phaseRecord.status, 'skipped');
    assert.equal(phaseRecord.dom_extract_skip_reason, 'api_capture_incomplete');
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge DOM extract does not add full-page DOM prices before API success', async () => {
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async () =>
      JSON.stringify({
        bodyText: '选择房间 高级大床房 房型摘要 可住人数 2人 今日价格 ¥100 立即确认',
        bodyHtml: '',
        snippets: [],
        snapshots: []
      }),
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(),
      debugHotelId: '112433891',
      roomBlocks,
      perf: createPerfRecorder([])
    });

    assert.equal(stats.roomCandidatesCount, 0);
    assert.equal(roomBlocks.length, 0);
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge DOM extract skips full-page evaluation before API success', async () => {
  let evaluateCalls = 0;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async () => {
      evaluateCalls += 1;
      return JSON.stringify({
        bodyText: '选择房间 高级大床房 今日价格 ¥288 立即确认',
        bodyHtml: '',
        snippets: [],
        snapshots: []
      });
    },
    createCdpAbortError: (method) => {
      const error = new Error(`CDP ${method} aborted`);
      error.name = 'AbortError';
      return error;
    }
  });
  const debugPath = installMock('../src/scraper/edge-capture-modules/debug', {
    writeEdgeDebugArtifact() {}
  });
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

  try {
    const {
      extractEdgeDomRoomCandidates
    } = require('../src/scraper/edge-capture-modules/network-capture');
    const roomBlocks = [];
    const stats = await extractEdgeDomRoomCandidates({
      connection: {},
      sessionId: 'session-1',
      url: 'https://example.test/hotel',
      captureMethod: 'html_then_edge_cdp',
      targetMode: 'reuse',
      trackedUrls: new Set(),
      debugHotelId: '112433891',
      roomBlocks,
      perf: createPerfRecorder([])
    });

    assert.equal(evaluateCalls, 0);
    assert.equal(stats.skipped, true);
    assert.equal(stats.roomCandidatesCount, 0);
    assert.equal(roomBlocks.length, 0);
  } finally {
    clearModules([networkCapturePath, cdpUtilsPath, debugPath]);
  }
});

test('edge response parse times out stuck response body reads instead of hanging task', async () => {
  const networkCapturePath = require.resolve('../src/scraper/edge-capture-modules/network-capture');
  clearModules([networkCapturePath]);

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
  clearModules([networkCapturePath]);
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
    300
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
    true
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
