const path = require('path');
const {
  ensureScraperRuntimeDirs,
  loadScraperModule,
  resolveEmbeddedScraperPath,
  resolveScraperPath,
  resolveScraperWorkDir,
  withScraperEnvironment
} = require('./scraper-paths');
const {
  assertNotCancelled,
  isCtripHotelUrl,
  isTaskCancelled,
  normalizeCollectBrowser
} = require('./scraper-task-input');
const {
  createWriteRollbackSnapshot,
  restoreWriteRollbackSnapshot
} = require('./scraper-write-rollback');
const {
  createRefreshDetailContextFactory,
  mapRefreshPreparedResult
} = require('./refresh-item-context');

const MAX_REFRESH_BATCH_CONCURRENCY = 3;
const CTRIP_RISK_CONTROL_ABORT_CODE = 'CTRIP_RISK_CONTROL_203_ABORT';

function normalizeRefreshBatchConcurrency(value) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    return 1;
  }
  return Math.min(concurrency, MAX_REFRESH_BATCH_CONCURRENCY);
}

function createRefreshRiskControlAbortError(reason = '') {
  const error = new Error(reason || '检测到携程 203/风控，已停止剩余更新任务。');
  error.name = 'AbortError';
  error.code = CTRIP_RISK_CONTROL_ABORT_CODE;
  error.reason = reason || '';
  return error;
}

function isRefreshAppliedStatus(status) {
  return status === 'updated' || status === 'cleared';
}

function loadEmbeddedBoundedWorkerRunner() {
  const modulePath = path.join(resolveEmbeddedScraperPath(), 'src', 'bounded-worker-runner.js');
  return require(modulePath);
}

function getEffectiveRefreshConcurrency(
  requestedConcurrency,
  totalHotelCount,
  workerContexts = [],
  getEffectiveBoundedConcurrency = null
) {
  if (typeof getEffectiveBoundedConcurrency === 'function') {
    return getEffectiveBoundedConcurrency({
      requestedConcurrency: normalizeRefreshBatchConcurrency(requestedConcurrency),
      total: totalHotelCount,
      workerContexts,
      maxConcurrency: MAX_REFRESH_BATCH_CONCURRENCY
    });
  }

  const workerLimit =
    Array.isArray(workerContexts) && workerContexts.length > 0
      ? workerContexts.length
      : MAX_REFRESH_BATCH_CONCURRENCY;
  return Math.max(
    1,
    Math.min(
      normalizeRefreshBatchConcurrency(requestedConcurrency),
      Math.max(1, Number(totalHotelCount || 0)),
      workerLimit,
      MAX_REFRESH_BATCH_CONCURRENCY
    )
  );
}

function buildRefreshItemDetails({
  index,
  total,
  hotelName = '',
  status = '',
  roomTypeCount = 0,
  deletedRoomTypeCount = 0,
  reason = '',
  requestedConcurrency = 1,
  effectiveConcurrency = 1
}) {
  return {
    index,
    total,
    hotelName,
    status,
    roomTypeCount,
    deletedRoomTypeCount,
    reason,
    requestedConcurrency,
    effectiveConcurrency
  };
}

function normalizeRefreshItemResult(result = {}, fallback = {}) {
  const status = result.status === 'updated' ? 'updated' : result.status || 'skipped';
  const updatedHotels = Array.isArray(result.updatedHotels) ? result.updatedHotels : [];
  return {
    hotelName: result.hotelName || fallback.hotelName || '',
    url: result.url || fallback.url || '',
    status,
    updatedHotels,
    updatedRoomTypeCount: Number(result.updatedRoomTypeCount || updatedHotels.length || 0),
    deletedRoomTypeCount: Number(result.deletedRoomTypeCount || 0),
    skipReason: result.skipReason || '',
    error: result.error || '',
    retryAfterLogin: Boolean(result.retryAfterLogin),
    deleteExistingGroup: Boolean(result.deleteExistingGroup),
    existingHotels: Array.isArray(result.existingHotels) ? result.existingHotels : [],
    clearReason: result.clearReason || ''
  };
}

function toPublicRefreshItem(item = {}) {
  return {
    hotelName: item.hotelName || '',
    url: item.url || '',
    status: item.status || 'skipped',
    updatedRoomTypeCount: Number(item.updatedRoomTypeCount || 0),
    deletedRoomTypeCount: Number(item.deletedRoomTypeCount || 0),
    skipReason: item.skipReason || '',
    error: item.error || '',
    retryAfterLogin: Boolean(item.retryAfterLogin),
    clearReason: item.clearReason || ''
  };
}

function combineRefreshWriteResults(...writeResults) {
  const operations = [];
  for (const result of writeResults) {
    if (Array.isArray(result)) {
      operations.push(...result);
    } else if (result) {
      operations.push(result);
    }
  }
  return operations;
}

function mergeRefreshBatchResults(firstPass = {}, retryPass = {}) {
  const retryItemsByUrl = new Map(
    (Array.isArray(retryPass.items) ? retryPass.items : [])
      .filter((item) => item && item.url)
      .map((item) => [item.url, item])
  );
  const firstItems = Array.isArray(firstPass.items) ? firstPass.items : [];
  const mergedItems = firstItems.map((item) => retryItemsByUrl.get(item.url) || item);
  const firstUrls = new Set(firstItems.map((item) => item && item.url).filter(Boolean));
  for (const item of Array.isArray(retryPass.items) ? retryPass.items : []) {
    if (item && item.url && !firstUrls.has(item.url)) {
      mergedItems.push(item);
    }
  }

  const updatedItems = mergedItems.filter((item) => isRefreshAppliedStatus(item.status));
  const skippedItems = mergedItems.filter((item) => !isRefreshAppliedStatus(item.status));

  return {
    ...firstPass,
    effectiveConcurrency: firstPass.effectiveConcurrency,
    updatedHotelCount: updatedItems.length,
    updatedRoomTypeCount: updatedItems.reduce(
      (sum, item) => sum + Number(item.updatedRoomTypeCount || 0),
      0
    ),
    deletedRoomTypeCount: updatedItems.reduce(
      (sum, item) => sum + Number(item.deletedRoomTypeCount || 0),
      0
    ),
    skippedHotelCount: skippedItems.length,
    items: mergedItems,
    updatedHotels: [
      ...(Array.isArray(firstPass.updatedHotels) ? firstPass.updatedHotels : []),
      ...(Array.isArray(retryPass.updatedHotels) ? retryPass.updatedHotels : [])
    ],
    rawWriteResult: combineRefreshWriteResults(firstPass.rawWriteResult, retryPass.rawWriteResult)
  };
}

async function runRefreshHotelBatch({
  hotelUrls = [],
  requestedConcurrency = 1,
  workerContexts = [],
  signal = null,
  emit = () => {},
  getHotelName = () => '',
  processHotel,
  writeHotels,
  runWorkers = null,
  getEffectiveConcurrency = null,
  runPreparedDetails = null,
  createDetailContext = null,
  mapPreparedResult = null,
  detailScheduler = null
} = {}) {
  const urls = Array.isArray(hotelUrls) ? hotelUrls : [];
  const totalHotelCount = urls.length;
  const normalizedRequestedConcurrency = normalizeRefreshBatchConcurrency(requestedConcurrency);
  const runBoundedWorkers =
    typeof runWorkers === 'function'
      ? runWorkers
      : loadEmbeddedBoundedWorkerRunner().runBoundedWorkers;
  const effectiveConcurrency = getEffectiveRefreshConcurrency(
    normalizedRequestedConcurrency,
    totalHotelCount,
    workerContexts,
    getEffectiveConcurrency
  );
  const collectedItems = new Array(totalHotelCount);
  const updatedHotelBatches = new Array(totalHotelCount);

  const buildItemMeta = ({ url, zeroBasedIndex, index, total, worker }) => {
    const hotelName = String(getHotelName(url) || '');
    return {
      url,
      zeroBasedIndex,
      index,
      total,
      worker,
      hotelName,
      detailsBase: {
        index,
        total,
        hotelName,
        requestedConcurrency: normalizedRequestedConcurrency,
        effectiveConcurrency
      }
    };
  };

  const emitItemStart = (meta) => {
    emit(
      'refresh:item-start',
      `正在更新第 ${meta.index}/${totalHotelCount} 家${meta.hotelName ? `：${meta.hotelName}` : ''}`,
      buildRefreshItemDetails(meta.detailsBase)
    );
  };

  const storeRefreshItem = (rawResult, meta) => {
    const item = normalizeRefreshItemResult(rawResult, {
      url: meta.url,
      hotelName: meta.hotelName
    });
    collectedItems[meta.zeroBasedIndex] = item;
    updatedHotelBatches[meta.zeroBasedIndex] =
      item.status === 'updated' ? item.updatedHotels || [] : [];

    if (item.status === 'updated') {
      emit(
        'refresh:item-done',
        `已更新 ${item.hotelName || meta.hotelName || meta.url}：${item.updatedRoomTypeCount} 种房型`,
        buildRefreshItemDetails({
          ...meta.detailsBase,
          hotelName: item.hotelName || meta.hotelName,
          status: 'updated',
          roomTypeCount: item.updatedRoomTypeCount,
          deletedRoomTypeCount: item.deletedRoomTypeCount
        })
      );
    } else if (item.status === 'cleared') {
      emit(
        'refresh:item-done',
        `已删除 ${item.hotelName || meta.hotelName || meta.url}：${item.deletedRoomTypeCount} 种旧房型`,
        buildRefreshItemDetails({
          ...meta.detailsBase,
          hotelName: item.hotelName || meta.hotelName,
          status: 'cleared',
          roomTypeCount: item.updatedRoomTypeCount,
          deletedRoomTypeCount: item.deletedRoomTypeCount,
          reason: item.clearReason || '当前日期不可预订'
        })
      );
    } else {
      const reason = item.skipReason || item.error || '采集未返回有效房型数据';
      emit(
        'refresh:item-skipped',
        `跳过 ${item.hotelName || meta.hotelName || meta.url}：${reason}`,
        buildRefreshItemDetails({
          ...meta.detailsBase,
          hotelName: item.hotelName || meta.hotelName,
          status: item.status,
          reason
        })
      );
    }

    return item;
  };

  const storeRefreshError = (error, meta) => {
    if (isTaskCancelled(error, signal)) {
      throw error;
    }
    const errorMessage = error && error.message ? error.message : String(error || '未知错误');
    const item = normalizeRefreshItemResult(
      {
        hotelName: meta.hotelName,
        url: meta.url,
        status: 'failed',
        updatedHotels: [],
        updatedRoomTypeCount: 0,
        deletedRoomTypeCount: 0,
        skipReason: errorMessage,
        error: errorMessage
      },
      { url: meta.url, hotelName: meta.hotelName }
    );
    collectedItems[meta.zeroBasedIndex] = item;
    updatedHotelBatches[meta.zeroBasedIndex] = [];
    emit(
      'refresh:item-skipped',
      `跳过 ${meta.hotelName || meta.url}：${errorMessage}`,
      buildRefreshItemDetails({
        ...meta.detailsBase,
        status: 'failed',
        reason: errorMessage
      })
    );
    return item;
  };

  if (
    typeof runPreparedDetails === 'function' &&
    typeof createDetailContext === 'function' &&
    typeof mapPreparedResult === 'function'
  ) {
    await runPreparedDetails({
      items: urls,
      requestedConcurrency: normalizedRequestedConcurrency,
      workerContexts,
      maxConcurrency: effectiveConcurrency,
      signal,
      createDetailContext: async ({ item: url, zeroBasedIndex, index, total, worker }) => {
        let schedulerStarted = false;
        if (detailScheduler) {
          await detailScheduler.beforeStart({ index, total, signal });
          schedulerStarted = true;
        }
        const meta = buildItemMeta({ url, zeroBasedIndex, index, total, worker });
        emitItemStart(meta);
        let preparedContext = null;
        try {
          preparedContext = await createDetailContext({
            url,
            index,
            total,
            hotelName: meta.hotelName,
            worker
          });
        } catch (error) {
          if (schedulerStarted) {
            detailScheduler.recordError(error, { index, total });
          }
          throw error;
        }
        const schedulerMeta = {
          schedulerStarted,
          schedulerRecorded: false
        };
        if (preparedContext && Object.prototype.hasOwnProperty.call(preparedContext, 'context')) {
          return {
            context: preparedContext.context,
            meta: {
              ...meta,
              ...(preparedContext.meta || {}),
              ...schedulerMeta
            }
          };
        }
        return {
          context: preparedContext,
          meta: {
            ...meta,
            ...schedulerMeta
          }
        };
      },
      mapPreparedResult: async ({ preparedResult, meta }) => {
        if (detailScheduler) {
          const schedulerSnapshot = detailScheduler.recordOutcome(preparedResult.result || {}, {
            index: meta.index,
            total: meta.total
          });
          meta.schedulerRecorded = true;
          if (schedulerSnapshot && schedulerSnapshot.circuit_open) {
            throw createRefreshRiskControlAbortError(schedulerSnapshot.circuit_reason);
          }
        }
        const rawResult = await mapPreparedResult({
          preparedResult,
          url: meta.url,
          index: meta.index,
          total: meta.total,
          hotelName: meta.hotelName,
          worker: meta.worker,
          meta
        });
        return storeRefreshItem(rawResult, meta);
      },
      mapDetailError: async ({ error, item: url, zeroBasedIndex, index, total, worker, meta }) => {
        const safeMeta = meta || buildItemMeta({ url, zeroBasedIndex, index, total, worker });
        if (detailScheduler && safeMeta.schedulerStarted && !safeMeta.schedulerRecorded) {
          detailScheduler.recordError(error, { index, total });
          safeMeta.schedulerRecorded = true;
        }
        return storeRefreshError(error, safeMeta);
      }
    });
  } else {
    await runBoundedWorkers({
      items: urls,
      requestedConcurrency: normalizedRequestedConcurrency,
      workerContexts,
      maxConcurrency: effectiveConcurrency,
      signal,
      runItem: async ({ item: url, zeroBasedIndex, index, total, worker }) => {
        assertNotCancelled(signal);
        let schedulerStarted = false;
        let schedulerRecorded = false;
        if (detailScheduler) {
          await detailScheduler.beforeStart({ index, total, signal });
          schedulerStarted = true;
        }
        const meta = buildItemMeta({ url, zeroBasedIndex, index, total, worker });
        emitItemStart(meta);

        try {
          const rawResult = await processHotel({
            url,
            index,
            total,
            hotelName: meta.hotelName,
            worker
          });
          if (detailScheduler) {
            const schedulerSnapshot = detailScheduler.recordOutcome(rawResult || {}, {
              index,
              total
            });
            schedulerRecorded = true;
            if (schedulerSnapshot && schedulerSnapshot.circuit_open) {
              throw createRefreshRiskControlAbortError(schedulerSnapshot.circuit_reason);
            }
          }
          return storeRefreshItem(rawResult, meta);
        } catch (error) {
          if (detailScheduler && schedulerStarted && !schedulerRecorded) {
            detailScheduler.recordError(error, { index, total });
          }
          return storeRefreshError(error, meta);
        }
      }
    });
  }

  const internalItems = collectedItems.filter(Boolean);
  const updatedItems = internalItems.filter((item) => isRefreshAppliedStatus(item.status));
  const skippedItems = internalItems.filter((item) => !isRefreshAppliedStatus(item.status));
  const clearedItems = updatedItems.filter((item) => item.deleteExistingGroup);
  const updatedHotels = updatedHotelBatches.flatMap((hotels) =>
    Array.isArray(hotels) ? hotels : []
  );
  const updatedRoomTypeCount = updatedItems.reduce(
    (sum, item) => sum + Number(item.updatedRoomTypeCount || 0),
    0
  );
  const deletedRoomTypeCount = updatedItems.reduce(
    (sum, item) => sum + Number(item.deletedRoomTypeCount || 0),
    0
  );
  let rawWriteResult = null;

  if ((updatedHotels.length > 0 || clearedItems.length > 0) && typeof writeHotels === 'function') {
    emit('refresh:write', `正在写入 ${updatedItems.length} 家宾馆的更新结果`, {
      scope: 'final',
      total: totalHotelCount,
      updatedHotelCount: updatedItems.length,
      updatedRoomTypeCount,
      deletedRoomTypeCount,
      skippedHotelCount: skippedItems.length,
      requestedConcurrency: normalizedRequestedConcurrency,
      effectiveConcurrency
    });
    rawWriteResult = await writeHotels(updatedHotels, {
      updatedItems,
      skippedItems,
      updatedHotels,
      clearedItems
    });
  }

  return {
    requestedConcurrency: normalizedRequestedConcurrency,
    effectiveConcurrency,
    totalHotelCount,
    updatedHotelCount: updatedItems.length,
    updatedRoomTypeCount,
    deletedRoomTypeCount,
    skippedHotelCount: skippedItems.length,
    items: internalItems.map(toPublicRefreshItem),
    updatedHotels,
    rawWriteResult
  };
}

async function refreshExistingCtripHotels(input, context = {}) {
  const dataFolderPath = context.dataFolderPath;
  if (!dataFolderPath) {
    throw new Error('缺少比较助手数据目录，无法读取宾馆数据。');
  }

  const scraperPath = resolveScraperPath();
  const workDir = resolveScraperWorkDir(dataFolderPath, scraperPath);
  ensureScraperRuntimeDirs(workDir);

  return withScraperEnvironment(dataFolderPath, scraperPath, async () => {
    const rollbackState = {};
    const emit = (type, message, details = {}) => {
      if (typeof context.onEvent !== 'function') return;
      context.onEvent({ type, message, details, at: new Date().toISOString() });
    };

    try {
      assertNotCancelled(context.signal);

      // 1. Load current store data
      emit('refresh:load-data', '正在读取当前宾馆数据');
      const bridge = await loadScraperModule(scraperPath, 'compare-app-bridge.js');
      const hotelMerge = await loadScraperModule(scraperPath, 'compare-app/hotel-merge.js');
      const store = bridge.loadCompareAppStore();
      const rawHotels = Array.isArray(store.hotels) ? store.hotels : [];
      const sharedCompareAppModule = await loadScraperModule(
        scraperPath,
        'compare-app/shared-module.js'
      );
      const { BASE_COMPARE_APP_SETTINGS } =
        sharedCompareAppModule.requireSharedCompareAppModule('constants.js');
      const { expandStoredHotels } =
        sharedCompareAppModule.requireSharedCompareAppModule('hotel-groups.js');
      const expandedHotels = expandStoredHotels(rawHotels);
      const compareAppSettings = {
        ...BASE_COMPARE_APP_SETTINGS,
        ...((store && store.settings) || {})
      };

      // 2. Group hotels by website (ctrip URL), find ones with ctrip links
      const hotelGroups = new Map();
      for (const hotel of expandedHotels) {
        const url = hotel.website || '';
        if (!url || !isCtripHotelUrl(url)) continue;
        if (!hotelGroups.has(url)) {
          hotelGroups.set(url, []);
        }
        hotelGroups.get(url).push(hotel);
      }

      const hotelUrls = Array.from(hotelGroups.keys());
      const totalHotelCount = hotelUrls.length;

      if (totalHotelCount === 0) {
        emit('refresh:scan-done', '当前没有找到带携程链接的宾馆', {
          total: 0
        });
        return {
          success: true,
          totalHotelCount: 0,
          updatedHotelCount: 0,
          updatedRoomTypeCount: 0,
          deletedRoomTypeCount: 0,
          skippedHotelCount: 0,
          items: [],
          message: '当前没有找到带携程链接的宾馆，未执行更新。'
        };
      }

      emit('refresh:scan-done', `找到 ${totalHotelCount} 家有携程链接的宾馆，准备逐家更新`, {
        total: totalHotelCount
      });

      // 3. Prepare Edge sessions
      assertNotCancelled(context.signal);
      emit('edge:login-required', '正在准备浏览器登录态');
      const requestedConcurrency = normalizeRefreshBatchConcurrency(input.batchConcurrency);
      const collectBrowser = normalizeCollectBrowser(input.collectBrowser);
      const { getEffectiveBoundedConcurrency, runBoundedWorkers } = await loadScraperModule(
        scraperPath,
        'bounded-worker-runner.js'
      );
      const { runPreparedDetailBatch } = await loadScraperModule(
        scraperPath,
        'prepared-detail-batch-collector.js'
      );
      const { createScrapeEventForwarder } = await loadScraperModule(scraperPath, 'task-events.js');
      const { AdaptiveDetailScheduler } = await loadScraperModule(
        scraperPath,
        'adaptive-detail-scheduler.js'
      );
      const { applyMatchedTemplate, mergeTemplateWithArgs, validateTemplate } =
        await loadScraperModule(scraperPath, 'template-loader.js');
      const { normalizePlaceName } = await loadScraperModule(scraperPath, 'utils.js');
      let edgeSession = null;

      try {
        edgeSession = await createManagedRefreshEdgeWorkerSession({
          scraperPath,
          workDir,
          collectBrowser,
          requestedConcurrency,
          totalHotelCount,
          firstHotelUrl: hotelUrls[0] || 'https://hotels.ctrip.com/',
          emit,
          getEffectiveBoundedConcurrency
        });
        const {
          baseEdgeTemplate,
          workerContexts,
          effectiveConcurrency: edgeEffectiveConcurrency
        } = edgeSession;
        const createDetailScheduler = (maxConcurrency) =>
          new AdaptiveDetailScheduler({
            maxConcurrency,
            detailStartIntervalMs: input.detailStartIntervalMs ?? 2000,
            degradedStartIntervalMs: input.degradedStartIntervalMs ?? 3000,
            warmupHotelCount: input.warmupHotelCount ?? 3
          });

        emit('edge:login-done', '浏览器登录态已准备完成', {
          requestedConcurrency,
          effectiveConcurrency: edgeEffectiveConcurrency
        });

        assertNotCancelled(context.signal);
        await createWriteRollbackSnapshot(scraperPath, rollbackState);

        const createRefreshDetailContext = createRefreshDetailContextFactory({
          input,
          taskContext: context,
          workDir,
          hotelGroups,
          bridge,
          store,
          compareAppSettings,
          baseEdgeUserDataDir: baseEdgeTemplate.edge_user_data_dir,
          baseEdgeProfileDirectory: baseEdgeTemplate.edge_profile_directory,
          emit,
          createScrapeEventForwarder,
          applyMatchedTemplate,
          mergeTemplateWithArgs,
          validateTemplate,
          normalizePlaceName
        });

        const getRefreshHotelName = (url) => {
          const existingHotels = hotelGroups.get(url) || [];
          const firstHotel = existingHotels[0] || {};
          return firstHotel.name || '';
        };
        const writeRefreshHotels = (hotels, writeContext = {}) => {
          const writeResults = [];
          if (Array.isArray(hotels) && hotels.length > 0) {
            writeResults.push(
              hotelMerge.appendHotelsToStore(hotels, {
                overwriteExistingGroup: true
              })
            );
          }

          const clearedItems = Array.isArray(writeContext.clearedItems)
            ? writeContext.clearedItems
            : [];
          const clearGroups = clearedItems
            .map((item) => (Array.isArray(item.existingHotels) ? item.existingHotels : []))
            .filter((group) => group.length > 0);
          if (
            clearGroups.length > 0 &&
            typeof hotelMerge.removeHotelGroupsFromStore === 'function'
          ) {
            writeResults.push(hotelMerge.removeHotelGroupsFromStore(clearGroups));
          }

          return combineRefreshWriteResults(...writeResults);
        };

        let batchResult = await runRefreshHotelBatch({
          hotelUrls,
          requestedConcurrency,
          workerContexts,
          signal: context.signal,
          emit,
          getHotelName: getRefreshHotelName,
          runWorkers: runBoundedWorkers,
          getEffectiveConcurrency: getEffectiveBoundedConcurrency,
          runPreparedDetails: runPreparedDetailBatch,
          createDetailContext: createRefreshDetailContext,
          mapPreparedResult: async (args) => {
            assertNotCancelled(context.signal);
            return mapRefreshPreparedResult(args);
          },
          writeHotels: writeRefreshHotels,
          detailScheduler: createDetailScheduler(edgeEffectiveConcurrency)
        });

        const loginRetryUrls = batchResult.items
          .filter((item) => item.retryAfterLogin)
          .map((item) => item.url)
          .filter(Boolean);
        if (loginRetryUrls.length > 0) {
          emit(
            'edge:login-required',
            `有 ${loginRetryUrls.length} 家宾馆价格被携程隐藏，正在打开浏览器重新确认登录态`,
            {
              retryHotelCount: loginRetryUrls.length,
              instruction:
                '请在打开的采集浏览器中登录携程，并确认目标酒店页能看到具体房价；关闭窗口后会自动重试这些宾馆。'
            }
          );

          await edgeSession.close();
          edgeSession = null;

          const { runInteractiveEdgeLoginPrep } = await loadScraperModule(
            scraperPath,
            'cli/auto-edge.js'
          );
          const loginPrepResult = await runInteractiveEdgeLoginPrep({
            userDataDir: baseEdgeTemplate.edge_user_data_dir,
            profileDirectory: baseEdgeTemplate.edge_profile_directory,
            browserPreference: collectBrowser,
            port: baseEdgeTemplate.edge_debugging_port || 9222,
            url: loginRetryUrls[0] || hotelUrls[0] || 'https://hotels.ctrip.com/'
          });
          assertNotCancelled(context.signal);

          if (loginPrepResult && loginPrepResult.loginConfirmed) {
            emit('edge:login-done', '携程登录窗口已关闭，正在重试价格不可见的宾馆', {
              retryHotelCount: loginRetryUrls.length
            });
          } else {
            emit('edge:login-unconfirmed', '携程登录窗口已关闭，但尚未确认登录态', {
              retryHotelCount: loginRetryUrls.length,
              instruction: '仍会重试一次；如果继续跳过，请重新登录携程后再次更新数据。'
            });
          }

          edgeSession = await createManagedRefreshEdgeWorkerSession({
            scraperPath,
            workDir,
            collectBrowser,
            requestedConcurrency,
            totalHotelCount: loginRetryUrls.length,
            firstHotelUrl: loginRetryUrls[0] || 'https://hotels.ctrip.com/',
            emit,
            getEffectiveBoundedConcurrency
          });
          const {
            baseEdgeTemplate: retryBaseEdgeTemplate,
            workerContexts: retryWorkerContexts,
            effectiveConcurrency: retryEdgeEffectiveConcurrency
          } = edgeSession;

          emit('refresh:retry-login', `正在重试 ${loginRetryUrls.length} 家价格不可见的宾馆`, {
            retryHotelCount: loginRetryUrls.length,
            requestedConcurrency,
            effectiveConcurrency: retryEdgeEffectiveConcurrency
          });

          const retryCreateRefreshDetailContext = createRefreshDetailContextFactory({
            input,
            taskContext: context,
            workDir,
            hotelGroups,
            bridge,
            store,
            compareAppSettings,
            baseEdgeUserDataDir: retryBaseEdgeTemplate.edge_user_data_dir,
            baseEdgeProfileDirectory: retryBaseEdgeTemplate.edge_profile_directory,
            emit,
            createScrapeEventForwarder,
            applyMatchedTemplate,
            mergeTemplateWithArgs,
            validateTemplate,
            normalizePlaceName
          });
          const retryBatchResult = await runRefreshHotelBatch({
            hotelUrls: loginRetryUrls,
            requestedConcurrency,
            workerContexts: retryWorkerContexts,
            signal: context.signal,
            emit,
            getHotelName: getRefreshHotelName,
            runWorkers: runBoundedWorkers,
            getEffectiveConcurrency: getEffectiveBoundedConcurrency,
            runPreparedDetails: runPreparedDetailBatch,
            createDetailContext: retryCreateRefreshDetailContext,
            mapPreparedResult: async (args) => {
              assertNotCancelled(context.signal);
              return mapRefreshPreparedResult(args);
            },
            writeHotels: writeRefreshHotels,
            detailScheduler: createDetailScheduler(retryEdgeEffectiveConcurrency)
          });
          batchResult = mergeRefreshBatchResults(batchResult, retryBatchResult);
        }

        const {
          updatedHotelCount,
          updatedRoomTypeCount,
          deletedRoomTypeCount,
          skippedHotelCount,
          items,
          effectiveConcurrency,
          rawWriteResult
        } = batchResult;

        const message =
          totalHotelCount === 0
            ? '当前没有找到带携程链接的宾馆，未执行更新。'
            : updatedHotelCount === 0 && skippedHotelCount > 0
              ? `本次没有成功更新的宾馆，已跳过 ${skippedHotelCount} 家。请检查携程登录态或稍后重试。`
              : `更新完成，本次更新 ${updatedHotelCount} 家宾馆信息，更新 ${updatedRoomTypeCount} 种房型价格，删除 ${deletedRoomTypeCount} 种已下架房型，跳过 ${skippedHotelCount} 家。`;

        emit('refresh:summary', message, {
          totalHotelCount,
          updatedHotelCount,
          updatedRoomTypeCount,
          deletedRoomTypeCount,
          skippedHotelCount,
          requestedConcurrency,
          effectiveConcurrency
        });

        return {
          success: true,
          totalHotelCount,
          updatedHotelCount,
          updatedRoomTypeCount,
          deletedRoomTypeCount,
          skippedHotelCount,
          requestedConcurrency,
          effectiveConcurrency,
          items,
          message,
          writeResult: {
            batchMode: true,
            appliedCount: updatedHotelCount,
            skippedCount: skippedHotelCount,
            operations: rawWriteResult || [],
            items: items.map((item) => ({
              skipped: !isRefreshAppliedStatus(item.status),
              reason: item.skipReason || ''
            }))
          }
        };
      } finally {
        if (edgeSession) {
          await edgeSession.close();
        }
      }
    } catch (error) {
      if (isTaskCancelled(error, context.signal)) {
        restoreWriteRollbackSnapshot(rollbackState, context);
      }
      throw error;
    }
  });
}

async function createManagedRefreshEdgeWorkerSession({
  scraperPath,
  workDir,
  collectBrowser,
  requestedConcurrency,
  totalHotelCount,
  firstHotelUrl,
  emit = () => {},
  getEffectiveBoundedConcurrency
} = {}) {
  const baseEdgeTemplate = {
    edge_user_data_dir: path.join(workDir, 'state', 'edge-profile'),
    edge_profile_directory: 'Default',
    edge_debugging_port: 0,
    edge_headless: true,
    browser_preference: collectBrowser
  };
  const { closeAutoEdge, launchAndWaitForEdge, resolveAutoEdgeRuntime } = await loadScraperModule(
    scraperPath,
    'cli/auto-edge.js'
  );
  const { createBatchEdgeWorkerPool, findAvailablePort } = await loadScraperModule(
    scraperPath,
    'batch-edge-worker-pool.js'
  );
  const autoEdgeRuntime = resolveAutoEdgeRuntime({
    userDataDir: baseEdgeTemplate.edge_user_data_dir,
    profileDirectory: baseEdgeTemplate.edge_profile_directory,
    browserPreference: collectBrowser
  });
  if (autoEdgeRuntime && autoEdgeRuntime.userDataDir) {
    baseEdgeTemplate.edge_user_data_dir = autoEdgeRuntime.userDataDir;
    baseEdgeTemplate.edge_profile_directory = autoEdgeRuntime.profileDirectory;
  }

  const plannedEffectiveConcurrency = getEffectiveRefreshConcurrency(
    requestedConcurrency,
    totalHotelCount,
    [],
    getEffectiveBoundedConcurrency
  );
  let primaryEdgePid = null;
  let primaryEdgeProcess = null;
  let edgeWorkerPool = null;
  let workerContexts = [];
  let closed = false;

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      if (edgeWorkerPool) {
        await edgeWorkerPool.close();
      }
    } finally {
      if (primaryEdgePid) {
        closeAutoEdge(primaryEdgePid, primaryEdgeProcess);
      }
    }
  };

  try {
    const baseEdgeDebuggingPort =
      typeof findAvailablePort === 'function' ? await findAvailablePort() : 9222;
    baseEdgeTemplate.edge_debugging_port = baseEdgeDebuggingPort;

    const primaryEdge = await launchAndWaitForEdge({
      userDataDir: baseEdgeTemplate.edge_user_data_dir,
      profileDirectory: baseEdgeTemplate.edge_profile_directory,
      browserPreference: collectBrowser,
      port: baseEdgeDebuggingPort,
      url: firstHotelUrl || 'https://hotels.ctrip.com/',
      headless: baseEdgeTemplate.edge_headless
    });
    primaryEdgeProcess = primaryEdge;
    primaryEdgePid = primaryEdge.pid || null;
    const primaryEdgePort = Number(primaryEdge.port || baseEdgeDebuggingPort);
    const primaryWorker = {
      id: 1,
      pid: primaryEdge.pid || null,
      port: primaryEdgePort,
      userDataDir: baseEdgeTemplate.edge_user_data_dir,
      profileDirectory: baseEdgeTemplate.edge_profile_directory,
      browserExecutable: primaryEdge.browserExecutable || '',
      browserName: primaryEdge.browserName || '',
      cleanupUserDataDir: false,
      shouldClose: false,
      effectiveTemplate: {
        ...baseEdgeTemplate,
        edge_debugging_port: primaryEdgePort
      }
    };

    workerContexts = [primaryWorker];
    if (plannedEffectiveConcurrency > 1) {
      try {
        edgeWorkerPool = await createBatchEdgeWorkerPool({
          args: { 'auto-edge': true },
          effectiveTemplate: {
            ...baseEdgeTemplate,
            edge_debugging_port: primaryEdgePort
          },
          concurrency: plannedEffectiveConcurrency,
          existingWorker: primaryWorker,
          preparedUserDataDirs: []
        });
        workerContexts =
          edgeWorkerPool && Array.isArray(edgeWorkerPool.workers)
            ? edgeWorkerPool.workers
            : workerContexts;
      } catch (error) {
        emit('edge:parallel-disabled', '并发 Edge 会话准备失败，已回退为串行更新', {
          reason: error && error.message ? error.message : String(error || ''),
          requestedConcurrency,
          effectiveConcurrency: 1
        });
      }
    }

    return {
      baseEdgeTemplate,
      workerContexts,
      effectiveConcurrency: getEffectiveRefreshConcurrency(
        requestedConcurrency,
        totalHotelCount,
        workerContexts,
        getEffectiveBoundedConcurrency
      ),
      close
    };
  } catch (error) {
    try {
      await close();
    } catch (_cleanupError) {
      // Preserve the launch/setup failure; cleanup failures are already best-effort.
    }
    throw error;
  }
}

module.exports = {
  mergeRefreshBatchResults,
  refreshExistingCtripHotels,
  runRefreshHotelBatch
};
