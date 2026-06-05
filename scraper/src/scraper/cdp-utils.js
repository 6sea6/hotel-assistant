const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { normalizeText, toNumber, ensureDir } = require('../utils');
const {
  delay,
  scheduleProcessWindowHide,
  killBrowserProcessesByCommandLine,
  killProcessTree,
  findEdgeExecutable,
  normalizeBrowserPreference
} = require('./process-utils');

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a debugging port'));
        return;
      }

      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function normalizeEdgeSessionOptions(options = {}) {
  return {
    userDataDir: normalizeText(options.userDataDir || ''),
    profileDirectory: normalizeText(options.profileDirectory || ''),
    debuggerUrl: normalizeText(options.debuggerUrl || ''),
    debuggingPort: toNumber(options.debuggingPort),
    headless: options.headless !== false,
    browserPreference:
      normalizeBrowserPreference(
        options.browserPreference || options.browser || options.collectBrowser
      ) || 'edge'
  };
}

function cloneEdgeUserDataDir(sourceDir) {
  const normalizedSourceDir = normalizeText(sourceDir);
  if (!normalizedSourceDir || !fs.existsSync(normalizedSourceDir)) {
    return '';
  }

  const clonedDir = path.join(
    os.tmpdir(),
    `ctrip-edge-profile-clone-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.cpSync(normalizedSourceDir, clonedDir, {
    recursive: true,
    force: true,
    errorOnExist: false
  });
  return clonedDir;
}

async function launchManagedEdgeSession(edgeExecutable, sessionOptions, requestedPort) {
  const launchWithUserDataDir = async (userDataDir, shouldCleanupUserDataDir, port, timeoutMs) => {
    ensureDir(userDataDir);

    const launchArgs = [
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-renderer-backgrounding',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`
    ];

    if (sessionOptions.profileDirectory) {
      launchArgs.push(`--profile-directory=${sessionOptions.profileDirectory}`);
    }
    if (sessionOptions.headless) {
      launchArgs.push('--headless=new');
    } else {
      launchArgs.push(
        '--window-position=-32000,-32000',
        '--window-size=1280,900',
        '--start-minimized'
      );
    }
    launchArgs.push('about:blank');

    const browser = spawn(edgeExecutable, launchArgs, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    });
    browser.unref();
    scheduleProcessWindowHide(browser.pid);

    try {
      const debuggerUrl = await waitForDebuggerEndpoint(port, timeoutMs);
      return {
        browser,
        debuggerUrl,
        browserExecutable: edgeExecutable,
        port,
        userDataDir,
        shouldCleanupUserDataDir
      };
    } catch (error) {
      killProcessTree(browser.pid);
      killBrowserProcessesByCommandLine({
        browserExecutable: edgeExecutable,
        port,
        userDataDir
      });
      if (shouldCleanupUserDataDir) {
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch (_cleanupError) {
          // Ignore cleanup failures for failed launch attempts.
        }
      }
      throw error;
    }
  };

  const primaryPort = requestedPort || (await findAvailablePort());
  const primaryUserDataDir =
    sessionOptions.userDataDir ||
    path.join(
      os.tmpdir(),
      `ctrip-edge-capture-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
  const primaryShouldCleanup = !sessionOptions.userDataDir;

  try {
    return await launchWithUserDataDir(
      primaryUserDataDir,
      primaryShouldCleanup,
      primaryPort,
      sessionOptions.userDataDir ? 30000 : 10000
    );
  } catch (primaryError) {
    if (!sessionOptions.userDataDir) {
      throw primaryError;
    }

    const clonedUserDataDir = cloneEdgeUserDataDir(sessionOptions.userDataDir);
    if (!clonedUserDataDir) {
      throw primaryError;
    }

    const fallbackPort = await findAvailablePort();
    return launchWithUserDataDir(clonedUserDataDir, true, fallbackPort, 20000);
  }
}

async function connectToDebugger(debuggerUrl, EdgeWebSocket) {
  const socket = new EdgeWebSocket(debuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting to CDP')), 10000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      'error',
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      { once: true }
    );
  });
  return createCdpConnection(socket);
}

async function waitForDebuggerEndpoint(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.webSocketDebuggerUrl) {
          return data.webSocketDebuggerUrl;
        }
      }
    } catch (_error) {
      // Browser may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for Edge remote debugging endpoint');
}

function createCdpTimeoutError(method, timeoutMs) {
  const error = new Error(`CDP ${method} timed out after ${timeoutMs}ms`);
  error.code = 'CDP_TIMEOUT';
  return error;
}

function createCdpAbortError(method) {
  const error = new Error(`CDP ${method} aborted`);
  error.name = 'AbortError';
  error.code = 'CDP_ABORTED';
  return error;
}

function createCdpConnection(socket, options = {}) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  const defaultTimeoutMs =
    Number.isFinite(options.defaultTimeoutMs) && options.defaultTimeoutMs > 0
      ? options.defaultTimeoutMs
      : 15000;

  const clearPendingHandler = (id) => {
    const handler = pending.get(id);
    if (!handler) {
      return null;
    }
    pending.delete(id);
    if (handler.timer) {
      clearTimeout(handler.timer);
    }
    if (
      handler.signal &&
      handler.abortHandler &&
      typeof handler.signal.removeEventListener === 'function'
    ) {
      handler.signal.removeEventListener('abort', handler.abortHandler);
    }
    return handler;
  };

  const resolvePending = (id, value) => {
    const handler = clearPendingHandler(id);
    if (handler) {
      handler.resolve(value);
    }
  };

  const rejectPending = (id, error) => {
    const handler = clearPendingHandler(id);
    if (handler) {
      handler.reject(error);
    }
  };

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_error) {
      return;
    }

    if (typeof message.id === 'number') {
      if (!pending.has(message.id)) {
        return;
      }
      if (message.error) {
        rejectPending(message.id, new Error(message.error.message || 'CDP request failed'));
        return;
      }
      resolvePending(message.id, message.result || {});
      return;
    }

    for (const listener of listeners) {
      listener(message);
    }
  });

  socket.addEventListener('close', () => {
    for (const id of [...pending.keys()]) {
      rejectPending(id, new Error('CDP connection closed'));
    }
  });

  return {
    send(method, params = {}, sessionId = '', sendOptions = {}) {
      const id = nextId;
      nextId += 1;
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      const timeoutMs =
        Number.isFinite(sendOptions.timeoutMs) && sendOptions.timeoutMs >= 0
          ? sendOptions.timeoutMs
          : defaultTimeoutMs;
      const signal = sendOptions.signal || null;
      if (signal && signal.aborted) {
        return Promise.reject(createCdpAbortError(method));
      }
      const responsePromise = new Promise((resolve, reject) => {
        const handler = {
          resolve,
          reject,
          signal,
          abortHandler: null,
          timer: null
        };
        if (timeoutMs > 0) {
          handler.timer = setTimeout(() => {
            rejectPending(id, createCdpTimeoutError(method, timeoutMs));
          }, timeoutMs);
        }
        if (signal && typeof signal.addEventListener === 'function') {
          handler.abortHandler = () => {
            rejectPending(id, createCdpAbortError(method));
          };
          signal.addEventListener('abort', handler.abortHandler, { once: true });
        }
        pending.set(id, handler);
      });
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        rejectPending(id, error);
      }
      return responsePromise;
    },
    addListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPendingCount() {
      return pending.size;
    },
    close(timeoutMs = 1000) {
      if (socket.readyState >= 2) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          for (const id of [...pending.keys()]) {
            rejectPending(id, new Error('CDP connection closed'));
          }
          resolve();
        };
        timer = setTimeout(finish, Math.max(50, Number(timeoutMs) || 1000));
        socket.addEventListener('close', finish, { once: true });
        try {
          socket.close();
        } catch (_error) {
          finish();
        }
      });
    }
  };
}

async function evaluateInSession(connection, sessionId, expression, options = {}) {
  const result = await connection.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId,
    {
      timeoutMs:
        Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 5000,
      signal: options.signal || null
    }
  );
  return result && result.result ? result.result.value : undefined;
}

async function waitForSessionCondition(
  connection,
  sessionId,
  expression,
  timeoutMs = 4000,
  intervalMs = 200,
  options = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (options.signal && options.signal.aborted) {
        throw createCdpAbortError('Runtime.evaluate');
      }
      if (
        await evaluateInSession(connection, sessionId, expression, {
          timeoutMs: options.evaluateTimeoutMs || Math.min(1000, Math.max(250, timeoutMs)),
          signal: options.signal || null
        })
      ) {
        return true;
      }
    } catch (error) {
      if (error && (error.name === 'AbortError' || error.code === 'CDP_ABORTED')) {
        throw error;
      }
      // Session may still be loading; retry until timeout.
    }
    await delay(intervalMs);
  }
  return false;
}

async function waitForStableCount(getCount, options = {}) {
  const stableMs = options.stableMs || 1200;
  const maxWaitMs = options.maxWaitMs || 4000;
  const intervalMs = options.intervalMs || 200;
  const deadline = Date.now() + maxWaitMs;
  let lastCount = getCount();
  let lastChangedAt = Date.now();

  while (Date.now() < deadline) {
    if (options.signal && options.signal.aborted) {
      throw createCdpAbortError('waitForStableCount');
    }
    await delay(intervalMs);
    if (options.signal && options.signal.aborted) {
      throw createCdpAbortError('waitForStableCount');
    }
    const currentCount = getCount();
    if (currentCount !== lastCount) {
      lastCount = currentCount;
      lastChangedAt = Date.now();
      continue;
    }
    if (Date.now() - lastChangedAt >= stableMs) {
      return currentCount;
    }
  }

  return lastCount;
}

module.exports = {
  findAvailablePort,
  findEdgeExecutable,
  normalizeEdgeSessionOptions,
  cloneEdgeUserDataDir,
  launchManagedEdgeSession,
  connectToDebugger,
  waitForDebuggerEndpoint,
  createCdpConnection,
  createCdpAbortError,
  createCdpTimeoutError,
  evaluateInSession,
  waitForSessionCondition,
  waitForStableCount
};
