const path = require('path');
const { BUNDLE_RESOURCE_MAP, PROMPT_CONTRACT } = require('../../shared/compare-app/prompt-contract');

function getSetupArtifactName(mode, version) {
  return mode === '2'
    ? `宾馆比较终极版-完整版-${version}.exe`
    : `宾馆比较终极版-基础版-${version}.exe`;
}

function getBundleManifest(bundleRoot) {
  const scraperRoot = path.join(bundleRoot, BUNDLE_RESOURCE_MAP.scraperDirName);
  const skillRoot = path.join(bundleRoot, BUNDLE_RESOURCE_MAP.skillDirName);
  const compareAppRoot = path.join(bundleRoot, BUNDLE_RESOURCE_MAP.compareAppDirName);

  return {
    directories: {
      bundleRoot,
      scraperRoot,
      skillRoot,
      compareAppRoot
    },
    extraResources: [
      {
        from: scraperRoot,
        to: BUNDLE_RESOURCE_MAP.scraperDirName,
        filter: ['**/*', '!state/**', '!output/**']
      },
      {
        from: skillRoot,
        to: BUNDLE_RESOURCE_MAP.skillDirName
      },
      {
        from: path.join(compareAppRoot, PROMPT_CONTRACT.compareAppPromptsFileName),
        to: path.posix.join(BUNDLE_RESOURCE_MAP.compareAppDirName, PROMPT_CONTRACT.compareAppPromptsFileName)
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
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, PROMPT_CONTRACT.unifiedPromptFileName),
        path.join(BUNDLE_RESOURCE_MAP.skillDirName, PROMPT_CONTRACT.bundledSkillEntryFileName),
        path.join(BUNDLE_RESOURCE_MAP.compareAppDirName, PROMPT_CONTRACT.compareAppPromptsFileName)
      ],
      baseOnlyAbsentResources: [
        path.join(BUNDLE_RESOURCE_MAP.scraperDirName, 'src', 'cli.js'),
        path.join(BUNDLE_RESOURCE_MAP.skillDirName, PROMPT_CONTRACT.bundledSkillEntryFileName),
        path.join(BUNDLE_RESOURCE_MAP.compareAppDirName, PROMPT_CONTRACT.compareAppPromptsFileName)
      ]
    }
  };
}

module.exports = {
  getBundleManifest,
  getSetupArtifactName
};
