const fs = require('fs');
const { monitorLoginConfirmation } = require('./login-confirmation');
const { getCtripAccessController } = require('../ctrip-access-controller');
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
  inspectReusableEdgeProfile,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
} = require('../edge-runtime');
const {
  buildBackgroundBrowserWindowArgs,
  buildVisibleBrowserWindowArgs,
  is360BrowserRuntime
} = require('../browser-launch-args');
const { waitForDebuggerEndpoint } = require('../debugger-endpoint');

function shouldUseSeparate360Profile(browserName, userDataDir) {
  if (browserName !== '360 Browser') {
    return false;
  }
  const normalized = String(userDataDir || '')
    .replace(/\\/g, '/')
    .toLowerCase();
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
    launchArgs.push(...buildBackgroundBrowserWindowArgs(runtime));
  } else {
    launchArgs.push(...buildVisibleBrowserWindowArgs());
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
    windowsHide: headless
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
  const closeTarget = target && typeof target === 'object' ? target : { ...details, pid: target };
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
    `[auto-edge] 未检测到可复用的登录资料，已打开一次可见 ${browserName} 窗口。请登录并确认房价，点击页面右下角的恢复采集按钮。若按钮无法确认，请手动刷新酒店页；关闭窗口不会恢复采集。`
  );

  const abort = new AbortController();
  const cancel = () => abort.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) abort.abort();
  let confirmation = { userConfirmed: false, pageVerified: false, loginConfirmed: false };
  const child = spawn(
    edgeExecutable,
    [
      '--no-first-run',
      '--no-default-browser-check',
      ...buildVisibleBrowserWindowArgs(),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--profile-directory=${profileDirectory}`,
      url
    ],
    { stdio: 'ignore', detached: false, windowsHide: false }
  );
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve(null));
  });
  try {
    confirmation =
      (await Promise.race([closed, monitorLoginConfirmation(port, abort.signal)])) || confirmation;
    if (confirmation.loginConfirmed) {
      getCtripAccessController(userDataDir).confirmRecovery(confirmation);
      closeAutoEdge({ pid: child.pid, port, userDataDir, browserExecutable: edgeExecutable });
    }
  } finally {
    abort.abort();
    options.signal?.removeEventListener('abort', cancel);
    if (options.signal?.aborted)
      closeAutoEdge({ pid: child.pid, port, userDataDir, browserExecutable: edgeExecutable });
  }
  const loginConfirmed = confirmation.loginConfirmed;

  return {
    success: true,
    loginConfirmed,
    userConfirmed: confirmation.userConfirmed,
    pageVerified: confirmation.pageVerified,
    browserName,
    userDataDir,
    profileDirectory
  };
}

module.exports = {
  buildBackgroundBrowserWindowArgs,
  buildVisibleBrowserWindowArgs,
  closeAutoEdge,
  hasReusableEdgeProfile,
  inspectReusableEdgeProfile,
  is360BrowserRuntime,
  launchAndWaitForEdge,
  resolveAutoEdgeRuntime,
  runInteractiveEdgeLoginPrep,
  waitForDebuggerEndpoint
};
