const fs = require('fs');
const {
  connectToDebugger,
  launchManagedEdgeSession,
  normalizeEdgeSessionOptions,
  waitForDebuggerEndpoint
} = require('./cdp-utils');
const {
  findEdgeExecutable,
  killBrowserProcessesByCommandLine,
  killProcessTree
} = require('./process-utils');

function getEdgeWebSocket() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }

  try {
    return require('ws');
  } catch (_error) {
    return null;
  }
}

async function connectListEdgeSession(edgeSessionOptions = {}, EdgeWebSocket, edgeExecutable) {
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

  if (sessionOptions.debuggerUrl) {
    result.connection = await connectToDebugger(sessionOptions.debuggerUrl, EdgeWebSocket);
  } else if (sessionOptions.debuggingPort) {
    try {
      const debuggerUrl = await waitForDebuggerEndpoint(sessionOptions.debuggingPort, 3000);
      result.connection = await connectToDebugger(debuggerUrl, EdgeWebSocket);
    } catch (error) {
      if (!edgeExecutable) {
        throw error;
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

  return result;
}

async function acquireListPageTarget(connection) {
  let targetId = '';
  let shouldCloseTarget = false;

  try {
    const targetsResponse = await connection.send('Target.getTargets');
    const targets = (targetsResponse && targetsResponse.targetInfos) || [];
    const blankTarget = targets.find(
      (target) => target.type === 'page' && (!target.url || target.url === 'about:blank')
    );
    if (blankTarget) {
      targetId = blankTarget.targetId;
    }
  } catch (_error) {
    // Listing targets is best effort; create a target below when needed.
  }

  if (!targetId) {
    let createdTarget = null;
    try {
      createdTarget = await connection.send('Target.createTarget', {
        url: 'about:blank',
        hidden: true,
        background: true
      });
    } catch (_hiddenTargetError) {
      createdTarget = await connection.send('Target.createTarget', { url: 'about:blank' });
    }
    targetId = createdTarget && createdTarget.targetId;
    shouldCloseTarget = true;
  }

  if (!targetId) {
    return {
      targetId,
      sessionId: '',
      shouldCloseTarget,
      error: 'edge-cdp list fallback failed: could not create a target tab'
    };
  }

  const attachedTarget = await connection.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });
  const sessionId = attachedTarget && attachedTarget.sessionId;
  if (!sessionId) {
    return {
      targetId,
      sessionId: '',
      shouldCloseTarget,
      error: 'edge-cdp list fallback failed: attachToTarget returned no sessionId'
    };
  }

  return {
    targetId,
    sessionId,
    shouldCloseTarget,
    error: ''
  };
}

async function cleanupListEdgeSession({
  stopNetworkListener,
  connection,
  sessionId,
  targetId,
  shouldCloseTarget,
  browser,
  browserExecutable = '',
  browserPort = 0,
  shouldCleanupUserDataDir,
  userDataDir
}) {
  if (stopNetworkListener) {
    stopNetworkListener();
  }
  if (connection && sessionId) {
    await connection.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
  if (connection && targetId && shouldCloseTarget) {
    await connection.send('Target.closeTarget', { targetId }).catch(() => undefined);
  }
  if (connection) {
    await connection.close().catch(() => undefined);
  }
  if (browser && browser.pid) {
    killProcessTree(browser.pid);
    killBrowserProcessesByCommandLine({
      browserExecutable,
      port: browserPort,
      userDataDir
    });
  }
  if (shouldCleanupUserDataDir && userDataDir) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_error) {
      // Edge can keep profile files locked briefly; cleanup should not fail parsing.
    }
  }
}

module.exports = {
  acquireListPageTarget,
  cleanupListEdgeSession,
  connectListEdgeSession,
  findEdgeExecutable,
  getEdgeWebSocket,
  normalizeEdgeSessionOptions
};
