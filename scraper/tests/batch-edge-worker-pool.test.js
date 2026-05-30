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

test('batch edge worker pool launches separate debugging ports and cleans cloned profiles', async (t) => {
  clearPoolModules();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-edge-worker-pool-'));
  const sourceProfile = path.join(tempRoot, 'edge-profile');
  fs.mkdirSync(path.join(sourceProfile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(sourceProfile, 'Default', 'Cookies'), 'login', 'utf8');
  fs.mkdirSync(path.join(sourceProfile, 'Default', 'Cache', 'Cache_Data'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceProfile, 'Default', 'Cache', 'Cache_Data', 'locked-cache-entry'),
    'cache',
    'utf8'
  );
  fs.mkdirSync(path.join(sourceProfile, 'Default', 'Code Cache', 'js'), { recursive: true });
  fs.writeFileSync(path.join(sourceProfile, 'Default', 'Code Cache', 'js', 'cache'), 'cache');
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    Module._load = originalLoad;
    clearPoolModules();
  });

  const launched = [];
  const closedPids = [];
  Module._load = function loadWithAutoEdgeStub(request, parent, isMain) {
    if (request === './cli/auto-edge' || request.endsWith('/cli/auto-edge')) {
      return {
        launchAndWaitForEdge: async (options = {}) => {
          launched.push(options);
          return {
            pid: Number(options.port) + 5000,
            port: Number(options.port)
          };
        },
        closeAutoEdge(pid) {
          closedPids.push(pid);
        }
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
    concurrency: 2
  });

  assert.equal(pool.workers.length, 2);
  assert.equal(new Set(pool.workers.map((worker) => worker.port)).size, 2);
  assert.ok(pool.workers.every((worker) => worker.userDataDir !== sourceProfile));
  assert.ok(launched.every((item) => item.userDataDir !== sourceProfile));
  assert.deepEqual(
    launched.map((item) => item.timeoutMs),
    [30000, 30000]
  );
  assert.equal(fs.existsSync(path.join(pool.workers[0].userDataDir, 'Default', 'Cookies')), true);
  assert.equal(fs.existsSync(path.join(pool.workers[1].userDataDir, 'Default', 'Cookies')), true);
  assert.equal(
    fs.existsSync(path.join(pool.workers[0].userDataDir, 'Default', 'Cache', 'Cache_Data')),
    false
  );
  assert.equal(
    fs.existsSync(path.join(pool.workers[1].userDataDir, 'Default', 'Code Cache')),
    false
  );
  assert.deepEqual(
    launched.map((item) => item.profileDirectory),
    ['Default', 'Default']
  );

  await pool.close();

  assert.deepEqual(
    closedPids.sort((left, right) => left - right),
    pool.workers.map((worker) => worker.pid).sort((left, right) => left - right)
  );
  assert.equal(fs.existsSync(pool.workers[0].userDataDir), false);
  assert.equal(fs.existsSync(pool.workers[1].userDataDir), false);
  assert.equal(fs.existsSync(sourceProfile), true);
});

test('batch edge worker pool can use profiles cloned before the source profile is locked', async (t) => {
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

  const launched = [];
  const closedPids = [];
  Module._load = function loadWithAutoEdgeStub(request, parent, isMain) {
    if (request === './cli/auto-edge' || request.endsWith('/cli/auto-edge')) {
      return {
        launchAndWaitForEdge: async (options = {}) => {
          launched.push(options);
          return {
            pid: Number(options.port) + 5000,
            port: Number(options.port)
          };
        },
        closeAutoEdge(pid) {
          closedPids.push(pid);
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const {
    createBatchEdgeWorkerPool,
    prepareBatchEdgeWorkerProfileClones
  } = require('../src/batch-edge-worker-pool');
  const preparedUserDataDirs = prepareBatchEdgeWorkerProfileClones({
    effectiveTemplate: {
      edge_user_data_dir: sourceProfile,
      edge_profile_directory: 'Default'
    },
    concurrency: 2,
    existingWorkerCount: 1
  });

  assert.equal(preparedUserDataDirs.length, 1);
  assert.equal(
    fs.readFileSync(path.join(preparedUserDataDirs[0], 'Default', 'Network', 'Cookies'), 'utf8'),
    'login-cookie'
  );

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
    },
    preparedUserDataDirs
  });

  assert.equal(pool.workers.length, 2);
  assert.equal(pool.workers[0].userDataDir, sourceProfile);
  assert.equal(pool.workers[0].shouldClose, false);
  assert.equal(pool.workers[1].userDataDir, preparedUserDataDirs[0]);
  assert.deepEqual(
    launched.map((item) => item.userDataDir),
    preparedUserDataDirs
  );

  await pool.close();

  assert.deepEqual(closedPids, [pool.workers[1].pid]);
  assert.equal(fs.existsSync(preparedUserDataDirs[0]), false);
  assert.equal(fs.existsSync(sourceProfile), true);
});
