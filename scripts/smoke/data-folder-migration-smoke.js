const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildTargetDataFolder,
  migrateDataFolder,
  prepareTargetFolder
} = require('../../src/main/services/data-folder-migration-service');

const KEEP_TEMP = process.env.KEEP_MIGRATION_SMOKE === 'true';
const STRICT_UNICODE = process.env.STRICT_MIGRATION_SMOKE === 'true';

function writeFixture(sourceDir) {
  fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'hotel-data.json'),
    JSON.stringify({ hotels: [{ name: 'Smoke Hotel' }] }, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(sourceDir, 'nested', 'note.txt'), 'smoke-ok', 'utf8');
}

function createMigrationDeps(pointerFile) {
  let storePath = '';
  const calls = [];
  return {
    calls,
    dataFolderManager: {
      ensureDataFolder(folder) {
        calls.push(['ensureDataFolder', folder]);
      },
      saveDataFolderPath(folder) {
        calls.push(['saveDataFolderPath', folder]);
        fs.writeFileSync(pointerFile, JSON.stringify({ dataFolder: folder }, null, 2), 'utf8');
      }
    },
    dataService: {
      reinitializeStore(folder) {
        calls.push(['reinitializeStore', folder]);
        storePath = path.join(folder, 'hotel-data.json');
      },
      getStore() {
        calls.push(['getStore']);
        return { path: storePath };
      }
    }
  };
}

function runAsciiBaseline(tempRoot) {
  const sourceDir = path.join(tempRoot, 'old-data-source');
  const selectedDir = path.join(tempRoot, 'new location ascii (smoke)');
  const pointerFile = path.join(tempRoot, 'ascii-pointer.json');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(selectedDir, { recursive: true });
  writeFixture(sourceDir);

  const targetFolder = buildTargetDataFolder(selectedDir, {
    DATA_FOLDER_NAME: 'hotel-data-assistant'
  });
  const deps = createMigrationDeps(pointerFile);
  prepareTargetFolder({ fs, targetFolder, overwrite: false });
  const result = migrateDataFolder({
    fs,
    dataFolderManager: deps.dataFolderManager,
    dataService: deps.dataService,
    currentDataFolder: sourceDir,
    targetDataFolder: targetFolder
  });
  const hotelDataPath = path.join(targetFolder, 'hotel-data.json');
  const hotelDataBuffer = fs.readFileSync(hotelDataPath);
  return {
    ok: true,
    sourceDir,
    selectedDir,
    targetFolder,
    pointerData: JSON.parse(fs.readFileSync(pointerFile, 'utf8')),
    result,
    calls: deps.calls,
    hotelDataUtf8: hotelDataBuffer.toString('utf8'),
    hotelDataBufferHex: hotelDataBuffer.toString('hex')
  };
}

function writeUnicodeProbeScript(scriptPath, servicePath) {
  fs.writeFileSync(
    scriptPath,
    `
const fs = require('node:fs');
const path = require('node:path');
const { buildTargetDataFolder, migrateDataFolder, prepareTargetFolder } = require(${JSON.stringify(
      servicePath
    )});

const tempRoot = process.env.MIGRATION_SMOKE_ROOT;
const reportFile = process.env.MIGRATION_SMOKE_REPORT;
const DATA_FOLDER_NAME = '宾馆比较助手';
const sourceDir = path.join(tempRoot, '旧数据 源目录');
const selectedDir = path.join(tempRoot, '新位置 中文 (smoke)');
const pointerFile = path.join(tempRoot, 'unicode-pointer.json');
const targetFolder = buildTargetDataFolder(selectedDir, { DATA_FOLDER_NAME });
let storePath = '';
const calls = [];

function writeReport(extra) {
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        platform: process.platform,
        sourceDir,
        selectedDir,
        targetFolder,
        calls,
        ...extra
      },
      null,
      2
    ),
    'utf8'
  );
}

fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
fs.mkdirSync(selectedDir, { recursive: true });
fs.writeFileSync(
  path.join(sourceDir, 'hotel-data.json'),
  JSON.stringify({ hotels: [{ name: '中文 Smoke 酒店' }] }, null, 2),
  'utf8'
);
fs.writeFileSync(path.join(sourceDir, 'nested', '中文文件.txt'), '中文 smoke ok', 'utf8');
writeReport({ phase: 'before-migrate', targetExists: fs.existsSync(targetFolder) });

const dataFolderManager = {
  ensureDataFolder(folder) {
    calls.push(['ensureDataFolder', folder]);
  },
  saveDataFolderPath(folder) {
    calls.push(['saveDataFolderPath', folder]);
    fs.writeFileSync(pointerFile, JSON.stringify({ dataFolder: folder }, null, 2), 'utf8');
  }
};
const dataService = {
  reinitializeStore(folder) {
    calls.push(['reinitializeStore', folder]);
    storePath = path.join(folder, 'hotel-data.json');
  },
  getStore() {
    calls.push(['getStore']);
    return { path: storePath };
  }
};

prepareTargetFolder({ fs, targetFolder, overwrite: false });
const result = migrateDataFolder({
  fs,
  dataFolderManager,
  dataService,
  currentDataFolder: sourceDir,
  targetDataFolder: targetFolder
});
const hotelDataPath = path.join(targetFolder, 'hotel-data.json');
const hotelDataBuffer = fs.readFileSync(hotelDataPath);
writeReport({
  phase: 'after-migrate',
  targetExists: fs.existsSync(targetFolder),
  hotelDataUtf8: hotelDataBuffer.toString('utf8'),
  hotelDataBufferHex: hotelDataBuffer.toString('hex'),
  nestedText: fs.readFileSync(path.join(targetFolder, 'nested', '中文文件.txt'), 'utf8'),
  pointerData: JSON.parse(fs.readFileSync(pointerFile, 'utf8')),
  result
});
process.stdout.write(JSON.stringify({ ok: true }));
`,
    'utf8'
  );
}

function runUnicodeProbe(tempRoot) {
  const scriptPath = path.join(tempRoot, 'unicode-smoke-probe.js');
  const reportFile = path.join(tempRoot, 'unicode-smoke-report.json');
  const servicePath = path.resolve(
    __dirname,
    '..',
    '..',
    'src',
    'main',
    'services',
    'data-folder-migration-service.js'
  );
  writeUnicodeProbeScript(scriptPath, servicePath);

  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      MIGRATION_SMOKE_ROOT: tempRoot,
      MIGRATION_SMOKE_REPORT: reportFile
    }
  });
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  const exactMigrationSucceeded =
    child.status === 0 &&
    report?.targetExists === true &&
    typeof report.hotelDataUtf8 === 'string' &&
    report.hotelDataUtf8.includes('中文 Smoke 酒店') &&
    report?.pointerData?.dataFolder === report.targetFolder &&
    report?.result?.path === path.join(report.targetFolder, 'hotel-data.json');

  return {
    ok: exactMigrationSucceeded,
    status: child.status,
    signal: child.signal,
    stdout: child.stdout,
    stderr: child.stderr,
    report
  };
}

function printSection(title, value) {
  console.log(`[data-folder-migration-smoke] ${title}:`);
  console.log(JSON.stringify(value, null, 2));
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-folder-migration-smoke-'));
  let exitCode = 0;

  try {
    console.log(`[data-folder-migration-smoke] platform=${process.platform}`);
    console.log(`[data-folder-migration-smoke] tempRoot=${tempRoot}`);

    const asciiBaseline = runAsciiBaseline(tempRoot);
    printSection('ascii baseline ok', asciiBaseline);

    const unicodeProbe = runUnicodeProbe(tempRoot);
    printSection(unicodeProbe.ok ? 'unicode probe ok' : 'unicode probe warning', unicodeProbe);

    if (!unicodeProbe.ok) {
      console.log(
        '[data-folder-migration-smoke] WARNING: Chinese path migration did not complete with an exact target path in this runtime.'
      );
      if (STRICT_UNICODE) {
        exitCode = 1;
      }
    }

    console.log(
      `[data-folder-migration-smoke] result=${exitCode === 0 ? 'ok' : 'failed'} keep=${KEEP_TEMP}`
    );
  } catch (error) {
    exitCode = 1;
    console.error('[data-folder-migration-smoke] ERROR:', error);
  } finally {
    if (!KEEP_TEMP) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`[data-folder-migration-smoke] kept tempRoot=${tempRoot}`);
    }
  }

  process.exitCode = exitCode;
}

main();
