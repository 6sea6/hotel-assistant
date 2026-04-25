const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeIfExists(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyDirSync(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFileSync(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function runCommand(command, args, options = {}) {
  const needsWindowsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(command || ''));
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: needsWindowsShell,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

function resolveWindowsCommand(command) {
  return process.platform === 'win32' && !command.toLowerCase().endsWith('.cmd')
    ? `${command}.cmd`
    : command;
}

module.exports = {
  copyDirSync,
  copyFileSync,
  ensureDir,
  removeIfExists,
  resolveWindowsCommand,
  runCommand
};
