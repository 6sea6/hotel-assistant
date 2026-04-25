function getBundledSetup() {
  return require('../bundled-setup');
}

function createBundleService() {
  return {
    ensureBootstrapResources() {
      return getBundledSetup().ensureBundledBootstrapResources();
    },
    ensureRuntimeDirs() {
      return getBundledSetup().ensureBundledRuntimeDirs();
    },
    getScraperPath() {
      return getBundledSetup().getScraperPath();
    },
    isBundledWithScraper() {
      return getBundledSetup().isBundledWithScraper();
    },
    scheduleSetup(delayMs = 0) {
      return getBundledSetup().scheduleBundledSetup(delayMs);
    },
    setupModules() {
      return getBundledSetup().setupBundledModules();
    }
  };
}

module.exports = {
  createBundleService
};
