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

function normalizeRefreshBatchConcurrency(value) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    return 1;
  }
  return Math.min(concurrency, MAX_REFRESH_BATCH_CONCURRENCY);
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
    error: result.error || ''
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
    error: item.error || ''
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
  mapPreparedResult = null
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
        const meta = buildItemMeta({ url, zeroBasedIndex, index, total, worker });
        emitItemStart(meta);
        const preparedContext = await createDetailContext({
          url,
          index,
          total,
          hotelName: meta.hotelName,
          worker
        });
        if (preparedContext && Object.prototype.hasOwnProperty.call(preparedContext, 'context')) {
          return {
            context: preparedContext.context,
            meta: {
              ...meta,
              ...(preparedContext.meta || {})
            }
          };
        }
        return {
          context: preparedContext,
          meta
        };
      },
      mapPreparedResult: async ({ preparedResult, meta }) => {
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
        const safeMeta =
          meta || buildItemMeta({ url, zeroBasedIndex, index, total, worker });
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
          return storeRefreshItem(rawResult, meta);
        } catch (error) {
          return storeRefreshError(error, meta);
        }
      }
    });
  }

  const internalItems = collectedItems.filter(Boolean);
  const updatedItems = internalItems.filter((item) => item.status === 'updated');
  const skippedItems = internalItems.filter((item) => item.status !== 'updated');
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

  if (updatedHotels.length > 0 && typeof writeHotels === 'function') {
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
      updatedHotels
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

        const batchResult = await runRefreshHotelBatch({
          hotelUrls,
          requestedConcurrency,
          workerContexts,
          signal: context.signal,
          emit,
          getHotelName(url) {
            const existingHotels = hotelGroups.get(url) || [];
            const firstHotel = existingHotels[0] || {};
            return firstHotel.name || '';
          },
          runWorkers: runBoundedWorkers,
          getEffectiveConcurrency: getEffectiveBoundedConcurrency,
          runPreparedDetails: runPreparedDetailBatch,
          createDetailContext: createRefreshDetailContext,
          mapPreparedResult: async (args) => {
            assertNotCancelled(context.signal);
            return mapRefreshPreparedResult(args);
          },
          writeHotels(hotels) {
            return hotelMerge.appendHotelsToStore(hotels, {
              overwriteExistingGroup: true
            });
          }
        });

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
              skipped: item.status !== 'updated',
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
  const baseEdgeDebuggingPort = 9222;
  const baseEdgeTemplate = {
    edge_user_data_dir: path.join(workDir, 'state', 'edge-profile'),
    edge_profile_directory: 'Default',
    edge_debugging_port: baseEdgeDebuggingPort,
    edge_headless: true,
    browser_preference: collectBrowser
  };
  const { closeAutoEdge, launchAndWaitForEdge, resolveAutoEdgeRuntime } = await loadScraperModule(
    scraperPath,
    'cli/auto-edge.js'
  );
  const {
    createBatchEdgeWorkerPool,
    cleanupBatchEdgeWorkerProfileClones,
    prepareBatchEdgeWorkerProfileClones
  } = await loadScraperModule(scraperPath, 'batch-edge-worker-pool.js');
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
  let preparedEdgeWorkerProfileDirs = [];
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
      cleanupBatchEdgeWorkerProfileClones(preparedEdgeWorkerProfileDirs);
    }
  };

  try {
    if (plannedEffectiveConcurrency > 1) {
      preparedEdgeWorkerProfileDirs = prepareBatchEdgeWorkerProfileClones({
        effectiveTemplate: baseEdgeTemplate,
        concurrency: plannedEffectiveConcurrency,
        existingWorkerCount: 1
      });
    }

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
          preparedUserDataDirs: preparedEdgeWorkerProfileDirs
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
  refreshExistingCtripHotels,
  runRefreshHotelBatch
};
