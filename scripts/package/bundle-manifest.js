const path = require('path');
const { BUNDLE_RESOURCE_MAP, PROMPT_CONTRACT } = require('../../shared/compare-app/prompt-contract');

function getSetupArtifactName(mode, version) {
  return mode === '2'
    ? `宾馆比较终极版-完整版-${version}.exe`
    : `宾馆比较终极版-基础版-${version}.exe`;
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
        filter: ['**/*', '!state/**', '!output/**']
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
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, PROMPT_CONTRACT.unifiedPromptFileName)
      ],
      baseOnlyAbsentResources: [
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'cli.js')
      ]
    }
  };
}

module.exports = {
  getBundleManifest,
  getSetupArtifactName
};
