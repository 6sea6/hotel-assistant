const { evaluateInSession } = require('./cdp-utils');

function isCtripListNetworkResponse(url) {
  return /\/restapi\/soa2\/34951\/fetchHotelList/i.test(String(url || ''));
}

function hasHotelListPayload(value) {
  return /"hotelList"|"hotelInfo"|"hotelId"|"masterHotelId"/i.test(String(value || ''));
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

    let bodyResult;
    try {
      bodyResult = await connection.send(
        'Network.getResponseBody',
        { requestId: response.requestId },
        sessionId
      );
    } catch (_error) {
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

  const maxReplayPages = Math.min(
    8,
    Math.max(1, Number(options.maxListApiReplayPages) || Math.ceil(desiredCount / 8) + 1)
  );
  const expression = `(async () => {
    const targetCount = ${JSON.stringify(desiredCount)};
    const maxReplayPages = ${JSON.stringify(maxReplayPages)};
    const endpoint = 'https://m.ctrip.com/restapi/soa2/34951/fetchHotelList';
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
    const readHotelIds = (value, output = []) => {
      if (!value || typeof value !== 'object' || output.length > 300) return output;
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
    const request = extractObjectAfter(chunks, '"initListRequest"');
    const initData = extractObjectAfter(chunks, '"initListData"');
    if (!request) {
      result.error = 'missing_init_list_request';
      return JSON.stringify(result);
    }
    const seenIds = new Set(readHotelIds(initData && initData.hotelList));
    const basePageIndex = Number(
      (request.paging && request.paging.pageIndex) ||
      (initData && initData.pagingInfo && initData.pagingInfo.pageIndex) ||
      1
    ) || 1;
    const pageSize = Number(
      (request.paging && request.paging.pageSize) ||
      (initData && initData.pagingInfo && initData.pagingInfo.pageSize) ||
      10
    ) || 10;

    for (
      let pageIndex = basePageIndex + 1;
      pageIndex <= basePageIndex + maxReplayPages && seenIds.size < targetCount;
      pageIndex += 1
    ) {
      const body = JSON.parse(JSON.stringify(request));
      body.paging = { ...(body.paging || {}), pageIndex, pageSize };
      body.hotelIdFilter = {
        ...(body.hotelIdFilter || {}),
        hotelAldyShown: Array.from(seenIds)
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
      ids.forEach((id) => seenIds.add(id));
      result.responses.push({ pageIndex, status: response.status, data });
      result.pageIndexes.push(pageIndex);
      if (!ids.length) {
        break;
      }
    }
    return JSON.stringify(result);
  })()`;

  try {
    const rawResult = await evaluateInSession(connection, sessionId, expression);
    const parsed = JSON.parse(String(rawResult || '{}'));
    const responses = Array.isArray(parsed.responses) ? parsed.responses : [];
    const html = responses
      .filter((response) => response && response.data)
      .map(
        (response) =>
          `<script type="application/json" data-source="edge-list-api-replay" data-page-index="${Number(response.pageIndex) || ''}">${JSON.stringify(response.data).replace(/<\/script/gi, '<\\/script')}</script>`
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
  fetchListApiPagesInEdgeSession,
  isCtripListNetworkResponse
};
