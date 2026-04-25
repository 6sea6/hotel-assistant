const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDefaultPrompt } = require('../src/main/default-prompts');
const { PROMPT_CONTRACT } = require('../shared/compare-app/prompt-contract');
const { getBundleManifest, getSetupArtifactName } = require('../scripts/package/bundle-manifest');
const { createBuilderConfig } = require('../scripts/package/create-builder-config');
const { prepareFullBundle } = require('../scripts/package/prepare-full-bundle');
const { verifyPackageLayout } = require('../scripts/package/verify-package-layout');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-package-scripts-'));
}

test('package manifest keeps base and full bundle resource contracts stable', () => {
  const manifest = getBundleManifest('E:/temp/bundle-root');

  assert.equal(getSetupArtifactName('1', '6.6.0'), '宾馆比较终极版-基础版-6.6.0.exe');
  assert.equal(getSetupArtifactName('2', '6.6.0'), '宾馆比较终极版-完整版-6.6.0.exe');
  assert.deepEqual(
    manifest.expectations.fullOnlyResources,
    [
      path.join('scraper', 'src', 'cli.js'),
      path.join('scraper', PROMPT_CONTRACT.unifiedPromptFileName),
      path.join('skill', PROMPT_CONTRACT.bundledSkillEntryFileName),
      path.join('compare-app', PROMPT_CONTRACT.compareAppPromptsFileName)
    ]
  );
});

test('createBuilderConfig only injects full-bundle extra resources in full mode', (t) => {
  const tempRoot = makeTempRoot();
  const tempOutputDir = path.join(tempRoot, 'dist-verify');
  const extraResources = [{ from: 'temp-bundle', to: 'scraper' }];

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const baseConfig = createBuilderConfig({
    projectRoot: path.resolve(__dirname, '..'),
    mode: '1',
    outputDir: tempOutputDir,
    extraResources
  });
  const fullConfig = createBuilderConfig({
    projectRoot: path.resolve(__dirname, '..'),
    mode: '2',
    outputDir: tempOutputDir,
    extraResources
  });

  t.after(() => {
    fs.rmSync(baseConfig.tempDir, { recursive: true, force: true });
  });

  assert.equal(baseConfig.buildConfig.directories.output, tempOutputDir);
  assert.equal(
    baseConfig.buildConfig.extraResources.some((entry) => entry.from === 'temp-bundle'),
    false
  );
  assert.equal(
    fullConfig.buildConfig.extraResources.some((entry) => entry.from === 'temp-bundle'),
    true
  );
});

test('prepareFullBundle preserves protected prompt and skill assets and seeds ai-prompts.json', (t) => {
  const tempRoot = makeTempRoot();
  const scraperDir = path.join(tempRoot, 'scraper');
  const skillDir = path.join(scraperDir, '.workbuddy', 'skills', PROMPT_CONTRACT.bundledSkillName);

  fs.mkdirSync(path.join(scraperDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(scraperDir, 'examples'), { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(scraperDir, 'src', 'cli.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'package.json'), JSON.stringify({ name: 'fixture-scraper' }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'README.md'), '# fixture\n', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, PROMPT_CONTRACT.unifiedPromptFileName), '# guide\n', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'examples', 'sample.json'), '{}\n', 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# protected skill\n', 'utf-8');

  const prepared = prepareFullBundle({
    projectRoot: path.resolve(__dirname, '..'),
    scraperDir
  });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(prepared.bundleRoot, { recursive: true, force: true });
  });

  const promptSeedPath = path.join(
    prepared.manifest.directories.compareAppRoot,
    PROMPT_CONTRACT.compareAppPromptsFileName
  );
  const promptSeed = JSON.parse(fs.readFileSync(promptSeedPath, 'utf-8'));

  assert.equal(fs.existsSync(path.join(prepared.manifest.directories.scraperRoot, 'src', 'cli.js')), true);
  assert.equal(fs.existsSync(path.join(prepared.manifest.directories.scraperRoot, PROMPT_CONTRACT.unifiedPromptFileName)), true);
  assert.equal(fs.existsSync(path.join(prepared.manifest.directories.skillRoot, 'SKILL.md')), true);
  assert.equal(promptSeed.protective.content, getDefaultPrompt('protective'));
  assert.equal(promptSeed.guide.content, getDefaultPrompt('guide', { dataPath: '当前数据目录中的 hotel-data.json' }));
  assert.equal(promptSeed.optimize.content, getDefaultPrompt('optimize'));
});

test('verifyPackageLayout distinguishes base and full resource layouts', (t) => {
  const tempRoot = makeTempRoot();
  const baseResourcesDir = path.join(tempRoot, 'base', 'win-unpacked', 'resources');
  const fullResourcesDir = path.join(tempRoot, 'full', 'win-unpacked', 'resources');

  const writeFile = (rootDir, relativePath) => {
    const targetPath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, 'fixture', 'utf-8');
  };

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  [
    path.join('shared', 'compare-app', 'constants.js'),
    path.join('shared', 'compare-app', 'data-folder.js'),
    path.join('shared', 'compare-app', 'hotel-groups.js')
  ].forEach((relativePath) => {
    writeFile(baseResourcesDir, relativePath);
    writeFile(fullResourcesDir, relativePath);
  });

  [
    path.join('scraper', 'src', 'cli.js'),
    path.join('scraper', PROMPT_CONTRACT.unifiedPromptFileName),
    path.join('skill', 'SKILL.md'),
    path.join('compare-app', PROMPT_CONTRACT.compareAppPromptsFileName)
  ].forEach((relativePath) => {
    writeFile(fullResourcesDir, relativePath);
  });

  assert.doesNotThrow(() => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'base'), mode: '1' }));
  assert.doesNotThrow(() => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'full'), mode: '2' }));

  writeFile(baseResourcesDir, path.join('scraper', 'src', 'cli.js'));
  assert.throws(
    () => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'base'), mode: '1' }),
    /不应存在的打包资源/
  );
});

test('protected source prompt and skill assets remain present in workspace', () => {
  const scraperRoot = path.resolve(__dirname, '..', '..', '2');
  const promptGuidePath = path.join(scraperRoot, PROMPT_CONTRACT.unifiedPromptFileName);
  const skillPath = path.join(scraperRoot, '.workbuddy', 'skills', PROMPT_CONTRACT.bundledSkillName, 'SKILL.md');

  assert.equal(fs.existsSync(path.resolve(__dirname, '..', 'src', 'main', 'default-prompts.js')), true);
  assert.equal(fs.existsSync(promptGuidePath), true);
  assert.equal(fs.existsSync(skillPath), true);
});
