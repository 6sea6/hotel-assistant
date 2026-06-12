const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const {
  findChromiumBrowserExecutable,
  getBrowserDisplayName,
  killBrowserProcessesByCommandLine,
  normalizeBrowserPreference,
  killProcessTree
} = require('../scraper/process-utils');
const {
  hasReusableEdgeProfile,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
} = require('../edge-runtime');

function shouldUseSeparate360Profile(browserName, userDataDir) {
  if (browserName !== '360 Browser') {
    return false;
  }
  const normalized = String(userDataDir || '').replace(/\\/g, '/').toLowerCase();
  return /(^|\/)edge-profile(\/|$)/.test(normalized);
}

function resolve360UserDataDir(edgeUserDataDir) {
  const resolvedEdgeDir = resolveEdgeUserDataDir(edgeUserDataDir);
  return path.join(path.dirname(resolvedEdgeDir), '360-profile');
}

function resolveAutoEdgeRuntime(options = {}) {
  const browserPreference = normalizeBrowserPreference(
    options.browserPreference || options.browser || options.collectBrowser
  );
  const browser = findChromiumBrowserExecutable({ browserPreference });
  const browserExecutable = browser.executablePath;
  const browserName = browser.browserName || getBrowserDisplayName(browserExecutable);
  if (!browserExecutable) {
    return {
      browserExecutable: '',
      browserName: browserPreference === '360' ? '360 Browser' : '',
      userDataDir: '',
      profileDirectory: resolveEdgeProfileDirectory(options.profileDirectory),
      browserPreference,
      usingSeparate360Profile: false
    };
  }

  const requestedUserDataDir = resolveEdgeUserDataDir(options.userDataDir);
  const usingSeparate360Profile = shouldUseSeparate360Profile(browserName, requestedUserDataDir);
  return {
    browserExecutable,
    browserName,
    userDataDir: usingSeparate360Profile
      ? resolve360UserDataDir(requestedUserDataDir)
      : requestedUserDataDir,
    profileDirectory: resolveEdgeProfileDirectory(options.profileDirectory),
    browserPreference,
    usingSeparate360Profile
  };
}

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
        res.on('data', (chunk) => {
          data += chunk;
        });
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
  const runtime = resolveAutoEdgeRuntime(options);
  const edgeExecutable = runtime.browserExecutable;
  const browserName = runtime.browserName;
  if (!edgeExecutable) {
    throw new Error('未找到 Edge 或 360 浏览器，无法启动浏览器采集会话');
  }

  const userDataDir = runtime.userDataDir;
  const profileDirectory = runtime.profileDirectory;
  const port = Number(options.port || 9222);
  const headless = toBoolean(options.headless, true);
  const url = options.url || 'about:blank';
  const timeoutMs = Number(options.timeoutMs || 15000);

  fs.mkdirSync(userDataDir, { recursive: true });

  const launchArgs = [
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (headless) {
    launchArgs.push('--disable-gpu', '--headless=new', '--no-startup-window');
  } else {
    launchArgs.push(
      '--new-window',
      '--window-position=-32000,-32000',
      '--window-size=1280,900',
      '--start-minimized'
    );
  }

  launchArgs.push(
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`
  );

  if (!headless) {
    launchArgs.push(url);
  }

  const child = spawn(edgeExecutable, launchArgs, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  child.unref();

  let wsUrl = '';
  try {
    wsUrl = await waitForDebuggerEndpoint(port, timeoutMs);
  } catch (error) {
    killProcessTree(child.pid);
    killBrowserProcessesByCommandLine({
      browserExecutable: edgeExecutable,
      port,
      userDataDir
    });
    throw error;
  }
  console.error(
    `[auto-edge] 后台 ${browserName} 已启动 (PID: ${child.pid}, 端口: ${port}, headless: ${headless})`
  );
  const result = {
    pid: child.pid,
    port,
    wsUrl,
    headless,
    browserName,
    browserExecutable: edgeExecutable,
    userDataDir,
    profileDirectory,
    usingSeparate360Profile: runtime.usingSeparate360Profile
  };
  return result;
}

function closeAutoEdge(target, details = {}) {
  const closeTarget =
    target && typeof target === 'object' ? target : { ...details, pid: target };
  const pid = closeTarget.pid;
  if (!pid) {
    return;
  }
  const killedByPid = killProcessTree(pid);
  const killedByCommandLine = killBrowserProcessesByCommandLine(closeTarget);
  if (killedByPid || killedByCommandLine) {
    const browserName =
      closeTarget.browserName || getBrowserDisplayName(closeTarget.browserExecutable);
    console.error(`[auto-edge] ${browserName} (PID: ${pid}) 已关闭`);
  }
}

async function runInteractiveEdgeLoginPrep(options = {}) {
  const runtime = resolveAutoEdgeRuntime(options);
  const edgeExecutable = runtime.browserExecutable;
  const browserName = runtime.browserName;
  if (!edgeExecutable) {
    throw new Error('未找到 Edge 或 360 浏览器，无法启动首次登录准备');
  }

  const userDataDir = runtime.userDataDir;
  const profileDirectory = runtime.profileDirectory;
  const port = Number(options.port || 9222);
  const url = options.url || 'https://hotels.ctrip.com/';

  fs.mkdirSync(userDataDir, { recursive: true });

  console.error(
    `[auto-edge] 未检测到可复用的登录资料，已打开一次可见 ${browserName} 窗口。请先登录携程，完成后关闭该窗口，当前任务会继续。`
  );

  await new Promise((resolve, reject) => {
    const child = spawn(
      edgeExecutable,
      [
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        `--profile-directory=${profileDirectory}`,
        url
      ],
      {
        stdio: 'ignore',
        detached: false,
        windowsHide: false
      }
    );

    child.on('error', reject);
    child.on('exit', () => resolve());
  });

  const loginConfirmed = hasReusableEdgeProfile(userDataDir, profileDirectory);
  if (loginConfirmed) {
    console.error('[auto-edge] 首次登录准备已完成，继续后台采集。');
  } else {
    console.error(
      `[auto-edge] 可见 ${browserName} 窗口已关闭，但尚未检测到明确的可复用资料；若后续仍提示登录，请重新完成一次登录。`
    );
  }

  return {
    success: true,
    loginConfirmed,
    browserName,
    userDataDir,
    profileDirectory
  };
}

module.exports = {
  closeAutoEdge,
  hasReusableEdgeProfile,
  launchAndWaitForEdge,
  resolveAutoEdgeRuntime,
  runInteractiveEdgeLoginPrep,
  waitForDebuggerEndpoint
};
