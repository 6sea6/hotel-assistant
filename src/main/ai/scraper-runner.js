const path = require('path');
const {
  ensureScraperRuntimeDirs,
  loadScraperModule,
  resolveRootPerfLogDir,
  resolveScraperPath,
  resolveScraperWorkDir,
  withScraperEnvironment
} = require('./scraper-paths');
const {
  assertNotCancelled,
  assertSafeWriteResult,
  buildScraperArgs,
  emitScraperEvent,
  getCtripHotelInputUrls,
  isCtripHotelUrl,
  isTaskCancelled
} = require('./scraper-task-input');
const {
  createWriteRollbackSnapshot,
  restoreWriteRollbackSnapshot
} = require('./scraper-write-rollback');
const {
  refreshExistingCtripHotels,
  runRefreshHotelBatch
} = require('./refresh-runner');

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

function buildLoginRetrySummary(previousResult = {}, retryNeed = {}) {
  return {
    attempted: true,
    reason: retryNeed.reason || '',
    previousTotalPrice: previousResult.totalPrice ?? null,
    previousEligibleCount: previousResult.eligibleCount ?? 0,
    previousPageSnapshot: getPageSnapshot(previousResult)
  };
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
            '程序会打开一个可见浏览器窗口。请在窗口中登录携程，确认酒店页能看到价格后关闭该窗口，采集会自动重试一次。'
        });
        emitScraperEvent(context, 'edge:login-window', '已打开浏览器登录窗口，等待你完成登录', {
          instruction: '登录完成后请关闭浏览器窗口；关闭后程序会继续采集，不需要重新发送链接。'
        });

        assertNotCancelled(context.signal);
        const { runInteractiveEdgeLoginPrep } = await loadScraperModule(
          scraperPath,
          'cli/auto-edge.js'
        );
        const loginPrepResult = await runInteractiveEdgeLoginPrep({
          userDataDir: path.join(workDir, 'state', 'edge-profile'),
          profileDirectory: 'Default',
          browserPreference: input.collectBrowser,
          port: 9222,
          url: input.url || 'https://hotels.ctrip.com/'
        });
        assertNotCancelled(context.signal);

        if (loginPrepResult && loginPrepResult.loginConfirmed) {
          emitScraperEvent(context, 'edge:login-done', '携程登录窗口已关闭，正在重新采集价格', {
            reason: retryNeed.reason
          });
        } else {
          emitScraperEvent(context, 'edge:login-unconfirmed', '携程登录窗口已关闭，但尚未确认登录态', {
            reason: retryNeed.reason,
            instruction: '请重新执行采集，并在弹出的浏览器窗口中完成携程登录后再关闭窗口。'
          });
        }
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
            ? `${writeSafety.reason} 已自动打开浏览器让你重新登录携程并重试一次；如果页面仍看不到价格，请在采集浏览器中确认账号已登录且目标酒店页显示具体房价后再重新采集。`
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
    const loginPrepResult = await runInteractiveEdgeLoginPrep({
      userDataDir: path.join(workDir, 'state', 'edge-profile'),
      profileDirectory: 'Default',
      browserPreference: input.collectBrowser,
      port: 9222,
      url: input.url || 'https://hotels.ctrip.com/'
    });

    return {
      success: Boolean(loginPrepResult && loginPrepResult.loginConfirmed),
      message:
        loginPrepResult && loginPrepResult.loginConfirmed
          ? '浏览器登录态准备完成。'
          : '浏览器窗口已关闭，但尚未确认携程登录态。'
    };
  });
}

module.exports = {
  assertSafeWriteResult,
  buildScraperArgs,
  createWriteRollbackSnapshot,
  collectAndWriteCtripHotel,
  getVisibleLoginRetryNeed,
  isCtripHotelUrl,
  isTaskCancelled,
  loadScraperModule,
  openVisibleEdgeLogin,
  refreshExistingCtripHotels,
  resolveRootPerfLogDir,
  runRefreshHotelBatch,
  restoreWriteRollbackSnapshot,
  resolveScraperPath,
  resolveScraperWorkDir
};
