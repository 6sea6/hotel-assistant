const fs = require('fs');
const path = require('path');

const DEFAULT_RUNTIME_ARTIFACT_PATHS = [
  'output',
  'state',
  'scraper-data',
  'logs',
  'coverage',
  '.nyc_output',
  '.cache',
  '.playwright-cli',
  '_first_launch_verify',
  'dist-smoke',
  path.join('scraper', 'output'),
  path.join('scraper', 'state'),
  path.join('scraper', 'scraper-data'),
  path.join('scraper', 'logs')
];

function isInsideOrSame(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getPathSize(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    total += getPathSize(path.join(targetPath, entry.name));
  }
  return total;
}

function normalizeRuntimeArtifactPath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (!normalized || normalized === '.' || path.isAbsolute(normalized)) {
    throw new Error(`Invalid runtime artifact path: ${relativePath}`);
  }
  return normalized;
}

function buildCleanupCandidate(projectRoot, relativePath) {
  const normalizedRoot = path.resolve(projectRoot);
  const normalizedRelativePath = normalizeRuntimeArtifactPath(relativePath);
  const targetPath = path.resolve(normalizedRoot, normalizedRelativePath);

  if (!isInsideOrSame(normalizedRoot, targetPath)) {
    throw new Error(`Refusing to clean outside project root: ${relativePath}`);
  }

  return {
    relativePath: normalizedRelativePath,
    path: targetPath,
    exists: fs.existsSync(targetPath),
    bytes: getPathSize(targetPath)
  };
}

function cleanupRuntimeArtifacts({
  projectRoot = path.resolve(__dirname, '..'),
  runtimeArtifactPaths = DEFAULT_RUNTIME_ARTIFACT_PATHS,
  dryRun = false
} = {}) {
  const normalizedRoot = path.resolve(projectRoot);
  const candidates = runtimeArtifactPaths.map((relativePath) =>
    buildCleanupCandidate(normalizedRoot, relativePath)
  );
  const existingCandidates = candidates.filter((item) => item.exists);
  const removed = [];

  if (!dryRun) {
    for (const candidate of existingCandidates) {
      fs.rmSync(candidate.path, { recursive: true, force: true });
      removed.push(candidate);
    }
  }

  return {
    projectRoot: normalizedRoot,
    dryRun: Boolean(dryRun),
    candidates,
    removed,
    totalBytes: existingCandidates.reduce((sum, item) => sum + item.bytes, 0)
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run') || argv.includes('-n');
  const result = cleanupRuntimeArtifacts({ dryRun });
  const action = dryRun ? 'Would remove' : 'Removed';
  const items = dryRun ? result.candidates.filter((item) => item.exists) : result.removed;

  if (items.length === 0) {
    console.log('No runtime artifacts found.');
    return result;
  }

  for (const item of items) {
    console.log(`${action}: ${item.relativePath} (${formatBytes(item.bytes)})`);
  }
  console.log(`Total: ${formatBytes(result.totalBytes)}`);
  return result;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_RUNTIME_ARTIFACT_PATHS,
  cleanupRuntimeArtifacts,
  formatBytes,
  main
};
