const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function getFinalSetupName(buildMode, version) {
  if (buildMode === '2') {
    return `宾馆比较终极版-完整版-${version}.exe`;
  }
  return `宾馆比较终极版-基础版-${version}.exe`;
}

function findSetupExecutable(tempBuildDir) {
  const entries = fs.readdirSync(tempBuildDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(tempBuildDir, entry.name);
      return {
        name: entry.name,
        fullPath,
        stat: fs.statSync(fullPath),
      };
    })
    .filter((entry) => entry.name.toLowerCase().endsWith('.exe') && /setup/i.test(entry.name))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  return entries[0] || null;
}

function main() {
  const [tempBuildDir, distDir, appVersion, buildMode] = process.argv.slice(2);
  if (!tempBuildDir || !distDir || !appVersion || !buildMode) {
    fail('Usage: node scripts/finalize-nsis-output.js <tempBuildDir> <distDir> <appVersion> <buildMode>');
  }

  if (!fs.existsSync(tempBuildDir)) {
    fail(`Build output directory not found: ${tempBuildDir}`);
  }

  const sourceSetup = findSetupExecutable(tempBuildDir);
  if (!sourceSetup) {
    fail(`No NSIS setup executable found in: ${tempBuildDir}`);
  }

  fs.mkdirSync(distDir, { recursive: true });

  const finalSetupName = getFinalSetupName(buildMode, appVersion);
  const targetSetupPath = path.join(distDir, finalSetupName);
  const lastSetupFilePath = path.join(distDir, 'last-successful-setup.txt');

  if (fs.existsSync(targetSetupPath)) {
    fs.rmSync(targetSetupPath, { force: true });
  }

  fs.copyFileSync(sourceSetup.fullPath, targetSetupPath);

  const relativeSetupPath = path.relative(process.cwd(), targetSetupPath).replaceAll('/', '\\');
  fs.writeFileSync(lastSetupFilePath, `${relativeSetupPath}\r\n`, 'utf8');

  process.stdout.write(`${targetSetupPath}\n`);
}

main();
