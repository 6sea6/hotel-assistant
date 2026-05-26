const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;
const { APP_INFO } = require('../src/shared/app-info.generated');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(PROJECT_ROOT, 'build');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');
const ICON_PATH = path.join(BUILD_DIR, 'icon.ico');
const UNINSTALLER_ICON_PATH = path.join(BUILD_DIR, 'uninstallerIcon.ico');
const SIDEBAR_PATH = path.join(BUILD_DIR, 'installerSidebar.bmp');
const VERIFY_DEFAULT_ICON_PATH = path.join(BUILD_DIR, 'verify-default-icon.png');
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

function findSourceImage() {
  const candidates = ['png', 'jpg', 'jpeg', 'bmp', 'webp'].map((extension) =>
    path.join(ASSETS_DIR, `app-icon.${extension}`)
  );
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function writeBmp24({ width, height, rgbaBuffer, outputPath }) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const bmp = Buffer.alloc(fileSize);

  bmp.write('BM', 0, 2, 'ascii');
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const rowOffset = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 4;
      const targetOffset = rowOffset + x * 3;
      bmp[targetOffset] = rgbaBuffer[sourceOffset + 2];
      bmp[targetOffset + 1] = rgbaBuffer[sourceOffset + 1];
      bmp[targetOffset + 2] = rgbaBuffer[sourceOffset];
    }
  }

  fs.writeFileSync(outputPath, bmp);
}

async function createResizedPng(sourceImagePath, size) {
  return sharp(sourceImagePath)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function writeIcoFromImage(sourceImagePath, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-icon-'));
  try {
    const pngPaths = [];
    for (const size of ICON_SIZES) {
      const pngPath = path.join(tempDir, `icon-${size}.png`);
      fs.writeFileSync(pngPath, await createResizedPng(sourceImagePath, size));
      pngPaths.push(pngPath);
    }

    const icoBuffer = await pngToIco(pngPaths);
    fs.writeFileSync(outputPath, icoBuffer);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildSidebarSvg({ title, version, author }) {
  const authorLine = author
    ? `<text x="82" y="268" class="meta">作者: ${escapeXml(author)}</text>`
    : '';

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <style>
    .title { font: 700 22px "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif; fill: #242424; text-anchor: middle; }
    .meta { font: 400 15px "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif; fill: #606060; text-anchor: middle; }
  </style>
  <text x="82" y="178" class="title">${escapeXml(title)}</text>
  <line x1="26" y1="206" x2="138" y2="206" stroke="#dc2d23" stroke-width="2" />
  <text x="82" y="234" class="meta">版本 v${escapeXml(version)}</text>
  ${authorLine}
</svg>`);
}

async function writeInstallerSidebar({ sourceImagePath, outputPath, title, version, author }) {
  const width = 164;
  const height = 314;
  const icon = await sharp(sourceImagePath)
    .resize(104, 104, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  const { data, info } = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 246, g: 247, b: 249, alpha: 1 }
    }
  })
    .composite([
      { input: icon, left: 30, top: 28 },
      { input: buildSidebarSvg({ title, version, author }), left: 0, top: 0 }
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });

  writeBmp24({
    width: info.width,
    height: info.height,
    rgbaBuffer: data,
    outputPath
  });
}

async function main() {
  const sourceImagePath = findSourceImage();
  if (!sourceImagePath) {
    throw new Error('未找到正式应用图标源文件，请提供 assets/app-icon.png（或 jpg/jpeg/bmp/webp）');
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const productName = packageJson?.build?.productName || packageJson.name || '宾馆比较助手';
  const version = APP_INFO.version || packageJson.version || '';
  const author = APP_INFO.author || packageJson.author || '';

  fs.mkdirSync(BUILD_DIR, { recursive: true });

  await writeIcoFromImage(sourceImagePath, ICON_PATH);
  await writeIcoFromImage(sourceImagePath, UNINSTALLER_ICON_PATH);
  await sharp(sourceImagePath).png().toFile(VERIFY_DEFAULT_ICON_PATH);
  await writeInstallerSidebar({
    sourceImagePath,
    outputPath: SIDEBAR_PATH,
    title: productName,
    version,
    author
  });

  console.log(`Build assets synced from ${path.relative(PROJECT_ROOT, sourceImagePath)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
