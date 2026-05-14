const { evaluateInSession } = require('../cdp-utils');

async function settleRoomListInEdgeSession(connection, sessionId) {
  await evaluateInSession(connection, sessionId, `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForDomIdle = async (idleMs = 220, timeoutMs = 1000) => {
      const root = document.body || document.documentElement;
      if (!root || typeof MutationObserver !== 'function') {
        await sleep(idleMs);
        return;
      }
      try {
        await new Promise((resolve) => {
          let settled = false;
          let idleTimer = null;
          let timeoutTimer = null;
          const finish = () => {
            if (settled) {
              return;
            }
            settled = true;
            if (idleTimer) {
              clearTimeout(idleTimer);
            }
            if (timeoutTimer) {
              clearTimeout(timeoutTimer);
            }
            observer.disconnect();
            resolve();
          };
          const observer = new MutationObserver(() => {
            if (idleTimer) {
              clearTimeout(idleTimer);
            }
            idleTimer = setTimeout(finish, idleMs);
          });
          observer.observe(root, { childList: true, subtree: true, attributes: true });
          idleTimer = setTimeout(finish, idleMs);
          timeoutTimer = setTimeout(finish, timeoutMs);
        });
      } catch (_error) {
        await sleep(idleMs);
      }
    };
    const getDocumentHeight = () => Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
      window.innerHeight || 0
    );

    const closeReviewPanels = () => {
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch(_e) {}

      const closeSelectors = [
        '[class*="close"]', '[class*="Close"]',
        '[class*="modal"] [class*="close"]', '[class*="Modal"] [class*="Close"]',
        '[class*="overlay"]', '[class*="Overlay"]',
        '[class*="dialog"] [class*="close"]', '[class*="Dialog"] [class*="Close"]',
        '[class*="review-panel"] [class*="close"]',
        '[class*="comment-panel"] [class*="close"]',
        '[aria-label="关闭"]', '[aria-label="Close"]',
      ];
      for (const sel of closeSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (el.getBoundingClientRect().width > 0) {
              try { el.click(); } catch(_e1) {}
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }
          }
        } catch(_e) {}
      }

      const tabTexts = ['服务及设施', '政策', '地点', '酒店简介', '订房必读'];
      const allElements = Array.from(document.querySelectorAll(
        '[role="tab"], [class*="tab"], [class*="Tab"], nav a, .nav-item, [class*="nav"] [class*="item"]'
      ));
      for (const tabText of tabTexts) {
        for (const el of allElements) {
          const t = (el.innerText || el.textContent || '').trim();
          if (t === tabText || t.includes(tabText)) {
            try { el.click(); } catch(_e2) {}
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
        }
      }

      window.scrollTo({ top: 0, behavior: 'instant' });
      return false;
    };
    closeReviewPanels();
    await waitForDomIdle(180, 700);
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(120);

    const clickExpandButtons = () => {
      const expandTexts = ['展示额外', '隐藏房型', '更多房型价格', '展开全部房型',
                           '查看全部房型', '全部房型'];
      const genericTexts = ['房型'];
      let clicked = 0;
      const elements = Array.from(document.querySelectorAll(
        'button, a, div, span, li, p, h1, h2, h3, h4, h5, h6, section, article, label'
      ));
      const clickedTexts = new Set();
      for (const element of elements) {
        const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const isExpand = expandTexts.some((item) => text.includes(item));
        const isGeneric = !isExpand && genericTexts.some((item) => text.includes(item))
                          && rect.top > window.innerHeight * 0.3;
        if ((isExpand || isGeneric) && !clickedTexts.has(text.substring(0, 20))) {
          clickedTexts.add(text.substring(0, 20));
          try { element.click(); } catch(_e) {}
          try {
            ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
              const event = new MouseEvent(eventType, {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
              });
              element.dispatchEvent(event);
            });
          } catch(_e) {}
          clicked += 1;
        }
      }
      return clicked;
    };

    const scrollAllContainers = async () => {
      const scrollableContainers = Array.from(document.querySelectorAll('*')).filter(el => {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll')
               && el.scrollHeight > el.clientHeight + 50;
      }).sort((left, right) => right.scrollHeight - left.scrollHeight).slice(0, 3);
      for (const container of scrollableContainers) {
        for (const ratio of [0, 0.5, 1]) {
          const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
          container.scrollTop = Math.round(maxScrollTop * ratio);
          await sleep(140);
          const clicked = clickExpandButtons();
          if (clicked > 0) {
            await waitForDomIdle(180, 700);
          } else {
            await sleep(60);
          }
        }
        container.scrollTop = 0;
      }
    };

    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(140);
    const initialClickCount = clickExpandButtons();
    if (initialClickCount > 0) {
      await waitForDomIdle(220, 900);
    } else {
      await sleep(180);
    }

    const maxScroll = getDocumentHeight();
    const steps = 6;
    let previousHeight = maxScroll;
    let stableHeightRounds = 0;
    for (let index = 0; index <= steps; index += 1) {
      const y = Math.round((maxScroll * index) / steps);
      window.scrollTo({ top: y, behavior: 'instant' });
      await sleep(180);
      const clicked = clickExpandButtons();
      if (clicked > 0) {
        await waitForDomIdle(220, 900);
      } else {
        await sleep(70);
      }
      const currentHeight = getDocumentHeight();
      if (Math.abs(currentHeight - previousHeight) <= 24) {
        stableHeightRounds += 1;
      } else {
        stableHeightRounds = 0;
      }
      previousHeight = currentHeight;
      if (stableHeightRounds >= 2 && clicked === 0 && index >= Math.floor(steps / 2)) {
        break;
      }
    }

    await scrollAllContainers();

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    await sleep(260);
    const clickedCount = clickExpandButtons();
    if (clickedCount > 0) {
      await waitForDomIdle(320, 1100);
    } else {
      await sleep(320);
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(100);
    return true;
  })()`);
}

module.exports = {
  settleRoomListInEdgeSession
};
