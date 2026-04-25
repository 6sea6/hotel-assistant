const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { PROMPT_CONTRACT } = require('../shared/compare-app/prompt-contract');
const { prepareFullBundle } = require('../scripts/package/prepare-full-bundle');

const bundledSetupModulePath = path.resolve(__dirname, '..', 'src', 'main', 'bundled-setup.js');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-setup-test-'));
}

function overrideProcessProperty(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(process, name);
  Object.defineProperty(process, name, {
    configurable: true,
    writable: true,
    value
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(process, name, descriptor);
    } else {
      delete process[name];
    }
  };
}

function withMockedElectron(mockedElectron, fn) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return mockedElectron;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return fn();
  } finally {
    Module._load = originalLoad;
  }
}

test('setupBundledModules deploys prompt seed, unified prompt, and skill into packaged paths', (t) => {
  const tempRoot = makeTempRoot();
  const scraperDir = path.join(tempRoot, 'scraper');
  const skillDir = path.join(scraperDir, '.workbuddy', 'skills', PROMPT_CONTRACT.bundledSkillName);
  const installDir = path.join(tempRoot, 'install-root');
  const appDataRoot = path.join(tempRoot, 'appdata-root');
  const homeRoot = path.join(tempRoot, 'home-root');
  const fakeExecPath = path.join(installDir, '宾馆比较终极版.exe');

  fs.mkdirSync(path.join(scraperDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(scraperDir, 'examples'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(homeRoot, { recursive: true });

  fs.writeFileSync(path.join(scraperDir, 'src', 'cli.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'src', 'edge-session.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'package.json'), JSON.stringify({ name: 'fixture-scraper' }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'README.md'), '# fixture readme\n', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, PROMPT_CONTRACT.unifiedPromptFileName), '# bundled guide\n', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'examples', 'sample.json'), '{}\n', 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'references', 'field-rules.md'), '数据目录：E:\\实验\\1\\宾馆比较助手\n', 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '# Skill',
    'E:\\实验\\1\\宾馆比较助手',
    'E:\\实验\\2\\README.md',
    'node _run.js',
    'node src/edge-session.js',
    '## 执行流程'
  ].join('\n'), 'utf-8');

  const prepared = prepareFullBundle({
    projectRoot: path.resolve(__dirname, '..'),
    scraperDir
  });

  const restoreExecPath = overrideProcessProperty('execPath', fakeExecPath);
  const restoreResourcesPath = overrideProcessProperty('resourcesPath', prepared.bundleRoot);
  const originalHomedir = os.homedir;
  os.homedir = () => homeRoot;

  t.after(() => {
    restoreExecPath();
    restoreResourcesPath();
    os.homedir = originalHomedir;
    delete require.cache[bundledSetupModulePath];
    fs.rmSync(prepared.bundleRoot, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  delete require.cache[bundledSetupModulePath];
  withMockedElectron({
    app: {
      isPackaged: true,
      getPath(name) {
        assert.equal(name, 'appData');
        return appDataRoot;
      }
    }
  }, () => {
    const bundledSetup = require(bundledSetupModulePath);
    bundledSetup.setupBundledModules();
  });

  const dataDir = path.join(installDir, '宾馆比较助手');
  const workDir = path.join(dataDir, 'scraper-data');
  const skillTargetDir = path.join(homeRoot, '.workbuddy', 'skills', PROMPT_CONTRACT.bundledSkillName);
  const skillContent = fs.readFileSync(path.join(skillTargetDir, 'SKILL.md'), 'utf-8');

  assert.equal(fs.existsSync(path.join(dataDir, PROMPT_CONTRACT.compareAppPromptsFileName)), true);
  assert.equal(fs.existsSync(path.join(workDir, PROMPT_CONTRACT.unifiedPromptFileName)), true);
  assert.equal(fs.existsSync(path.join(skillTargetDir, 'SKILL.md')), true);
  assert.match(skillContent, /打包版专用说明/);
  assert.match(skillContent, new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(skillContent, new RegExp(workDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
