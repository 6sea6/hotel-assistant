const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { closeAutoEdge, launchAndWaitForEdge } = require('./cli/auto-edge');
const { resolveEdgeProfileDirectory, resolveEdgeUserDataDir } = require('./edge-runtime');

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

function copyProfileForWorker(sourceDir) {
  const targetDir = createTemporaryProfileDir();
  if (sourceDir && fs.existsSync(sourceDir)) {
    fs.cpSync(sourceDir, targetDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: (sourcePath) => shouldCopyEdgeProfilePath(sourceDir, sourcePath)
    });
  }
  return targetDir;
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

function buildWorkerTemplate(effectiveTemplate, worker) {
  return {
    ...effectiveTemplate,
    edge_user_data_dir: worker.userDataDir,
    edge_profile_directory: worker.profileDirectory,
    edge_debugging_port: worker.port,
    edge_debugger_url: ''
  };
}

async function closeBatchEdgeWorkerPool(pool) {
  if (!pool || !Array.isArray(pool.workers)) {
    return;
  }

  for (const worker of pool.workers) {
    if (worker.pid && worker.shouldClose !== false) {
      closeAutoEdge(worker.pid);
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
      const worker = {
        id: 1,
        pid: existingWorker.pid || null,
        port: Number(existingWorker.port),
        userDataDir: sourceUserDataDir,
        profileDirectory,
        cleanupUserDataDir: false,
        shouldClose: false
      };
      worker.effectiveTemplate = buildWorkerTemplate(effectiveTemplate, worker);
      workers.push(worker);
    }

    let preparedUserDataDirIndex = 0;
    for (let index = workers.length; index < concurrency; index += 1) {
      let userDataDir = preparedUserDataDirs[preparedUserDataDirIndex];
      preparedUserDataDirIndex += 1;
      if (!userDataDir) {
        userDataDir = copyProfileForWorker(sourceUserDataDir);
      }
      const port = await findAvailablePort();
      try {
        const launched = await launchAndWaitForEdge({
          userDataDir,
          profileDirectory,
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
  findAvailablePort,
  prepareBatchEdgeWorkerProfileClones,
  shouldCopyEdgeProfilePath
};
