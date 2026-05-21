const fs = require('fs');
const path = require('path');
const { request } = require('../../http-client');
const { ensureDir } = require('../../utils');

const DESKTOP_HEADERS = {
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  referer: 'https://hotels.ctrip.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
};

const MOBILE_HEADERS = {
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  referer: 'https://m.ctrip.com/',
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
};

async function fetchHtml(url, headers, options = {}) {
  if (!url) {
    return {
      html: '',
      cookieHeader: ''
    };
  }

  const response = await request({
    method: 'GET',
    url,
    headers,
    timeoutMs: 30000,
    responseType: 'text',
    signal: options.signal || null
  });
  const setCookieHeaders = Array.isArray(response.headers && response.headers['set-cookie'])
    ? response.headers['set-cookie']
    : [];
  const cookiePairs = setCookieHeaders
    .map((value) =>
      String(value || '')
        .split(';')[0]
        .trim()
    )
    .filter(Boolean);

  return {
    html: response.data,
    cookieHeader: [...new Set(cookiePairs)].join('; ')
  };
}

function loadHtmlFromFile(htmlPath) {
  return fs.readFileSync(htmlPath, 'utf-8');
}

function saveHtmlSnapshot(baseDir, fileStem, sourceName, html) {
  if (!baseDir || !html) {
    return null;
  }

  ensureDir(baseDir);
  const filePath = path.join(baseDir, `${fileStem}-${sourceName}.html`);
  fs.writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

module.exports = {
  DESKTOP_HEADERS,
  MOBILE_HEADERS,
  fetchHtml,
  loadHtmlFromFile,
  saveHtmlSnapshot
};
