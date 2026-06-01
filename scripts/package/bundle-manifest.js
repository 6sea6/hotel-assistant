const path = require('path');
const { DEFAULT_COMPARE_APP_FILES } = require('../../shared/compare-app/constants');
const {
  BUNDLE_RESOURCE_MAP,
  PROMPT_CONTRACT
} = require('../../shared/compare-app/prompt-contract');

function getSetupArtifactName(version) {
  return `宾馆比较终极版-完整版-${version}.exe`;
}

function getBundleManifest(bundleRoot) {
  const scraperRoot = path.join(bundleRoot, BUNDLE_RESOURCE_MAP.scraperDirName);

  return {
    directories: {
      bundleRoot,
      scraperRoot
    },
    extraResources: [
      {
        from: scraperRoot,
        to: BUNDLE_RESOURCE_MAP.scraperDirName,
        filter: [
          '**/*',
          '!examples/**',
          '!tests/**',
          '!devtools/**',
          '!logs/**',
          '!README.md',
          '!scripts/analyze_perf.py',
          '!src/devtools/**',
          '!state/**',
          '!output/**',
          '!scraper-data/**',
          '!**/*.jsonl',
          '!**/collect_perf.jsonl',
          '!**/perf_log.py',
          '!**/edge-profile/**',
          '!**/raw-pages/**',
          '!**/hotel-data.json',
          '!**/*api*key*'
        ]
      }
    ],
    expectations: {
      sharedResources: [
        path.join('shared', 'compare-app', 'constants.js'),
        path.join('shared', 'compare-app', 'data-folder.js'),
        path.join('shared', 'compare-app', 'hotel-groups.js')
      ],
      fullOnlyResources: [
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'cli.js'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'runtime', 'perf.js'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'runtime', 'file-perf.js'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'runtime', 'noop-perf.js'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'vendor', 'axios', 'package.json'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'vendor', 'cheerio', 'package.json'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'vendor', 'ws', 'package.json'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'vendor', 'parse5', 'package.json'),
        path.join(
          BUNDLE_RESOURCE_MAP.scraperDirName,
          'vendor',
          'parse5',
          'dist',
          'cjs',
          'tokenizer',
          'index.js'
        ),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, PROMPT_CONTRACT.unifiedPromptFileName)
      ],
      neverResources: [
        path.join(DEFAULT_COMPARE_APP_FILES.appFolderName, DEFAULT_COMPARE_APP_FILES.storeFileName),
        path.join(BUNDLE_RESOURCE_MAP.runtimeWorkDirName, 'state', 'edge-profile'),
        path.join('devtools'),
        path.join('logs'),
        path.join('scripts', 'analyze_perf.py'),
        path.join('state', 'edge-profile'),
        path.join('output', 'latest-run.json'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'devtools'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'logs'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'README.md'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'examples'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'tests'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'scripts', 'analyze_perf.py'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'devtools'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'runtime', 'perf_log.py'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'state'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'output'),
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'scraper-data')
      ]
    }
  };
}

module.exports = {
  getBundleManifest,
  getSetupArtifactName
};
