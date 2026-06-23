function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPromiseOrTimeout(promise, timeoutMs) {
  let timeoutId = null;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function dispatchCdpWheelScroll(connection, sessionId) {
  for (let index = 0; index < 3; index += 1) {
    await connection
      .send(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseWheel',
          x: 600,
          y: 400,
          deltaY: 1200,
          deltaX: 0
        },
        sessionId,
        { timeoutMs: 400 }
      )
      .catch(() => undefined);
    await delay(250);
  }
}

function buildListPageScrollExpression(options = {}) {
  const edgeHtmlExpression =
    options.includeFullEdgeHtml === true
      ? "document.documentElement ? document.documentElement.outerHTML : ''"
      : 'collectCandidateHtml()';

  return `(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const getHeight = () => Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
            window.innerHeight || 0
          );
          const getBodyText = () => document.body && document.body.innerText ? document.body.innerText : '';
          const getCandidateCount = () => {
            try {
              return document.querySelectorAll([
                'a[href*="/hotels/"]',
                'a[href*="hotelId="]',
                '[data-hotelid]',
                '[data-hotel-id]',
                '[data-offline-hotelid]',
                '[data-offline-hotelId]'
              ].join(',')).length;
            } catch (_error) {
              return 0;
            }
          };
          const collectCandidateHtml = () => {
            const selector = [
              'a[href*="/hotels/"]',
              'a[href*="/hotel"]',
              'a[href*="hotelId="]',
              '[data-hotelid]',
              '[data-hotel-id]',
              '[data-masterhotelid]',
              '[data-master-hotel-id]',
              '[data-offline-hotelid]',
              '[data-offline-hotelId]',
              '[data-exposure*="hotel"]',
              '[data-exposure*="Hotel"]',
              '[data-ubt-key*="hotel"]',
              '[data-ubt-key*="Hotel"]'
            ].join(',');
            const fragments = [];
            const seen = new Set();
            let totalBytes = 0;
            const startedAt = Date.now();
            const isOverBudget = () => Date.now() - startedAt > 850;
            const addFragment = (element) => {
              if (!element || seen.has(element) || isOverBudget()) return;
              seen.add(element);
              const html = String(element.outerHTML || '').trim();
              if (!html) return;
              fragments.push(html.slice(0, 12000));
              totalBytes += html.length;
            };
            const hotelLike = (element) => {
              if (!element) return false;
              const attrText = [
                element.id,
                element.className,
                element.getAttribute && element.getAttribute('href'),
                element.getAttribute && element.getAttribute('data-hotelid'),
                element.getAttribute && element.getAttribute('data-hotel-id'),
                element.getAttribute && element.getAttribute('data-masterhotelid'),
                element.getAttribute && element.getAttribute('data-master-hotel-id'),
                element.getAttribute && element.getAttribute('data-offline-hotelid'),
                element.getAttribute && element.getAttribute('data-offline-hotelId'),
                element.getAttribute && element.getAttribute('data-exposure'),
                element.getAttribute && element.getAttribute('data-ubt-key')
              ].filter(Boolean).join(' ');
              const text = String(element.innerText || element.textContent || '').slice(0, 1200);
              return /hotelId|hotelid|masterHotelId|masterhotelid|offline-hotel|\\/hotels\\/|酒店|宾馆|评分|点评|¥|￥/i.test(attrText + ' ' + text);
            };
            for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 500)) {
              if (isOverBudget()) break;
              let candidate = element;
              let best = hotelLike(candidate) ? candidate : null;
              for (let depth = 0; depth < 7; depth += 1) {
                if (isOverBudget()) break;
                const parent = candidate && candidate.parentElement;
                if (!parent || parent === document.body || parent === document.documentElement) {
                  break;
                }
                const text = parent.innerText || '';
                if (text.length > 20 && text.length <= 2200 && hotelLike(parent)) {
                  candidate = parent;
                  best = parent;
                  continue;
                }
                if (text.length > 2200) break;
                candidate = parent;
              }
              addFragment(best || element);
              if (fragments.length >= 120 || totalBytes >= 240000 || isOverBudget()) {
                break;
              }
            }
            return fragments.join('\\n');
          };
          const decodeJsonAttribute = (value) => {
            const text = String(value || '').replace(/&quot;/g, '"').replace(/&#34;/g, '"').trim();
            if (!text) return null;
            try {
              return JSON.parse(text);
            } catch (_error) {
              return null;
            }
          };
          const readHotelIdFromObject = (value, depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 4) return '';
            for (const key of ['hotelId', 'hotelID', 'hotelid', 'masterHotelId', 'masterHotelID', 'masterhotelid', 'hotelBasicId']) {
              const text = String(value[key] || '').trim();
              if (/^\\d{3,}$/.test(text)) return text;
            }
            for (const child of Object.values(value)) {
              const id = readHotelIdFromObject(child, depth + 1);
              if (id) return id;
            }
            return '';
          };
          const readHotelIdFromText = (value) => {
            const text = String(value || '');
            return (
              (text.match(/hotelId["'=:\\s]+(\\d{3,})/i) || [])[1] ||
              (text.match(/masterHotelId["'=:\\s]+(\\d{3,})/i) || [])[1] ||
              (text.match(/hotelid["'=:\\s]+(\\d{3,})/i) || [])[1] ||
              (text.match(/hotels\\/(\\d{3,})\\.html/i) || [])[1] ||
              (text.match(/hoteldetail\\/(\\d{3,})\\.html/i) || [])[1] ||
              ''
            );
          };
          const readHotelIdFromElement = (element) => {
            if (!element) return '';
            const directAttrs = [
              'data-hotelid',
              'data-hotel-id',
              'data-masterhotelid',
              'data-master-hotel-id',
              'data-offline-hotelid',
              'data-offline-hotelId',
              'hotelid',
              'masterhotelid',
              'href'
            ];
            for (const name of directAttrs) {
              const value = element.getAttribute && element.getAttribute(name);
              const textId = readHotelIdFromText(value);
              if (textId) return textId;
              const clean = String(value || '').trim();
              if (/^\\d{3,}$/.test(clean)) return clean;
            }
            for (const name of ['data-exposure', 'data-ubt-key', 'data-dop', 'data-params']) {
              const parsed = decodeJsonAttribute(element.getAttribute && element.getAttribute(name));
              const jsonId = readHotelIdFromObject(parsed);
              if (jsonId) return jsonId;
            }
            if (element.attributes) {
              for (const attr of Array.from(element.attributes)) {
                const attrId = readHotelIdFromText(attr && attr.value);
                if (attrId) return attrId;
                const parsed = decodeJsonAttribute(attr && attr.value);
                const jsonId = readHotelIdFromObject(parsed);
                if (jsonId) return jsonId;
              }
            }
            return '';
          };
          const pickCandidateName = (element, text) => {
            const selectors = [
              '.hotelName',
              '[class*="hotelName"]',
              '[class*="hotel-name"]',
              '[class*="hotelTitle"]',
              '[class*="hotel-title"]',
              '[class*="name"]',
              'h2',
              'h3',
              'strong'
            ];
            for (const selector of selectors) {
              const matched = element && element.querySelector && element.querySelector(selector);
              const value = String(matched && (matched.innerText || matched.textContent) || '').trim();
              if (/(酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村|Hotel|Inn|Hostel|Apartment)/i.test(value)) {
                return value.slice(0, 100);
              }
            }
            const match = String(text || '').match(/([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\- ]{2,80}(?:酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村|Hotel|Inn|Hostel|Apartment))/i);
            return match ? match[1].trim() : '';
          };
          const parseCandidateScore = (text) => {
            const match = String(text || '').match(/([0-9](?:\\.[0-9])?)\\s*(?:分|点评|好评|超棒|很好|不错|棒)/);
            if (!match) return null;
            const score = Number(match[1]);
            return Number.isFinite(score) && score > 0 && score <= 5 ? score : null;
          };
          const collectCandidateData = () => {
            const selector = [
              'a[href*="/hotels/"]',
              'a[href*="/hotel"]',
              'a[href*="hotelId="]',
              '[data-hotelid]',
              '[data-hotel-id]',
              '[data-masterhotelid]',
              '[data-master-hotel-id]',
              '[data-offline-hotelid]',
              '[data-offline-hotelId]',
              '[data-exposure*="hotel"]',
              '[data-exposure*="Hotel"]',
              '[data-ubt-key*="hotel"]',
              '[data-ubt-key*="Hotel"]'
            ].join(',');
            const output = [];
            const seenIds = new Set();
            const startedAt = Date.now();
            const isOverBudget = () => Date.now() - startedAt > 900;
            for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 700)) {
              if (isOverBudget()) break;
              let hotelId = readHotelIdFromElement(element);
              let root = element;
              for (let depth = 0; depth < 7 && root && root.parentElement; depth += 1) {
                const parent = root.parentElement;
                if (parent === document.body || parent === document.documentElement) break;
                const text = parent.innerText || parent.textContent || '';
                if (text.length > 20 && text.length <= 2600) {
                  root = parent;
                  hotelId = hotelId || readHotelIdFromElement(root);
                  continue;
                }
                if (text.length > 2600) break;
              }
              hotelId = hotelId || readHotelIdFromText((root && root.outerHTML) || '');
              if (!/^\\d{3,}$/.test(hotelId) || seenIds.has(hotelId)) {
                continue;
              }
              seenIds.add(hotelId);
              const href =
                (element.getAttribute && element.getAttribute('href')) ||
                (root && root.querySelector && root.querySelector('a[href]') && root.querySelector('a[href]').getAttribute('href')) ||
                '';
              const detailUrl = /hotel/i.test(href)
                ? href
                : 'https://hotels.ctrip.com/hotels/detail/?hotelId=' + hotelId;
              const text = String((root && (root.innerText || root.textContent)) || '').replace(/\\s+/g, ' ').trim();
              output.push({
                hotelId,
                masterHotelId: hotelId,
                detailUrl,
                hotelName: pickCandidateName(root || element, text),
                commentScore: parseCandidateScore(text),
                hotelTypeName: (text.match(/(酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村|Hotel|Inn|Hostel|Apartment)/i) || [])[1] || '',
                source: 'edge-dom-candidate'
              });
              if (output.length >= 300) break;
            }
            return output;
          };
          const buildCandidateJsonScript = (candidates) => {
            if (!Array.isArray(candidates) || !candidates.length) return '';
            const json = JSON.stringify({ hotelList: candidates }).replace(/<\\/script/gi, '<\\\\/script');
            return '<script type="application/json" data-source="edge-dom-candidates">' + json + '</script>';
          };
          const isVisible = (element) => {
            if (!element || element === document.body || element === document.documentElement) {
              return true;
            }
            const rect = element.getBoundingClientRect();
            if (!rect || rect.width < 120 || rect.height < 120) {
              return false;
            }
            const style = window.getComputedStyle(element);
            return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
          };
          const collectScrollableContainers = () => {
            const selector = [
              'main',
              '[role="main"]',
              '[class*="list"]',
              '[class*="List"]',
              '[class*="hotel"]',
              '[class*="Hotel"]',
              '[class*="search"]',
              '[class*="Search"]',
              '[class*="content"]',
              '[class*="Content"]',
              'section',
              'div'
            ].join(',');
            const scored = [];
            const seen = new Set();
            for (const element of Array.from(document.querySelectorAll(selector))) {
              if (seen.has(element) || !isVisible(element)) {
                continue;
              }
              seen.add(element);
              const clientHeight = element.clientHeight || 0;
              const scrollHeight = element.scrollHeight || 0;
              if (scrollHeight <= clientHeight + 80) {
                continue;
              }
              const rect = element.getBoundingClientRect();
              const text = element.innerText || '';
              const keywordBonus = /(酒店|宾馆|评分|点评|价格|携程)/.test(text) ? 100000 : 0;
              const classBonus = /(list|hotel|search|content|result)/i.test(element.className || '') ? 50000 : 0;
              scored.push({
                element,
                score: keywordBonus + classBonus + scrollHeight + rect.height
              });
            }
            return scored
              .sort((left, right) => right.score - left.score)
              .slice(0, 8)
              .map((item) => item.element);
          };
          const dispatchWheel = (target, deltaY) => {
            try {
              target.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaY
              }));
            } catch (_error) {
              // Some browser contexts can reject synthetic wheel events.
            }
          };
          const height = getHeight();
          const scrollYBefore = window.scrollY || window.pageYOffset || 0;
          const bodyScrollTopBefore = document.body ? document.body.scrollTop || 0 : 0;
          const documentScrollTopBefore = document.documentElement ? document.documentElement.scrollTop || 0 : 0;
          const bodyTextLength = getBodyText().length;
          const containers = [
            document.body,
            document.documentElement,
            ...collectScrollableContainers()
          ].filter(Boolean);
          let scrollActions = 0;
          for (let step = 0; step < 3; step += 1) {
            const pageDelta = Math.max(Math.floor((window.innerHeight || 900) * 0.85), 700);
            window.scrollBy(0, pageDelta);
            dispatchWheel(document.scrollingElement || document.documentElement || document.body, pageDelta);
            scrollActions += 1;
            for (const container of containers) {
              const before = container.scrollTop || 0;
              const delta = Math.max(Math.floor((container.clientHeight || 600) * 0.9), 500);
              container.scrollTop = Math.min(before + delta, container.scrollHeight || before + delta);
              dispatchWheel(container, delta);
              if ((container.scrollTop || 0) !== before) {
                scrollActions += 1;
              }
            }
            await sleep(180);
          }
          await sleep(250);
          const nextHeight = getHeight();
          const nextCount = getCandidateCount();
          const candidateData = collectCandidateData();
          const candidateJsonScript = buildCandidateJsonScript(candidateData);
          const candidateHtml = collectCandidateHtml();
          const baseHtml = ${options.includeFullEdgeHtml === true ? edgeHtmlExpression : 'candidateHtml'};
          const html = [baseHtml, candidateJsonScript].filter(Boolean).join('\\n');
          return JSON.stringify({
            scrollHeight: nextHeight,
            candidateCount: nextCount,
            html,
            candidateHtml,
            candidateDataCount: candidateData.length,
            fullHtmlIncluded: ${options.includeFullEdgeHtml === true ? 'true' : 'false'},
            scrollContainerCount: containers.length,
            scrollActions,
            documentHeightBefore: height,
            documentHeightAfter: nextHeight,
            bodyTextLength,
            scrollYBefore,
            scrollYAfter: window.scrollY || window.pageYOffset || 0,
            bodyScrollTopBefore,
            bodyScrollTopAfter: document.body ? document.body.scrollTop || 0 : 0,
            documentScrollTopBefore,
            documentScrollTopAfter: document.documentElement ? document.documentElement.scrollTop || 0 : 0
          });
        })()`;
}

function parseListPageScrollResult(scrollResult) {
  try {
    return JSON.parse(String(scrollResult || '{}'));
  } catch (_error) {
    return { scrollHeight: 0, candidateCount: 0, html: '' };
  }
}

module.exports = {
  buildListPageScrollExpression,
  delay,
  dispatchCdpWheelScroll,
  parseListPageScrollResult,
  waitForPromiseOrTimeout
};
