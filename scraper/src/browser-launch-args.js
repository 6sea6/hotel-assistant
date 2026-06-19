const VISIBLE_BROWSER_WINDOW_ARGS = Object.freeze([
  '--new-window',
  '--window-size=1280,900',
  '--window-position=80,80'
]);

const BASE_BACKGROUND_BROWSER_WINDOW_ARGS = Object.freeze([
  '--disable-gpu',
  '--headless=new',
  '--no-startup-window'
]);

const BACKGROUND_360_BROWSER_WINDOW_ARGS = Object.freeze([
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-component-update',
  '--disable-sync',
  '--start-minimized',
  '--window-size=1280,900',
  '--window-position=-32000,-32000'
]);

function normalizeBrowserRuntime(runtimeOrName = {}, browserPreference = '') {
  if (typeof runtimeOrName === 'string') {
    return {
      browserName: runtimeOrName,
      browserPreference
    };
  }

  return runtimeOrName && typeof runtimeOrName === 'object' ? runtimeOrName : {};
}

function is360BrowserRuntime(runtimeOrName = {}, browserPreference = '') {
  const runtime = normalizeBrowserRuntime(runtimeOrName, browserPreference);
  return (
    runtime.browserName === '360 Browser' ||
    runtime.browserPreference === '360' ||
    runtime.browser === '360' ||
    runtime.collectBrowser === '360' ||
    /(^|[\\/])360[^\\/]*\.exe$/i.test(
      String(runtime.browserExecutable || runtime.edgeExecutable || '')
    )
  );
}

function buildVisibleBrowserWindowArgs() {
  return [...VISIBLE_BROWSER_WINDOW_ARGS];
}

function buildBackgroundBrowserWindowArgs(runtimeOrName = {}, browserPreference = '') {
  const args = [...BASE_BACKGROUND_BROWSER_WINDOW_ARGS];
  if (is360BrowserRuntime(runtimeOrName, browserPreference)) {
    args.push(...BACKGROUND_360_BROWSER_WINDOW_ARGS);
  }
  return args;
}

module.exports = {
  buildBackgroundBrowserWindowArgs,
  buildVisibleBrowserWindowArgs,
  is360BrowserRuntime
};
