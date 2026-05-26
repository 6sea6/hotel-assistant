const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { closeAutoEdge, launchAndWaitForEdge } = require('./cli/auto-edge');
const { resolveEdgeProfileDirectory, resolveEdgeUserDataDir } = require('./edge-runtime');

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

function copyProfileForWorker(sourceDir) {
  const targetDir = createTemporaryProfileDir();
  if (sourceDir && fs.existsSync(sourceDir)) {
    fs.cpSync(sourceDir, targetDir, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  }
  return targetDir;
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
    if (worker.pid) {
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

async function createBatchEdgeWorkerPool({ args = {}, effectiveTemplate = {}, concurrency = 1 }) {
  if (!args['auto-edge'] || concurrency <= 1) {
    return null;
  }

  const sourceUserDataDir = resolveEdgeUserDataDir(effectiveTemplate.edge_user_data_dir);
  const profileDirectory = resolveEdgeProfileDirectory(effectiveTemplate.edge_profile_directory);
  const workers = [];

  try {
    for (let index = 0; index < concurrency; index += 1) {
      const useSourceProfile = index === 0;
      const userDataDir = useSourceProfile
        ? sourceUserDataDir
        : copyProfileForWorker(sourceUserDataDir);
      const port = await findAvailablePort();
      const launched = await launchAndWaitForEdge({
        userDataDir,
        profileDirectory,
        port,
        url: 'about:blank',
        headless: effectiveTemplate.edge_headless
      });
      const worker = {
        id: index + 1,
        pid: launched.pid,
        port: Number(launched.port || port),
        userDataDir,
        profileDirectory,
        cleanupUserDataDir: !useSourceProfile
      };
      worker.effectiveTemplate = buildWorkerTemplate(effectiveTemplate, worker);
      workers.push(worker);
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
  closeBatchEdgeWorkerPool,
  createBatchEdgeWorkerPool,
  findAvailablePort
};
