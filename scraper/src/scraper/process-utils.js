const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hideProcessWindows(pid) {
  if (process.platform !== 'win32' || !pid) {
    return;
  }

  const script = [
    '$signature = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class WindowHider {',
    '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null',
    `[WindowHider]::EnumWindows({ param($hWnd, $lParam)`,
    '  $currentPid = 0',
    '  [WindowHider]::GetWindowThreadProcessId($hWnd, [ref]$currentPid) | Out-Null',
    `  if ($currentPid -eq ${Number(pid)} -and [WindowHider]::IsWindowVisible($hWnd)) {`,
    '    [WindowHider]::ShowWindowAsync($hWnd, 0) | Out-Null',
    '  }',
    '  return $true',
    '}, [IntPtr]::Zero) | Out-Null'
  ].join('; ');

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    }
  );

  child.on('error', () => undefined);
  child.unref();
}

function scheduleProcessWindowHide(pid) {
  if (!pid) {
    return;
  }

  [0, 400, 1200].forEach((delayMs) => {
    const timer = setTimeout(() => hideProcessWindows(pid), delayMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
}

function killProcessTree(pid) {
  if (!pid) {
    return false;
  }

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    if (!result.error && result.status === 0) {
      return true;
    }
  }

  try {
    process.kill(pid);
    return true;
  } catch (_error) {
    return false;
  }
}

function toPowerShellSingleQuoted(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function killBrowserProcessesByCommandLine(options = {}) {
  const userDataDir = String(options.userDataDir || '').trim();
  const port = options.port ? String(options.port) : '';
  const executablePath = String(options.browserExecutable || options.executablePath || '').trim();
  if (process.platform !== 'win32' || (!userDataDir && !port)) {
    return false;
  }

  const script = [
    `$userDataDir = ${toPowerShellSingleQuoted(userDataDir)}`,
    `$port = ${toPowerShellSingleQuoted(port)}`,
    `$executablePath = ${toPowerShellSingleQuoted(executablePath)}`,
    '$killed = 0',
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $cmd = [string]$_.CommandLine',
    '  $exe = [string]$_.ExecutablePath',
    '  if (-not $cmd) { return $false }',
    '  $portMatch = $port -and $cmd.Contains("--remote-debugging-port=$port")',
    '  $profileMatch = $userDataDir -and $cmd.Contains($userDataDir)',
    '  $exeMatch = -not $executablePath -or $exe -eq $executablePath',
    '  return $exeMatch -and ($portMatch -or $profileMatch)',
    '} | ForEach-Object {',
    '  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue',
    '  $killed += 1',
    '}',
    'Write-Output $killed'
  ].join('; ');

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  );
  const killedCount = Number(String(result.stdout || '').trim());
  return Number.isFinite(killedCount) && killedCount > 0;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean))];
}

function getWindowsDriveRoots(env = process.env) {
  const roots = [
    env.SystemDrive ? `${env.SystemDrive.replace(/[\\/]$/, '')}\\` : '',
    env.HOMEDRIVE ? `${env.HOMEDRIVE.replace(/[\\/]$/, '')}\\` : '',
    path.parse(process.cwd()).root,
    'C:\\',
    'D:\\',
    'E:\\'
  ];

  for (const key of ['PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA']) {
    if (env[key]) {
      roots.push(path.parse(env[key]).root);
    }
  }

  return uniqueNonEmpty(roots);
}

function getBrowserDisplayName(executablePath = '') {
  const normalizedName = path.basename(String(executablePath || '')).toLowerCase();
  const normalizedPath = String(executablePath || '').toLowerCase();
  if (normalizedName === 'msedge.exe' || normalizedPath.includes('\\microsoft\\edge\\')) {
    return 'Edge';
  }
  if (normalizedName.includes('360')) {
    return '360 Browser';
  }
  if (normalizedName.includes('chrome')) {
    return 'Chrome';
  }
  return 'Chromium Browser';
}

function normalizeBrowserPreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === '360' || normalized === '360-browser' || normalized === '360browser') {
    return '360';
  }
  if (normalized === 'auto') {
    return 'auto';
  }
  return normalized === 'edge' ? 'edge' : '';
}

function buildChromiumBrowserCandidates(options = {}) {
  const env = options.env || process.env;
  const driveRoots = Array.isArray(options.driveRoots)
    ? options.driveRoots
    : getWindowsDriveRoots(env);
  const directExecutableCandidates = [
    env.HOTEL_COLLECTOR_BROWSER_EXECUTABLE,
    env.CTRIP_BROWSER_EXECUTABLE,
    env['360_BROWSER_EXECUTABLE'],
    env.EDGE_EXECUTABLE,
    env.MSEDGE_EXECUTABLE
  ].filter(Boolean);
  const installRoots = uniqueNonEmpty([
    env['PROGRAMFILES(X86)'],
    env.PROGRAMFILES,
    env.LOCALAPPDATA,
    env.APPDATA
  ]);

  const candidates = directExecutableCandidates.map((executablePath) => ({
    executablePath,
    browserName: getBrowserDisplayName(executablePath)
  }));

  [
    env['PROGRAMFILES(X86)']
      ? path.join(
          env['PROGRAMFILES(X86)'],
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        )
      : '',
    env.PROGRAMFILES
      ? path.join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : '',
    env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : ''
  ]
    .filter(Boolean)
    .forEach((executablePath) => candidates.push({ executablePath, browserName: 'Edge' }));

  for (const root of installRoots) {
    [
      path.join(root, '360', '360se6', 'Application', '360se.exe'),
      path.join(root, '360se6', 'Application', '360se.exe'),
      path.join(root, '360', '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
      path.join(root, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
      path.join(root, '360', '360ChromeX', 'Chrome', 'Application', '360ChromeX.exe'),
      path.join(root, '360ChromeX', 'Chrome', 'Application', '360ChromeX.exe')
    ].forEach((executablePath) => {
      candidates.push({ executablePath, browserName: '360 Browser' });
    });
  }

  for (const root of driveRoots) {
    [
      path.join(root, '360se6', 'Application', '360se.exe'),
      path.join(root, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
      path.join(root, '360ChromeX', 'Chrome', 'Application', '360ChromeX.exe')
    ].forEach((executablePath) => {
      candidates.push({ executablePath, browserName: '360 Browser' });
    });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = String(candidate.executablePath || '').toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function findChromiumBrowserExecutable(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const browserPreference = normalizeBrowserPreference(
    options.browserPreference || options.preferredBrowser || options.browser
  );
  const candidates = buildChromiumBrowserCandidates(options);
  const searchGroups =
    browserPreference === '360'
      ? [candidates.filter((candidate) => candidate.browserName === '360 Browser')]
      : browserPreference === 'edge'
        ? [
            candidates.filter((candidate) => candidate.browserName === 'Edge'),
            candidates.filter((candidate) => candidate.browserName !== 'Edge')
          ]
        : [candidates];

  for (const group of searchGroups) {
    for (const candidate of group) {
      if (existsSync(candidate.executablePath)) {
        return candidate;
      }
    }
  }
  return { executablePath: '', browserName: '' };
}

function findStrictBrowserExecutable(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const browserPreference = normalizeBrowserPreference(
    options.browserPreference || options.preferredBrowser || options.browser
  );
  const candidates = buildChromiumBrowserCandidates(options).filter((candidate) => {
    if (browserPreference === '360') {
      return candidate.browserName === '360 Browser';
    }
    if (browserPreference === 'edge') {
      return candidate.browserName === 'Edge';
    }
    return true;
  });
  for (const candidate of candidates) {
    if (existsSync(candidate.executablePath)) {
      return candidate;
    }
  }
  return { executablePath: '', browserName: '' };
}

function findEdgeExecutable(options = {}) {
  const browser = findChromiumBrowserExecutable(options);
  return browser.executablePath || '';
}

function findEdgeBrowserName(options = {}) {
  const browser = findChromiumBrowserExecutable(options);
  return browser.browserName || '';
}

function find360BrowserExecutable(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  for (const candidate of buildChromiumBrowserCandidates(options)) {
    if (candidate.browserName === '360 Browser' && existsSync(candidate.executablePath)) {
      return candidate.executablePath;
    }
  }
  return '';
}

module.exports = {
  delay,
  hideProcessWindows,
  scheduleProcessWindowHide,
  killBrowserProcessesByCommandLine,
  killProcessTree,
  buildChromiumBrowserCandidates,
  find360BrowserExecutable,
  findChromiumBrowserExecutable,
  findEdgeBrowserName,
  findEdgeExecutable,
  findStrictBrowserExecutable,
  getBrowserDisplayName,
  normalizeBrowserPreference
};
