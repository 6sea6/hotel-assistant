let scraperRunnerPromise = null;

function formatLoadError(error) {
  const message = error && error.message ? error.message : String(error || '未知错误');
  return new Error(`采集模块加载失败：${message}`);
}

async function loadScraperRunner() {
  if (!scraperRunnerPromise) {
    scraperRunnerPromise = import('./scraper-runner.js')
      .then((module) => module.default || module)
      .catch((error) => {
        scraperRunnerPromise = null;
        throw formatLoadError(error);
      });
  }

  return scraperRunnerPromise;
}

function clearScraperRunnerForTests() {
  scraperRunnerPromise = null;
}

module.exports = {
  clearScraperRunnerForTests,
  loadScraperRunner
};
