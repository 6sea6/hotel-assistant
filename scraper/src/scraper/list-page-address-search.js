const {
  buildDesktopUrl,
  buildUrlOverridesFromTemplate,
  classifyCtripHotelUrl
} = require('../ctrip-url');
const { splitListFilters } = require('../ctrip-url-filters');
const { normalizeText } = require('../utils');
const { evaluateInSession, waitForSessionCondition } = require('./cdp-utils');
const {
  acquireListPageTarget,
  cleanupListEdgeSession,
  connectListEdgeSession,
  findEdgeExecutable,
  getEdgeWebSocket,
  normalizeEdgeSessionOptions
} = require('./list-page-cdp-session');
const { delay, waitForPromiseOrTimeout } = require('./list-page-scroll-policy');

const DEFAULT_ADDRESS_SEARCH_CITY = {
  cityId: '2',
  provinceId: '2',
  countryId: '1',
  cityName: '上海',
  destName: '上海',
  optionId: '2'
};

function buildDefaultAddressSearchListUrl(template = {}) {
  const url = new URL('https://hotels.ctrip.com/hotels/list');
  url.searchParams.set('cityId', DEFAULT_ADDRESS_SEARCH_CITY.cityId);
  url.searchParams.set('provinceId', DEFAULT_ADDRESS_SEARCH_CITY.provinceId);
  url.searchParams.set('countryId', DEFAULT_ADDRESS_SEARCH_CITY.countryId);
  url.searchParams.set('cityName', DEFAULT_ADDRESS_SEARCH_CITY.cityName);
  url.searchParams.set('destName', DEFAULT_ADDRESS_SEARCH_CITY.destName);
  url.searchParams.set('searchType', 'CT');
  url.searchParams.set('optionId', DEFAULT_ADDRESS_SEARCH_CITY.optionId);
  url.searchParams.set('crn', '1');
  url.searchParams.set('curr', 'CNY');
  url.searchParams.set('locale', 'zh-CN');
  url.searchParams.set('old', '1');
  return buildDesktopUrl(url.toString(), buildUrlOverridesFromTemplate(template));
}

function buildAddressSearchBaseUrl(template = {}, options = {}) {
  const candidateUrl = normalizeText(options.baseUrl || template.ctrip_url || '');
  if (candidateUrl && classifyCtripHotelUrl(candidateUrl).type === 'list') {
    return buildDesktopUrl(candidateUrl, buildUrlOverridesFromTemplate(template));
  }
  return buildDefaultAddressSearchListUrl(template);
}

function emitAddressSearchDebug(options = {}, event, data = {}) {
  if (typeof options.onDebug !== 'function') {
    return;
  }
  try {
    options.onDebug(event, data);
  } catch (_error) {
    // Debug hooks must not change scraper behavior.
  }
}

function buildControlSnapshotExpression() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element || !(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width < 16 || rect.height < 16) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
    };
    const textAround = (element) => {
      const parts = [];
      let current = element;
      for (let depth = 0; depth < 4 && current; depth += 1, current = current.parentElement) {
        parts.push(current.getAttribute && current.getAttribute('aria-label'));
        parts.push(current.getAttribute && current.getAttribute('placeholder'));
        parts.push(current.getAttribute && current.getAttribute('title'));
        parts.push(current.className);
        parts.push(current.id);
        parts.push(current.innerText);
      }
      return normalize(parts.filter(Boolean).join(' '));
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        text: normalize(element.value || element.innerText || element.textContent || ''),
        hint: textAround(element)
      };
    };
    const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const hint = textAround(element);
        const placeholder = normalize(element.getAttribute('placeholder') || '');
        const value = normalize(element.value || element.innerText || element.textContent || '');
        let score = 0;
        if (/位置|品牌|酒店|地标|关键词|关键字|keyword/i.test(hint)) score += 160;
        if (/目的地|城市|city|dest|destination/i.test(hint)) score += 35;
        if (/搜索任何旅游相关/.test(hint)) score -= 120;
        if (placeholder === '目的地' && /^(北京|上海|天津|重庆|广州|深圳|杭州|南京|成都|武汉|西安|苏州|长沙|青岛|厦门)$/.test(value)) score -= 80;
        if (rect.width >= 180 && rect.height >= 24) score += 55;
        if (rect.width < 80) score -= 45;
        if (rect.top < 70) score -= 80;
        if (rect.left < Math.max(window.innerWidth * 0.45, 520)) score += 15;
        return { element, score, rect };
      })
      .sort((left, right) => right.score - left.score);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const hint = textAround(element);
        const text = normalize(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
        const hasSearchText = /(^|\\s)搜索(\\s|$)/.test(text) || /^search$/i.test(text);
        let score = 0;
        if (hasSearchText) score += 260;
        else if (/搜索|search/i.test(hint)) score += 20;
        if (rect.width >= 40 && rect.height >= 28) score += 20;
        if (rect.left > window.innerWidth * 0.45 || hasSearchText) score += 15;
        if (rect.top < 70) score -= 80;
        if (!hasSearchText && /\\d+间|成人|儿童|\\d+晚|\\d+月|周[一二三四五六日]/.test(text)) score -= 140;
        if (!hasSearchText && rect.width > 200) score -= 30;
        return { element, score, rect };
      })
      .sort((left, right) => right.score - left.score);
    return {
      url: location.href,
      title: document.title || '',
      destinationInput: inputs[0] ? rectOf(inputs[0].element) : null,
      searchButton: buttons[0] ? rectOf(buttons[0].element) : null,
      inputCount: inputs.length,
      buttonCount: buttons.length
    };
  })()`;
}

async function clickPoint(connection, sessionId, point) {
  await connection.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: point.x, y: point.y },
    sessionId
  );
  await connection.send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 },
    sessionId
  );
  await connection.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 },
    sessionId
  );
}

async function pressKey(connection, sessionId, key, code, windowsVirtualKeyCode) {
  await connection.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key, code, windowsVirtualKeyCode },
    sessionId
  );
  await connection.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key, code, windowsVirtualKeyCode },
    sessionId
  );
}

async function chooseAddressSuggestionByKeyboard(connection, sessionId, deps) {
  await pressKey(connection, sessionId, 'ArrowDown', 'ArrowDown', 40);
  await deps.delay(120);
  await pressKey(connection, sessionId, 'Enter', 'Enter', 13);
}

function buildSetAddressSearchTextExpression(text) {
  const query = JSON.stringify(text);
  return `(() => {
    const query = ${query};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element || !(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width < 16 || rect.height < 16) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
    };
    const textAround = (element) => {
      const parts = [];
      let current = element;
      for (let depth = 0; depth < 4 && current; depth += 1, current = current.parentElement) {
        parts.push(current.getAttribute && current.getAttribute('aria-label'));
        parts.push(current.getAttribute && current.getAttribute('placeholder'));
        parts.push(current.getAttribute && current.getAttribute('title'));
        parts.push(current.className);
        parts.push(current.id);
        parts.push(current.innerText);
      }
      return normalize(parts.filter(Boolean).join(' '));
    };
    const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const hint = textAround(element);
        const placeholder = normalize(element.getAttribute('placeholder') || '');
        const value = normalize(element.value || element.innerText || element.textContent || '');
        let score = 0;
        if (/位置|品牌|酒店|地标|关键词|关键字|keyword/i.test(hint)) score += 160;
        if (/目的地|城市|city|dest|destination/i.test(hint)) score += 35;
        if (/搜索任何旅游相关/.test(hint)) score -= 120;
        if (placeholder === '目的地' && /^(北京|上海|天津|重庆|广州|深圳|杭州|南京|成都|武汉|西安|苏州|长沙|青岛|厦门)$/.test(value)) score -= 80;
        if (rect.width >= 180 && rect.height >= 24) score += 55;
        if (rect.width < 80) score -= 45;
        if (rect.top < 70) score -= 80;
        if (rect.left < Math.max(window.innerWidth * 0.45, 520)) score += 15;
        return { element, score };
      })
      .sort((left, right) => right.score - left.score);
    const selected = inputs[0];
    if (!selected || !selected.element) {
      return { ok: false, error: 'input_not_found' };
    }
    const element = selected.element;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try {
      if ('readOnly' in element) element.readOnly = false;
      if ('disabled' in element) element.disabled = false;
    } catch (_error) {}
    const setElementValue = (target, value) => {
      if ('value' in target) {
        const descriptor =
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value') ||
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(target, value);
          return;
        }
        target.value = value;
        return;
      }
      target.textContent = value;
    };
    try {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.click();
      element.focus({ preventScroll: true });
      setElementValue(element, query);
      element.dispatchEvent(new Event('focus', { bubbles: true }));
      if (typeof InputEvent === 'function') {
        element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }));
      } else {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: query.slice(-1), code: '' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
    const rect = element.getBoundingClientRect();
    return {
      ok: true,
      active: document.activeElement === element,
      score: selected.score,
      value: normalize(element.value || element.innerText || element.textContent || ''),
      rect: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      hint: textAround(element)
    };
  })()`;
}

function buildAddressSuggestionSnapshotExpression(addressQuery) {
  const query = JSON.stringify(addressQuery);
  return `(() => {
    const query = ${query};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const rectPayload = (rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
    const isVisible = (element) => {
      if (!element || !(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width < 8 || rect.height < 8) return false;
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
    };
    const isUsableRect = (rect) =>
      rect &&
      rect.width >= 4 &&
      rect.height >= 8 &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth;
    const scoreSuggestionText = (text, rect) => {
      let score = 0;
      if (text.includes(query)) score += 120;
      if (text.includes(query + '(上海)')) score += 180;
      if (text.startsWith(query)) score += 80;
      if (/上海市|青浦区|崧泽大道/.test(text)) score += 70;
      if (/当前城市的查询结果/.test(text)) score += 35;
      if (/其他城市|历史搜索/.test(text)) score -= 100;
      if (/酒店|宾馆|公寓|民宿/.test(text) && !text.includes(query + '(上海)')) score -= 45;
      if (text.length <= 40) score += 35;
      else if (text.length <= 120) score += 45;
      else if (text.length <= 220) score += 15;
      else score -= 160;
      if (rect.height >= 32 && rect.height <= 110) score += 45;
      else if (rect.height > 180) score -= 80;
      if (rect.width >= 160) score += 15;
      return score;
    };
    const textNodeRect = (node, marker) => {
      const raw = node.nodeValue || '';
      const index = raw.indexOf(marker);
      if (index < 0) return null;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + marker.length);
      const rects = Array.from(range.getClientRects()).filter(isUsableRect);
      range.detach && range.detach();
      return rects[0] || null;
    };
    const collectRoots = () => {
      const roots = [];
      const visit = (root) => {
        if (!root || roots.includes(root)) return;
        roots.push(root);
        const elements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const element of elements) {
          if (element.shadowRoot) {
            visit(element.shadowRoot);
          }
        }
      };
      visit(document);
      return roots;
    };
    const roots = collectRoots();
    const queryAll = (selector) =>
      roots.flatMap((root) => (root.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : []));
    const skipped = [];
    const elementCandidates = queryAll('li, [role="option"], [role="button"], button, a, div, span')
      .filter(isVisible)
      .map((element) => {
        const text = normalize(element.innerText || element.textContent || '');
        if (!text || !text.includes(query)) return null;
        const rect = element.getBoundingClientRect();
        if ((text.length > 500 && rect.height > 220) || rect.height > window.innerHeight * 0.8) {
          if (skipped.length < 8) {
            skipped.push({ reason: 'large_container', text: text.slice(0, 160), textLength: text.length, rect: rectPayload(rect) });
          }
          return null;
        }
        let score = scoreSuggestionText(text, rect);
        const childTexts = Array.from(element.children || []).map((child) => normalize(child.innerText || child.textContent || ''));
        if (text.length > 160 && childTexts.some((childText) => childText.includes(query))) score -= 35;
        return { element, text, score, type: 'element' };
      })
      .filter(Boolean);
    const textCandidates = [];
    for (const root of roots) {
      const startNode = root.body || root.documentElement || root;
      const walker = document.createTreeWalker(startNode, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const raw = node.nodeValue || '';
        if (!raw.includes(query)) continue;
        const parent = node.parentElement;
        if (!isVisible(parent)) continue;
        const marker = raw.includes(query + '(上海)') ? query + '(上海)' : query;
        const rect = textNodeRect(node, marker);
        if (!isUsableRect(rect)) continue;
        const index = raw.indexOf(marker);
        const text = normalize(raw.slice(Math.max(0, index - 30), index + marker.length + 90));
        textCandidates.push({
          element: parent,
          node,
          text,
          score: scoreSuggestionText(text, rect) + 70,
          type: 'text',
          rect
        });
      }
    }
    const candidates = [...textCandidates, ...elementCandidates]
      .sort((left, right) => right.score - left.score);
    const selected = candidates[0];
    const samples = candidates.slice(0, 8).map((candidate) => {
      const rect = candidate.type === 'text' ? candidate.rect : candidate.element.getBoundingClientRect();
      return { type: candidate.type, text: candidate.text.slice(0, 160), textLength: candidate.text.length, score: candidate.score, rect: rectPayload(rect) };
    });
    if (!selected) return { point: null, samples, skipped };
    selected.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect =
      selected.type === 'text'
        ? textNodeRect(selected.node, selected.text.includes(query + '(上海)') ? query + '(上海)' : query) || selected.rect
        : selected.element.getBoundingClientRect();
    return {
      text: selected.text,
      score: selected.score,
      point: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      },
      rect: rectPayload(rect),
      samples,
      skipped
    };
  })()`;
}

function buildHeuristicAddressSuggestionPointExpression(addressQuery) {
  const query = JSON.stringify(addressQuery);
  return `(() => {
    const query = ${query};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'));
    const input = inputs.find((element) => normalize(element.value || element.innerText || element.textContent || '').includes(query));
    if (!input) return null;
    const rect = input.getBoundingClientRect();
    const viewportWidth = Math.max(640, window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.max(480, window.innerHeight || document.documentElement.clientHeight || 0);
    const x = Math.max(16, Math.min(viewportWidth - 16, rect.left + 260));
    const y = Math.max(16, Math.min(viewportHeight - 16, rect.bottom + 64));
    const element = document.elementFromPoint(x, y);
    return {
      point: { x, y },
      inputRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      elementText: normalize(element && (element.innerText || element.textContent || '')).slice(0, 220)
    };
  })()`;
}

function createAddressKeywordCapture(connection, sessionId) {
  const requestUrls = new Map();
  const responses = [];
  const bodyPromises = [];
  const stopListening = connection.addListener((message) => {
    if (!message || message.sessionId !== sessionId || !message.params) {
      return;
    }
    if (message.method === 'Network.responseReceived') {
      const requestId = message.params.requestId;
      const url = (message.params.response && message.params.response.url) || '';
      if (requestId && /\/getHotelKeywords/i.test(url)) {
        requestUrls.set(requestId, url);
      }
      return;
    }
    if (message.method !== 'Network.loadingFinished') {
      return;
    }
    const requestId = message.params.requestId;
    if (!requestUrls.has(requestId)) {
      return;
    }
    const url = requestUrls.get(requestId);
    requestUrls.delete(requestId);
    const bodyPromise = connection
      .send(
        'Network.getResponseBody',
        { requestId },
        sessionId,
        { timeoutMs: 8000 }
      )
      .then((payload) => {
        responses.push({
          url,
          body: payload && payload.body ? payload.body : '',
          base64Encoded: Boolean(payload && payload.base64Encoded)
        });
      })
      .catch((error) => {
        responses.push({
          url,
          body: '',
          error: error && error.message ? error.message : String(error)
        });
      });
    bodyPromises.push(bodyPromise);
  });
  return {
    responses,
    stop: stopListening,
    async settle() {
      await Promise.allSettled(bodyPromises);
      return responses;
    }
  };
}

async function waitForAddressSuggestion(connection, sessionId, query, deps, options = {}) {
  const timeoutMs = Number(options.suggestionTimeoutMs) || 6000;
  const intervalMs = Number(options.suggestionIntervalMs) || 250;
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    if (options.signal && options.signal.aborted) {
      throw new Error('地址搜索已取消。');
    }
    const suggestion = await deps
      .evaluateInSession(connection, sessionId, buildAddressSuggestionSnapshotExpression(query), {
        timeoutMs: 1500,
        signal: options.signal || null
      })
      .catch(() => null);
    if (suggestion) {
      lastSnapshot = suggestion;
    }
    if (suggestion && suggestion.point) {
      return suggestion;
    }
    await deps.delay(intervalMs);
  }
  return lastSnapshot;
}

function normalizeResolvedListUrl(value) {
  const url = normalizeText(value);
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    const hostname = String(parsed.hostname || '').toLowerCase();
    const pathname = String(parsed.pathname || '').toLowerCase();
    if (
      !/(^|\.)hotels\.ctrip\.com$/.test(hostname) ||
      !/^\/hotels\/list\/?$/.test(pathname)
    ) {
      return '';
    }
    return url;
  } catch (_error) {
    return '';
  }
}

function buildResolvedListPageWaitExpression() {
  return `(() => {
    try {
      const parsed = new URL(location.href);
      return /(^|\\.)hotels\\.ctrip\\.com$/i.test(parsed.hostname || '') &&
        /^\\/hotels\\/list\\/?$/i.test(parsed.pathname || '');
    } catch (_error) {
      return false;
    }
  })()`;
}

function decodeKeywordResponseBody(response = {}) {
  const rawBody = normalizeText(response.body || '');
  if (!rawBody) {
    return null;
  }
  const body = response.base64Encoded
    ? Buffer.from(rawBody, 'base64').toString('utf8')
    : rawBody;
  try {
    return JSON.parse(body);
  } catch (_error) {
    return null;
  }
}

function scoreAddressKeywordCandidate(candidate, query) {
  const keyword = normalizeText(candidate.keyword);
  if (!keyword || !keyword.includes(query)) {
    return -1;
  }
  let score = 0;
  if (keyword === query) score += 80;
  if (keyword.startsWith(query)) score += 60;
  if (keyword.includes(`${query}(`)) score += 120;
  if (/上海/.test(keyword)) score += 30;
  if (candidate.keywordId) score += 40;
  if (candidate.filterValue) score += 80;
  if (candidate.tripType === 'LM') score += 30;
  if (candidate.urlType === 'list') score += 20;
  if (/酒店|宾馆|公寓|民宿/.test(keyword) && !keyword.includes(`${query}(`)) score -= 60;
  return score;
}

function normalizeAddressKeywordCandidate(source = {}, query = '') {
  const keywordWrapper = source.keyword && typeof source.keyword === 'object' ? source.keyword : {};
  const keywordContentInfo =
    source.keywordContentInfo ||
    keywordWrapper.keywordContentInfo ||
    (source.keyword && source.keyword.keywordContentInfo) ||
    {};
  const keywordFilterItem =
    (source.controlInfo &&
      source.controlInfo.keywordFilterItem &&
      source.controlInfo.keywordFilterItem.data) ||
    (source.keywordFilterItem && source.keywordFilterItem.data) ||
    {};
  const filterId = normalizeText(keywordFilterItem.filterID || '');
  const filterType =
    normalizeText(keywordFilterItem.type || filterId.split('|')[0]) ||
    '13';
  const keywordId =
    normalizeText(
      keywordContentInfo.keywordId ||
        keywordContentInfo.keywordCode ||
        keywordFilterItem.valueId ||
        filterId.split('|')[1] ||
        ''
    ) || '';
  const keyword = normalizeText(
    keywordContentInfo.keyword ||
      keywordContentInfo.keywordDesc ||
      keywordFilterItem.title ||
      ''
  );
  const filterValue = normalizeText(keywordFilterItem.value || '');
  const tripType = normalizeText(keywordContentInfo.tripType || '') || 'LM';
  const candidate = {
    keyword,
    keywordId,
    filterId,
    filterType,
    filterValue,
    tripType,
    urlType: normalizeText(keywordContentInfo.urlType || ''),
    score: 0
  };
  candidate.score = scoreAddressKeywordCandidate(candidate, query);
  return candidate;
}

function collectAddressKeywordCandidates(value, query, candidates = [], seen = new Set()) {
  if (!value || typeof value !== 'object') {
    return candidates;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectAddressKeywordCandidates(item, query, candidates, seen));
    return candidates;
  }

  const hasKeywordInfo =
    Boolean(value.keywordContentInfo) ||
    Boolean(value.keyword && value.keyword.keywordContentInfo) ||
    Boolean(value.controlInfo && value.controlInfo.keywordFilterItem) ||
    Boolean(value.keywordFilterItem);
  if (hasKeywordInfo) {
    const candidate = normalizeAddressKeywordCandidate(value, query);
    const key = `${candidate.keywordId}|${candidate.keyword}|${candidate.filterValue}`;
    if (candidate.score >= 0 && !seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  Object.values(value).forEach((item) =>
    collectAddressKeywordCandidates(item, query, candidates, seen)
  );
  return candidates;
}

function findAddressKeywordCandidate(keywordResponses = [], addressQuery = '') {
  const query = normalizeText(addressQuery);
  if (!query) {
    return null;
  }
  const candidates = [];
  keywordResponses.forEach((response) => {
    const body = decodeKeywordResponseBody(response);
    if (body) {
      collectAddressKeywordCandidates(body, query, candidates);
    }
  });
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

function buildAddressKeywordFilterPart(candidate = {}) {
  const filterType = normalizeText(candidate.filterType || '13') || '13';
  const keywordId = normalizeText(candidate.keywordId || '');
  const filterKey = normalizeText((candidate.filterId || '').split('|')[1] || keywordId);
  const filterValue = normalizeText(candidate.filterValue || '');
  if (!filterKey || !filterValue) {
    return '';
  }
  return `${filterType}~${filterKey}*${filterType}*${filterValue}`;
}

function buildAddressKeywordListUrl(baseUrl, candidate = {}) {
  const keyword = normalizeText(candidate.keyword);
  const keywordId = normalizeText(candidate.keywordId || '');
  const tripType = normalizeText(candidate.tripType || '') || 'LM';
  if (!keyword || !keywordId) {
    return '';
  }

  const parsed = new URL(baseUrl);
  parsed.searchParams.set('destName', keyword);
  parsed.searchParams.set('searchType', tripType);
  parsed.searchParams.set('optionId', keywordId);
  parsed.searchParams.set('searchWord', keyword);
  parsed.searchParams.set('searchValue', keywordId);
  parsed.searchParams.delete('pageIndex');

  const addressFilterPart = buildAddressKeywordFilterPart(candidate);
  if (addressFilterPart) {
    const existingFilters = splitListFilters(parsed.searchParams.get('listFilters') || '').filter(
      (part) => !/^13~/.test(part)
    );
    parsed.searchParams.set('listFilters', [addressFilterPart, ...existingFilters].join(','));
  }

  return parsed.toString();
}

function buildAddressKeywordListUrlFromResponses(baseUrl, addressQuery, keywordResponses = []) {
  const candidate = findAddressKeywordCandidate(keywordResponses, addressQuery);
  if (!candidate) {
    return '';
  }
  return buildAddressKeywordListUrl(baseUrl, candidate);
}

function getAddressSearchRetryCount(edgeSessionOptions = {}, options = {}) {
  const explicit =
    options.addressSearchRetryCount ?? options.retryCount ?? options.retries;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    const parsed = Number(explicit);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  return edgeSessionOptions.browserPreference === '360' ? 1 : 0;
}

function isRetryableAddressSearchError(error) {
  const message = normalizeText(error && error.message ? error.message : String(error || ''));
  if (!message) {
    return true;
  }
  return !/已取消|请输入地址|WebSocket|可用的 Edge 或 360 浏览器/.test(message);
}

async function resolveCtripListUrlFromAddressOnce({
  query,
  template,
  options,
  deps,
  edgeSessionOptions,
  EdgeWebSocket,
  edgeExecutable
}) {
  const baseUrl = buildAddressSearchBaseUrl(template, options);

  let browser = null;
  let browserExecutable = '';
  let browserPort = 0;
  let connection = null;
  let userDataDir = '';
  let shouldCleanupUserDataDir = false;
  let targetId = '';
  let sessionId = '';
  let shouldCloseTarget = false;
  let keywordCapture = null;

  try {
    const connectedSession = await deps.connectListEdgeSession(
      edgeSessionOptions,
      EdgeWebSocket,
      edgeExecutable
    );
    browser = connectedSession.browser;
    browserExecutable = connectedSession.browserExecutable || edgeExecutable;
    browserPort = connectedSession.browserPort || edgeSessionOptions.debuggingPort || 0;
    connection = connectedSession.connection;
    userDataDir = connectedSession.userDataDir;
    shouldCleanupUserDataDir = connectedSession.shouldCleanupUserDataDir;

    const targetSession = await deps.acquireListPageTarget(connection);
    targetId = targetSession.targetId;
    sessionId = targetSession.sessionId;
    shouldCloseTarget = targetSession.shouldCloseTarget;
    if (targetSession.error) {
      throw new Error(targetSession.error);
    }

    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Runtime.enable', {}, sessionId);
    await connection.send('Network.enable', {}, sessionId).catch(() => undefined);
    keywordCapture = createAddressKeywordCapture(connection, sessionId);
    const loadEvent = new Promise((resolve) => {
      const stopListening = connection.addListener((message) => {
        if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
          stopListening();
          resolve();
        }
      });
    });
    await connection.send('Page.navigate', { url: baseUrl }, sessionId);
    await deps.waitForPromiseOrTimeout(loadEvent, 15000);
    await deps.waitForSessionCondition(
      connection,
      sessionId,
      `(() => document.readyState === 'complete' && /携程|酒店|宾馆|搜索/.test(document.body ? document.body.innerText || '' : ''))()`,
      8000,
      250,
      { signal: options.signal || null }
    );
    await deps.delay(Number(options.initialSettleMs) || 1200);

    const controls = await deps.evaluateInSession(
      connection,
      sessionId,
      buildControlSnapshotExpression(),
      { timeoutMs: 5000, signal: options.signal || null }
    );
    if (!controls || !controls.destinationInput || !controls.searchButton) {
      throw new Error('未找到携程列表页的目的地输入框或搜索按钮。');
    }
    emitAddressSearchDebug(options, 'controls', controls);

    const addressInputState = await deps.evaluateInSession(
      connection,
      sessionId,
      buildSetAddressSearchTextExpression(query),
      { timeoutMs: 4000, signal: options.signal || null }
    );
    emitAddressSearchDebug(options, 'address-input', addressInputState || null);
    if (!addressInputState || !addressInputState.ok) {
      throw new Error('未能把地址写入携程列表页搜索框。');
    }
    await deps.delay(Number(options.afterTypeSettleMs) || 700);
    const keywordResponses = keywordCapture ? await keywordCapture.settle() : [];
    emitAddressSearchDebug(
      options,
      'keyword-responses',
      keywordResponses.map((response) => ({
        url: response.url,
        error: response.error || '',
        body: response.body ? response.body.slice(0, 1200) : ''
      }))
    );
    const keywordResolvedUrl = buildAddressKeywordListUrlFromResponses(
      baseUrl,
      query,
      keywordResponses
    );
    if (keywordResolvedUrl) {
      emitAddressSearchDebug(options, 'keyword-resolved-url', { url: keywordResolvedUrl });
      return keywordResolvedUrl;
    }

    const suggestion = await waitForAddressSuggestion(connection, sessionId, query, deps, {
      signal: options.signal || null,
      suggestionTimeoutMs: options.suggestionTimeoutMs
    });
    emitAddressSearchDebug(options, 'suggestion', suggestion || null);
    if (suggestion && suggestion.point) {
      await clickPoint(connection, sessionId, suggestion.point);
      await deps.delay(Number(options.afterSuggestionSettleMs) || 700);
    } else {
      const heuristicSuggestion = await deps
        .evaluateInSession(
          connection,
          sessionId,
          buildHeuristicAddressSuggestionPointExpression(query),
          {
            timeoutMs: 1500,
            signal: options.signal || null
          }
        )
        .catch(() => null);
      emitAddressSearchDebug(options, 'suggestion-heuristic', heuristicSuggestion || null);
      if (heuristicSuggestion && heuristicSuggestion.point) {
        await clickPoint(connection, sessionId, heuristicSuggestion.point);
      } else {
        emitAddressSearchDebug(options, 'suggestion-keyboard-fallback', {
          reason: suggestion ? 'no_click_point' : 'not_found'
        });
        await chooseAddressSuggestionByKeyboard(connection, sessionId, deps);
      }
      await deps.delay(Number(options.afterSuggestionSettleMs) || 700);
    }

    const latestControls =
      (await deps.evaluateInSession(connection, sessionId, buildControlSnapshotExpression(), {
        timeoutMs: 3000,
        signal: options.signal || null
      })) || controls;
    await clickPoint(connection, sessionId, latestControls.searchButton || controls.searchButton);
    await deps.delay(400);
    await deps.waitForSessionCondition(
      connection,
      sessionId,
      buildResolvedListPageWaitExpression(),
      Number(options.searchTimeoutMs) || 12000,
      300,
      { signal: options.signal || null }
    );
    await deps.delay(Number(options.afterSearchSettleMs) || 1000);

    const resolvedUrl = await deps.evaluateInSession(connection, sessionId, 'location.href', {
      timeoutMs: 3000,
      signal: options.signal || null
    });
    emitAddressSearchDebug(options, 'resolved-url', { url: resolvedUrl || '' });
    const normalizedResolvedUrl = normalizeResolvedListUrl(resolvedUrl);
    if (!normalizedResolvedUrl) {
      throw new Error('地址搜索未得到有效的携程列表页 URL。');
    }
    return normalizedResolvedUrl;
  } finally {
    if (keywordCapture && keywordCapture.stop) {
      keywordCapture.stop();
    }
    await deps.cleanupListEdgeSession({
      connection,
      sessionId,
      targetId,
      shouldCloseTarget,
      browser,
      browserExecutable,
      browserPort,
      shouldCleanupUserDataDir,
      userDataDir
    });
  }
}

async function resolveCtripListUrlFromAddress(addressQuery, template = {}, options = {}) {
  const query = normalizeText(addressQuery);
  if (!query) {
    throw new Error('请输入地址或目的地。');
  }

  const deps = {
    acquireListPageTarget,
    cleanupListEdgeSession,
    connectListEdgeSession,
    delay,
    evaluateInSession,
    findEdgeExecutable,
    getEdgeWebSocket,
    normalizeEdgeSessionOptions,
    waitForPromiseOrTimeout,
    waitForSessionCondition,
    ...(options.dependencies || {})
  };
  const edgeSessionOptions = deps.normalizeEdgeSessionOptions(options.edgeSession || {});
  const EdgeWebSocket = deps.getEdgeWebSocket();
  if (!EdgeWebSocket) {
    throw new Error('地址搜索需要可用的浏览器调试 WebSocket。');
  }
  const edgeExecutable = deps.findEdgeExecutable({
    browserPreference: edgeSessionOptions.browserPreference
  });
  if (!edgeSessionOptions.debuggerUrl && !edgeExecutable) {
    throw new Error('地址搜索需要可用的 Edge 或 360 浏览器。');
  }

  const retryCount = getAddressSearchRetryCount(edgeSessionOptions, options);
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      if (attempt > 0) {
        emitAddressSearchDebug(options, 'retry', {
          attempt,
          maxAttempts: retryCount + 1,
          reason: lastError && lastError.message ? lastError.message : String(lastError || '')
        });
        await deps.delay(Number(options.retrySettleMs) || 800);
      }
      return await resolveCtripListUrlFromAddressOnce({
        query,
        template,
        options,
        deps,
        edgeSessionOptions,
        EdgeWebSocket,
        edgeExecutable
      });
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !isRetryableAddressSearchError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error('地址搜索未得到有效的携程列表页 URL。');
}

module.exports = {
  buildAddressSearchBaseUrl,
  buildDefaultAddressSearchListUrl,
  buildAddressKeywordListUrlFromResponses,
  normalizeResolvedListUrl,
  resolveCtripListUrlFromAddress
};
