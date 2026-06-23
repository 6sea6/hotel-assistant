const { evaluateInSession } = require('./cdp-utils');

const LIST_API_ENDPOINT = 'https://m.ctrip.com/restapi/soa2/34951/fetchHotelList';
const DEFAULT_MAX_LIST_API_REPLAY_PAGES = 60;
const DEFAULT_LIST_API_REPLAY_CONCURRENCY = 6;

function normalizeMaxReplayPages(desiredCount, explicitMaxReplayPages) {
  const explicit = Number(explicitMaxReplayPages);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.trunc(explicit));
  }

  const requested = Math.max(1, Math.ceil((Number(desiredCount) || 0) / 10) + 1);
  return Math.min(DEFAULT_MAX_LIST_API_REPLAY_PAGES, requested);
}

function normalizeReplayConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_LIST_API_REPLAY_CONCURRENCY;
  }
  return Math.min(8, Math.max(1, Math.trunc(number)));
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await fn(items[index], index);
      }
    })
  );

  return results;
}

function isCtripListNetworkResponse(url) {
  const text = String(url || '');
  return (
    /\/restapi\/soa2\/34951\/fetchHotelList/i.test(text) ||
    /fetchHotelList|getHotelList|hotelList|hotelsearch|hotel\/list/i.test(text)
  );
}

function isCtripListResponseBodyReadable(response = {}) {
  const url = String(response.url || '');
  if (!isCtripListNetworkResponse(url)) {
    return false;
  }

  if (/\/restapi\/soa2\/34951\/fetchHotelList/i.test(url)) {
    return true;
  }

  const mimeType = String(response.mimeType || '').toLowerCase();
  return /json|javascript|text\/plain/.test(mimeType);
}

function hasHotelListPayload(value) {
  return /"hotelList"|"hotelInfo"|"hotelId"|"masterHotelId"/i.test(String(value || ''));
}

function readHotelIds(value, output = []) {
  if (!value || typeof value !== 'object' || output.length > 5000) {
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => readHotelIds(item, output));
    return output;
  }
  for (const key of ['hotelId', 'masterHotelId', 'hotelid', 'masterhotelid']) {
    const text = String(value[key] || '').trim();
    if (/^\d{3,}$/.test(text)) {
      output.push(text);
    }
  }
  Object.values(value).forEach((item) => readHotelIds(item, output));
  return output;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readNetworkResponseBody(connection, sessionId, requestId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await connection.send('Network.getResponseBody', { requestId }, sessionId, {
        timeoutMs: attempt === 0 ? 900 : 1500
      });
    } catch (_error) {
      if (attempt === 0) {
        await delay(250);
      }
    }
  }
  return null;
}

async function drainListNetworkResponses(
  connection,
  sessionId,
  responses = [],
  processed = new Set()
) {
  const scripts = [];

  for (const response of responses) {
    if (!response || !response.requestId || processed.has(response.requestId)) {
      continue;
    }
    processed.add(response.requestId);

    const bodyResult = await readNetworkResponseBody(connection, sessionId, response.requestId);
    if (!bodyResult) {
      continue;
    }

    if (!bodyResult || bodyResult.base64Encoded) {
      continue;
    }
    const body = String(bodyResult.body || '').trim();
    if (!body || !hasHotelListPayload(body)) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_error) {
      continue;
    }

    scripts.push(
      `<script type="application/json" data-source="edge-network-fetchHotelList">${JSON.stringify(parsed).replace(/<\/script/gi, '<\\/script')}</script>`
    );
  }

  return {
    html: scripts.join('\n'),
    count: scripts.length
  };
}

function normalizeInitialListRequests(requests = []) {
  return (Array.isArray(requests) ? requests : [])
    .map((request) => ({
      url: String(request && request.url ? request.url : ''),
      postData: String(request && request.postData ? request.postData : '')
    }))
    .filter((request) => request.url && request.postData)
    .slice(-5);
}

function parseJsonFragment(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    // Static Ctrip HTML often stores Next.js payloads as escaped JSON fragments.
  }

  try {
    return JSON.parse(text.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  } catch (_error) {
    return null;
  }
}

function extractObjectAfterMarker(source, marker) {
  const text = String(source || '');
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const start = text.indexOf('{', markerIndex + marker.length);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const escapedJsonQuote = char === '"' && index > 0 && text[index - 1] === '\\';
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (escapedJsonQuote) {
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return parseJsonFragment(text.slice(start, index + 1));
      }
    }
  }

  return null;
}

function applyListPageIndex(request, pageIndex, pageSize) {
  const body = JSON.parse(JSON.stringify(request || {}));
  if (body.paging && typeof body.paging === 'object') {
    body.paging = { ...body.paging, pageIndex, pageSize };
  } else if (Object.prototype.hasOwnProperty.call(body, 'pageIndex')) {
    body.pageIndex = pageIndex;
    body.pageSize = body.pageSize || pageSize;
  } else {
    body.paging = { pageIndex, pageSize };
  }
  return body;
}

function buildListApiScript(data, source, pageIndex) {
  return `<script type="application/json" data-source="${source}" data-page-index="${Number(pageIndex) || ''}">${JSON.stringify(data).replace(/<\/script/gi, '<\\/script')}</script>`;
}

async function fetchListApiPagesFromHtml(html, listUrl, options = {}) {
  const desiredCount = Math.max(0, Number(options.desiredHotelCount) || 0);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!desiredCount || typeof fetchImpl !== 'function') {
    return {
      count: 0,
      html: '',
      pageIndexes: [],
      error: ''
    };
  }

  const request = extractObjectAfterMarker(html, 'initListRequest');
  const initData = extractObjectAfterMarker(html, 'initListData');
  if (!request) {
    return {
      count: 0,
      html: '',
      pageIndexes: [],
      error: 'missing_init_list_request'
    };
  }

  const maxReplayPages = normalizeMaxReplayPages(desiredCount, options.maxListApiReplayPages);
  const initiallyShownIds = [...new Set(readHotelIds(initData && initData.hotelList))];
  const basePageIndex =
    Number(
      (request.paging && request.paging.pageIndex) ||
        request.pageIndex ||
        (initData && initData.pagingInfo && initData.pagingInfo.pageIndex) ||
        1
    ) || 1;
  const pageSize =
    Number(
      (request.paging && request.paging.pageSize) ||
        request.pageSize ||
        (initData && initData.pagingInfo && initData.pagingInfo.pageSize) ||
        10
    ) || 10;
  const headers = {
    ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    origin: 'https://hotels.ctrip.com',
    referer: listUrl || 'https://hotels.ctrip.com/'
  };
  if (options.cookieHeader) {
    headers.cookie = options.cookieHeader;
  }

  const pageIndexes = Array.from(
    { length: maxReplayPages },
    (_, index) => basePageIndex + index + 1
  );
  const replayConcurrency = normalizeReplayConcurrency(options.maxListApiReplayConcurrency);
  const allResponses = await mapWithConcurrency(
    pageIndexes,
    replayConcurrency,
    async (pageIndex) => {
      const body = applyListPageIndex(request, pageIndex, pageSize);
      body.hotelIdFilter = {
        ...(body.hotelIdFilter || {}),
        hotelAldyShown: initiallyShownIds
      };

      const response = await fetchImpl(LIST_API_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      const ids = readHotelIds(data);
      return { pageIndex, status: response.status, data, ids };
    }
  );
  const firstEmptyIndex = allResponses.findIndex((response) => !response.ids.length);
  const responses =
    firstEmptyIndex >= 0 ? allResponses.slice(0, firstEmptyIndex + 1) : allResponses;

  const scripts = responses
    .filter((response) => response && response.data)
    .map((response) =>
      buildListApiScript(response.data, 'html-list-api-replay', response.pageIndex)
    );

  return {
    count: scripts.length,
    html: scripts.join('\n'),
    pageIndexes: responses.map((response) => response.pageIndex),
    error: ''
  };
}

async function fetchListApiPagesInEdgeSession(connection, sessionId, options = {}) {
  const desiredCount = Math.max(0, Number(options.desiredHotelCount) || 0);
  if (!desiredCount) {
    return {
      count: 0,
      html: '',
      pageIndexes: [],
      error: ''
    };
  }

  const maxReplayPages = normalizeMaxReplayPages(desiredCount, options.maxListApiReplayPages);
  const replayConcurrency = normalizeReplayConcurrency(options.maxListApiReplayConcurrency);
  const expression = `(async () => {
    const targetCount = ${JSON.stringify(desiredCount)};
    const maxReplayPages = ${JSON.stringify(maxReplayPages)};
    const replayConcurrency = ${JSON.stringify(replayConcurrency)};
    const initialListRequests = ${JSON.stringify(normalizeInitialListRequests(options.initialRequests))};
    const endpoint = ${JSON.stringify(LIST_API_ENDPOINT)};
    const result = { responses: [], pageIndexes: [], error: '' };
    const chunks = Array.isArray(self.__next_f)
      ? self.__next_f.map((item) => Array.isArray(item) && typeof item[1] === 'string' ? item[1] : '').join('')
      : '';
    const extractObjectAfter = (source, marker) => {
      const markerIndex = String(source || '').indexOf(marker);
      if (markerIndex < 0) return null;
      const start = source.indexOf('{', markerIndex + marker.length);
      if (start < 0) return null;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === '\\\\') {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === '{') {
          depth += 1;
          continue;
        }
        if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            return JSON.parse(source.slice(start, index + 1));
          }
        }
      }
      return null;
    };
    const parseJson = (value) => {
      try {
        return JSON.parse(String(value || ''));
      } catch (_error) {
        return null;
      }
    };
    const pickNetworkInitRequest = () => {
      for (let index = initialListRequests.length - 1; index >= 0; index -= 1) {
        const parsed = parseJson(initialListRequests[index] && initialListRequests[index].postData);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
      return null;
    };
    const readHotelIds = (value, output = []) => {
      if (!value || typeof value !== 'object' || output.length > 5000) return output;
      if (Array.isArray(value)) {
        value.forEach((item) => readHotelIds(item, output));
        return output;
      }
      for (const key of ['hotelId', 'masterHotelId', 'hotelid', 'masterhotelid']) {
        const text = String(value[key] || '').trim();
        if (/^\\d{3,}$/.test(text)) {
          output.push(text);
        }
      }
      Object.values(value).forEach((item) => readHotelIds(item, output));
      return output;
    };
    const request = extractObjectAfter(chunks, '"initListRequest"') || pickNetworkInitRequest();
    const initData = extractObjectAfter(chunks, '"initListData"');
    if (!request) {
      result.error = 'missing_init_list_request';
      return JSON.stringify(result);
    }
    const initiallyShownIds = Array.from(new Set(readHotelIds(initData && initData.hotelList)));
    const basePageIndex = Number(
      (request.paging && request.paging.pageIndex) ||
      request.pageIndex ||
      (initData && initData.pagingInfo && initData.pagingInfo.pageIndex) ||
      1
    ) || 1;
    const pageSize = Number(
      (request.paging && request.paging.pageSize) ||
      request.pageSize ||
      (initData && initData.pagingInfo && initData.pagingInfo.pageSize) ||
      10
    ) || 10;

    const pageIndexes = Array.from({ length: maxReplayPages }, (_, index) => basePageIndex + index + 1);
    const mapWithConcurrency = async (items, concurrency, fn) => {
      const results = new Array(items.length);
      let nextIndex = 0;
      const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await fn(items[index], index);
        }
      }));
      return results;
    };
    const responses = await mapWithConcurrency(pageIndexes, replayConcurrency, async (pageIndex) => {
      const body = JSON.parse(JSON.stringify(request));
      if (body.paging && typeof body.paging === 'object') {
        body.paging = { ...body.paging, pageIndex, pageSize };
      } else if (Object.prototype.hasOwnProperty.call(body, 'pageIndex')) {
        body.pageIndex = pageIndex;
        body.pageSize = body.pageSize || pageSize;
      } else {
        body.paging = { pageIndex, pageSize };
      }
      body.hotelIdFilter = {
        ...(body.hotelIdFilter || {}),
        hotelAldyShown: initiallyShownIds
      };
      body.head = { ...(body.head || {}), isSSR: false };
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      const ids = readHotelIds(data);
      return { pageIndex, status: response.status, data, ids };
    });
    const firstEmptyIndex = responses.findIndex((response) => !response.ids.length);
    const keptResponses = firstEmptyIndex >= 0 ? responses.slice(0, firstEmptyIndex + 1) : responses;
    result.responses.push(...keptResponses.map(({ pageIndex, status, data }) => ({ pageIndex, status, data })));
    result.pageIndexes.push(...keptResponses.map((response) => response.pageIndex));
    return JSON.stringify(result);
  })()`;

  try {
    const replayTimeoutMs = Math.max(
      5000,
      Number(options.timeoutMs) || maxReplayPages * 3500 + 3000
    );
    const rawResult = await evaluateInSession(connection, sessionId, expression, {
      timeoutMs: replayTimeoutMs
    });
    const parsed = JSON.parse(String(rawResult || '{}'));
    const responses = Array.isArray(parsed.responses) ? parsed.responses : [];
    const html = responses
      .filter((response) => response && response.data)
      .map((response) =>
        buildListApiScript(response.data, 'edge-list-api-replay', response.pageIndex)
      )
      .join('\n');
    return {
      count: responses.filter((response) => response && response.data).length,
      html,
      pageIndexes: Array.isArray(parsed.pageIndexes) ? parsed.pageIndexes : [],
      error: parsed.error || ''
    };
  } catch (error) {
    return {
      count: 0,
      html: '',
      pageIndexes: [],
      error: error && error.message ? error.message : String(error)
    };
  }
}

module.exports = {
  drainListNetworkResponses,
  extractObjectAfterMarker,
  fetchListApiPagesFromHtml,
  fetchListApiPagesInEdgeSession,
  isCtripListResponseBodyReadable,
  isCtripListNetworkResponse
};
