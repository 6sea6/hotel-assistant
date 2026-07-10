const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { closeAutoEdge, launchAndWaitForEdge } = require('./cli/auto-edge');
const { resolveEdgeProfileDirectory, resolveEdgeUserDataDir } = require('./edge-runtime');
const { connectToDebugger, waitForDebuggerEndpoint } = require('./scraper/cdp-utils');

const BATCH_EDGE_WORKER_LAUNCH_TIMEOUT_MS = 30000;
const EDGE_PROFILE_SKIP_DIR_NAMES = new Set([
  'BrowserMetrics',
  'Cache',
  'Code Cache',
  'Crashpad',
  'DawnCache',
  'GPUCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'ShaderCache'
]);
const EDGE_PROFILE_SKIP_FILE_NAMES = new Set([
  'CrashpadMetrics.pma',
  'DevToolsActivePort',
  'LOCK',
  'lockfile',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket'
]);
const EDGE_PROFILE_SKIP_SEGMENT_PATTERNS = [
  /^cache storage$/i,
  /^database$/i,
  /^file system$/i,
  /^indexeddb$/i,
  /^shared_proto_db$/i,
  /^storage$/i
];
const EDGE_PROFILE_LOCKED_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

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
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function createTemporaryProfileDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctrip-batch-edge-profile-'));
}

async function createTemporaryProfileDirAsync() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'ctrip-batch-edge-profile-'));
}

function shouldCopyEdgeProfilePath(sourceRoot, sourcePath) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  if (!relativePath) {
    return true;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  const baseName = segments[segments.length - 1] || '';

  if (EDGE_PROFILE_SKIP_FILE_NAMES.has(baseName)) {
    return false;
  }

  return !segments.some(
    (segment) =>
      EDGE_PROFILE_SKIP_DIR_NAMES.has(segment) ||
      EDGE_PROFILE_SKIP_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment))
  );
}

function isLockedEdgeProfileCopyError(error) {
  if (!error) {
    return false;
  }

  const code = error.code ? String(error.code).toUpperCase() : '';
  const syscall = error.syscall ? String(error.syscall).toLowerCase() : '';
  const message = error.message ? String(error.message).toLowerCase() : '';

  return (
    EDGE_PROFILE_LOCKED_ERROR_CODES.has(code) &&
    (syscall.includes('copy') ||
      message.includes('resource busy') ||
      message.includes('locked') ||
      message.includes('being used by another process'))
  );
}

function describeLockedEdgeProfileCopyError(error) {
  const lockedPath = error && (error.path || error.dest) ? `：${error.path || error.dest}` : '';
  return `浏览器登录资料正在被 Edge 占用，无法复制并发采集用的临时资料${lockedPath}；本次已改为单浏览器顺序采集。`;
}

function copyProfileForWorker(sourceDir) {
  const targetDir = createTemporaryProfileDir();
  try {
    if (sourceDir && fs.existsSync(sourceDir)) {
      fs.cpSync(sourceDir, targetDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
        filter: (sourcePath) => shouldCopyEdgeProfilePath(sourceDir, sourcePath)
      });
    }
    return targetDir;
  } catch (error) {
    cleanupBatchEdgeWorkerProfileClones([targetDir]);
    throw error;
  }
}

async function copyProfileForWorkerAsync(sourceDir) {
  const targetDir = await createTemporaryProfileDirAsync();
  try {
    if (sourceDir && fs.existsSync(sourceDir)) {
      await fs.promises.cp(sourceDir, targetDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
        filter: (sourcePath) => shouldCopyEdgeProfilePath(sourceDir, sourcePath)
      });
    }
    return targetDir;
  } catch (error) {
    cleanupBatchEdgeWorkerProfileClones([targetDir]);
    throw error;
  }
}

function cleanupBatchEdgeWorkerProfileClones(profileDirs) {
  if (!Array.isArray(profileDirs)) {
    return;
  }

  for (const profileDir of profileDirs) {
    if (!profileDir) {
      continue;
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (_error) {
      // Edge may briefly keep profile files locked; cleanup failures should not fail the task.
    }
  }
}

function prepareBatchEdgeWorkerProfileClones({
  effectiveTemplate = {},
  concurrency = 1,
  existingWorkerCount = 0
} = {}) {
  const cloneCount = Math.max(0, Number(concurrency || 1) - Number(existingWorkerCount || 0));
  if (cloneCount <= 0) {
    return [];
  }

  const sourceUserDataDir = resolveEdgeUserDataDir(effectiveTemplate.edge_user_data_dir);
  const profileDirs = [];
  try {
    for (let index = 0; index < cloneCount; index += 1) {
      profileDirs.push(copyProfileForWorker(sourceUserDataDir));
    }
  } catch (error) {
    cleanupBatchEdgeWorkerProfileClones(profileDirs);
    throw error;
  }
  return profileDirs;
}

async function prepareBatchEdgeWorkerProfileClonesAsync({
  effectiveTemplate = {},
  concurrency = 1,
  existingWorkerCount = 0
} = {}) {
  const cloneCount = Math.max(0, Number(concurrency || 1) - Number(existingWorkerCount || 0));
  if (cloneCount <= 0) {
    return [];
  }

  const sourceUserDataDir = resolveEdgeUserDataDir(effectiveTemplate.edge_user_data_dir);
  const profileDirs = [];
  try {
    for (let index = 0; index < cloneCount; index += 1) {
      profileDirs.push(await copyProfileForWorkerAsync(sourceUserDataDir));
    }
  } catch (error) {
    cleanupBatchEdgeWorkerProfileClones(profileDirs);
    throw error;
  }
  return profileDirs;
}

function buildWorkerTemplate(effectiveTemplate, worker) {
  return {
    ...effectiveTemplate,
    edge_user_data_dir: worker.userDataDir,
    edge_profile_directory: worker.profileDirectory,
    edge_debugging_port: worker.port,
    edge_debugger_url: '',
    edge_target_id: worker.targetId || ''
  };
}

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

async function createPersistentTarget(connection) {
  try {
    return await connection.send('Target.createTarget', {
      url: 'about:blank',
      hidden: true,
      background: true
    });
  } catch (_error) {
    return connection.send('Target.createTarget', { url: 'about:blank' });
  }
}

async function createSharedBrowserWorkerPool({
  effectiveTemplate = {},
  concurrency = 1,
  existingWorker
}) {
  const EdgeWebSocket = getEdgeWebSocket();
  if (!EdgeWebSocket) {
    throw new Error('无法创建共享 Edge 标签页：当前运行环境缺少 WebSocket 支持。');
  }
  const port = Number(existingWorker && existingWorker.port);
  const debuggerUrl =
    (existingWorker && existingWorker.debuggerUrl) || (await waitForDebuggerEndpoint(port, 5000));
  const connection = await connectToDebugger(debuggerUrl, EdgeWebSocket);
  const sourceUserDataDir = resolveEdgeUserDataDir(effectiveTemplate.edge_user_data_dir);
  const profileDirectory = resolveEdgeProfileDirectory(effectiveTemplate.edge_profile_directory);
  const workers = [];
  const targetIds = [];

  try {
    for (let index = 0; index < concurrency; index += 1) {
      const created = await createPersistentTarget(connection);
      const targetId = created && created.targetId;
      if (!targetId) {
        throw new Error('共享 Edge 标签页创建失败：Target.createTarget 未返回 targetId。');
      }
      targetIds.push(targetId);
      const worker = {
        id: index + 1,
        pid: existingWorker.pid || null,
        port,
        targetId,
        userDataDir: sourceUserDataDir,
        profileDirectory,
        browserExecutable: existingWorker.browserExecutable || '',
        browserName: existingWorker.browserName || '',
        cleanupUserDataDir: false,
        shouldClose: false,
        sharedBrowser: true
      };
      worker.effectiveTemplate = buildWorkerTemplate(effectiveTemplate, worker);
      workers.push(worker);
    }
  } catch (error) {
    await Promise.all(
      targetIds.map((targetId) =>
        connection.send('Target.closeTarget', { targetId }).catch(() => undefined)
      )
    );
    await connection.close().catch(() => undefined);
    throw error;
  }

  return {
    workers,
    targetIds,
    sharedConnection: connection,
    sharedBrowser: true,
    close() {
      return closeBatchEdgeWorkerPool(this);
    }
  };
}

async function closeBatchEdgeWorkerPool(pool) {
  if (!pool || !Array.isArray(pool.workers)) {
    return;
  }

  if (pool.sharedConnection) {
    await Promise.all(
      (Array.isArray(pool.targetIds) ? pool.targetIds : [])
        .filter(Boolean)
        .map((targetId) =>
          pool.sharedConnection.send('Target.closeTarget', { targetId }).catch(() => undefined)
        )
    );
    await pool.sharedConnection.close().catch(() => undefined);
  }

  for (const worker of pool.workers) {
    if (worker.pid && worker.shouldClose !== false) {
      closeAutoEdge(worker.pid, worker);
    }
  }

  for (const worker of pool.workers) {
    if (worker.cleanupUserDataDir && worker.userDataDir) {
      try {
        fs.rmSync(worker.userDataDir, { recursive: true, force: true });
      } catch (_error) {
        // Edge may briefly keep profile files locked; cleanup failures should not fail the task.
      }
    }
  }
}

async function createBatchEdgeWorkerPool({
  args = {},
  effectiveTemplate = {},
  concurrency = 1,
  existingWorker = null,
  preparedUserDataDirs = []
}) {
  if (!args['auto-edge'] || concurrency <= 1) {
    return null;
  }

  const sourceUserDataDir = resolveEdgeUserDataDir(effectiveTemplate.edge_user_data_dir);
  const profileDirectory = resolveEdgeProfileDirectory(effectiveTemplate.edge_profile_directory);
  const workers = [];

  try {
    if (existingWorker && existingWorker.port) {
      return createSharedBrowserWorkerPool({
        effectiveTemplate,
        concurrency,
        existingWorker
      });
    }

    let preparedUserDataDirIndex = 0;
    for (let index = workers.length; index < concurrency; index += 1) {
      let userDataDir = preparedUserDataDirs[preparedUserDataDirIndex];
      preparedUserDataDirIndex += 1;
      if (!userDataDir) {
        userDataDir = await copyProfileForWorkerAsync(sourceUserDataDir);
      }
      const port = await findAvailablePort();
      try {
        const launched = await launchAndWaitForEdge({
          userDataDir,
          profileDirectory,
          browserPreference: effectiveTemplate.browser_preference,
          port,
          url: 'about:blank',
          headless: effectiveTemplate.edge_headless,
          timeoutMs: BATCH_EDGE_WORKER_LAUNCH_TIMEOUT_MS
        });
        const worker = {
          id: index + 1,
          pid: launched.pid,
          port: Number(launched.port || port),
          userDataDir,
          profileDirectory,
          browserExecutable: launched.browserExecutable || '',
          browserName: launched.browserName || '',
          cleanupUserDataDir: true,
          shouldClose: true
        };
        worker.effectiveTemplate = buildWorkerTemplate(effectiveTemplate, worker);
        workers.push(worker);
      } catch (error) {
        cleanupBatchEdgeWorkerProfileClones([userDataDir]);
        throw error;
      }
    }
  } catch (error) {
    await closeBatchEdgeWorkerPool({ workers });
    throw error;
  }

  return {
    workers,
    close: () => closeBatchEdgeWorkerPool({ workers })
  };
}

module.exports = {
  BATCH_EDGE_WORKER_LAUNCH_TIMEOUT_MS,
  cleanupBatchEdgeWorkerProfileClones,
  closeBatchEdgeWorkerPool,
  createBatchEdgeWorkerPool,
  describeLockedEdgeProfileCopyError,
  findAvailablePort,
  isLockedEdgeProfileCopyError,
  prepareBatchEdgeWorkerProfileClones,
  prepareBatchEdgeWorkerProfileClonesAsync,
  shouldCopyEdgeProfilePath
};
