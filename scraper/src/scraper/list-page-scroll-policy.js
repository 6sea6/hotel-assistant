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
        sessionId
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
                '[data-offline-hotelId]',
                '[class*="hotel"]',
                '[class*="Hotel"]'
              ].join(',')).length;
            } catch (_error) {
              return 0;
            }
          };
          const collectCandidateHtml = () => {
            const selector = [
              'a[href*="/hotels/"]',
              'a[href*="hotelId="]',
              '[data-hotelid]',
              '[data-hotel-id]',
              '[data-offline-hotelid]',
              '[data-offline-hotelId]',
              '[class*="hotel"]',
              '[class*="Hotel"]'
            ].join(',');
            const fragments = [];
            const seen = new Set();
            let totalBytes = 0;
            const addFragment = (element) => {
              if (!element || seen.has(element)) return;
              seen.add(element);
              const html = String(element.outerHTML || '').trim();
              if (!html) return;
              fragments.push(html.slice(0, 12000));
              totalBytes += html.length;
            };
            for (const element of Array.from(document.querySelectorAll(selector))) {
              let candidate = element;
              for (let depth = 0; depth < 3; depth += 1) {
                const parent = candidate && candidate.parentElement;
                if (!parent || parent === document.body || parent === document.documentElement) {
                  break;
                }
                const text = parent.innerText || '';
                if (text.length > 30 && text.length <= 1800) {
                  candidate = parent;
                }
              }
              addFragment(candidate);
              if (fragments.length >= 120 || totalBytes >= 240000) {
                break;
              }
            }
            return fragments.join('\\n');
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
          const candidateHtml = collectCandidateHtml();
          const html = ${edgeHtmlExpression};
          return JSON.stringify({
            scrollHeight: nextHeight,
            candidateCount: nextCount,
            html,
            candidateHtml,
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
