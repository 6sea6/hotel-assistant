const http = require('http');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDebuggerVersion(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`Debugger endpoint returned HTTP ${res.statusCode}`));
          return;
        }
        try {
          const info = JSON.parse(data);
          if (!info || !info.webSocketDebuggerUrl) {
            reject(new Error('Debugger endpoint did not expose webSocketDebuggerUrl'));
            return;
          }
          resolve(info.webSocketDebuggerUrl);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Debugger endpoint request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

async function waitForDebuggerEndpoint(port, timeoutMs = 10000, options = {}) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0) {
    throw new Error(`无效的 Edge 调试端口: ${port}`);
  }

  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(50, options.intervalMs) : 200;
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
    ? Math.max(50, options.requestTimeoutMs)
    : 1000;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      return await readDebuggerVersion(normalizedPort, Math.min(requestTimeoutMs, remainingMs));
    } catch (error) {
      lastError = error;
    }

    const waitMs = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) {
      await delay(waitMs);
    }
  }

  const cause = lastError && lastError.message ? `: ${lastError.message}` : '';
  throw new Error(`Edge 调试端口 ${normalizedPort} 在 ${timeoutMs}ms 内未就绪${cause}`);
}

module.exports = {
  waitForDebuggerEndpoint
};
