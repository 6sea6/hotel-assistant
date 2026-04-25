const fs = require('fs');
const os = require('os');
const path = require('path');

function getAppDataRoot(appDataRoot) {
  return appDataRoot || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

function getPointerFilePath({ appDataRoot, pointerFileName }) {
  return path.join(getAppDataRoot(appDataRoot), pointerFileName);
}

function readPointerDataFolder(pointerFilePath) {
  try {
    if (!pointerFilePath || !fs.existsSync(pointerFilePath)) {
      return '';
    }

    const pointer = JSON.parse(fs.readFileSync(pointerFilePath, 'utf-8'));
    return typeof pointer.dataFolder === 'string' && path.isAbsolute(pointer.dataFolder)
      ? pointer.dataFolder
      : '';
  } catch (error) {
    console.error('[compare-app:data-folder] 读取指针文件失败:', error);
    return '';
  }
}

function writePointerDataFolder(pointerFilePath, dataFolderPath) {
  fs.mkdirSync(path.dirname(pointerFilePath), { recursive: true });
  fs.writeFileSync(pointerFilePath, JSON.stringify({ dataFolder: dataFolderPath }, null, 2));
}

function getLegacyDataFolderPath({ appDataRoot, appFolderName }) {
  return path.join(getAppDataRoot(appDataRoot), appFolderName);
}

function getInstalledDataFolderPath({ execPath, executableDir, appFolderName }) {
  const resolvedExecutableDir = executableDir || (execPath ? path.dirname(execPath) : '');
  return resolvedExecutableDir ? path.join(resolvedExecutableDir, appFolderName) : '';
}

function looksLikeManagedAppExecutable(execPath) {
  const executableName = path.basename(execPath || '').toLowerCase();
  return Boolean(executableName)
    && !['node', 'node.exe', 'electron', 'electron.exe'].includes(executableName);
}

function pickFirstExistingPath(candidates = []) {
  return candidates.find((candidatePath) => candidatePath && fs.existsSync(candidatePath)) || '';
}

module.exports = {
  getAppDataRoot,
  getInstalledDataFolderPath,
  getLegacyDataFolderPath,
  getPointerFilePath,
  looksLikeManagedAppExecutable,
  pickFirstExistingPath,
  readPointerDataFolder,
  writePointerDataFolder
};
