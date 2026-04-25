const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_COMPARE_APP_FILES } = require('../shared/compare-app/constants');
const { BUNDLE_RESOURCE_MAP, PROMPT_CONTRACT, PROMPT_TYPES, getBundledSkillTargetDir } = require('../shared/compare-app/prompt-contract');
const {
  buildCompareAppDataPaths,
  getBundledResourcePaths,
  getExplicitDataFolderOverride,
  getWorkspaceDataFolderCandidates,
  isBundledScraperAvailable,
  resolveCompareAppDataFolder,
  shouldPreferWorkspaceDataFolder
} = require('../shared/compare-app/runtime-paths');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compare-app-runtime-'));
}

test('prompt contract keeps protected prompt and bundle file names stable', () => {
  assert.deepEqual(PROMPT_TYPES, ['protective', 'guide', 'optimize']);
  assert.equal(PROMPT_CONTRACT.compareAppPromptsFileName, 'ai-prompts.json');
  assert.equal(PROMPT_CONTRACT.unifiedPromptFileName, '00-后续AI统一提示词.md');
  assert.equal(PROMPT_CONTRACT.bundledSkillName, 'hotel-data-filler');
  assert.equal(PROMPT_CONTRACT.bundledSkillEntryFileName, 'SKILL.md');
  assert.equal(BUNDLE_RESOURCE_MAP.scraperDirName, 'scraper');
  assert.equal(BUNDLE_RESOURCE_MAP.skillDirName, 'skill');
  assert.equal(BUNDLE_RESOURCE_MAP.compareAppDirName, 'compare-app');
  assert.equal(BUNDLE_RESOURCE_MAP.runtimeWorkDirName, 'scraper-data');
});

test('workspace and explicit overrides are normalized through shared runtime paths', () => {
  const env = {
    HOTEL_COMPARE_APP_DATA_DIR: 'E:/实验/1/宾馆比较助手',
    HOTEL_COMPARE_APP_USE_WORKSPACE: 'true',
    HOTEL_COMPARE_APP_WORKSPACE_DIR: 'E:/实验/custom-workspace'
  };

  assert.equal(getExplicitDataFolderOverride(env), path.resolve('E:/实验/1/宾馆比较助手'));
  assert.equal(shouldPreferWorkspaceDataFolder(env), true);
  assert.deepEqual(
    getWorkspaceDataFolderCandidates({
      env,
      fallbackWorkspaceDir: 'E:/实验/1/宾馆比较助手'
    }),
    [
      path.resolve('E:/实验/custom-workspace'),
      path.resolve('E:/实验/1/宾馆比较助手')
    ]
  );
});

test('resolveCompareAppDataFolder respects explicit, workspace, pointer, installed, then legacy order', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  const workspaceDir = path.join(tempRoot, 'workspace', DEFAULT_COMPARE_APP_FILES.appFolderName);
  const pointerDir = path.join(tempRoot, 'pointer-data');
  const installedRoot = path.join(tempRoot, 'Program Files', '宾馆比较终极版');
  const installedDir = path.join(installedRoot, DEFAULT_COMPARE_APP_FILES.appFolderName);
  const legacyDir = path.join(appDataRoot, DEFAULT_COMPARE_APP_FILES.appFolderName);
  const execPath = path.join(installedRoot, '宾馆比较终极版.exe');

  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(pointerDir, { recursive: true });
  fs.mkdirSync(installedDir, { recursive: true });
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, DEFAULT_COMPARE_APP_FILES.storeFileName), '{}', 'utf-8');
  fs.writeFileSync(
    path.join(appDataRoot, DEFAULT_COMPARE_APP_FILES.pointerFileName),
    JSON.stringify({ dataFolder: pointerDir }, null, 2),
    'utf-8'
  );

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(
    resolveCompareAppDataFolder({
      env: { HOTEL_COMPARE_APP_DATA_DIR: path.join(tempRoot, 'explicit-data') },
      appDataRoot,
      appFolderName: DEFAULT_COMPARE_APP_FILES.appFolderName,
      pointerFileName: DEFAULT_COMPARE_APP_FILES.pointerFileName,
      storeFileName: DEFAULT_COMPARE_APP_FILES.storeFileName,
      fallbackWorkspaceDir: workspaceDir,
      execPath
    }),
    path.join(tempRoot, 'explicit-data')
  );

  assert.equal(
    resolveCompareAppDataFolder({
      env: { HOTEL_COMPARE_APP_USE_WORKSPACE: 'true' },
      appDataRoot,
      appFolderName: DEFAULT_COMPARE_APP_FILES.appFolderName,
      pointerFileName: DEFAULT_COMPARE_APP_FILES.pointerFileName,
      storeFileName: DEFAULT_COMPARE_APP_FILES.storeFileName,
      fallbackWorkspaceDir: workspaceDir,
      execPath
    }),
    workspaceDir
  );

  fs.rmSync(path.join(workspaceDir, DEFAULT_COMPARE_APP_FILES.storeFileName), { force: true });

  assert.equal(
    resolveCompareAppDataFolder({
      env: { HOTEL_COMPARE_APP_USE_WORKSPACE: 'true' },
      appDataRoot,
      appFolderName: DEFAULT_COMPARE_APP_FILES.appFolderName,
      pointerFileName: DEFAULT_COMPARE_APP_FILES.pointerFileName,
      storeFileName: DEFAULT_COMPARE_APP_FILES.storeFileName,
      fallbackWorkspaceDir: workspaceDir,
      execPath
    }),
    pointerDir
  );

  fs.rmSync(path.join(appDataRoot, DEFAULT_COMPARE_APP_FILES.pointerFileName), { force: true });

  assert.equal(
    resolveCompareAppDataFolder({
      env: { HOTEL_COMPARE_APP_USE_WORKSPACE: 'false' },
      appDataRoot,
      appFolderName: DEFAULT_COMPARE_APP_FILES.appFolderName,
      pointerFileName: DEFAULT_COMPARE_APP_FILES.pointerFileName,
      storeFileName: DEFAULT_COMPARE_APP_FILES.storeFileName,
      fallbackWorkspaceDir: workspaceDir,
      execPath
    }),
    installedDir
  );

  fs.rmSync(installedDir, { recursive: true, force: true });

  assert.equal(
    resolveCompareAppDataFolder({
      env: { HOTEL_COMPARE_APP_USE_WORKSPACE: 'false' },
      appDataRoot,
      appFolderName: DEFAULT_COMPARE_APP_FILES.appFolderName,
      pointerFileName: DEFAULT_COMPARE_APP_FILES.pointerFileName,
      storeFileName: DEFAULT_COMPARE_APP_FILES.storeFileName,
      fallbackWorkspaceDir: workspaceDir,
      execPath
    }),
    legacyDir
  );
});

test('shared bundled resource paths keep prompt, skill, and scraper locations stable', () => {
  const resourcesPath = path.join('E:/实验', 'hotel-comparison-app', 'resources');
  const appDataPath = path.join('E:/实验', 'hotel-comparison-app', DEFAULT_COMPARE_APP_FILES.appFolderName);
  const homeDir = path.join('C:/Users', 'tester');

  const resourcePaths = getBundledResourcePaths({
    resourcesPath,
    appDataPath,
    homeDir
  });

  assert.equal(resourcePaths.scraperPath, path.join(resourcesPath, 'scraper'));
  assert.equal(resourcePaths.skillSourcePath, path.join(resourcesPath, 'skill'));
  assert.equal(resourcePaths.compareAppResourcePath, path.join(resourcesPath, 'compare-app'));
  assert.equal(resourcePaths.bundledWorkDir, path.join(appDataPath, 'scraper-data'));
  assert.equal(resourcePaths.promptSeedPath, path.join(resourcesPath, 'compare-app', 'ai-prompts.json'));
  assert.equal(resourcePaths.promptTargetPath, path.join(appDataPath, 'ai-prompts.json'));
  assert.equal(resourcePaths.unifiedPromptSourcePath, path.join(resourcesPath, 'scraper', '00-后续AI统一提示词.md'));
  assert.equal(resourcePaths.unifiedPromptTargetPath, path.join(appDataPath, 'scraper-data', '00-后续AI统一提示词.md'));
  assert.equal(resourcePaths.bundledSkillTargetPath, getBundledSkillTargetDir(homeDir));

  const compareAppPaths = buildCompareAppDataPaths({
    dataFolder: appDataPath,
    storeFileName: DEFAULT_COMPARE_APP_FILES.storeFileName
  });
  assert.equal(compareAppPaths.storePath, path.join(appDataPath, 'hotel-data.json'));
  assert.equal(compareAppPaths.promptsPath, path.join(appDataPath, 'ai-prompts.json'));
});

test('shared bundled scraper detection only depends on bundled cli presence', (t) => {
  const tempRoot = makeTempRoot();
  const resourcePaths = getBundledResourcePaths({
    resourcesPath: tempRoot,
    appDataPath: path.join(tempRoot, DEFAULT_COMPARE_APP_FILES.appFolderName)
  });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(isBundledScraperAvailable(resourcePaths), false);

  fs.mkdirSync(path.join(resourcePaths.scraperPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(resourcePaths.scraperPath, 'src', 'cli.js'), 'module.exports = {};', 'utf-8');

  assert.equal(isBundledScraperAvailable(resourcePaths), true);
});
