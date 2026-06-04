const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PROMPT_CONTRACT } = require('../shared/compare-app/prompt-contract');
const { getBundleManifest, getSetupArtifactName } = require('../scripts/package/bundle-manifest');
const { createBuilderConfig } = require('../scripts/package/create-builder-config');
const { prepareFullBundle } = require('../scripts/package/prepare-full-bundle');
const { verifyPackageLayout } = require('../scripts/package/verify-package-layout');
const {
  cleanupRuntimeArtifacts,
  DEFAULT_RUNTIME_ARTIFACT_PATHS
} = require('../scripts/cleanup-runtime-artifacts');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-package-scripts-'));
}

function writePackageFixture(nodeModulesDir, packageName, packageJson = {}) {
  const packageDir = path.join(nodeModulesDir, ...packageName.split('/'));
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version: '1.0.0',
        ...packageJson
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};\n', 'utf-8');
  return packageDir;
}

test('package manifest keeps full bundle resource contracts stable', () => {
  const manifest = getBundleManifest('E:/temp/bundle-root');

  assert.equal(getSetupArtifactName('7.8.0'), '宾馆比较终极版-完整版-7.8.0.exe');
  assert.equal('baseOnlyAbsentResources' in manifest.expectations, false);
  assert.deepEqual(manifest.expectations.fullOnlyResources, [
    path.join('scraper', 'src', 'cli.js'),
    path.join('scraper', 'src', 'runtime', 'perf.js'),
    path.join('scraper', 'src', 'runtime', 'file-perf.js'),
    path.join('scraper', 'src', 'runtime', 'noop-perf.js'),
    path.join('scraper', 'vendor', 'axios', 'package.json'),
    path.join('scraper', 'vendor', 'cheerio', 'package.json'),
    path.join('scraper', 'vendor', 'ws', 'package.json'),
    path.join('scraper', 'vendor', 'parse5', 'package.json'),
    path.join('scraper', 'vendor', 'parse5', 'dist', 'cjs', 'tokenizer', 'index.js'),
    path.join('scraper', PROMPT_CONTRACT.unifiedPromptFileName)
  ]);
  [
    path.join('devtools'),
    path.join('logs'),
    path.join('scripts', 'analyze_perf.py'),
    path.join('scraper', 'logs'),
    path.join('scraper', 'tests'),
    path.join('scraper', 'devtools'),
    path.join('scraper', 'README.md'),
    path.join('scraper', 'scripts', 'analyze_perf.py'),
    path.join('scraper', 'src', 'devtools'),
    path.join('scraper', 'src', 'runtime', 'perf_log.py')
  ].forEach((relativePath) => {
    assert.ok(manifest.expectations.neverResources.includes(relativePath));
  });
  assert.ok(
    manifest.expectations.neverResources.includes(path.join('devtools')),
    'neverResources must exclude devtools'
  );
  assert.ok(
    manifest.expectations.neverResources.includes(path.join('logs')),
    'neverResources must exclude logs'
  );
  assert.ok(
    manifest.expectations.neverResources.includes(path.join('scraper', 'logs')),
    'neverResources must exclude scraper/logs'
  );
  assert.ok(
    manifest.expectations.neverResources.includes(path.join('scraper', 'devtools')),
    'neverResources must exclude scraper/devtools'
  );
  assert.ok(
    manifest.expectations.neverResources.includes(
      path.join('scraper', 'src', 'runtime', 'perf_log.py')
    ),
    'neverResources must exclude perf_log.py'
  );
  assert.ok(
    manifest.expectations.neverResources.includes(path.join('scraper', 'README.md')),
    'neverResources must exclude scraper README'
  );
  assert.ok(
    manifest.extraResources[0].filter.some((pattern) => pattern === '!**/*.jsonl'),
    'full bundle resource filter excludes JSONL logs'
  );
  assert.equal(
    manifest.extraResources[0].filter.includes('!**/*token*'),
    false,
    'bundle resource filter must not use broad !**/*token* that would exclude parse5 tokenizer'
  );
});

test('app version metadata is generated from package.json and reused by docs and build scripts', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const { APP_INFO } = require('../src/shared/app-info.generated');
  const { APP_CONFIG } = require('../src/main/config');
  const preload = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'preload.js'), 'utf-8');
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8');
  const indexHtml = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'index.html'),
    'utf-8'
  );
  const manualHtml = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'manual.html'),
    'utf-8'
  );
  const syncAppInfoScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'sync-app-info.js'),
    'utf-8'
  );
  const syncBuildAssetsScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'sync-build-assets.js'),
    'utf-8'
  );
  const runBuildScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'package', 'run-build.js'),
    'utf-8'
  );
  const versionPattern = escapeRegExp(packageJson.version);

  assert.equal(APP_INFO.version, packageJson.version);
  assert.equal(APP_CONFIG.VERSION, packageJson.version);
  assert.match(preload, new RegExp(`version:\\s*'${versionPattern}'`));
  assert.match(readme, new RegExp(`# 宾馆比较助手 v${versionPattern}`));
  assert.doesNotMatch(readme, /v8\.0\b/);
  assert.match(indexHtml, new RegExp(`id="aboutVersionText">v${versionPattern}<`));
  assert.match(manualHtml, new RegExp(`id="manualVersionText">v${versionPattern}<`));
  assert.match(syncAppInfoScript, /app-info\.generated\.js/);
  assert.match(syncAppInfoScript, /packageJson\.version/);
  assert.match(syncBuildAssetsScript, /app-info\.generated/);
  assert.match(runBuildScript, /sync-app-info\.js/);
});

test('project documentation avoids stale local-only instructions', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const docs = {
    readme: fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8'),
    devReadme: fs.readFileSync(path.join(projectRoot, 'README_DEV.md'), 'utf-8'),
    scraperReadme: fs.readFileSync(path.join(projectRoot, 'scraper', 'README.md'), 'utf-8'),
    scraperPrompt: fs.readFileSync(
      path.join(projectRoot, 'scraper', '00-后续AI统一提示词.md'),
      'utf-8'
    )
  };
  const combinedDocs = Object.values(docs).join('\n');

  assert.doesNotMatch(combinedDocs, /一键启动Edge并采集\.bat/);
  assert.doesNotMatch(combinedDocs, /根目录的 `00-后续AI统一提示词\.md`/);
  assert.doesNotMatch(combinedDocs, /E:\\实验\\1/);
  assert.doesNotMatch(combinedDocs, /E:\\实验\\hotel-comparison-app/);
  assert.doesNotMatch(docs.scraperReadme, /--templateName bw\b/);
  assert.equal(
    (docs.devReadme.match(/^## 采集性能日志$/gm) || []).length,
    1,
    'README_DEV should keep one merged performance-log section'
  );
});

test('electron-builder config excludes development perf tooling and JSONL logs', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
  );
  const files = packageJson.build.files || [];

  [
    '!devtools/**/*',
    '!logs/**/*',
    '!scripts/analyze_perf.py',
    '!**/*.jsonl',
    '!**/collect_perf.jsonl',
    '!**/perf_log.py'
  ].forEach((pattern) => {
    assert.ok(files.includes(pattern), `missing electron-builder exclude: ${pattern}`);
  });
  [
    '!node_modules/@*/*/{README,readme,readme.md,readme.txt,CHANGELOG,changelog,changelog.md,CHANGELOG.md,NEWS,news,HISTORY,history,LICENSE,license,license.md,license.txt}',
    '!node_modules/@*/*/{.github,.travis.yml,.gitignore,.eslintrc,.eslintrc.js,.eslintrc.json,.npmignore}',
    '!node_modules/@*/*/test/**/*',
    '!node_modules/@*/*/tests/**/*',
    '!node_modules/@*/*/__tests__/**/*',
    '!node_modules/@*/*/src/**/*',
    '!node_modules/@*/*/example/**/*',
    '!node_modules/@*/*/examples/**/*',
    '!node_modules/@*/*/demo/**/*',
    '!node_modules/@*/*/*.ts',
    '!node_modules/@*/*/*.map',
    '!node_modules/@*/*/docs/**/*',
    '!node_modules/@*/*/doc/**/*'
  ].forEach((pattern) => {
    assert.ok(files.includes(pattern), `missing scoped package exclude: ${pattern}`);
  });
  assert.equal(
    files.includes('!**/*token*'),
    false,
    'build.files must not use broad !**/*token* that would exclude parse5 tokenizer'
  );
});

test('NSIS installer uses simplified Chinese with unicode to avoid mojibake', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
  );
  const nsis = packageJson.build.nsis;

  assert.deepEqual(packageJson.build.electronLanguages, ['zh-CN', 'en-US']);
  assert.deepEqual(nsis.installerLanguages, ['zh_CN']);
  assert.equal(nsis.displayLanguageSelector, false);
  assert.equal(nsis.unicode, true);
  assert.equal(packageJson.build.productName, '宾馆比较终极版');
  assert.equal(nsis.shortcutName, '宾馆比较终极版');
  assert.equal(nsis.uninstallDisplayName, '宾馆比较终极版');
});

test('scraper dependency packages are declared only in the workspace package', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
  );
  const scraperPackage = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'scraper', 'package.json'), 'utf-8')
  );
  const scraperDependencyNames = ['axios', 'cheerio', 'ws'];

  assert.ok(Array.isArray(rootPackage.workspaces));
  assert.ok(rootPackage.workspaces.includes('scraper'));
  scraperDependencyNames.forEach((dependencyName) => {
    assert.equal(rootPackage.dependencies && rootPackage.dependencies[dependencyName], undefined);
    assert.equal(typeof scraperPackage.dependencies[dependencyName], 'string');
  });
});

test('createBuilderConfig always injects full-bundle extra resources', (t) => {
  const tempRoot = makeTempRoot();
  const tempOutputDir = path.join(tempRoot, 'dist-verify');
  const extraResources = [{ from: 'temp-bundle', to: 'scraper' }];

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const builderConfig = createBuilderConfig({
    projectRoot: path.resolve(__dirname, '..'),
    outputDir: tempOutputDir,
    extraResources
  });

  t.after(() => {
    fs.rmSync(builderConfig.tempDir, { recursive: true, force: true });
  });

  assert.equal(builderConfig.buildConfig.directories.output, tempOutputDir);
  assert.equal(
    builderConfig.buildConfig.extraResources.some((entry) => entry.from === 'temp-bundle'),
    true
  );
});

test('prepareFullBundle preserves scraper prompt assets', (t) => {
  const tempRoot = makeTempRoot();
  const scraperDir = path.join(tempRoot, 'scraper');
  const nodeModulesDir = path.join(tempRoot, 'node_modules');

  fs.mkdirSync(path.join(scraperDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(scraperDir, 'src', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(scraperDir, 'examples'), { recursive: true });
  fs.writeFileSync(path.join(scraperDir, 'src', 'cli.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(scraperDir, 'src', 'runtime', 'perf.js'), '// perf entry\n', 'utf-8');
  fs.writeFileSync(
    path.join(scraperDir, 'src', 'runtime', 'file-perf.js'),
    '// file-perf impl\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(scraperDir, 'src', 'runtime', 'noop-perf.js'),
    '// noop-perf impl\n',
    'utf-8'
  );
  fs.mkdirSync(path.join(scraperDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(scraperDir, 'logs', 'collect_perf_2026-05-23.jsonl'), '{}\n', 'utf-8');
  fs.mkdirSync(path.join(scraperDir, 'devtools'), { recursive: true });
  fs.writeFileSync(path.join(scraperDir, 'devtools', 'perf-log.js'), '// devtools perf\n', 'utf-8');
  fs.writeFileSync(
    path.join(scraperDir, 'src', 'runtime', 'perf_log.py'),
    '# python perf\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(scraperDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-scraper',
        dependencies: {
          axios: '^1.0.0',
          cheerio: '^1.0.0',
          ws: '^8.0.0'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(path.join(scraperDir, 'README.md'), '# fixture\n', 'utf-8');
  fs.writeFileSync(
    path.join(scraperDir, PROMPT_CONTRACT.unifiedPromptFileName),
    '# guide\n',
    'utf-8'
  );
  fs.writeFileSync(path.join(scraperDir, 'examples', 'sample.json'), '{}\n', 'utf-8');
  writePackageFixture(nodeModulesDir, 'axios', {
    dependencies: {
      'follow-redirects': '^1.0.0'
    }
  });
  writePackageFixture(nodeModulesDir, 'follow-redirects');
  writePackageFixture(nodeModulesDir, 'cheerio', {
    dependencies: {
      parse5: '^7.0.0'
    }
  });
  writePackageFixture(nodeModulesDir, 'ws');
  writePackageFixture(nodeModulesDir, 'parse5');
  const parse5TokenizerDir = path.join(nodeModulesDir, 'parse5', 'dist', 'cjs', 'tokenizer');
  fs.mkdirSync(parse5TokenizerDir, { recursive: true });
  fs.writeFileSync(path.join(parse5TokenizerDir, 'index.js'), 'module.exports = {};', 'utf-8');
  const parse5ParserDir = path.join(nodeModulesDir, 'parse5', 'dist', 'cjs', 'parser');
  fs.mkdirSync(parse5ParserDir, { recursive: true });
  fs.writeFileSync(
    path.join(parse5ParserDir, 'index.js'),
    "require('../tokenizer/index.js');",
    'utf-8'
  );

  const prepared = prepareFullBundle({
    projectRoot: tempRoot,
    scraperDir
  });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(prepared.bundleRoot, { recursive: true, force: true });
  });

  assert.equal(
    fs.existsSync(path.join(prepared.manifest.directories.scraperRoot, 'src', 'cli.js')),
    true
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, PROMPT_CONTRACT.unifiedPromptFileName)
    ),
    true
  );
  assert.equal(
    fs.existsSync(path.join(prepared.manifest.directories.scraperRoot, 'README.md')),
    false,
    'scraper README is documentation and should not be copied into the runtime bundle'
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'vendor', 'axios', 'package.json')
    ),
    true
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'vendor', 'cheerio', 'package.json')
    ),
    true
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'vendor', 'ws', 'package.json')
    ),
    true
  );
  assert.equal(
    fs.existsSync(
      path.join(
        prepared.manifest.directories.scraperRoot,
        'vendor',
        'follow-redirects',
        'package.json'
      )
    ),
    true
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'vendor', 'parse5', 'package.json')
    ),
    true,
    'parse5 package.json must be copied to full bundle'
  );
  assert.equal(
    fs.existsSync(
      path.join(
        prepared.manifest.directories.scraperRoot,
        'vendor',
        'parse5',
        'dist',
        'cjs',
        'tokenizer',
        'index.js'
      )
    ),
    true,
    'parse5 tokenizer/index.js must be copied to full bundle'
  );
  assert.equal(
    fs.existsSync(path.join(prepared.manifest.directories.scraperRoot, 'examples')),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'src', 'runtime', 'perf.js')
    ),
    true,
    'runtime/perf.js must be copied to full bundle'
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'src', 'runtime', 'file-perf.js')
    ),
    true,
    'runtime/file-perf.js must be copied to full bundle'
  );
  assert.equal(
    fs.existsSync(
      path.join(prepared.manifest.directories.scraperRoot, 'src', 'runtime', 'noop-perf.js')
    ),
    true,
    'runtime/noop-perf.js must be copied to full bundle'
  );
});

test('prepareFullBundle prunes copied vendor development assets', (t) => {
  const tempRoot = makeTempRoot();
  const scraperDir = path.join(tempRoot, 'scraper');
  const nodeModulesDir = path.join(tempRoot, 'node_modules');

  fs.mkdirSync(path.join(scraperDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(scraperDir, 'src', 'cli.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(
    path.join(scraperDir, 'package.json'),
    JSON.stringify({ name: 'fixture-scraper', dependencies: { fixturepkg: '^1.0.0' } }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(scraperDir, 'README.md'), '# fixture\n', 'utf-8');
  fs.writeFileSync(
    path.join(scraperDir, PROMPT_CONTRACT.unifiedPromptFileName),
    '# guide\n',
    'utf-8'
  );

  const packageDir = writePackageFixture(nodeModulesDir, 'fixturepkg', {
    main: 'dist/index.js',
    exports: './dist/index.js'
  });
  fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'benchmark'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'benchmarks'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'dist', 'index.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'dist', 'index.js.map'), '{}', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'dist', 'index.d.ts'), 'export {};', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'src', 'index.ts'), 'export {};', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'benchmark', 'speed.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(
    path.join(packageDir, 'benchmarks', 'speed.js'),
    'module.exports = {};',
    'utf-8'
  );
  fs.writeFileSync(path.join(packageDir, 'docs', 'usage.md'), '# docs\n', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'spec', 'index.spec.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(
    path.join(packageDir, 'specs', 'index.spec.js'),
    'module.exports = {};',
    'utf-8'
  );
  fs.writeFileSync(path.join(packageDir, 'tests', 'fixture.test.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf-8');
  fs.writeFileSync(path.join(packageDir, 'README.md'), '# package readme\n', 'utf-8');

  const prepared = prepareFullBundle({
    projectRoot: tempRoot,
    scraperDir
  });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(prepared.bundleRoot, { recursive: true, force: true });
  });

  const bundledPackageDir = path.join(
    prepared.manifest.directories.scraperRoot,
    'vendor',
    'fixturepkg'
  );

  assert.equal(fs.existsSync(path.join(bundledPackageDir, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(bundledPackageDir, 'dist', 'index.js')), true);
  [
    path.join('dist', 'index.js.map'),
    path.join('dist', 'index.d.ts'),
    path.join('src'),
    path.join('benchmark'),
    path.join('benchmarks'),
    path.join('docs'),
    path.join('spec'),
    path.join('specs'),
    path.join('tests'),
    'package-lock.json',
    'README.md'
  ].forEach((relativePath) => {
    assert.equal(
      fs.existsSync(path.join(bundledPackageDir, relativePath)),
      false,
      `${relativePath} should be pruned from copied vendor package`
    );
  });
});

test('verifyPackageLayout requires full resource layout', (t) => {
  const tempRoot = makeTempRoot();
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
    writeFile(fullResourcesDir, relativePath);
  });

  assert.throws(
    () => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'full') }),
    /缺少打包资源/
  );

  getBundleManifest('_unused').expectations.fullOnlyResources.forEach((relativePath) => {
    writeFile(fullResourcesDir, relativePath);
  });

  assert.doesNotThrow(() => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'full') }));
});

test('full package manifest requires runtime perf logger modules', () => {
  const manifest = getBundleManifest('E:/temp/bundle-root');
  assert.ok(
    manifest.expectations.fullOnlyResources.includes(
      path.join('scraper', 'src', 'runtime', 'perf.js')
    )
  );
  assert.ok(
    manifest.expectations.fullOnlyResources.includes(
      path.join('scraper', 'src', 'runtime', 'file-perf.js')
    )
  );
  assert.ok(
    manifest.expectations.fullOnlyResources.includes(
      path.join('scraper', 'src', 'runtime', 'noop-perf.js')
    )
  );
  assert.equal(
    manifest.expectations.fullOnlyResources.includes(
      path.join('scraper', 'devtools', 'perf-log.js')
    ),
    false,
    'devtools/perf-log.js must NOT be in fullOnlyResources'
  );
});

test('package layout rejects local data and login state resources', (t) => {
  const tempRoot = makeTempRoot();
  const resourcesDir = path.join(tempRoot, 'full', 'win-unpacked', 'resources');

  const writeFile = (relativePath) => {
    const targetPath = path.join(resourcesDir, relativePath);
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
  ].forEach(writeFile);
  getBundleManifest('_unused').expectations.fullOnlyResources.forEach(writeFile);
  writeFile(path.join('宾馆比较助手', 'hotel-data.json'));

  assert.throws(
    () => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'full'), mode: '2' }),
    /不应存在的打包资源/
  );
});

test('package layout rejects unexpected Electron locale packs', (t) => {
  const tempRoot = makeTempRoot();
  const unpackedDir = path.join(tempRoot, 'full', 'win-unpacked');
  const resourcesDir = path.join(unpackedDir, 'resources');
  const localesDir = path.join(unpackedDir, 'locales');

  const writeResourceFile = (relativePath) => {
    const targetPath = path.join(resourcesDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, 'fixture', 'utf-8');
  };
  const writeLocale = (name) => {
    fs.mkdirSync(localesDir, { recursive: true });
    fs.writeFileSync(path.join(localesDir, `${name}.pak`), 'fixture', 'utf-8');
  };

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  [
    path.join('shared', 'compare-app', 'constants.js'),
    path.join('shared', 'compare-app', 'data-folder.js'),
    path.join('shared', 'compare-app', 'hotel-groups.js')
  ].forEach(writeResourceFile);
  getBundleManifest('_unused').expectations.fullOnlyResources.forEach(writeResourceFile);
  writeLocale('zh-CN');
  writeLocale('en-US');
  writeLocale('ja');

  assert.throws(
    () => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'full') }),
    /不应存在的 Electron 语言包/
  );

  fs.rmSync(path.join(localesDir, 'ja.pak'), { force: true });
  assert.doesNotThrow(() => verifyPackageLayout({ tempBuildDir: path.join(tempRoot, 'full') }));
});

test('scraper unified prompt asset remains present in workspace', () => {
  const scraperRoot = path.resolve(__dirname, '..', 'scraper');
  const promptGuidePath = path.join(scraperRoot, PROMPT_CONTRACT.unifiedPromptFileName);

  assert.equal(fs.existsSync(promptGuidePath), true);
});

test('CI workflow and package scripts cover lint, tests, coverage and packaging smoke', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const workflowPath = path.join(projectRoot, '.github', 'workflows', 'ci.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf-8');

  assert.equal(typeof packageJson.scripts.lint, 'string');
  assert.equal(typeof packageJson.scripts.coverage, 'string');
  assert.equal(packageJson.scripts.build, 'node scripts/package/run-build.js');
  assert.equal(packageJson.scripts['build:win'], 'node scripts/package/run-build.js');
  assert.equal(packageJson.scripts['build:nsis'], 'node scripts/package/run-build.js');
  assert.equal(typeof packageJson.scripts['package:smoke'], 'string');
  assert.equal(packageJson.scripts['clean:runtime'], 'node scripts/cleanup-runtime-artifacts.js');
  assert.equal(
    packageJson.scripts['smoke:data-migration'],
    'node scripts/smoke/data-folder-migration-smoke.js'
  );
  assert.match(workflow, /on:\s*\n\s+push:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm install/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run coverage/);
  assert.match(workflow, /npm run package:smoke/);
});

test('package test scripts discover renderer and scraper test files automatically', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const { findNodeTestFiles } = require('../scripts/run-node-tests');

  assert.equal(packageJson.scripts['test:app'], 'node scripts/run-node-tests.js tests');
  assert.equal(packageJson.scripts['test:scraper'], 'node scripts/run-node-tests.js scraper/tests');

  const appTestFiles = findNodeTestFiles(path.join(projectRoot, 'tests')).map((filePath) =>
    path.relative(projectRoot, filePath)
  );
  const scraperTestFiles = findNodeTestFiles(path.join(projectRoot, 'scraper', 'tests')).map(
    (filePath) => path.relative(projectRoot, filePath)
  );

  assert.ok(appTestFiles.includes(path.join('tests', 'renderer-template-ui.test.js')));
  assert.ok(scraperTestFiles.includes(path.join('scraper', 'tests', 'prompt-rules.test.js')));
});

test('typecheck config covers renderer modules by directory glob', () => {
  const jsconfig = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'jsconfig.json'), 'utf-8')
  );

  assert.ok(jsconfig.include.includes('src/renderer/**/*.js'));
  assert.ok(jsconfig.include.includes('src/shared/**/*.js'));
  assert.ok(jsconfig.include.includes('src/main/domain/**/*.js'));
  assert.ok(jsconfig.include.includes('src/main/repositories/**/*.js'));
});

test('low-frequency settings modals are lazy-mounted templates', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'index.html'),
    'utf-8'
  );
  const appModule = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'app.module.js'),
    'utf-8'
  );

  ['listPrefilterModal', 'settingsModal', 'personalizationModal'].forEach((modalId) => {
    assert.match(indexHtml, new RegExp(`<template data-modal-template="${modalId}">`));
    assert.match(indexHtml, new RegExp(`<div id="${modalId}" class="modal"`));
  });
  assert.match(appModule, /document\.addEventListener\('change', handleDelegatedChange\)/);
  assert.doesNotMatch(
    appModule,
    /addEvent\('includeFourPersonRoomsForThreePersonTemplate',\s*'change'/
  );
  assert.doesNotMatch(appModule, /document\.querySelectorAll\('input\[name="themeOption"\]'\)/);
});

test('runtime artifact cleanup removes only known generated output directories', () => {
  const tempRoot = makeTempRoot();
  const generatedFiles = [
    path.join('output', 'latest-run.json'),
    path.join('state', 'session.json'),
    path.join('scraper-data', 'task.json'),
    path.join('scraper', 'output', 'batch-items', 'item.json'),
    path.join('scraper', 'state', 'edge.json'),
    path.join('scraper', 'scraper-data', 'hotel-data.json'),
    path.join('logs', 'perf', 'collect_perf.jsonl'),
    path.join('coverage', 'index.html')
  ];
  const preservedFiles = [
    path.join('src', 'main.js'),
    path.join('宾馆比较助手', 'hotel-data.json'),
    path.join('scraper', 'src', 'cli.js')
  ];

  [...generatedFiles, ...preservedFiles].forEach((relativePath) => {
    const filePath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${relativePath}\n`, 'utf-8');
  });

  const dryRun = cleanupRuntimeArtifacts({ projectRoot: tempRoot, dryRun: true });
  assert.equal(dryRun.removed.length, 0);
  assert.ok(dryRun.candidates.some((item) => item.relativePath === path.join('scraper', 'output')));
  generatedFiles.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(tempRoot, relativePath)), true);
  });

  const result = cleanupRuntimeArtifacts({ projectRoot: tempRoot });
  assert.ok(result.removed.length >= 6);
  assert.ok(result.totalBytes > 0);
  generatedFiles.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(tempRoot, relativePath)), false, relativePath);
  });
  preservedFiles.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(tempRoot, relativePath)), true, relativePath);
  });
});

test('runtime artifact cleanup rejects paths outside project root', () => {
  const tempRoot = makeTempRoot();

  assert.throws(
    () =>
      cleanupRuntimeArtifacts({
        projectRoot: tempRoot,
        runtimeArtifactPaths: ['output', '..']
      }),
    /outside project root/
  );
  assert.ok(DEFAULT_RUNTIME_ARTIFACT_PATHS.includes(path.join('scraper', 'output')));
});

test('build asset sync is implemented by the Node script without Python or Pillow', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const syncScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'sync-build-assets.js'),
    'utf-8'
  );
  const psWrapper = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'sync-build-assets.ps1'),
    'utf-8'
  );
  const runBuildScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'package', 'run-build.js'),
    'utf-8'
  );
  const smokeBuildScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'package', 'smoke-build.js'),
    'utf-8'
  );

  assert.equal(packageJson.scripts['sync-build-assets'], 'node scripts/sync-build-assets.js');
  assert.match(syncScript, /require\('sharp'\)/);
  assert.match(syncScript, /require\('png-to-ico'\)/);
  assert.doesNotMatch(syncScript, /python|pillow|PIL/i);
  assert.doesNotMatch(psWrapper, /python|pillow|PIL/i);
  assert.match(runBuildScript, /sync-build-assets\.js/);
  assert.match(smokeBuildScript, /sync-build-assets\.js/);
});

test('run-build script uses Chinese UI text and does not contain English menu strings', () => {
  const runBuildScript = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'package', 'run-build.js'),
    'utf-8'
  );

  assert.doesNotMatch(runBuildScript, /选择打包模式/);
  assert.doesNotMatch(runBuildScript, /基础版安装包/);
  assert.doesNotMatch(runBuildScript, /请选择打包模式/);
  assert.doesNotMatch(runBuildScript, /readline/);
  assert.doesNotMatch(runBuildScript, /--mode/);
  assert.match(runBuildScript, /宾馆比较终极版打包工具/);
  assert.match(runBuildScript, /正在同步构建资源/);
  assert.match(runBuildScript, /正在准备完整版采集模块资源/);
  assert.match(runBuildScript, /正在运行 electron-builder/);
  assert.match(runBuildScript, /正在校验安装包资源/);
  assert.match(runBuildScript, /打包完成/);
  assert.match(runBuildScript, /打包失败/);

  assert.doesNotMatch(runBuildScript, /Choose build mode/);
  assert.doesNotMatch(runBuildScript, /Base package/);
  assert.doesNotMatch(runBuildScript, /Full package with scraper resources/);
  assert.doesNotMatch(runBuildScript, /Select mode/);
  assert.doesNotMatch(runBuildScript, /Hotel Comparison Packager/);
});

test('build-nsis.bat uses Chinese UI with GBK codepage and CRLF line endings', () => {
  const batBuffer = fs.readFileSync(path.resolve(__dirname, '..', 'build-nsis.bat'));
  const asciiPart = batBuffer.toString('ascii');

  assert.ok(asciiPart.startsWith('@echo off'), 'bat file must start with @echo off');
  assert.ok(asciiPart.includes('chcp 936'), 'bat file must use GBK codepage');

  const crlfCount = batBuffer.filter((b) => b === 0x0d).length;
  const lfCount = batBuffer.filter((b) => b === 0x0a).length;
  assert.ok(crlfCount > 0, 'bat file must use CRLF line endings');
  assert.equal(crlfCount, lfCount, 'CR and LF count must match for CRLF');

  assert.doesNotMatch(asciiPart, /Hotel Comparison Packager/);
  assert.doesNotMatch(asciiPart, /Choose build mode/);
  assert.doesNotMatch(asciiPart, /Base package/);
  assert.doesNotMatch(asciiPart, /BUILD_MODE/);
  assert.doesNotMatch(asciiPart, /Build completed/);
  assert.doesNotMatch(asciiPart, /Packaging failed/);
  assert.doesNotMatch(asciiPart, /Select mode/);
  assert.doesNotMatch(asciiPart, /Latest installer/);
  assert.doesNotMatch(asciiPart, /Node\.js was not found/);
});
