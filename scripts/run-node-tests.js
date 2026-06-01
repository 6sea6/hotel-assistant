const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'dist']);

/**
 * @param {string} rootDir
 * @returns {string[]}
 */
function findNodeTestFiles(rootDir) {
  const root = path.resolve(rootDir);
  const files = [];

  /**
   * @param {string} dir
   * @returns {void}
   */
  function walk(dir) {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        files.push(path.join(dir, entry.name));
      }
    }
  }

  walk(root);
  return files;
}

/**
 * @param {string[]} roots
 * @returns {number}
 */
function main(roots) {
  const testRoots = roots.length > 0 ? roots : ['tests'];
  const testFiles = testRoots.flatMap((root) => findNodeTestFiles(root));

  if (testFiles.length === 0) {
    console.error(`No .test.js files found in: ${testRoots.join(', ')}`);
    return 1;
  }

  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return typeof result.status === 'number' ? result.status : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  findNodeTestFiles,
  main
};
