const fs = require('fs');
const {
  findEdgeExecutable,
  killBrowserProcessesByCommandLine,
  killProcessTree
} = require('../process-utils');
const {
  normalizeEdgeSessionOptions,
  launchManagedEdgeSession,
  connectToDebugger,
  waitForDebuggerEndpoint
} = require('../cdp-utils');
const {
  EDGE_CDP_COMMAND_TIMEOUT_MS,
  EDGE_CDP_CLEANUP_TIMEOUT_MS,
  EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS,
  assertEdgeNotAborted,
  buildCdpSendOptions
} = require('./edge-retry-policy');
const { isReusableEdgeHotelTarget } = require('./target-reuse');

function getEdgeWebSocket() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }

  try {
    return require('ws');
  } catch (_e) {
    return null;
  }
}

async function connectEdgeDebugger({
  edgeSessionOptions = {},
  edgeExecutable,
  EdgeWebSocket,
  perf,
  url,
  captureMethod,
  signal = null
}) {
  const sessionOptions = normalizeEdgeSessionOptions(edgeSessionOptions);
  const result = {
    browser: null,
    browserExecutable: '',
    browserPort: 0,
    connection: null,
    userDataDir: '',
    shouldCleanupUserDataDir: false,
    sessionOptions
  };

  await perf.runPhase(
    'edge_connect',
    {
      url,
      captureMethod,
      hasDebuggerUrl: Boolean(sessionOptions.debuggerUrl),
      hasDebuggingPort: Boolean(sessionOptions.debuggingPort)
    },
    async () => {
      assertEdgeNotAborted(signal, 'edge_connect');
      if (sessionOptions.debuggerUrl) {
        result.connection = await connectToDebugger(sessionOptions.debuggerUrl, EdgeWebSocket);
      } else if (sessionOptions.debuggingPort) {
        try {
          const debuggerUrl = await waitForDebuggerEndpoint(sessionOptions.debuggingPort, 3000);
          result.connection = await connectToDebugger(debuggerUrl, EdgeWebSocket);
        } catch (_error) {
          if (!edgeExecutable) {
            throw _error;
          }
          const launched = await launchManagedEdgeSession(
            edgeExecutable,
            sessionOptions,
            sessionOptions.debuggingPort
          );
          result.browser = launched.browser;
          result.browserExecutable = launched.browserExecutable || edgeExecutable;
          result.browserPort = launched.port || sessionOptions.debuggingPort || 0;
          result.userDataDir = launched.userDataDir;
          result.shouldCleanupUserDataDir = launched.shouldCleanupUserDataDir;
          result.connection = await connectToDebugger(launched.debuggerUrl, EdgeWebSocket);
        }
      } else {
        const launched = await launchManagedEdgeSession(edgeExecutable, sessionOptions);
        result.browser = launched.browser;
        result.browserExecutable = launched.browserExecutable || edgeExecutable;
        result.browserPort = launched.port || 0;
        result.userDataDir = launched.userDataDir;
        result.shouldCleanupUserDataDir = launched.shouldCleanupUserDataDir;
        result.connection = await connectToDebugger(launched.debuggerUrl, EdgeWebSocket);
      }
    }
  );

  return result;
}

async function acquireEdgeTarget({ connection, url, captureMethod, perf, signal = null }) {
  let targetId = '';
  let sessionId = '';
  let targetMode = 'create';
  let targetInitialUrl = '';
  let shouldCloseTarget = false;

  const targetPhase = perf.phase('edge_target', { url, captureMethod });
  try {
    assertEdgeNotAborted(signal, 'edge_target');
    try {
      const targetsResponse = await connection.send(
        'Target.getTargets',
        {},
        '',
        buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
      );
      const targets = (targetsResponse && targetsResponse.targetInfos) || [];
      const matchingTarget = targets.find((target) => {
        if (target.type !== 'page') return false;
        if (!target.url) return false;
        return isReusableEdgeHotelTarget(target.url, url);
      });
      if (matchingTarget) {
        targetId = matchingTarget.targetId;
        targetInitialUrl = matchingTarget.url || '';
        targetMode = 'reused-match';
      } else {
        const blankTarget = targets.find(
          (target) => target.type === 'page' && (!target.url || target.url === 'about:blank')
        );
        if (blankTarget) {
          targetId = blankTarget.targetId;
          targetInitialUrl = blankTarget.url || '';
          targetMode = 'reused-blank';
        }
      }
    } catch (_error) {
      // Listing targets is best effort; create a target below when needed.
    }

    if (!targetId) {
      let createdTarget = null;
      try {
        createdTarget = await connection.send(
          'Target.createTarget',
          { url: 'about:blank', hidden: true, background: true },
          '',
          buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
        );
      } catch (_hiddenTargetError) {
        createdTarget = await connection.send(
          'Target.createTarget',
          { url: 'about:blank' },
          '',
          buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
        );
      }
      targetId = createdTarget && createdTarget.targetId;
      shouldCloseTarget = true;
    }

    if (!targetId) {
      targetPhase.end('failed', { targetMode, targetCreated: shouldCloseTarget });
      return {
        targetId,
        sessionId,
        targetMode,
        targetInitialUrl,
        shouldCloseTarget,
        errorResult: {
          roomBlocks: [],
          selectedRoom: null,
          trackedUrls: [],
          error: 'edge-cdp fallback failed: could not find or create a target tab'
        }
      };
    }

    const attachedTarget = await connection.send(
      'Target.attachToTarget',
      {
        targetId,
        flatten: true
      },
      '',
      buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
    );
    sessionId = attachedTarget && attachedTarget.sessionId;
    if (!sessionId) {
      targetPhase.end('failed', { targetMode, targetCreated: shouldCloseTarget });
      return {
        targetId,
        sessionId,
        targetMode,
        targetInitialUrl,
        shouldCloseTarget,
        errorResult: {
          roomBlocks: [],
          selectedRoom: null,
          trackedUrls: [],
          error: 'edge-cdp fallback failed: attachToTarget returned no sessionId'
        }
      };
    }
    targetPhase.end('success', { targetMode, targetCreated: shouldCloseTarget });
    return {
      targetId,
      sessionId,
      targetMode,
      targetInitialUrl,
      shouldCloseTarget,
      errorResult: null
    };
  } catch (error) {
    targetPhase.error(error, { targetMode, targetCreated: shouldCloseTarget });
    throw error;
  }
}

async function cleanupEdgeTargetSession({
  perf,
  url,
  captureMethod,
  targetMode,
  targetCreated,
  temporaryProfile,
  connection,
  sessionId,
  targetId,
  browser,
  browserExecutable = '',
  browserPort = 0,
  userDataDir
}) {
  const cleanupPhase = perf.phase('edge_cleanup', {
    url,
    captureMethod,
    targetMode,
    targetCreated,
    temporaryProfile
  });
  try {
    if (connection && sessionId) {
      await connection
        .send('Target.detachFromTarget', { sessionId }, '', {
          timeoutMs: EDGE_CDP_CLEANUP_TIMEOUT_MS
        })
        .catch(() => undefined);
    }
    if (connection && targetId && targetCreated) {
      await connection
        .send('Target.closeTarget', { targetId }, '', { timeoutMs: EDGE_CDP_CLEANUP_TIMEOUT_MS })
        .catch(() => undefined);
    }
    if (connection) {
      await connection.close(EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS).catch(() => undefined);
    }
    if (browser && browser.pid) {
      killProcessTree(browser.pid);
      killBrowserProcessesByCommandLine({
        browserExecutable,
        port: browserPort,
        userDataDir
      });
    }
    if (temporaryProfile && userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (_error) {
        // Edge may keep profile files locked briefly; cleanup failure should not fail scraping.
      }
    }
    cleanupPhase.end('success');
  } catch (error) {
    cleanupPhase.error(error);
  }
}

module.exports = {
  acquireEdgeTarget,
  cleanupEdgeTargetSession,
  connectEdgeDebugger,
  findEdgeExecutable,
  getEdgeWebSocket,
  normalizeEdgeSessionOptions
};
