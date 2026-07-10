const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const poolPath = require.resolve('../src/batch-edge-worker-pool');
const autoEdgePath = require.resolve('../src/cli/auto-edge');
const originalLoad = Module._load;

function clearPoolModules() {
  delete require.cache[poolPath];
  delete require.cache[autoEdgePath];
}

test.after(() => {
  Module._load = originalLoad;
  clearPoolModules();
});

test('batch edge worker profile copy skips locked root Crashpad metrics file', () => {
  clearPoolModules();
  const { shouldCopyEdgeProfilePath } = require('../src/batch-edge-worker-pool');
  const sourceProfile = path.join(os.tmpdir(), 'edge-profile');

  assert.equal(
    shouldCopyEdgeProfilePath(sourceProfile, path.join(sourceProfile, 'CrashpadMetrics.pma')),
    false
  );
});

test('batch edge worker profile copy classifies locked cookie copy errors', () => {
  clearPoolModules();
  const {
    describeLockedEdgeProfileCopyError,
    isLockedEdgeProfileCopyError
  } = require('../src/batch-edge-worker-pool');
  const error = Object.assign(
    new Error(
      "EBUSY: resource busy or locked, copyfile 'state/edge-profile/Default/Network/Cookies'"
    ),
    {
      code: 'EBUSY',
      syscall: 'copyfile',
      path: path.join('state', 'edge-profile', 'Default', 'Network', 'Cookies')
    }
  );

  assert.equal(isLockedEdgeProfileCopyError(error), true);
  assert.match(describeLockedEdgeProfileCopyError(error), /单浏览器顺序采集/);
  assert.match(describeLockedEdgeProfileCopyError(error), /Cookies/);
});

test('batch edge worker profile clone can copy asynchronously', async () => {
  clearPoolModules();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-edge-worker-async-copy-'));
  const sourceProfile = path.join(tempRoot, 'edge-profile');
  fs.mkdirSync(path.join(sourceProfile, 'Default', 'Network'), { recursive: true });
  fs.writeFileSync(path.join(sourceProfile, 'Default', 'Network', 'Cookies'), 'login-cookie');
  fs.mkdirSync(path.join(sourceProfile, 'Default', 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(sourceProfile, 'Default', 'Cache', 'entry'), 'cache');

  try {
    const {
      cleanupBatchEdgeWorkerProfileClones,
      prepareBatchEdgeWorkerProfileClonesAsync
    } = require('../src/batch-edge-worker-pool');
    const clones = await prepareBatchEdgeWorkerProfileClonesAsync({
      effectiveTemplate: {
        edge_user_data_dir: sourceProfile,
        edge_profile_directory: 'Default'
      },
      concurrency: 2,
      existingWorkerCount: 1
    });

    assert.equal(clones.length, 1);
    assert.equal(
      fs.readFileSync(path.join(clones[0], 'Default', 'Network', 'Cookies'), 'utf8'),
      'login-cookie'
    );
    assert.equal(fs.existsSync(path.join(clones[0], 'Default', 'Cache', 'entry')), false);
    cleanupBatchEdgeWorkerProfileClones(clones);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    clearPoolModules();
  }
});

test('batch edge worker pool reuses one browser with persistent worker targets', async (t) => {
  clearPoolModules();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-edge-worker-pool-'));
  const sourceProfile = path.join(tempRoot, 'edge-profile');
  fs.mkdirSync(path.join(sourceProfile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(sourceProfile, 'Default', 'Cookies'), 'login', 'utf8');
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    Module._load = originalLoad;
    clearPoolModules();
  });

  const createdTargets = [];
  const closedTargets = [];
  let connectionClosed = false;
  Module._load = function loadWithAutoEdgeStub(request, parent, isMain) {
    if (request === './cli/auto-edge' || request.endsWith('/cli/auto-edge')) {
      return {
        launchAndWaitForEdge: async () => {
          throw new Error('shared browser pool must not launch cloned browser processes');
        },
        closeAutoEdge() {}
      };
    }
    if (request === './scraper/cdp-utils' || request.endsWith('/scraper/cdp-utils')) {
      return {
        waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
        connectToDebugger: async () => ({
          async send(method, params = {}) {
            if (method === 'Target.createTarget') {
              const targetId = `worker-target-${createdTargets.length + 1}`;
              createdTargets.push(targetId);
              return { targetId };
            }
            if (method === 'Target.closeTarget') {
              closedTargets.push(params.targetId);
              return { success: true };
            }
            return {};
          },
          async close() {
            connectionClosed = true;
          }
        })
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const { createBatchEdgeWorkerPool } = require('../src/batch-edge-worker-pool');
  const pool = await createBatchEdgeWorkerPool({
    args: { 'auto-edge': true },
    effectiveTemplate: {
      edge_user_data_dir: sourceProfile,
      edge_profile_directory: 'Default',
      edge_headless: true
    },
    concurrency: 3,
    existingWorker: {
      pid: 1234,
      port: 9222,
      browserName: 'Edge'
    }
  });

  assert.equal(pool.workers.length, 3);
  assert.equal(pool.sharedBrowser, true);
  assert.deepEqual(
    pool.workers.map((worker) => worker.port),
    [9222, 9222, 9222]
  );
  assert.ok(pool.workers.every((worker) => worker.userDataDir === sourceProfile));
  assert.equal(new Set(pool.workers.map((worker) => worker.targetId)).size, 3);
  assert.deepEqual(
    pool.workers.map((worker) => worker.effectiveTemplate.edge_target_id),
    createdTargets
  );

  await pool.close();

  assert.deepEqual(closedTargets.sort(), createdTargets.sort());
  assert.equal(connectionClosed, true);
  assert.equal(fs.existsSync(sourceProfile), true);
});

test('batch edge worker pool does not copy a locked source profile when sharing tabs', async (t) => {
  clearPoolModules();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-edge-worker-pool-prepared-'));
  const sourceProfile = path.join(tempRoot, 'edge-profile');
  fs.mkdirSync(path.join(sourceProfile, 'Default', 'Network'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceProfile, 'Default', 'Network', 'Cookies'),
    'login-cookie',
    'utf8'
  );
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    Module._load = originalLoad;
    clearPoolModules();
  });

  let targetCounter = 0;
  Module._load = function loadWithAutoEdgeStub(request, parent, isMain) {
    if (request === './cli/auto-edge' || request.endsWith('/cli/auto-edge')) {
      return {
        launchAndWaitForEdge: async () => {
          throw new Error('must not launch a cloned profile');
        },
        closeAutoEdge() {}
      };
    }
    if (request === './scraper/cdp-utils' || request.endsWith('/scraper/cdp-utils')) {
      return {
        waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
        connectToDebugger: async () => ({
          async send(method) {
            if (method === 'Target.createTarget') {
              targetCounter += 1;
              return { targetId: `target-${targetCounter}` };
            }
            return {};
          },
          async close() {}
        })
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const { createBatchEdgeWorkerPool } = require('../src/batch-edge-worker-pool');

  const originalCpSync = fs.cpSync;
  fs.cpSync = () => {
    throw new Error('source profile is locked');
  };
  t.after(() => {
    fs.cpSync = originalCpSync;
  });

  const pool = await createBatchEdgeWorkerPool({
    args: { 'auto-edge': true },
    effectiveTemplate: {
      edge_user_data_dir: sourceProfile,
      edge_profile_directory: 'Default',
      edge_headless: true
    },
    concurrency: 2,
    existingWorker: {
      pid: 1234,
      port: 9222
    }
  });

  assert.equal(pool.workers.length, 2);
  assert.ok(pool.workers.every((worker) => worker.userDataDir === sourceProfile));
  assert.ok(pool.workers.every((worker) => worker.shouldClose === false));

  await pool.close();

  assert.equal(fs.existsSync(sourceProfile), true);
});
