const { connectToDebugger } = require('../scraper/cdp-utils');
const { collectRoomCandidatesFromPayload } = require('../scraper/structured-extractor');
const { wait } = require('../ctrip-access-controller');

const CONFIRM_EXPRESSION = `(() => {
  if (!/(^|\\.)ctrip\\.com$/.test(location.hostname)) return { userConfirmed: false, pageVerified: false };
  const text = document.body?.innerText || '';
  const blocked = /登录看低价|登录后才能查看|请完成验证|安全验证|访问过于频繁/.test(text);
  let button = document.getElementById('__hotel_collect_confirm');
  if (!button && document.body) {
    button = document.createElement('button');
    button.id = '__hotel_collect_confirm';
    button.textContent = '我已确认房价可见，恢复采集';
    button.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:16px;background:#1260b8;color:white;border:0;border-radius:8px;font-size:16px;cursor:pointer';
    button.onclick = () => { window.__hotelCollectConfirmed = true; };
    document.body.appendChild(button);
  }
  return { userConfirmed: window.__hotelCollectConfirmed === true, pageVerified: !blocked };
})()`;

async function monitorLoginConfirmation(port, signal) {
  let connection;
  let detach = () => {};
  let sessionId = '';
  let roomResponseVerified = false;
  let latestRoomRequest = '';
  try {
    while (!signal.aborted) {
      try {
        if (!connection) {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(1000)])
          });
          const info = await response.json();
          const Socket = globalThis.WebSocket || require('ws');
          connection = await connectToDebugger(info.webSocketDebuggerUrl, Socket);
        }
        if (!sessionId) {
          const { targetInfos = [] } = await connection.send('Target.getTargets');
          const target = targetInfos.find(
            (item) => item.type === 'page' && /^https:\/\/[^/]*ctrip\.com\//.test(item.url)
          );
          if (target) {
            ({ sessionId } = await connection.send('Target.attachToTarget', {
              targetId: target.targetId,
              flatten: true
            }));
            const requests = new Set();
            detach = connection.addListener((message) => {
              if (message.sessionId !== sessionId) return;
              const params = message.params || {};
              if (message.method === 'Network.requestWillBeSent' && params.type === 'Document') {
                roomResponseVerified = false;
                latestRoomRequest = '';
              }
              if (
                message.method === 'Network.responseReceived' &&
                /getHotelRoomList/.test(params.response?.url || '')
              ) {
                latestRoomRequest = params.requestId;
                roomResponseVerified = false;
                if (params.response.status === 200) requests.add(params.requestId);
              }
              if (
                message.method === 'Network.loadingFinished' &&
                requests.delete(params.requestId)
              ) {
                connection
                  .send('Network.getResponseBody', { requestId: params.requestId }, sessionId)
                  .then((body) => {
                    const payload = JSON.parse(
                      body.base64Encoded
                        ? Buffer.from(body.body, 'base64').toString('utf8')
                        : body.body
                    );
                    if (params.requestId !== latestRoomRequest) return;
                    roomResponseVerified =
                      Number(payload?.data?.htlSpiderActionErrorCode) !== 203 &&
                      collectRoomCandidatesFromPayload(payload, {}).some(
                        (room) => room.price > 0 && !room.price_locked
                      );
                  })
                  .catch(() => {});
              }
            });
            await connection.send('Network.enable', {}, sessionId);
          }
        }
        if (sessionId) {
          const state = await connection.send(
            'Runtime.evaluate',
            { expression: CONFIRM_EXPRESSION, returnByValue: true },
            sessionId,
            { signal }
          );
          const value = state.result?.value;
          if (value?.userConfirmed && value.pageVerified && roomResponseVerified) {
            return { userConfirmed: true, pageVerified: true, loginConfirmed: true };
          }
        }
      } catch (_error) {
        if (signal.aborted) break;
      }
      await wait(500, signal);
    }
  } catch (_error) {
    /* Closing the window is not confirmation. */
  } finally {
    detach();
    if (connection) await connection.close().catch(() => {});
  }
  return { userConfirmed: false, pageVerified: false, loginConfirmed: false };
}

module.exports = { monitorLoginConfirmation };
