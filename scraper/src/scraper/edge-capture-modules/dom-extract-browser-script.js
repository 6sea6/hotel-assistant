function createEdgeDomExtractBrowserHelpers() {
  const roomPattern =
    /(家庭房|家庭间|双床房|双床间|大床房|大床间|三人间|三人房|三床房|套房|单人间|标准间|高级房|高级间|豪华房|豪华间|商务房|商务间|景观房|景观间|亲子房|亲子间|影音房|影音间|电竞房|电竞间|榻榻米房|榻榻米间|棋牌房|棋牌间)/;
  const pricePattern = /(¥|登录看低价|解锁优惠|券后|每晚|起)/;
  const titlePattern =
    /[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,40}(?:大床房|大床间|双床房|双床间|家庭房|家庭间|三床房|三人房|三人间|景观房|景观间|商务房|商务间|豪华房|豪华间|特惠房|特惠间|标准房|标准间|高级房|高级间|精品房|精品间|影音房|影音间|电竞房|电竞间|榻榻米房|榻榻米间|棋牌房|棋牌间|亲子房|亲子间|套房)/g;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (element) => {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const clickElement = (element) => {
    if (!element || !isVisible(element)) return false;
    try {
      element.click();
    } catch (_e) {}
    try {
      const rect = element.getBoundingClientRect();
      ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
        element.dispatchEvent(
          new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          })
        );
      });
    } catch (_e) {}
    return true;
  };
  const readBodyText = () =>
    document.body && document.body.innerText ? document.body.innerText : '';
  const toNormalizedText = (text) =>
    String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const extractRoomSection = (text, options = {}) => {
    const normalized = toNormalizedText(text);
    if (!normalized) {
      return '';
    }
    const maxLength = Number(options.maxLength || 18000);
    const startMarkers = ['选择房间', '房型摘要', '可住人数 今日价格', '立即确认', '登录看低价'];
    const endMarkers = [
      '地点',
      '服务及设施',
      '酒店政策',
      '酒店简介',
      '订房必读',
      '附近的酒店',
      '住客点评',
      '位置周边'
    ];
    let startIndex = -1;
    for (const marker of startMarkers) {
      const markerIndex = normalized.indexOf(marker);
      if (markerIndex !== -1 && (startIndex === -1 || markerIndex < startIndex)) {
        startIndex = markerIndex;
      }
    }
    if (startIndex === -1) {
      return normalized.slice(0, maxLength);
    }
    let endIndex = normalized.length;
    for (const marker of endMarkers) {
      const markerIndex = normalized.indexOf(marker, startIndex + 1);
      if (markerIndex !== -1 && markerIndex < endIndex) {
        endIndex = markerIndex;
      }
    }
    return normalized.slice(startIndex, Math.min(endIndex, startIndex + maxLength));
  };
  const extractTitleWindows = (text, options = {}) => {
    const normalized = toNormalizedText(text);
    const limit = Number(options.limit || 40);
    const windows = [];
    const seenWindows = new Set();
    const matches = [...normalized.matchAll(titlePattern)];
    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      const next = matches[index + 1];
      const start = Math.max(0, (current.index || 0) - 80);
      const end = next
        ? Math.min(normalized.length, (next.index || 0) + 120)
        : Math.min(normalized.length, start + 900);
      const snippet = normalized.slice(start, end).trim();
      if (!snippet || seenWindows.has(snippet)) {
        continue;
      }
      seenWindows.add(snippet);
      windows.push(snippet);
      if (windows.length >= limit) {
        break;
      }
    }
    return windows;
  };
  const addUniqueSnapshot = (snapshots, text) => {
    const normalized = extractRoomSection(text);
    if (!normalized || snapshots.includes(normalized)) return;
    snapshots.push(normalized);
  };
  const clickRoomDetailTriggers = async (options = {}) => {
    const triggerWaitMs = Number.isFinite(options.triggerWaitMs)
      ? Math.max(0, Number(options.triggerWaitMs))
      : 280;
    const triggerTexts = ['展示额外', '更多房型', '房间详情', '房型详情'];
    const triggerElements = Array.from(document.querySelectorAll('button, a, div, span'));
    const clickedTriggers = new Set();
    const snapshots = [];
    for (const element of triggerElements) {
      if (!isVisible(element)) continue;
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || !triggerTexts.some((item) => text.includes(item))) continue;
      const dedupeKey = text.slice(0, 40);
      if (clickedTriggers.has(dedupeKey)) continue;
      clickedTriggers.add(dedupeKey);
      if (!clickElement(element)) continue;
      if (triggerWaitMs > 0) {
        await sleep(triggerWaitMs);
      }
      addUniqueSnapshot(snapshots, readBodyText());
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } catch (_e) {}
      if (triggerWaitMs > 0) {
        await sleep(Math.min(120, triggerWaitMs));
      }
    }
    return snapshots;
  };
  const collectRoomNodeSnippets = (options = {}) => {
    const limit = Number(options.limit || 80);
    const texts = [];
    const seen = new Set();
    const nodes = document.querySelectorAll('div, li, section, article');
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = toNormalizedText(node.innerText || '');
      if (!text || text.length < 4) continue;
      if (!roomPattern.test(text) || !pricePattern.test(text)) continue;
      const normalized = text.length > 1800 ? extractRoomSection(text) : text;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      texts.push(normalized);
      if (texts.length >= limit) break;
    }
    return { texts, seen };
  };
  const collectFullDomExtractPayload = async (options = {}) => {
    const snapshots = [];
    addUniqueSnapshot(snapshots, readBodyText());
    const triggerSnapshots = await clickRoomDetailTriggers(options);
    for (const snapshot of triggerSnapshots) {
      addUniqueSnapshot(snapshots, snapshot);
    }

    const { texts, seen } = collectRoomNodeSnippets({ limit: 80 });
    const bodyText = readBodyText();
    for (const snippet of extractTitleWindows(bodyText, { limit: 40 })) {
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      texts.push(snippet);
      if (texts.length >= 120) break;
    }

    return {
      bodyText: extractRoomSection(bodyText),
      bodyHtml: '',
      snippets: texts,
      snapshots
    };
  };
  const collectLightweightDomExtractPayload = () => {
    const bodyText = readBodyText();
    const relevantBodyText = extractRoomSection(bodyText, { maxLength: 12000 });
    const snippets = [];
    const seen = new Set();
    const matches = [...relevantBodyText.matchAll(titlePattern)];
    for (let index = 0; index < matches.length && snippets.length < 40; index += 1) {
      const match = matches[index];
      const start = Math.max(0, match.index || 0);
      const end = Math.min(relevantBodyText.length, (match.index || 0) + 260);
      const snippet = relevantBodyText.slice(start, end).trim();
      if (!snippet || seen.has(snippet)) continue;
      seen.add(snippet);
      snippets.push(snippet);
    }
    return {
      bodyText: relevantBodyText,
      bodyHtml: '',
      snippets,
      snapshots: []
    };
  };

  return {
    sleep,
    isVisible,
    clickElement,
    readBodyText,
    toNormalizedText,
    extractRoomSection,
    extractTitleWindows,
    clickRoomDetailTriggers,
    collectRoomNodeSnippets,
    collectFullDomExtractPayload,
    collectLightweightDomExtractPayload
  };
}

function createEdgeDomExtractLightweightBrowserHelpers() {
  const titlePattern =
    /[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,40}(?:大床房|大床间|双床房|双床间|家庭房|家庭间|三床房|三人房|三人间|景观房|景观间|商务房|商务间|豪华房|豪华间|特惠房|特惠间|标准房|标准间|高级房|高级间|精品房|精品间|影音房|影音间|电竞房|电竞间|榻榻米房|榻榻米间|棋牌房|棋牌间|亲子房|亲子间|套房)/g;
  const readBodyText = () =>
    document.body && document.body.innerText ? document.body.innerText : '';
  const toNormalizedText = (text) =>
    String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const extractRoomSection = (text) => {
    const normalized = toNormalizedText(text);
    if (!normalized) return '';
    const startMarkers = ['选择房间', '房型摘要', '可住人数 今日价格', '立即确认', '登录看低价'];
    const endMarkers = [
      '地点',
      '服务及设施',
      '酒店政策',
      '酒店简介',
      '订房必读',
      '附近的酒店',
      '住客点评',
      '位置周边'
    ];
    let startIndex = -1;
    for (const marker of startMarkers) {
      const markerIndex = normalized.indexOf(marker);
      if (markerIndex !== -1 && (startIndex === -1 || markerIndex < startIndex)) {
        startIndex = markerIndex;
      }
    }
    if (startIndex === -1) return normalized.slice(0, 12000);
    let endIndex = normalized.length;
    for (const marker of endMarkers) {
      const markerIndex = normalized.indexOf(marker, startIndex + 1);
      if (markerIndex !== -1 && markerIndex < endIndex) {
        endIndex = markerIndex;
      }
    }
    return normalized.slice(startIndex, Math.min(endIndex, startIndex + 12000));
  };
  const collectLightweightDomExtractPayload = () => {
    const bodyText = readBodyText();
    const relevantBodyText = extractRoomSection(bodyText);
    const snippets = [];
    const seen = new Set();
    const matches = [...relevantBodyText.matchAll(titlePattern)];
    for (let index = 0; index < matches.length && snippets.length < 40; index += 1) {
      const match = matches[index];
      const start = Math.max(0, match.index || 0);
      const end = Math.min(relevantBodyText.length, (match.index || 0) + 260);
      const snippet = relevantBodyText.slice(start, end).trim();
      if (!snippet || seen.has(snippet)) continue;
      seen.add(snippet);
      snippets.push(snippet);
    }
    return {
      bodyText: relevantBodyText,
      bodyHtml: '',
      snippets,
      snapshots: []
    };
  };

  return {
    readBodyText,
    toNormalizedText,
    extractRoomSection,
    collectLightweightDomExtractPayload
  };
}

const EDGE_DOM_EXTRACT_HELPER_NAMES = [
  'sleep',
  'isVisible',
  'clickElement',
  'readBodyText',
  'toNormalizedText',
  'extractRoomSection',
  'extractTitleWindows',
  'clickRoomDetailTriggers',
  'collectRoomNodeSnippets',
  'collectFullDomExtractPayload',
  'collectLightweightDomExtractPayload'
];

const EDGE_DOM_EXTRACT_LIGHTWEIGHT_HELPER_NAMES = [
  'readBodyText',
  'toNormalizedText',
  'extractRoomSection',
  'collectLightweightDomExtractPayload'
];

function buildEdgeDomExtractHelpersSource() {
  const helperBindings = EDGE_DOM_EXTRACT_HELPER_NAMES.join(',\n  ');
  return `
const {
  ${helperBindings}
} = (${createEdgeDomExtractBrowserHelpers.toString()})();
`;
}

function buildLightweightEdgeDomExtractHelpersSource() {
  const helperBindings = EDGE_DOM_EXTRACT_LIGHTWEIGHT_HELPER_NAMES.join(',\n  ');
  return `
const {
  ${helperBindings}
} = (${createEdgeDomExtractLightweightBrowserHelpers.toString()})();
`;
}

function buildEdgeDomExtractExpression(options = {}) {
  return `(async () => {
  ${buildEdgeDomExtractHelpersSource()}
  return JSON.stringify(await collectFullDomExtractPayload(${JSON.stringify(options)}));
})()`;
}

function buildLightweightEdgeDomExtractExpression() {
  return `(async () => {
  ${buildLightweightEdgeDomExtractHelpersSource()}
  return JSON.stringify(collectLightweightDomExtractPayload());
})()`;
}

module.exports = {
  EDGE_DOM_EXTRACT_HELPER_NAMES,
  EDGE_DOM_EXTRACT_LIGHTWEIGHT_HELPER_NAMES,
  buildEdgeDomExtractExpression,
  buildEdgeDomExtractHelpersSource,
  buildLightweightEdgeDomExtractHelpersSource,
  buildLightweightEdgeDomExtractExpression,
  createEdgeDomExtractBrowserHelpers,
  createEdgeDomExtractLightweightBrowserHelpers
};
