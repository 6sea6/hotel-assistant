const { post } = require('../http-client');
const { pickFirst, toNumber } = require('../utils');
const { buildMobileUrl, buildUrlOverridesFromTemplate } = require('../ctrip-url');
const { mergeRoomCandidates, selectBestRoom } = require('./room-logic');
const { findRoomBlocksFromStructuredText } = require('./html-parser');
const { MOBILE_HEADERS } = require('./html-parser');
const {
  deepClone,
  formatCompactDate,
  collectRoomCandidatesFromPayload,
  extractRoomReplayContext
} = require('./structured-extractor');

const RISK_CONTROL_203_BACKOFF_MIN_MS = 800;
const RISK_CONTROL_203_BACKOFF_MAX_MS = 1000;
// 首次 203 即跳过该酒店所有剩余 variant。
// 之前 RISK_CONTROL_203_CONSECUTIVE_LIMIT=2 需要连续2次203才break，且 catch 块会重置计数器，
// 导致网络异常（超时/断连，也是风控表现）后继续打、放大风控。10家酒店批量场景下全灭。
const RISK_CONTROL_203_CONSECUTIVE_LIMIT = 1;

function extractSpiderErrorCode(payload) {
  const code = toNumber(payload && payload.data && payload.data.htlSpiderActionErrorCode);
  return code !== null ? code : null;
}

function mergeDefined(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing =
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
          ? target[key]
          : {};
      target[key] = mergeDefined(existing, value);
      continue;
    }

    target[key] = value;
  }

  return target;
}

function shouldInspectNetworkResponse(url, mimeType) {
  const normalizedUrl = String(url || '').toLowerCase();
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  return (
    normalizedUrl.includes('/restapi/soa2/') ||
    normalizedUrl.includes('room') ||
    normalizedUrl.includes('hotel') ||
    normalizedMimeType.includes('json')
  );
}

function buildDefaultRoomListSearch(context) {
  return {
    hotelId: context.hotelId,
    roomId: 0,
    checkIn: context.compactCheckIn,
    checkOut: context.compactCheckOut,
    roomQuantity: 1,
    adult: context.adult,
    childInfoItems: [],
    childrenAgeList: [],
    mustShowRoomList: [],
    location: {
      geo: {
        cityID: 0
      }
    },
    filters: [],
    roomFilters: [],
    meta: {
      fgt: -1,
      roomkey: '',
      minCurr: '',
      minPrice: '',
      roomToken: ''
    },
    hasAidInUrl: false,
    cancelPolicyType: 0,
    fixSubhotel: 0,
    listTraceId: '',
    hotelUniqueKey: '',
    page: {
      pageIndex: 1,
      pageSize: 100
    },
    scenario: {},
    roomListQueryId: `copilot-${Date.now()}`,
    isFirstEnterDetailPage: true,
    totalPrice: 1
  };
}

function buildRoomListRequestVariants(context) {
  const seededSearch = mergeDefined(
    buildDefaultRoomListSearch(context),
    deepClone(context.searchSeed || {})
  );
  const detailRequest = deepClone(context.detailRequestParam || {});

  const ssrSearch = deepClone(seededSearch);

  ssrSearch.hotelId =
    context.hotelId || toNumber(ssrSearch.hotelId) || toNumber(detailRequest.hotelId) || 0;
  ssrSearch.checkIn =
    context.compactCheckIn || ssrSearch.checkIn || formatCompactDate(detailRequest.checkIn || '');
  ssrSearch.checkOut =
    context.compactCheckOut ||
    ssrSearch.checkOut ||
    formatCompactDate(detailRequest.checkOut || '');
  ssrSearch.roomQuantity = 1;
  ssrSearch.adult = context.adult;
  ssrSearch.child = 0;
  ssrSearch.childrenAgeList = Array.isArray(ssrSearch.childrenAgeList)
    ? ssrSearch.childrenAgeList
    : [];
  ssrSearch.childInfoItems = Array.isArray(ssrSearch.childInfoItems)
    ? ssrSearch.childInfoItems
    : [];
  ssrSearch.roomListQueryId = ssrSearch.roomListQueryId || `copilot-ssr-${Date.now()}`;
  ssrSearch.scenario = deepClone(detailRequest.scenario || ssrSearch.scenario || {});
  ssrSearch.location = deepClone(
    detailRequest.location || ssrSearch.location || { geo: { cityID: 0 } }
  );
  ssrSearch.filters = Array.isArray(ssrSearch.filters)
    ? ssrSearch.filters
    : Array.isArray(detailRequest.filterInfoList)
      ? deepClone(detailRequest.filterInfoList)
      : [];
  ssrSearch.roomFilters = Array.isArray(ssrSearch.roomFilters) ? ssrSearch.roomFilters : [];
  ssrSearch.mustShowRoomList = Array.isArray(ssrSearch.mustShowRoomList)
    ? ssrSearch.mustShowRoomList
    : [];
  ssrSearch.meta = mergeDefined(
    { fgt: -1, roomkey: '', minCurr: '', minPrice: '', roomToken: '' },
    deepClone(ssrSearch.meta || {})
  );

  const baseSearch = deepClone(ssrSearch);

  baseSearch.hotelId =
    context.hotelId || toNumber(baseSearch.hotelId) || toNumber(detailRequest.hotelId) || 0;
  baseSearch.checkIn =
    context.compactCheckIn || baseSearch.checkIn || formatCompactDate(detailRequest.checkIn || '');
  baseSearch.checkOut =
    context.compactCheckOut ||
    baseSearch.checkOut ||
    formatCompactDate(detailRequest.checkOut || '');
  baseSearch.roomQuantity = 1;
  baseSearch.adult = context.adult;
  baseSearch.child = 0;
  baseSearch.childrenAgeList = [];
  baseSearch.childInfoItems = [];
  baseSearch.isSSR = false;
  baseSearch.isRSC = false;
  baseSearch.roomListQueryId = baseSearch.roomListQueryId || `copilot-${Date.now()}`;
  baseSearch.scenario = deepClone(detailRequest.scenario || baseSearch.scenario || {});
  baseSearch.location = deepClone(
    detailRequest.location || baseSearch.location || { geo: { cityID: 0 } }
  );
  baseSearch.filters = Array.isArray(baseSearch.filters)
    ? baseSearch.filters
    : Array.isArray(detailRequest.filterInfoList)
      ? deepClone(detailRequest.filterInfoList)
      : [];
  baseSearch.roomFilters = Array.isArray(baseSearch.roomFilters) ? baseSearch.roomFilters : [];
  baseSearch.mustShowRoomList = Array.isArray(baseSearch.mustShowRoomList)
    ? baseSearch.mustShowRoomList
    : [];
  baseSearch.meta = mergeDefined(
    { fgt: -1, roomkey: '', minCurr: '', minPrice: '', roomToken: '' },
    deepClone(baseSearch.meta || {})
  );

  const extras = {
    globalCacheCheckIn: baseSearch.checkIn,
    globalCacheCheckOut: baseSearch.checkOut,
    globalCacheQuantity: baseSearch.roomQuantity,
    globalCacheAdultCount: baseSearch.adult,
    globalCacheChildCount: 0,
    globalCacheChildAgeList: [],
    combineRoomPriceMode: 0,
    timeZone: pickFirst(
      context.detailResponse &&
        context.detailResponse.data &&
        context.detailResponse.data.hotelBaseInfo &&
        context.detailResponse.data.hotelBaseInfo.timeOffset
        ? String(Math.round(Number(context.detailResponse.data.hotelBaseInfo.timeOffset) / 3600))
        : null,
      '8'
    )
  };

  const bodies = [
    { search: deepClone(ssrSearch) },
    {
      head: {
        platform: 'H5',
        locale: 'zh-CN',
        currency: 'CNY',
        pageId: '212094',
        bu: 'HBU',
        group: 'ctrip',
        syscode: '09',
        extension: []
      },
      search: deepClone(ssrSearch)
    },
    { search: deepClone(baseSearch) },
    { search: mergeDefined(deepClone(baseSearch), { extras: deepClone(extras) }) },
    {
      head: {
        platform: 'H5',
        locale: 'zh-CN',
        currency: 'CNY',
        pageId: '212094',
        bu: 'HBU',
        group: 'ctrip',
        syscode: '09',
        extension: []
      },
      search: mergeDefined(deepClone(baseSearch), { extras: deepClone(extras) })
    }
  ];

  const operation = context.isOversea ? 'getHotelRoomListOversea' : 'getHotelRoomListInland';
  const endpoints = [
    `https://m.ctrip.com/restapi/soa2/33278/${operation}`,
    `https://m.ctrip.com/restapi/soa2/33278/h5-json/${operation}`
  ];

  return endpoints.flatMap((endpoint) =>
    bodies.map((body, index) => ({
      endpoint,
      body,
      variantName: `${endpoint.includes('/h5-json/') ? 'h5-json' : 'plain'}-${index + 1}`
    }))
  );
}

function createNoopPerf() {
  const noopPhase = {
    end() {},
    error() {},
    async run(callback) {
      return callback();
    }
  };
  return {
    phase() {
      return { ...noopPhase };
    },
    async runPhase(_phase, fields, callback) {
      if (typeof fields === 'function') {
        return fields();
      }
      return callback();
    },
    event() {}
  };
}

function createAbortError() {
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}

function normalizeDelayMs(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function resolveRiskControl203BackoffMs(options = {}) {
  const explicit = options.riskControl203BackoffMs ?? options.riskControlShortBackoffMs;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return normalizeDelayMs(explicit, RISK_CONTROL_203_BACKOFF_MIN_MS);
  }

  const range = Array.isArray(options.riskControl203BackoffRangeMs)
    ? options.riskControl203BackoffRangeMs
    : [];
  const min = normalizeDelayMs(range[0], RISK_CONTROL_203_BACKOFF_MIN_MS);
  const max = Math.max(min, normalizeDelayMs(range[1], RISK_CONTROL_203_BACKOFF_MAX_MS));
  return min + Math.floor(Math.random() * (max - min + 1));
}

function delayWithSignal(delayMs, signal = null) {
  const ms = normalizeDelayMs(delayMs, 0);
  if (ms <= 0) {
    assertNotAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeout = null;
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    if (signal && signal.aborted) {
      onAbort();
      return;
    }

    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function backoffAfterFirstRiskControl203(options = {}, perf = createNoopPerf()) {
  const delayMs = resolveRiskControl203BackoffMs(options);
  perf.event('api_replay_203_short_backoff', {
    delay_ms: delayMs,
    delay_min_ms: RISK_CONTROL_203_BACKOFF_MIN_MS,
    delay_max_ms: RISK_CONTROL_203_BACKOFF_MAX_MS
  });
  const delayFn =
    typeof options.riskControl203Delay === 'function'
      ? options.riskControl203Delay
      : delayWithSignal;
  await delayFn(delayMs, options.signal || null);
  assertNotAborted(options.signal);
}

function isAbortLikeError(error, signal = null) {
  const message = error && error.message ? error.message : String(error || '');
  return Boolean(
    (signal && signal.aborted) ||
    (error && (error.name === 'AbortError' || error.code === 'ERR_CANCELED')) ||
    /任务已取消|aborted|cancelled|canceled/i.test(message)
  );
}

async function captureRoomCandidatesDirect(url, template, parsedSources, options = {}) {
  const perf = options.perf || createNoopPerf();
  const captureMethod = options.captureMethod || 'html_then_api_replay';
  const totalPhase = perf.phase('api_replay_total', {
    url,
    captureMethod
  });
  let context = null;
  let variants = [];
  const attempts = [];
  const spiderErrorCodes = new Set();

  try {
    assertNotAborted(options.signal);
    context = await perf.runPhase('api_replay_build_context', { url, captureMethod }, async () =>
      extractRoomReplayContext(parsedSources, url, template)
    );
    if (!context.hotelId) {
      const result = {
        roomBlocks: [],
        selectedRoom: null,
        trackedUrls: [],
        error: 'direct room-list replay unavailable: hotelId not found'
      };
      totalPhase.end('failed', {
        url,
        captureMethod,
        roomCandidatesCount: 0,
        roomPriceVisible: false,
        trackedUrlCount: 0,
        spiderErrorCodes: []
      });
      return result;
    }

    const referer =
      context.mobileUrl || buildMobileUrl(url, buildUrlOverridesFromTemplate(template)) || url;
    variants = await perf.runPhase('api_replay_build_variants', { url, captureMethod }, async () =>
      buildRoomListRequestVariants(context)
    );
    const blockedVariantGroups = new Set();
    let consecutiveSpider203Count = 0;

    for (const variant of variants) {
      assertNotAborted(options.signal);
      const variantGroup = variant.endpoint.includes('/h5-json/') ? 'h5-json' : 'plain';
      if (blockedVariantGroups.has(variantGroup)) {
        continue;
      }

      const requestPhase = perf.phase('api_replay_request', {
        url,
        endpoint: variant.endpoint,
        variantName: variant.variantName,
        captureMethod
      });
      try {
        const response = await post(variant.endpoint, variant.body, {
          headers: {
            ...MOBILE_HEADERS,
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json;charset=UTF-8',
            origin: 'https://m.ctrip.com',
            referer,
            ...(context.cookieHeader ? { cookie: context.cookieHeader } : {})
          },
          timeoutMs: 30000,
          signal: options.signal || null
        });

        const spiderErrorCode = extractSpiderErrorCode(response.data);
        if (spiderErrorCode !== null) {
          spiderErrorCodes.add(spiderErrorCode);
        }

        const roomBlocks = mergeRoomCandidates([
          ...collectRoomCandidatesFromPayload(response.data, template),
          ...findRoomBlocksFromStructuredText(JSON.stringify(response.data)).map((candidate) => ({
            ...candidate,
            source: candidate.source || 'api-json-raw'
          }))
        ]);
        const selectedRoom = selectBestRoom(roomBlocks, template, options.matchingOptions || {});
        attempts.push({
          endpoint: variant.endpoint,
          variant: variant.variantName,
          spider_error_code: spiderErrorCode,
          room_candidates_count: roomBlocks.length,
          room_price_visible: roomBlocks.some((room) => room.price !== null)
        });
        requestPhase.end(selectedRoom ? 'hit' : 'miss', {
          endpoint: variant.endpoint,
          variantName: variant.variantName,
          spiderErrorCode,
          roomCandidatesCount: roomBlocks.length,
          roomPriceVisible: roomBlocks.some((room) => room.price !== null)
        });

        if (spiderErrorCode === 203 && roomBlocks.length === 0) {
          consecutiveSpider203Count += 1;
          blockedVariantGroups.add(variantGroup);
          if (consecutiveSpider203Count >= RISK_CONTROL_203_CONSECUTIVE_LIMIT) {
            // 首次 203 即 break：已被风控，继续打剩余 variant 只会加重风控、拖慢整体采集。
            // 该酒店走 skipped / 兜底逻辑，比继续打更安全。
            break;
          }
          await backoffAfterFirstRiskControl203(options, perf);
          continue;
        }
        // 注意：此处不再无条件重置 consecutiveSpider203Count。
        // 只有拿到数据（roomBlocks 非空）时才重置，避免"203→超时→203"交替时计数被清零。
        if (roomBlocks.length > 0) {
          consecutiveSpider203Count = 0;
        }

        if (selectedRoom) {
          const result = {
            roomBlocks,
            selectedRoom,
            trackedUrls: [variant.endpoint],
            attempts,
            spiderErrorCodes: [...spiderErrorCodes],
            error: ''
          };
          totalPhase.end('success', {
            url,
            captureMethod,
            roomCandidatesCount: roomBlocks.length,
            roomPriceVisible: roomBlocks.some((room) => room.price !== null),
            trackedUrlCount: 1,
            spiderErrorCodes: [...spiderErrorCodes]
          });
          return result;
        }
      } catch (error) {
        if (isAbortLikeError(error, options.signal)) {
          throw createAbortError();
        }
        // 不重置 consecutiveSpider203Count：网络异常（超时/断连）也可能是风控的表现，
        // 重置会导致"203→网络异常→203"交替时计数被清零、早停失效、继续打加重风控。
        attempts.push({
          endpoint: variant.endpoint,
          variant: variant.variantName,
          error: error && error.message ? error.message : 'request failed'
        });
        requestPhase.error(error, {
          endpoint: variant.endpoint,
          variantName: variant.variantName
        });
      }
    }

    const result = {
      roomBlocks: [],
      selectedRoom: null,
      trackedUrls: [],
      attempts,
      spiderErrorCodes: [...spiderErrorCodes],
      error:
        spiderErrorCodes.size > 0
          ? `direct room-list replay blocked by anti-spider code(s): ${[...spiderErrorCodes].join(', ')}`
          : 'direct room-list replay completed but did not find a matching priced room'
    };
    totalPhase.end('failed', {
      url,
      captureMethod,
      roomCandidatesCount: 0,
      roomPriceVisible: false,
      trackedUrlCount: 0,
      spiderErrorCodes: [...spiderErrorCodes],
      attemptsCount: attempts.length
    });
    return result;
  } catch (error) {
    totalPhase.error(error, {
      url,
      captureMethod,
      roomCandidatesCount: 0,
      roomPriceVisible: false,
      trackedUrlCount: 0,
      spiderErrorCodes: [...spiderErrorCodes],
      attemptsCount: attempts.length,
      variantCount: variants.length
    });
    throw error;
  }
}

module.exports = {
  extractSpiderErrorCode,
  shouldInspectNetworkResponse,
  captureRoomCandidatesDirect
};
