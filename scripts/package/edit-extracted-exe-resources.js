const fs = require('fs');
const path = require('path');
const { executeAppBuilder } = require('builder-util');

function getBuildResourcesDir(projectRoot, packageJson) {
  const configured = packageJson?.build?.directories?.buildResources || 'build';
  return path.resolve(projectRoot, configured);
}

function toWindowsProductVersion(version) {
  const parts = String(version || '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .slice(0, 4);

  while (parts.length < 4) {
    parts.push('0');
  }

  return parts.join('.');
}

function getProductName(packageJson) {
  return packageJson?.build?.productName || packageJson?.productName || packageJson?.name || '';
}

function getCompanyName(packageJson) {
  if (!packageJson?.author) {
    return '';
  }
  if (typeof packageJson.author === 'string') {
    return packageJson.author;
  }
  return packageJson.author.name || '';
}

function buildRceditArgs({ executablePath, iconPath, packageJson }) {
  const productName = getProductName(packageJson);
  const version = packageJson?.version || '0.0.0';
  const args = [
    executablePath,
    '--set-version-string',
    'FileDescription',
    productName,
    '--set-version-string',
    'ProductName',
    productName,
    '--set-file-version',
    version,
    '--set-product-version',
    toWindowsProductVersion(version),
    '--set-version-string',
    'InternalName',
    productName,
    '--set-version-string',
    'OriginalFilename',
    ''
  ];

  const copyright = packageJson?.build?.copyright;
  if (copyright) {
    args.push('--set-version-string', 'LegalCopyright', copyright);
  }

  const companyName = getCompanyName(packageJson);
  if (companyName) {
    args.push('--set-version-string', 'CompanyName', companyName);
  }

  args.push('--set-icon', iconPath);
  return args;
}

function findExtractedExecutable({ appOutDir, packageJson }) {
  const projectName = packageJson?.build?.electronBranding?.projectName || 'electron';
  const candidates = [`${projectName}.exe`, 'electron.exe'].map((name) =>
    path.join(appOutDir, name)
  );
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

async function editExtractedExeResources(context, options = {}) {
  if (context.electronPlatformName && context.electronPlatformName !== 'win32') {
    return;
  }

  const projectRoot = context.packager?.projectDir || path.resolve(__dirname, '..', '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const executablePath =
    options.executablePath ||
    findExtractedExecutable({
      appOutDir: context.appOutDir,
      packageJson
    });
  const iconName = packageJson?.build?.win?.icon || 'icon.ico';
  const iconPath =
    options.iconPath || path.resolve(getBuildResourcesDir(projectRoot, packageJson), iconName);

  if (!fs.existsSync(executablePath)) {
    throw new Error(`未找到 Electron 解包后的 exe：${executablePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`未找到应用图标：${iconPath}`);
  }

  const args = buildRceditArgs({
    executablePath,
    iconPath,
    packageJson
  });
  const runner = options.runner || executeAppBuilder;
  await runner(['rcedit', '--args', JSON.stringify(args)], undefined, {}, 3);
}

module.exports = {
  default: editExtractedExeResources,
  buildRceditArgs,
  editExtractedExeResources,
  findExtractedExecutable,
  toWindowsProductVersion
};
