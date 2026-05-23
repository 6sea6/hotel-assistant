const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Module = require('module');
const {
  ensureBundledBootstrapResources,
  getScraperPath,
  isBundledWithScraper
} = require('../bundled-setup');

const scraperModuleCache = new Map();
const TRAILING_URL_PUNCTUATION = /[)\]}>，。；;、！？!?.,]+$/;
const INLINE_URL_TEXT_SEPARATOR = /[,，。；;、！？!?](?=[\u4e00-\u9fff])/;

function resolveEmbeddedScraperPath(options = {}) {
  return path.resolve(options.currentDir || __dirname, '..', '..', '..', 'scraper');
}

function resolveScraperPath(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  let bundledAvailable = false;
  try {
    bundledAvailable =
      typeof options.isBundledWithScraper === 'function'
        ? options.isBundledWithScraper()
        : isBundledWithScraper();
  } catch (error) {
    bundledAvailable = false;
  }
  const bundledScraperPath = bundledAvailable
    ? typeof options.getScraperPath === 'function'
      ? options.getScraperPath()
      : getScraperPath()
    : '';
  const candidates = [
    bundledAvailable ? bundledScraperPath : '',
    resolveEmbeddedScraperPath(options),
    process.resourcesPath ? path.join(process.resourcesPath, 'scraper') : ''
  ].filter(Boolean);

  const resolved = candidates.find((candidate) =>
    existsSync(path.join(candidate, 'src', 'task-runner.js'))
  );
  if (!resolved) {
    throw new Error('未找到内置采集器，请确认项目内 scraper 目录或完整版采集资源存在。');
  }

  return resolved;
}

function resolveSharedCompareAppDir() {
  return path.resolve(__dirname, '..', '..', '..', 'shared', 'compare-app');
}

function resolveScraperWorkDir(dataFolderPath, scraperPath = resolveScraperPath()) {
  if (isBundledWithScraper()) {
    return path.join(dataFolderPath, 'scraper-data');
  }

  return scraperPath;
}

function ensureScraperRuntimeDirs(workDir) {
  if (isBundledWithScraper()) {
    ensureBundledBootstrapResources();
  }

  [
    path.join(workDir, 'state', 'edge-profile'),
    path.join(workDir, 'output'),
    path.join(workDir, 'output', 'raw-pages')
  ].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function applyScraperVendorPath(scraperPath) {
  const vendorPath = path.join(scraperPath, 'vendor');
  if (!fs.existsSync(vendorPath)) {
    return () => {};
  }

  const previousNodePath = process.env.NODE_PATH;
  const currentPaths = previousNodePath
    ? previousNodePath.split(path.delimiter).filter(Boolean)
    : [];
  if (!currentPaths.includes(vendorPath)) {
    process.env.NODE_PATH = [vendorPath, ...currentPaths].join(path.delimiter);
    Module._initPaths();
  }

  return () => {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
    Module._initPaths();
  };
}

async function withScraperEnvironment(dataFolderPath, scraperPath, task) {
  const previousDataDir = process.env.HOTEL_COMPARE_APP_DATA_DIR;
  const previousSharedDir = process.env.HOTEL_COMPARE_SHARED_DIR;
  const restoreVendorPath = applyScraperVendorPath(scraperPath);

  process.env.HOTEL_COMPARE_APP_DATA_DIR = dataFolderPath;
  process.env.HOTEL_COMPARE_SHARED_DIR = resolveSharedCompareAppDir();

  try {
    return await task();
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.HOTEL_COMPARE_APP_DATA_DIR;
    } else {
      process.env.HOTEL_COMPARE_APP_DATA_DIR = previousDataDir;
    }

    if (previousSharedDir === undefined) {
      delete process.env.HOTEL_COMPARE_SHARED_DIR;
    } else {
      process.env.HOTEL_COMPARE_SHARED_DIR = previousSharedDir;
    }
    restoreVendorPath();
  }
}

async function loadScraperModule(scraperPath, moduleFile) {
  const modulePath = path.join(scraperPath, 'src', moduleFile);
  const cacheKey = path.resolve(modulePath);
  if (!scraperModuleCache.has(cacheKey)) {
    scraperModuleCache.set(
      cacheKey,
      import(pathToFileURL(modulePath).href)
        .then((module) => module.default || module)
        .catch((error) => {
          scraperModuleCache.delete(cacheKey);
          const message = error && error.message ? error.message : String(error || '未知错误');
          throw new Error(`采集模块加载失败（${moduleFile}）：${message}`);
        })
    );
  }

  return scraperModuleCache.get(cacheKey);
}

function isCtripHotelUrl(url) {
  try {
    let cleaned = String(url || '')
      .replace(/&amp;/g, '&')
      .trim();
    const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
    if (inlineTextIndex > 0) {
      cleaned = cleaned.slice(0, inlineTextIndex);
    }
    while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
      cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
    }
    const parsed = new URL(cleaned);
    const host = parsed.hostname.toLowerCase();
    const href = parsed.href.toLowerCase();
    return /(^|\.)ctrip\.com$/.test(host) && /hotel|hotels/.test(href);
  } catch (error) {
    return false;
  }
}

function extractUrlsFromText(value) {
  const values = Array.isArray(value) ? value : [value];
  const urls = [];
  const seen = new Set();

  for (const item of values) {
    const text = String(item || '');
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const match of matches) {
      let cleaned = match.replace(/&amp;/g, '&').trim();
      const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
      if (inlineTextIndex > 0) {
        cleaned = cleaned.slice(0, inlineTextIndex);
      }
      while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
        cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
      }
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }

  return urls;
}

function getCtripHotelInputUrls(input = {}) {
  const rawValues = [input.url, input.urls, input.text, input.inputText];
  return extractUrlsFromText(rawValues).filter(isCtripHotelUrl);
}

function buildScraperArgs(input, workDir) {
  const args = {
    url: input.url,
    urls: Array.isArray(input.urls) ? input.urls.join('\n') : input.urls,
    text: input.text || input.inputText || '',
    listFilters:
      input.listFilters && typeof input.listFilters === 'object' ? input.listFilters : undefined,
    listUrlFilters:
      input.listUrlFilters && typeof input.listUrlFilters === 'object'
        ? input.listUrlFilters
        : undefined,
    'auto-edge': true,
    'edge-user-data-dir': path.join(workDir, 'state', 'edge-profile'),
    'edge-profile-directory': 'Default',
    'edge-debugging-port': 9222,
    latestRun: path.join(workDir, 'output', 'latest-run.json')
  };

  if (input.templateId !== null && input.templateId !== undefined && input.templateId !== '') {
    args.templateId = input.templateId;
  }
  if (input.templateName) {
    args.templateName = input.templateName;
  }

  if (input.targetCount !== null && input.targetCount !== undefined && input.targetCount !== '') {
    args.targetCount = input.targetCount;
  }
  if (
    input.maxCandidatesPerPage !== null &&
    input.maxCandidatesPerPage !== undefined &&
    input.maxCandidatesPerPage !== ''
  ) {
    args.maxCandidatesPerPage = input.maxCandidatesPerPage;
  }
  if (
    input.desiredHotelCount !== null &&
    input.desiredHotelCount !== undefined &&
    input.desiredHotelCount !== ''
  ) {
    args.desiredHotelCount = input.desiredHotelCount;
  }
  if (input.excludeHotelTypes) {
    args.excludeHotelTypes = input.excludeHotelTypes;
  }
  if (input.excludeAccommodationKeywords) {
    args.excludeAccommodationKeywords = input.excludeAccommodationKeywords;
  }
  if (
    input.amapKey !== null &&
    input.amapKey !== undefined &&
    String(input.amapKey).trim() !== ''
  ) {
    args.amapKey = String(input.amapKey).trim();
  }
  [
    'priceMin',
    'priceMax',
    'starLevels',
    'sortMode',
    'freeCancel',
    'reviewCountMin',
    'ctripScoreMin'
  ].forEach((key) => {
    if (input[key] !== undefined) {
      args[key] = input[key];
    }
  });

  return args;
}

function assertSafeWriteResult(result) {
  if (!result || result.success !== true) {
    return {
      ok: false,
      reason: result && result.error ? result.error : '采集失败，未写入。'
    };
  }

  if (!Number.isFinite(Number(result.eligibleCount)) || Number(result.eligibleCount) <= 0) {
    return {
      ok: false,
      reason: '没有符合模板人数、价格和房型规则的候选房型，未写入。'
    };
  }

  if (result.totalPrice === null || result.totalPrice === undefined || result.totalPrice === '') {
    return {
      ok: false,
      reason: '未采集到有效价格，未写入。'
    };
  }

  return {
    ok: true,
    reason: ''
  };
}

function getPageSnapshot(result = {}) {
  return result.pageSnapshot || result.page_snapshot || null;
}

function hasLockedPriceSignal(result = {}) {
  const pageSnapshot = getPageSnapshot(result);
  if (!pageSnapshot || typeof pageSnapshot !== 'object') {
    return false;
  }

  if (pageSnapshot.selected_room_price_locked) {
    return true;
  }

  return (Array.isArray(pageSnapshot.sources) ? pageSnapshot.sources : []).some(
    (source) => source && source.locked_price_detected
  );
}

function getVisibleLoginRetryNeed(result = {}) {
  if (!result || result.success !== true) {
    return {
      needed: false,
      reason: ''
    };
  }

  const pageSnapshot = getPageSnapshot(result) || {};
  const totalPriceMissing =
    result.totalPrice === null || result.totalPrice === undefined || result.totalPrice === '';
  const roomPricesMissing = !Array.isArray(result.roomPrices) || result.roomPrices.length === 0;
  const candidatesCount = Number(pageSnapshot.room_candidates_count || 0);
  const visiblePriceMissing = candidatesCount > 0 && pageSnapshot.room_price_visible === false;
  const lockedPrice = hasLockedPriceSignal(result);

  if (lockedPrice && totalPriceMissing) {
    return {
      needed: true,
      reason: '检测到携程页面显示“登录看低价/解锁优惠”，当前登录态可能已失效。'
    };
  }

  if (totalPriceMissing && (visiblePriceMissing || (roomPricesMissing && candidatesCount > 0))) {
    return {
      needed: true,
      reason: '已找到房型信息，但未采集到有效价格，携程可能要求重新登录后才显示价格。'
    };
  }

  return {
    needed: false,
    reason: ''
  };
}

function emitScraperEvent(context = {}, type, message, details = {}) {
  if (typeof context.onEvent !== 'function') {
    return;
  }

  context.onEvent({
    type,
    message,
    details,
    at: new Date().toISOString()
  });
}

function assertNotCancelled(signal) {
  if (signal && signal.aborted) {
    throw new Error('任务已取消');
  }
}

function isTaskCancelled(error, signal) {
  if (signal && signal.aborted) {
    return true;
  }

  const message = error && error.message ? error.message : String(error || '');
  return /任务已取消/.test(message) || (error && error.name === 'AbortError');
}

async function createWriteRollbackSnapshot(scraperPath, rollbackState = {}) {
  if (rollbackState.created) {
    return rollbackState;
  }

  const bridge = await loadScraperModule(scraperPath, 'compare-app-bridge.js');
  const storePath = bridge.getCompareAppStorePath();
  rollbackState.created = true;
  rollbackState.restored = false;
  rollbackState.storePath = storePath;
  rollbackState.storeExisted = fs.existsSync(storePath);
  rollbackState.snapshotJson = rollbackState.storeExisted ? fs.readFileSync(storePath, 'utf8') : '';

  return rollbackState;
}

function restoreWriteRollbackSnapshot(rollbackState = {}, context = {}) {
  if (!rollbackState.created || rollbackState.restored || !rollbackState.storePath) {
    return null;
  }

  emitScraperEvent(context, 'write:rollback-start', '任务已取消，正在撤销本次已写回的数据', {
    storePath: rollbackState.storePath
  });

  if (rollbackState.storeExisted) {
    fs.mkdirSync(path.dirname(rollbackState.storePath), { recursive: true });
    fs.writeFileSync(rollbackState.storePath, rollbackState.snapshotJson || '', 'utf8');
  } else if (fs.existsSync(rollbackState.storePath)) {
    fs.unlinkSync(rollbackState.storePath);
  }

  rollbackState.restored = true;
  const result = {
    restored: true,
    storePath: rollbackState.storePath,
    storeExisted: Boolean(rollbackState.storeExisted)
  };
  emitScraperEvent(context, 'write:rollback-done', '已撤销本次取消任务的写回数据', result);

  return result;
}

function buildLoginRetrySummary(previousResult = {}, retryNeed = {}) {
  return {
    attempted: true,
    reason: retryNeed.reason || '',
    previousTotalPrice: previousResult.totalPrice ?? null,
    previousEligibleCount: previousResult.eligibleCount ?? 0,
    previousPageSnapshot: getPageSnapshot(previousResult)
  };
}

function resolveRootPerfLogDir() {
  return path.resolve('logs', 'perf');
}

async function runCollectTask(scraperPath, input, workDir, context) {
  const { runHotelImportTask } = await loadScraperModule(scraperPath, 'task-runner.js');
  return runHotelImportTask(buildScraperArgs(input, workDir), {
    workingDirectory: workDir,
    taskId: context.taskId,
    signal: context.signal,
    onEvent: context.onEvent,
    perfLogEnabled: Boolean(input.enableCollectPerfLog),
    perfLogDir: resolveRootPerfLogDir()
  });
}

async function runApplyTask(scraperPath, outputPath, workDir, context, options = {}) {
  const { runHotelImportTask } = await loadScraperModule(scraperPath, 'task-runner.js');
  const args = {
    'apply-output': outputPath,
    latestRun: path.join(workDir, 'output', 'latest-run.json')
  };
  if (options.overwriteExistingGroup) {
    args['overwrite-existing-group'] = true;
  }

  return runHotelImportTask(args, {
    workingDirectory: workDir,
    taskId: context.taskId,
    signal: context.signal,
    onEvent: context.onEvent
  });
}

async function applyBatchItemOutputs(scraperPath, collectResult, workDir, context, rollbackState) {
  const items = Array.isArray(collectResult.items) ? collectResult.items : [];
  const itemResults = [];

  for (const item of items) {
    assertNotCancelled(context.signal);

    if (!item || item.success !== true) {
      itemResults.push({
        item,
        skipped: true,
        reason: item && item.error ? item.error : '该详情页采集失败，未写入。'
      });
      continue;
    }

    if (!item.outputPath) {
      itemResults.push({
        item,
        skipped: true,
        reason: '该详情页没有可复核输出文件，未写入。'
      });
      continue;
    }

    const writeSafety = assertSafeWriteResult(item);
    if (!writeSafety.ok) {
      itemResults.push({
        item,
        skipped: true,
        reason: writeSafety.reason
      });
      continue;
    }

    await createWriteRollbackSnapshot(scraperPath, rollbackState);
    const applyResult = await runApplyTask(scraperPath, item.outputPath, workDir, context);
    assertNotCancelled(context.signal);
    itemResults.push({
      item,
      skipped: false,
      writeResult: applyResult.writeResult || null,
      latestApplyResult: applyResult
    });
  }

  return {
    batchMode: true,
    appliedCount: itemResults.filter((result) => !result.skipped).length,
    skippedCount: itemResults.filter((result) => result.skipped).length,
    items: itemResults
  };
}

async function collectAndWriteCtripHotel(input, context = {}) {
  const dataFolderPath = context.dataFolderPath;
  if (!dataFolderPath) {
    throw new Error('缺少比较助手数据目录，无法写入。');
  }
  if (getCtripHotelInputUrls(input).length === 0) {
    throw new Error('只支持携程酒店详情页或酒店列表页链接。');
  }
  if (!input.templateId && !input.templateName) {
    throw new Error('请提供模板 ID 或模板名称。');
  }

  const scraperPath = resolveScraperPath();
  const workDir = resolveScraperWorkDir(dataFolderPath, scraperPath);
  ensureScraperRuntimeDirs(workDir);

  return withScraperEnvironment(dataFolderPath, scraperPath, async () => {
    const rollbackState = {};

    try {
      assertNotCancelled(context.signal);
      let collectResult = await runCollectTask(scraperPath, input, workDir, context);
      assertNotCancelled(context.signal);
      const retryNeed = getVisibleLoginRetryNeed(collectResult);

      if (retryNeed.needed && !(collectResult.loginRetry && collectResult.loginRetry.attempted)) {
        emitScraperEvent(context, 'edge:login-required', '需要重新登录携程后继续采集', {
          reason: retryNeed.reason,
          instruction:
            '程序会打开一个可见 Edge 窗口。请在窗口中登录携程，确认酒店页能看到价格后关闭该窗口，采集会自动重试一次。'
        });
        emitScraperEvent(context, 'edge:login-window', '已打开 Edge 登录窗口，等待你完成登录', {
          instruction: '登录完成后请关闭 Edge 窗口；关闭后程序会继续采集，不需要重新发送链接。'
        });

        assertNotCancelled(context.signal);
        const { runInteractiveEdgeLoginPrep } = await loadScraperModule(
          scraperPath,
          'cli/auto-edge.js'
        );
        await runInteractiveEdgeLoginPrep({
          userDataDir: path.join(workDir, 'state', 'edge-profile'),
          profileDirectory: 'Default',
          port: 9222,
          url: input.url || 'https://hotels.ctrip.com/'
        });
        assertNotCancelled(context.signal);

        emitScraperEvent(context, 'edge:login-done', '携程登录窗口已关闭，正在重新采集价格', {
          reason: retryNeed.reason
        });
        emitScraperEvent(context, 'scrape:retry', '正在使用新的携程登录态重新采集酒店页面');

        const previousCollectResult = collectResult;
        collectResult = await runCollectTask(scraperPath, input, workDir, context);
        assertNotCancelled(context.signal);
        collectResult.loginRetry = buildLoginRetrySummary(previousCollectResult, retryNeed);
      }

      if (collectResult.batchMode) {
        const batchApplyResult = await applyBatchItemOutputs(
          scraperPath,
          collectResult,
          workDir,
          context,
          rollbackState
        );
        assertNotCancelled(context.signal);
        return {
          ...collectResult,
          writeSkipped: batchApplyResult.appliedCount === 0,
          writeSkipReason:
            batchApplyResult.appliedCount === 0 ? '批量采集没有可安全写入的详情页结果。' : '',
          writeResult: batchApplyResult,
          latestApplyResult: batchApplyResult
        };
      }

      const writeSafety = assertSafeWriteResult(collectResult);
      if (!writeSafety.ok) {
        const retriedButStillMissingPrice =
          collectResult.loginRetry &&
          collectResult.loginRetry.attempted &&
          writeSafety.reason.includes('未采集到有效价格');
        return {
          ...collectResult,
          writeSkipped: true,
          writeSkipReason: retriedButStillMissingPrice
            ? `${writeSafety.reason} 已自动打开 Edge 让你重新登录携程并重试一次；如果页面仍看不到价格，请在 Edge 中确认账号已登录且目标酒店页显示具体房价后再重新采集。`
            : writeSafety.reason,
          writeResult: null
        };
      }

      await createWriteRollbackSnapshot(scraperPath, rollbackState);
      const applyResult = await runApplyTask(
        scraperPath,
        collectResult.outputPath,
        workDir,
        context
      );
      assertNotCancelled(context.signal);

      return {
        ...collectResult,
        writeResult: applyResult.writeResult || null,
        latestApplyResult: applyResult
      };
    } catch (error) {
      if (isTaskCancelled(error, context.signal)) {
        restoreWriteRollbackSnapshot(rollbackState, context);
      }
      throw error;
    }
  });
}

async function openVisibleEdgeLogin(input, context = {}) {
  if (!isCtripHotelUrl(input.url || 'https://hotels.ctrip.com/')) {
    throw new Error('只支持携程酒店链接。');
  }

  const dataFolderPath = context.dataFolderPath;
  const scraperPath = resolveScraperPath();
  const workDir = resolveScraperWorkDir(dataFolderPath, scraperPath);
  ensureScraperRuntimeDirs(workDir);

  return withScraperEnvironment(dataFolderPath, scraperPath, async () => {
    const { runInteractiveEdgeLoginPrep } = await loadScraperModule(
      scraperPath,
      'cli/auto-edge.js'
    );
    await runInteractiveEdgeLoginPrep({
      userDataDir: path.join(workDir, 'state', 'edge-profile'),
      profileDirectory: 'Default',
      port: 9222,
      url: input.url || 'https://hotels.ctrip.com/'
    });

    return {
      success: true,
      message: 'Edge 登录态准备完成。'
    };
  });
}

module.exports = {
  assertSafeWriteResult,
  createWriteRollbackSnapshot,
  collectAndWriteCtripHotel,
  getVisibleLoginRetryNeed,
  isCtripHotelUrl,
  isTaskCancelled,
  loadScraperModule,
  openVisibleEdgeLogin,
  resolveRootPerfLogDir,
  restoreWriteRollbackSnapshot,
  resolveScraperPath,
  resolveScraperWorkDir
};
