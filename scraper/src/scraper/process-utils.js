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

function findEdgeExecutable() {
  const candidates = [
    process.env['PROGRAMFILES(X86)']
      ? path.join(
          process.env['PROGRAMFILES(X86)'],
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        )
      : '',
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : '',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : ''
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

module.exports = {
  delay,
  hideProcessWindows,
  scheduleProcessWindowHide,
  killProcessTree,
  findEdgeExecutable
};
