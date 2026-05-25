const { safeJsonParse } = require('../html-parser');
const { evaluateInSession } = require('../cdp-utils');

function detectCtripLoginPromptFromText(text = '') {
  const normalizedText = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) {
    return {
      detected: false,
      reason: ''
    };
  }

  const priceLoginPattern =
    /登录看低价|解锁优惠|登录后(?:查看|享|可|才)?[^。；，,.]{0,16}(?:低价|价格|优惠|房价)/;
  if (priceLoginPattern.test(normalizedText)) {
    return {
      detected: true,
      reason: '携程页面提示登录后才能查看价格或优惠。'
    };
  }

  const loginDialogPattern =
    /扫码登录|手机号登录|账号密码登录|验证码登录|携程账号登录|登录携程|会员登录|立即登录|请登录后|登录后继续/;
  if (loginDialogPattern.test(normalizedText)) {
    return {
      detected: true,
      reason: '携程页面出现登录弹窗或登录入口。'
    };
  }

  return {
    detected: false,
    reason: ''
  };
}

async function detectCtripLoginPromptInSession(connection, sessionId, options = {}) {
  const result = await evaluateInSession(
    connection,
    sessionId,
    `(() => {
      const readText = (element) => element ? String(element.innerText || element.textContent || '') : '';
      const selectors = [
        '[role="dialog"]',
        '[class*="login"]',
        '[class*="Login"]',
        '[class*="modal"]',
        '[class*="Modal"]',
        '[class*="popup"]',
        '[class*="Popup"]',
        '[class*="mask"]',
        '[class*="Mask"]'
      ];
      const snippets = [];
      for (const selector of selectors) {
        try {
          for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 12)) {
            const text = readText(element).replace(/\\s+/g, ' ').trim();
            if (text && !snippets.includes(text)) snippets.push(text.slice(0, 600));
          }
        } catch (_error) {}
      }
      const bodyText = readText(document.body).replace(/\\s+/g, ' ').trim();
      return JSON.stringify({
        title: document.title || '',
        url: location.href || '',
        modalText: snippets.join('\\n').slice(0, 1800),
        bodyText: bodyText.slice(0, 2400)
      });
    })()`,
    {
      timeoutMs: 2500,
      signal: options.signal || null
    }
  );
  const payload = typeof result === 'string' ? safeJsonParse(result) : result;
  const combinedText = [
    payload && payload.title,
    payload && payload.modalText,
    payload && payload.bodyText
  ]
    .filter(Boolean)
    .join('\n');
  return detectCtripLoginPromptFromText(combinedText);
}

module.exports = {
  detectCtripLoginPromptFromText,
  detectCtripLoginPromptInSession
};
