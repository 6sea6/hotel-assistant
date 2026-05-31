const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadRendererDebugLogModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-debug-log-'));
  const sourcePath = path.join(__dirname, '..', 'src', 'renderer', 'modules', 'debug-log.js');

  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
  fs.copyFileSync(sourcePath, path.join(tempRoot, 'debug-log.js'));

  const moduleUrl = pathToFileURL(path.join(tempRoot, 'debug-log.js')).href;
  process.on('exit', () => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  return import(moduleUrl);
}

function installWindowWithDebugFlag(value) {
  global.window = {
    localStorage: {
      getItem(key) {
        return key === 'HOTEL_APP_DEBUG_LOGS' ? value : null;
      }
    }
  };
}

test('renderer debug log is silent by default', async () => {
  const { logRendererDebug } = await loadRendererDebugLogModule();
  const originalWindow = global.window;
  const originalLog = console.log;
  const logs = [];

  installWindowWithDebugFlag(null);
  console.log = (...args) => logs.push(args);
  try {
    logRendererDebug('[初始化] 开始初始化应用');
  } finally {
    console.log = originalLog;
    global.window = originalWindow;
  }

  assert.deepEqual(logs, []);
});

test('renderer debug log can be enabled through localStorage', async () => {
  const { logRendererDebug } = await loadRendererDebugLogModule();
  const originalWindow = global.window;
  const originalLog = console.log;
  const logs = [];

  installWindowWithDebugFlag('1');
  console.log = (...args) => logs.push(args);
  try {
    logRendererDebug('[初始化] 应用初始化完成', { hotelsCount: 2 });
  } finally {
    console.log = originalLog;
    global.window = originalWindow;
  }

  assert.deepEqual(logs, [['[初始化] 应用初始化完成', { hotelsCount: 2 }]]);
});

test('renderer success-path logs are gated behind the debug logger', () => {
  const rendererRoot = path.join(__dirname, '..', 'src', 'renderer');
  const files = [
    'app.module.js',
    path.join('modules', 'about-manual.js'),
    path.join('modules', 'hotel-crud.js'),
    path.join('modules', 'template-ui.js')
  ];
  const offenders = [];

  for (const relativePath of files) {
    const filePath = path.join(rendererRoot, relativePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    content.split(/\r?\n/).forEach((line, index) => {
      if (line.includes('console.log(')) {
        offenders.push(`${relativePath}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});
