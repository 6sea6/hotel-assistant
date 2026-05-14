const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const {
  findEdgeExecutable,
  scheduleProcessWindowHide,
  killProcessTree
} = require('../scraper/process-utils');
const {
  hasReusableEdgeProfile,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
} = require('../edge-runtime');

function waitForDebuggerEndpoint(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Edge 调试端口 ${port} 在 ${timeoutMs}ms 内未就绪`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            resolve(info.webSocketDebuggerUrl);
          } catch (_error) {
            setTimeout(tryConnect, 500);
          }
        });
      });
      req.on('error', () => {
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

async function launchAndWaitForEdge(options) {
  const edgeExecutable = findEdgeExecutable();
  if (!edgeExecutable) {
    throw new Error('未找到 msedge.exe，无法启动 Edge 会话');
  }

  const userDataDir = resolveEdgeUserDataDir(options.userDataDir);
  const profileDirectory = resolveEdgeProfileDirectory(options.profileDirectory);
  const port = Number(options.port || 9222);
  const headless = toBoolean(options.headless, true);
  const url = options.url || 'about:blank';

  fs.mkdirSync(userDataDir, { recursive: true });

  const launchArgs = [
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`,
    url
  ];

  if (headless) {
    launchArgs.splice(3, 0, '--disable-gpu', '--headless=new');
  } else {
    launchArgs.splice(3, 0, '--window-position=-32000,-32000', '--window-size=1280,900', '--start-minimized');
  }

  const child = spawn(edgeExecutable, launchArgs, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  child.unref();
  scheduleProcessWindowHide(child.pid);

  const wsUrl = await waitForDebuggerEndpoint(port);
  console.error(`[auto-edge] 后台 Edge 已启动 (PID: ${child.pid}, 端口: ${port}, headless: ${headless})`);
  return { pid: child.pid, port, wsUrl, headless };
}

function closeAutoEdge(pid) {
  if (!pid) {
    return;
  }
  if (killProcessTree(pid)) {
    console.error(`[auto-edge] Edge (PID: ${pid}) 已关闭`);
  }
}

async function runInteractiveEdgeLoginPrep(options = {}) {
  const edgeExecutable = findEdgeExecutable();
  if (!edgeExecutable) {
    throw new Error('未找到 msedge.exe，无法启动首次登录准备');
  }

  const userDataDir = resolveEdgeUserDataDir(options.userDataDir);
  const profileDirectory = resolveEdgeProfileDirectory(options.profileDirectory);
  const port = Number(options.port || 9222);
  const url = options.url || 'https://hotels.ctrip.com/';

  fs.mkdirSync(userDataDir, { recursive: true });

  console.error('[auto-edge] 未检测到可复用的 Edge 登录资料，已打开一次可见 Edge 窗口。请先登录携程，完成后关闭该窗口，当前任务会继续。');

  await new Promise((resolve, reject) => {
    const child = spawn(edgeExecutable, [
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--profile-directory=${profileDirectory}`,
      url
    ], {
      stdio: 'ignore',
      detached: false,
      windowsHide: false
    });

    child.on('error', reject);
    child.on('exit', () => resolve());
  });

  if (hasReusableEdgeProfile(userDataDir, profileDirectory)) {
    console.error('[auto-edge] 首次登录准备已完成，继续后台采集。');
  } else {
    console.error('[auto-edge] 可见 Edge 窗口已关闭，但尚未检测到明确的可复用资料；若后续仍提示登录，请重新完成一次登录。');
  }
}

module.exports = {
  closeAutoEdge,
  hasReusableEdgeProfile,
  launchAndWaitForEdge,
  runInteractiveEdgeLoginPrep,
  waitForDebuggerEndpoint
};
