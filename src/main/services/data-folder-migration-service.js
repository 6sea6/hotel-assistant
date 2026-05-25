const path = require('path');

/**
 * services: data folder migration file-system operations shared by data IPC handlers and tests.
 *
 * @typedef {{DATA_FOLDER_NAME: string}} DataFolderPaths
 * @typedef {{existsSync?: (target: string) => boolean, rmSync: (target: string, options: {recursive: boolean, force: boolean}) => void, cpSync?: (source: string, target: string, options: {recursive: boolean, force: boolean}) => void}} MigrationFs
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
  if (typeof fsModule.cpSync !== 'function') {
    throw new Error('文件复制能力不可用');
  }
  fsModule.cpSync(currentDataFolder, targetDataFolder, { recursive: true, force: true });
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
  deleteOldDataFolder,
  isSameResolvedPath,
  migrateDataFolder,
  prepareTargetFolder
};
