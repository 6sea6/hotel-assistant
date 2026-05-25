const path = require('path');

/**
 * services: data folder migration file-system operations shared by data IPC handlers and tests.
 *
 * @typedef {{DATA_FOLDER_NAME: string}} DataFolderPaths
 * @typedef {{name: string, isDirectory: () => boolean}} MigrationDirent
 * @typedef {{existsSync?: (target: string) => boolean, rmSync: (target: string, options: {recursive: boolean, force: boolean}) => void, mkdirSync?: (target: string, options: {recursive: boolean}) => void, readdirSync?: (target: string, options: {withFileTypes: true}) => MigrationDirent[], copyFileSync?: (source: string, target: string) => void}} MigrationFs
 * @typedef {{ensureDataFolder: (folder: string) => void, saveDataFolderPath: (folder: string) => void}} MigrationDataFolderManager
 * @typedef {{reinitializeStore: (folder: string) => void, getStore: () => {path?: string}}} MigrationDataService
 * @typedef {{path: string|undefined}} MigrationResult
 */

/**
 * @param {string} selectedDir
 * @param {DataFolderPaths} paths
 * @returns {string}
 */
function buildTargetDataFolder(selectedDir, paths) {
  return path.join(selectedDir, paths.DATA_FOLDER_NAME);
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function isSameResolvedPath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

/**
 * @param {{fs: MigrationFs, targetFolder: string, overwrite: boolean}} options
 * @returns {{exists: boolean, removed: boolean}}
 */
function prepareTargetFolder({ fs: fsModule, targetFolder, overwrite }) {
  const exists =
    typeof fsModule.existsSync === 'function' ? fsModule.existsSync(targetFolder) : false;

  if (!exists) {
    return { exists: false, removed: false };
  }

  if (!overwrite) {
    return { exists: true, removed: false };
  }

  fsModule.rmSync(targetFolder, { recursive: true, force: true });
  return { exists: true, removed: true };
}

/**
 * @param {{fs: MigrationFs, sourceFolder: string, targetFolder: string}} options
 * @returns {void}
 */
function copyDataFolderRecursive({ fs: fsModule, sourceFolder, targetFolder }) {
  if (
    typeof fsModule.mkdirSync !== 'function' ||
    typeof fsModule.readdirSync !== 'function' ||
    typeof fsModule.copyFileSync !== 'function'
  ) {
    throw new Error('文件复制能力不可用');
  }

  fsModule.mkdirSync(targetFolder, { recursive: true });
  for (const entry of fsModule.readdirSync(sourceFolder, { withFileTypes: true })) {
    const sourcePath = path.join(sourceFolder, entry.name);
    const targetPath = path.join(targetFolder, entry.name);
    if (entry.isDirectory()) {
      copyDataFolderRecursive({
        fs: fsModule,
        sourceFolder: sourcePath,
        targetFolder: targetPath
      });
      continue;
    }

    fsModule.copyFileSync(sourcePath, targetPath);
  }
}

/**
 * @param {{
 *   fs: MigrationFs,
 *   dataFolderManager: MigrationDataFolderManager,
 *   dataService: MigrationDataService,
 *   currentDataFolder: string,
 *   targetDataFolder: string
 * }} options
 * @returns {MigrationResult}
 */
function migrateDataFolder({
  fs: fsModule,
  dataFolderManager,
  dataService,
  currentDataFolder,
  targetDataFolder
}) {
  dataFolderManager.ensureDataFolder(currentDataFolder);
  copyDataFolderRecursive({
    fs: fsModule,
    sourceFolder: currentDataFolder,
    targetFolder: targetDataFolder
  });
  dataFolderManager.saveDataFolderPath(targetDataFolder);
  dataService.reinitializeStore(targetDataFolder);

  return {
    path: dataService.getStore().path
  };
}

/**
 * @param {{fs: MigrationFs, oldPath: string}} options
 * @returns {void}
 */
function deleteOldDataFolder({ fs: fsModule, oldPath }) {
  fsModule.rmSync(oldPath, { recursive: true, force: true });
}

module.exports = {
  buildTargetDataFolder,
  copyDataFolderRecursive,
  deleteOldDataFolder,
  isSameResolvedPath,
  migrateDataFolder,
  prepareTargetFolder
};
