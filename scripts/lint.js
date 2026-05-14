const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CHECK_ROOTS = [
  'src',
  'shared',
  'scripts',
  'tests',
  path.join('scraper', 'src'),
  path.join('scraper', 'tests')
];
const SKIP_DIRS = new Set([
  '.git',
  '.github',
  'node_modules',
  'coverage',
  'dist',
  'dist-smoke',
  'build',
  'scraper-data'
]);

function isModuleSource(source) {
  return /^\s*(?:import|export)\s/m.test(source);
}

function collectJavaScriptFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) return [];
      return collectJavaScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function checkFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const result = isModuleSource(source)
    ? spawnSync(process.execPath, ['--check', '--input-type=module'], {
      cwd: PROJECT_ROOT,
      input: source,
      encoding: 'utf8'
    })
    : spawnSync(process.execPath, ['--check', filePath], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });

  if (result.status === 0) {
    return null;
  }

  return {
    file: relativePath,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  };
}

const files = CHECK_ROOTS.flatMap((root) => collectJavaScriptFiles(path.join(PROJECT_ROOT, root)));
const failures = files.map(checkFile).filter(Boolean);

if (failures.length > 0) {
  console.error(`lint failed: ${failures.length} JavaScript file(s) have syntax errors.`);
  failures.forEach((failure) => {
    console.error(`\n--- ${failure.file} ---`);
    console.error(failure.output);
  });
  process.exit(1);
}

console.log(`lint passed: checked ${files.length} JavaScript files.`);
