const fs = require('fs');
const { spawn } = require('child_process');
const { parseArgs } = require('./utils');
const {
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
} = require('./edge-runtime');
const {
  findChromiumBrowserExecutable,
  getBrowserDisplayName,
  normalizeBrowserPreference
} = require('./scraper/process-utils');

function printHelp() {
  console.log(`
用法:
  node src/edge-session.js --login
  node src/edge-session.js --userDataDir ./state/edge-profile --profileDirectory Default --port 9222 --url https://hotels.ctrip.com/

说明:
  这个脚本用于初始化或保持一个可复用的 Edge/360 登录会话。
  推荐先运行一次 --login，在打开的浏览器中登录携程；之后采集脚本即可复用该 profile。

可选参数:
  --login                        以可见窗口启动，方便手工登录并保存会话
  --userDataDir <路径>           Edge 用户数据目录，默认 ./state/edge-profile
  --profileDirectory <名称>      Profile 名称，默认 Default
  --port <端口>                  远程调试端口，默认 9222
  --url <地址>                   启动后打开的页面，默认 https://hotels.ctrip.com/
  --browser <edge|360|auto>       浏览器选择，默认自动发现
  --headless <true|false>        非 login 模式下是否 headless，默认 false
  --help                         显示帮助
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const browser = findChromiumBrowserExecutable({
    browserPreference: normalizeBrowserPreference(args.browser || args['browser-preference'])
  });
  const edgeExecutable = browser.executablePath;
  const browserName = browser.browserName || getBrowserDisplayName(edgeExecutable);
  if (!edgeExecutable) {
    throw new Error('未找到 Edge 或 360 浏览器，无法启动浏览器会话');
  }

  const userDataDir = resolveEdgeUserDataDir(args.userDataDir || args['user-data-dir']);
  const profileDirectory = resolveEdgeProfileDirectory(
    args.profileDirectory || args['profile-directory']
  );
  const port = Number(args.port || 9222);
  const loginMode = Boolean(args.login);
  const headless = loginMode ? false : toBoolean(args.headless, false);
  const url = args.url || 'https://hotels.ctrip.com/';

  fs.mkdirSync(userDataDir, { recursive: true });

  const launchArgs = [
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`
  ];

  if (headless) {
    launchArgs.push('--headless=new', '--disable-gpu');
  }

  launchArgs.push(url);

  const child = spawn(edgeExecutable, launchArgs, {
    stdio: 'ignore',
    detached: true,
    windowsHide: false
  });
  child.unref();

  const summary = {
    mode: loginMode ? 'login' : 'session',
    browserName,
    edgeExecutable,
    userDataDir,
    profileDirectory,
    port,
    url,
    headless,
    pid: child.pid,
    attachHint: `在采集模板或命令里填写 edge_debugging_port=${port}，或复用 edge_user_data_dir=${userDataDir}`
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
