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
  isAddressSearchInput,
  isTaskCancelled
} = require('./scraper-task-input');
const {
  createWriteRollbackSnapshot,
  restoreWriteRollbackSnapshot
} = require('./scraper-write-rollback');
const { refreshExistingCtripHotels, runRefreshHotelBatch } = require('./refresh-runner');
const { buildLoginRetrySummary, getVisibleLoginRetryNeed } = require('./ctrip-login-retry');

const LOGIN_REQUIRED_ABORT_CODE = 'CTRIP_LOGIN_REQUIRED_ABORT';

function isHardLoginRequiredEvent(event = {}) {
  if (!event || event.type !== 'edge:login-required') {
    return false;
  }

  const details = event.details && typeof event.details === 'object' ? event.details : {};
  if (details.actionRequired === false) {
    return false;
  }

  const text = [details.reason, details.instruction, event.message].filter(Boolean).join(' ');
  if (/未检测到可复用的携程登录资料|首次采集需要登录/.test(text)) {
    return false;
  }

  return (
    details.actionRequired === true ||
    /登录看低价|解锁优惠|登录后才能查看价格|登录后才能查看房价|当前采集浏览器登录态可能无效|携程房价接口返回\s*203|错误码\s*203|风控|反爬/.test(
      text
    )
  );
}

function createLoginRequiredAbortError(event = {}) {
  const error = new Error('检测到携程登录态失效，已中断当前采集以便重新登录。');
  error.name = 'AbortError';
  error.code = LOGIN_REQUIRED_ABORT_CODE;
  error.loginEvent = event;
  return error;
}

function buildRetryNeedFromLoginEvent(event = {}) {
  const details = event.details && typeof event.details === 'object' ? event.details : {};
  return {
    needed: true,
    reason:
      details.reason ||
      event.message ||
      '检测到携程页面显示“登录看低价/解锁优惠”，当前登录态可能已失效。'
  };
}

function buildLoginInterruptedCollectResult(event = {}) {
  const retryNeed = buildRetryNeedFromLoginEvent(event);
  return {
    success: false,
    abortedForLoginRequired: true,
    retryNeed,
    loginRequiredEvent: event,
    totalPrice: null,
    eligibleCount: 0,
    roomPrices: [],
    pageSnapshot: {
      login_required: true,
      login_reason: retryNeed.reason,
      login_stage: 'during_collect'
    }
  };
}

function getLoginRetryUrl(input = {}, collectResult = {}) {
  const loginEvent = collectResult.loginRequiredEvent || {};
  const eventDetails =
    loginEvent.details && typeof loginEvent.details === 'object' ? loginEvent.details : {};
  const eventUrl = String(eventDetails.url || '').trim();
  if (eventUrl && isCtripHotelUrl(eventUrl)) {
    return eventUrl;
  }

  const pageSnapshot = collectResult.pageSnapshot || collectResult.page_snapshot || {};
  const snapshotUrl = String(pageSnapshot.source_url || pageSnapshot.sourceUrl || '').trim();
  if (snapshotUrl && isCtripHotelUrl(snapshotUrl)) {
    return snapshotUrl;
  }

  const inputUrls = getCtripHotelInputUrls(input);
  return inputUrls[0] || 'https://hotels.ctrip.com/';
}

function getManagedEdgeProfilePath(workDir) {
  const stateDir = path.resolve(workDir, 'state');
  const profilePath = path.resolve(stateDir, 'edge-profile');
  const normalizedStateDir = stateDir.endsWith(path.sep) ? stateDir : `${stateDir}${path.sep}`;
  if (!profilePath.startsWith(normalizedStateDir)) {
    throw new Error('采集浏览器资料目录不在工作目录下。');
  }
  return profilePath;
}

async function runCollectTask(scraperPath, input, workDir, context, options = {}) {
  const { runHotelImportTask } = await loadScraperModule(scraperPath, 'task-runner.js');
  const abortOnLoginRequired = Boolean(options.abortOnLoginRequired);
  let loginRequiredEvent = null;
  let signal = context.signal;
  let cleanup = () => {};
  let onEvent = context.onEvent;

  if (abortOnLoginRequired && typeof AbortController === 'function') {
    const controller = new AbortController();
    signal = controller.signal;
    const parentSignal = context.signal || null;
    if (parentSignal) {
      const abortFromParent = () => {
        if (!controller.signal.aborted) {
          controller.abort(parentSignal.reason || new Error('任务已取消'));
        }
      };
      if (parentSignal.aborted) {
        abortFromParent();
      } else if (typeof parentSignal.addEventListener === 'function') {
        parentSignal.addEventListener('abort', abortFromParent, { once: true });
        cleanup = () => parentSignal.removeEventListener('abort', abortFromParent);
      }
    }

    onEvent = (event) => {
      if (!loginRequiredEvent && isHardLoginRequiredEvent(event)) {
        loginRequiredEvent = event;
        if (typeof context.onEvent === 'function') {
          context.onEvent(event);
        }
        if (!controller.signal.aborted) {
          controller.abort(createLoginRequiredAbortError(event));
        }
        return;
      }
      if (typeof context.onEvent === 'function') {
        context.onEvent(event);
      }
    };
  }

  try {
    return await runHotelImportTask(buildScraperArgs(input, workDir), {
      workingDirectory: workDir,
      taskId: context.taskId,
      signal,
      onEvent,
      perfLogEnabled: Boolean(input.enableCollectPerfLog),
      perfLogDir: resolveRootPerfLogDir()
    });
  } catch (error) {
    if (loginRequiredEvent && !(context.signal && context.signal.aborted)) {
      return buildLoginInterruptedCollectResult(loginRequiredEvent);
    }
    throw error;
  } finally {
    cleanup();
  }
}

async function runApplyTask(scraperPath, outputPath, workDir, context, options = {}) {
  const { runHotelImportTask } = await loadScraperModule(scraperPath, 'task-runner.js');
  const args = {
    'apply-output': outputPath,
    latestRun: options.latestRunPath || path.join(workDir, 'output', 'latest-run.json')
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
    const applyResult = await runApplyTask(scraperPath, item.outputPath, workDir, context, {
      latestRunPath: path.join(workDir, 'output', 'apply-latest-run.json')
    });
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
  const addressSearchInput = isAddressSearchInput(input);
  if (!addressSearchInput && getCtripHotelInputUrls(input).length === 0) {
    throw new Error('只支持携程酒店详情页或酒店列表页链接。');
  }
  if (addressSearchInput && !String(input.addressQuery || '').trim()) {
    throw new Error('请输入地址或目的地。');
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
      let collectResult = await runCollectTask(scraperPath, input, workDir, context, {
        abortOnLoginRequired: true
      });
      assertNotCancelled(context.signal);
      const retryNeed = collectResult.abortedForLoginRequired
        ? collectResult.retryNeed || buildRetryNeedFromLoginEvent(collectResult.loginRequiredEvent)
        : getVisibleLoginRetryNeed(collectResult);

      if (retryNeed.needed && !(collectResult.loginRetry && collectResult.loginRetry.attempted)) {
        const loginRetryUrl = getLoginRetryUrl(input, collectResult);
        const edgeProfilePath = getManagedEdgeProfilePath(workDir);
        if (!collectResult.abortedForLoginRequired) {
          emitScraperEvent(context, 'edge:login-required', '需要确认携程登录或完成验证后继续采集', {
            reason: retryNeed.reason,
            instruction:
              '程序会打开出问题的携程酒店页。请确认页面已登录且能看到具体房价，必要时完成携程验证，然后关闭窗口，采集会自动重试一次。'
          });
        }
        emitScraperEvent(
          context,
          'edge:login-window',
          '已打开浏览器确认窗口，等待你确认登录或完成验证',
          {
            url: loginRetryUrl,
            instruction:
              '请在打开的酒店页确认能看到具体房价；确认后关闭浏览器窗口，程序会继续采集，不需要重新发送链接。'
          }
        );

        assertNotCancelled(context.signal);
        const { runInteractiveEdgeLoginPrep } = await loadScraperModule(
          scraperPath,
          'cli/auto-edge.js'
        );
        const loginPrepResult = await runInteractiveEdgeLoginPrep({
          userDataDir: edgeProfilePath,
          profileDirectory: 'Default',
          browserPreference: input.collectBrowser,
          port: 9222,
          url: loginRetryUrl
        });
        assertNotCancelled(context.signal);

        if (loginPrepResult && loginPrepResult.loginConfirmed) {
          emitScraperEvent(context, 'edge:login-done', '携程登录窗口已关闭，正在重新采集价格', {
            reason: retryNeed.reason
          });
        } else {
          emitScraperEvent(
            context,
            'edge:login-unconfirmed',
            '携程登录窗口已关闭，但尚未确认登录态',
            {
              reason: retryNeed.reason,
              instruction: '请重新执行采集，并在弹出的浏览器窗口中完成携程登录后再关闭窗口。'
            }
          );
        }
        emitScraperEvent(context, 'scrape:retry', '正在使用新的携程登录态重新采集酒店页面');

        const previousCollectResult = collectResult;
        collectResult = await runCollectTask(scraperPath, input, workDir, context, {
          abortOnLoginRequired: true
        });
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
