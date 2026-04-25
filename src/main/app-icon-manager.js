const fs = require('fs');
const path = require('path');
const storeManager = require('./store-manager');

const MANAGED_ICON_PREFIX = 'managed:';
const MANAGED_ICON_DIR = 'assets';
const MANAGED_ICON_BASENAME = 'app-icon';
const ALLOWED_EXTENSIONS = new Set(['.ico', '.png', '.jpg', '.jpeg', '.bmp', '.webp']);

function getDataFolderPath() {
  const dataFolderManager = storeManager.getDataFolderManager();
  const dataFolder = dataFolderManager.getDataFolderPath();
  dataFolderManager.ensureDataFolder(dataFolder);
  return dataFolder;
}

function getManagedIconDirectory() {
  const iconDirectory = path.join(getDataFolderPath(), MANAGED_ICON_DIR);
  if (!fs.existsSync(iconDirectory)) {
    fs.mkdirSync(iconDirectory, { recursive: true });
  }
  return iconDirectory;
}

function normalizeExtension(extension = '') {
  return String(extension || '').trim().toLowerCase();
}

function toPosixPath(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/');
}

function ensureAllowedExtension(filePath) {
  const extension = normalizeExtension(path.extname(filePath));
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('不支持的图标格式');
  }
  return extension;
}

function isManagedIconReference(storedPath = '') {
  return String(storedPath || '').trim().startsWith(MANAGED_ICON_PREFIX);
}

function buildManagedIconReference(extension) {
  return `${MANAGED_ICON_PREFIX}${MANAGED_ICON_DIR}/${MANAGED_ICON_BASENAME}${normalizeExtension(extension)}`;
}

function resolveStoredIconPath(storedPath = '') {
  const normalizedStoredPath = String(storedPath || '').trim();
  if (!normalizedStoredPath) {
    return '';
  }

  if (isManagedIconReference(normalizedStoredPath)) {
    const relativePath = normalizedStoredPath.slice(MANAGED_ICON_PREFIX.length).replace(/\//g, path.sep);
    return path.join(getDataFolderPath(), relativePath);
  }

  return normalizedStoredPath;
}

function toManagedIconReference(storedPath = '') {
  const normalizedStoredPath = String(storedPath || '').trim();
  if (!normalizedStoredPath) {
    return '';
  }

  if (isManagedIconReference(normalizedStoredPath)) {
    return normalizedStoredPath;
  }

  if (!path.isAbsolute(normalizedStoredPath)) {
    return '';
  }

  const relativePath = path.relative(path.resolve(getDataFolderPath()), path.resolve(normalizedStoredPath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return '';
  }

  return `${MANAGED_ICON_PREFIX}${toPosixPath(relativePath)}`;
}

function listManagedIconFiles() {
  const iconDirectory = getManagedIconDirectory();
  return fs.readdirSync(iconDirectory)
    .filter((fileName) => {
      const extension = normalizeExtension(path.extname(fileName));
      return fileName.startsWith(`${MANAGED_ICON_BASENAME}.`) && ALLOWED_EXTENSIONS.has(extension);
    })
    .map((fileName) => path.join(iconDirectory, fileName));
}

function cleanupManagedIconFiles(keepAbsolutePath = '') {
  const keepPath = keepAbsolutePath ? path.resolve(keepAbsolutePath) : '';
  for (const filePath of listManagedIconFiles()) {
    if (keepPath && path.resolve(filePath) === keepPath) {
      continue;
    }
    fs.rmSync(filePath, { force: true });
  }
}

function writeManagedIconFromBuffer(buffer, extension, originalFileName = '') {
  const managedReference = buildManagedIconReference(extension);
  const targetPath = resolveStoredIconPath(managedReference);
  const temporaryPath = `${targetPath}.tmp`;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(temporaryPath, buffer);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
  fs.renameSync(temporaryPath, targetPath);
  cleanupManagedIconFiles(targetPath);

  return {
    path: managedReference,
    activePath: targetPath,
    fileName: originalFileName || path.basename(targetPath),
    isManaged: true
  };
}

// 自定义图标一律复制到当前数据目录内，避免继续依赖桌面、下载目录等外部路径。
function persistCustomIcon(sourcePath, originalFileName = '') {
  const normalizedSourcePath = String(sourcePath || '').trim();
  if (!normalizedSourcePath || !fs.existsSync(normalizedSourcePath)) {
    throw new Error('图标文件不存在');
  }

  const extension = ensureAllowedExtension(normalizedSourcePath);
  const buffer = fs.readFileSync(normalizedSourcePath);
  return writeManagedIconFromBuffer(buffer, extension, originalFileName || path.basename(normalizedSourcePath));
}

function removeManagedIcon() {
  cleanupManagedIconFiles();
}

function readCustomIconExportPayload(settings = {}) {
  const storedPath = resolveStoredIconPath(settings.app_icon_path || '');
  if (!storedPath || !fs.existsSync(storedPath)) {
    return null;
  }

  const extension = ensureAllowedExtension(storedPath);
  return {
    fileName: settings.app_icon_file_name || path.basename(storedPath),
    extension: extension.slice(1),
    data: fs.readFileSync(storedPath).toString('base64')
  };
}

function restoreExportedIcon(iconPayload) {
  if (!iconPayload || typeof iconPayload !== 'object') {
    throw new Error('导出图标数据格式不正确');
  }

  const normalizedExtension = normalizeExtension(`.${iconPayload.extension || ''}`);
  if (!ALLOWED_EXTENSIONS.has(normalizedExtension)) {
    throw new Error('导出图标格式不受支持');
  }

  const buffer = Buffer.from(String(iconPayload.data || ''), 'base64');
  if (!buffer.length) {
    throw new Error('导出图标内容为空');
  }

  return writeManagedIconFromBuffer(buffer, normalizedExtension, iconPayload.fileName || '自定义图标');
}

function captureManagedIconSnapshot(settings = {}) {
  const managedReference = toManagedIconReference(settings.app_icon_path || '');
  if (!managedReference) {
    return null;
  }

  const absolutePath = resolveStoredIconPath(managedReference);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return null;
  }

  return {
    path: managedReference,
    fileName: settings.app_icon_file_name || path.basename(absolutePath),
    extension: normalizeExtension(path.extname(absolutePath)).slice(1),
    data: fs.readFileSync(absolutePath).toString('base64')
  };
}

function restoreManagedIconSnapshot(snapshot) {
  if (!snapshot) {
    removeManagedIcon();
    return null;
  }

  return restoreExportedIcon(snapshot);
}

module.exports = {
  MANAGED_ICON_PREFIX,
  isManagedIconReference,
  resolveStoredIconPath,
  toManagedIconReference,
  persistCustomIcon,
  removeManagedIcon,
  readCustomIconExportPayload,
  restoreExportedIcon,
  captureManagedIconSnapshot,
  restoreManagedIconSnapshot
};