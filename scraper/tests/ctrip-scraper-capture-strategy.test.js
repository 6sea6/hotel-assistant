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
    child() {
      return this;
    },
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
            error_type: error && error.name ? error.name : 'Error',
            error_message: error && error.message ? error.message : String(error),
            ...fields,
            ...extra
          });
        }
      };
    },
    async runPhase(phase, fields = {}, callback = null) {
      if (typeof fields === 'function') {
        callback = fields;
        fields = {};
      }
      const phaseTimer = this.phase(phase, fields);
      try {
        const result = await callback();
        phaseTimer.end('success');
        return result;
      } catch (error) {
        phaseTimer.error(error);
        throw error;
      }
    },
    event(event, fields = {}) {
      records.push({ event, ...fields });
    }
  };
}

function makeRoom(title, price, source = '') {
  return {
    title,
    price,
    prices: price === null ? [] : [price],
    occupancy: 2,
    source
  };
}

function installScraperMocks(state = {}) {
  const mockedPaths = [];
  const htmlRoom = state.htmlRoom || makeRoom('HTML大床房', 188, 'desktop');
  const edgeRoom = state.edgeRoom || makeRoom('Edge大床房', 166, 'edge-cdp');
  const calls = {
    fetchHtml: 0,
    edge: 0,
    directReplay: 0
  };

  mockedPaths.push(
    installMock('../src/scraper/html-parser', {
      DESKTOP_HEADERS: {},
      MOBILE_HEADERS: {},
      fetchHtml: async (url) => {
        calls.fetchHtml += 1;
        if (state.onFetchStart) state.onFetchStart(url);
        if (state.htmlDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, state.htmlDelayMs));
        }
        if (state.htmlFails) {
          throw new Error('html failed');
        }
        if (state.onFetchDone) state.onFetchDone(url);
        return {
          html: url.includes('m.ctrip') ? '<html>mobile</html>' : '<html>desktop</html>',
          cookieHeader: ''
        };
      },
      loadHtmlFromFile: () => '<html>local</html>',
      saveHtmlSnapshot: () => '',
      extractHotelMetaFromHtml: (html) => ({
        hotelName: html.includes('mobile') ? '' : 'HTML酒店',
        address: html.includes('mobile') ? '' : 'HTML地址',
        score: 4.8,
        geoInfo: { address: 'HTML地址', location: '114.1,30.1' }
      }),
      extractHotelScoreFromHtml: () => 4.8,
      findRoomBlocksFromHtml: (html) => (html.includes('desktop') ? [htmlRoom] : [])
    })
  );
  mockedPaths.push(
    installMock('../src/scraper/room-logic', {
      mergeRoomCandidates: (rooms = []) => rooms.map((room) => ({ ...room })),
      selectBestRoom: (rooms = []) =>
        rooms.find((room) => room && room.price !== null && room.price !== undefined) || null,
      buildRoomSelectionDiagnostics: (rooms = []) => ({
        evaluations: rooms.map((room) => ({
          action: room.price === null ? 'rejected' : 'selected'
        })),
        eligibleRooms: rooms.filter((room) => room.price !== null && room.price !== undefined)
      }),
      isPersistableRoomCandidate: () => true
    })
  );
  mockedPaths.push(
    installMock('../src/scraper/api-replay', {
      captureRoomCandidatesDirect: async () => {
        calls.directReplay += 1;
        return { roomBlocks: [], selectedRoom: null, trackedUrls: [], error: '' };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/scraper/edge-capture', {
      shouldAttemptSupplementalCapture: () =>
        state.shouldAttemptSupplementalCapture !== undefined
          ? state.shouldAttemptSupplementalCapture
          : true,
      shouldPreferEdgeCapture: () =>
        state.shouldPreferEdgeCapture !== undefined ? state.shouldPreferEdgeCapture : true,
      captureRoomCandidatesWithEdge: async (_url, _template, _edgeSession, edgeOptions = {}) => {
        calls.edge += 1;
        if (state.onEdgeStart) state.onEdgeStart();
        if (state.onEdgeOptions) state.onEdgeOptions(edgeOptions);
        if (state.edgeWaitsForAbort) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, state.edgeDelayMs || 120);
            const abortEdge = () => {
              clearTimeout(timeout);
              const error = new Error('edge aborted after html fast path');
              error.name = 'AbortError';
              reject(error);
            };
            if (edgeOptions.signal && edgeOptions.signal.aborted) {
              abortEdge();
              return;
            }
            edgeOptions.signal?.addEventListener('abort', abortEdge, { once: true });
          });
        }
        if (state.edgeDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, state.edgeDelayMs));
        }
        if (state.onEdgeSettled) state.onEdgeSettled();
        if (state.edgeFails) {
          return {
            roomBlocks: [],
            selectedRoom: null,
            trackedUrls: [],
            error: 'edge failed',
            edgeWaitedForSettle: true,
            settleStats: state.settleStats || null
          };
        }
        return {
          roomBlocks: [edgeRoom],
          selectedRoom: edgeRoom,
          trackedUrls: ['https://example.test/api/room'],
          spiderErrorCodes: [],
          error: '',
          edgeWaitedForSettle: true,
          settleStats: state.settleStats || {
            totalMs: 123,
            clickedCount: 2,
            scrollCount: 4,
            containerCount: 1
          }
        };
      }
    })
  );

  return { calls, mockedPaths };
}

async function withScraper(state, callback) {
  const scraperPath = require.resolve('../src/ctrip-scraper');
  delete require.cache[scraperPath];
  const { calls, mockedPaths } = installScraperMocks(state);
  try {
    const { scrapeCtripHotel } = require('../src/ctrip-scraper');
    return await callback(scrapeCtripHotel, calls);
  } finally {
    clearModules([scraperPath, ...mockedPaths]);
  }
}

test('captureStrategy auto keeps the old HTML-first decision path', async () => {
  let htmlDone = false;
  let edgeStartedBeforeHtmlDone = false;
  await withScraper(
    {
      shouldAttemptSupplementalCapture: false,
      onFetchDone: () => {
        htmlDone = true;
      },
      onEdgeStart: () => {
        edgeStartedBeforeHtmlDone = !htmlDone;
      }
    },
    async (scrapeCtripHotel, calls) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
        {},
        {
          autoEdge: true,
          captureStrategy: 'auto',
          perf: createPerfRecorder([])
        }
      );

      assert.equal(calls.edge, 0);
      assert.equal(edgeStartedBeforeHtmlDone, false);
      assert.equal(result.room.title, 'HTML大床房');
      assert.equal(result.page_snapshot.capture_strategy, 'auto');
    }
  );
});

test('captureStrategy parallel_edge starts HTML and Edge work in parallel', async () => {
  let htmlDone = false;
  let edgeStartedBeforeHtmlDone = false;
  const records = [];

  await withScraper(
    {
      htmlDelayMs: 40,
      onFetchDone: () => {
        htmlDone = true;
      },
      onEdgeStart: () => {
        edgeStartedBeforeHtmlDone = !htmlDone;
      }
    },
    async (scrapeCtripHotel, calls) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=2',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder(records)
        }
      );

      assert.ok(calls.fetchHtml > 0);
      assert.equal(calls.edge, 1);
      assert.equal(edgeStartedBeforeHtmlDone, true);
      assert.equal(result.room.title, 'Edge大床房');
      assert.equal(result.page_snapshot.html_edge_parallel_used, true);
      assert.equal(
        records.some((record) => record.capture_strategy === 'parallel_edge'),
        true
      );
    }
  );
});

test('parallel_edge returns HTML and aborts Edge when HTML already has a priced room', async () => {
  let edgeSignal = null;
  let edgeAbortObserved = false;

  await withScraper(
    {
      edgeDelayMs: 160,
      edgeWaitsForAbort: true,
      shouldAttemptSupplementalCapture: false,
      onEdgeOptions: (edgeOptions) => {
        edgeSignal = edgeOptions.signal;
        edgeOptions.signal?.addEventListener(
          'abort',
          () => {
            edgeAbortObserved = true;
          },
          { once: true }
        );
      }
    },
    async (scrapeCtripHotel, calls) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=3',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder([])
        }
      );

      assert.equal(calls.edge, 1);
      assert.equal(result.room.title, 'HTML大床房');
      assert.equal(result.page_snapshot.capture_method, 'html_only');
      assert.equal(result.page_snapshot.edge_fallback_used, false);
      assert.ok(edgeSignal);
      assert.equal(edgeSignal.aborted, true);
      assert.equal(edgeAbortObserved, true);
    }
  );
});

test('parallel_edge uses Edge rooms only after Edge settle completed', async () => {
  const events = [];

  await withScraper(
    {
      onEdgeStart: () => events.push('edge:start'),
      onEdgeSettled: () => events.push('edge:settle-done')
    },
    async (scrapeCtripHotel) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=3',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder([])
        }
      );

      events.push(`result:${result.room.source}`);
      assert.deepEqual(events, ['edge:start', 'edge:settle-done', 'result:edge-cdp']);
      assert.equal(result.page_snapshot.edge_waited_for_settle, true);
    }
  );
});

test('parallel_edge falls back to HTML when Edge fails', async () => {
  await withScraper(
    {
      edgeFails: true
    },
    async (scrapeCtripHotel) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=4',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder([])
        }
      );

      assert.equal(result.room.title, 'HTML大床房');
      assert.equal(result.page_snapshot.edge_fallback_used, true);
      assert.ok(result.warnings.some((warning) => warning.includes('edge failed')));
    }
  );
});

test('parallel_edge can return Edge rooms with a warning when HTML fails', async () => {
  await withScraper(
    {
      htmlFails: true
    },
    async (scrapeCtripHotel) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=5',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder([])
        }
      );

      assert.equal(result.room.title, 'Edge大床房');
      assert.equal(result.hotel_name, '');
      assert.ok(result.warnings.some((warning) => warning.includes('HTML')));
    }
  );
});

test('parallel_edge settleStats are exposed in quality fields and perf events', async () => {
  const records = [];
  const settleStats = {
    totalMs: 321,
    clickedCount: 5,
    scrollCount: 7,
    containerCount: 2
  };

  await withScraper(
    {
      settleStats
    },
    async (scrapeCtripHotel) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=6',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder(records)
        }
      );

      assert.equal(result.page_snapshot.settle_total_ms, 321);
      assert.equal(result.page_snapshot.settle_clicked_count, 5);
      assert.equal(result.page_snapshot.settle_scroll_count, 7);
      assert.equal(result.page_snapshot.settle_container_count, 2);
      const detailQuality = records.find((record) => record.event === 'detail_quality');
      assert.equal(detailQuality.capture_strategy, 'parallel_edge');
      assert.equal(detailQuality.settle_total_ms, 321);
    }
  );
});

test('scrapeCtripHotel passes login prompt event callback into Edge capture', async () => {
  const events = [];

  await withScraper(
    {
      onEdgeOptions: (edgeOptions) => {
        assert.equal(typeof edgeOptions.onEvent, 'function');
        edgeOptions.onEvent('edge:login-required', '检测到携程登录提示', {
          reason: '页面出现携程登录弹窗。'
        });
      }
    },
    async (scrapeCtripHotel) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=7',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder([]),
          onEvent: (type, message, details) => events.push({ type, message, details })
        }
      );

      assert.equal(result.room.title, 'Edge大床房');
      assert.deepEqual(events, [
        {
          type: 'edge:login-required',
          message: '检测到携程登录提示',
          details: {
            reason: '页面出现携程登录弹窗。'
          }
        }
      ]);
    }
  );
});

test('scrapeCtripHotel passes cancellation signal into Edge capture', async () => {
  const controller = new AbortController();

  await withScraper(
    {
      onEdgeOptions: (edgeOptions) => {
        assert.ok(edgeOptions.signal);
        assert.equal(edgeOptions.signal.aborted, false);
      }
    },
    async (scrapeCtripHotel) => {
      const result = await scrapeCtripHotel(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=8',
        {},
        {
          autoEdge: true,
          captureStrategy: 'parallel_edge',
          perf: createPerfRecorder([]),
          signal: controller.signal
        }
      );

      assert.equal(result.room.title, 'Edge大床房');
    }
  );
});
