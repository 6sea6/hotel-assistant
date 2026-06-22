const { randomUUID } = require('crypto');
const {
  getAiProviderPresets,
  getDefaultAiProviderConfig,
  normalizeAiProviderConfig,
  redactAiProviderConfig
} = require('../ai/provider-presets');
const { requestChatCompletion } = require('../ai/provider-client');
const { loadScraperRunner } = require('../ai/scraper-lazy-loader');
const {
  flushHotelRepositoryCache,
  resetHotelRepositoryCache
} = require('../repositories/hotel-repository');

const AI_CONFIG_SETTING_KEY = 'ai_provider_config';

function compactRefreshResult(result = {}) {
  return {
    success: Boolean(result.success),
    totalHotelCount: result.totalHotelCount ?? 0,
    updatedHotelCount: result.updatedHotelCount ?? 0,
    updatedRoomTypeCount: result.updatedRoomTypeCount ?? 0,
    deletedRoomTypeCount: result.deletedRoomTypeCount ?? 0,
    skippedHotelCount: result.skippedHotelCount ?? 0,
    items: Array.isArray(result.items) ? result.items.slice(0, 50) : [],
    writeResult: result.writeResult || null,
    error: result.error || ''
  };
}

function compactTaskResult(result = {}) {
  const eligibleRoomTypes = Array.isArray(result.eligibleRoomTypes)
    ? result.eligibleRoomTypes.slice(0, 12)
    : [];
  const eligibleHotels = Array.isArray(result.eligibleHotels)
    ? result.eligibleHotels.slice(0, 12)
    : [];
  const firstRoom = eligibleRoomTypes[0] || {};
  const firstHotel = eligibleHotels[0] || {};
  const totalPrice =
    result.totalPrice ??
    firstRoom.totalPrice ??
    firstRoom.total_price ??
    firstHotel.total_price ??
    null;

  return {
    success: Boolean(result.success),
    hotelName: result.hotelName || '',
    eligibleCount: result.eligibleCount ?? 0,
    totalPrice,
    outputPath: result.outputPath || '',
    inputMode: result.inputMode || '',
    batchMode: Boolean(result.batchMode),
    items: Array.isArray(result.items) ? result.items.slice(0, 20) : [],
    batchStats: result.batchStats || null,
    batchSummary: result.batchSummary || null,
    requestedUrls: Array.isArray(result.requestedUrls) ? result.requestedUrls.slice(0, 20) : [],
    resolvedUrls: Array.isArray(result.resolvedUrls) ? result.resolvedUrls.slice(0, 20) : [],
    writeSkipped: Boolean(result.writeSkipped),
    writeSkipReason: result.writeSkipReason || '',
    emptyListResult: Boolean(result.emptyListResult),
    emptyReason: result.emptyReason || '',
    writeResult: result.writeResult || null,
    loginRetry: result.loginRetry || null,
    eligibleRoomTypes,
    eligibleHotels,
    pageSnapshot: result.pageSnapshot || null,
    error: result.error || ''
  };
}

function hasExternalWriteResult(value) {
  if (!value) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasExternalWriteResult(item));
  }
  if (typeof value !== 'object') {
    return false;
  }

  if (Number(value.appliedCount) > 0) {
    return true;
  }
  if (value.operation && value.operation !== 'skipped') {
    return true;
  }
  if (hasExternalWriteResult(value.writeResult)) {
    return true;
  }
  if (hasExternalWriteResult(value.latestApplyResult)) {
    return true;
  }
  if (hasExternalWriteResult(value.collectResult)) {
    return true;
  }
  if (hasExternalWriteResult(value.result)) {
    return true;
  }
  if (hasExternalWriteResult(value.items)) {
    return true;
  }
  if (hasExternalWriteResult(value.toolResults)) {
    return true;
  }

  return false;
}

function compactErrorMessage(error) {
  return error && error.message ? error.message : String(error || '未知错误');
}

function isCancellationError(error, signal) {
  if (signal && signal.aborted) {
    return true;
  }
  const message = compactErrorMessage(error);
  return (
    /任务已取消|采集任务已取消|operation was aborted|aborted/i.test(message) ||
    (error && error.name === 'AbortError')
  );
}

function createAiService({ dataService, windowService, hotelTaskRunner = null }) {
  const state = {
    currentTask: null,
    lastTask: null,
    taskHistory: new Map()
  };

  function getStore() {
    return dataService.getStore();
  }

  function getRawConfig() {
    const settings = getStore().get('settings') || {};
    return settings[AI_CONFIG_SETTING_KEY] || getDefaultAiProviderConfig();
  }

  function getProviderConfig(options = {}) {
    const config = normalizeAiProviderConfig(getRawConfig());
    return options.includeSecret ? config : redactAiProviderConfig(config);
  }

  async function getHotelTaskRunner() {
    if (hotelTaskRunner) {
      return hotelTaskRunner;
    }
    const scraperRunner = await loadScraperRunner();
    return scraperRunner.collectAndWriteCtripHotel;
  }

  function getOptionalStore() {
    return dataService && typeof dataService.getStore === 'function'
      ? dataService.getStore()
      : null;
  }

  function flushStoreBeforeExternalWrite() {
    const store = getOptionalStore();
    if (store) {
      flushHotelRepositoryCache(store);
    }
  }

  function reloadStoreAfterExternalWrite(result) {
    if (!hasExternalWriteResult(result)) {
      return;
    }

    const previousStore = getOptionalStore();
    if (previousStore) {
      resetHotelRepositoryCache(previousStore);
    }
    if (
      dataService &&
      typeof dataService.reinitializeStore === 'function' &&
      typeof dataService.getDataFolderPath === 'function'
    ) {
      dataService.reinitializeStore(dataService.getDataFolderPath());
    }
  }

  function saveProviderConfig(nextConfig = {}) {
    const store = getStore();
    const settings = store.get('settings') || {};
    const previousConfig = normalizeAiProviderConfig(
      settings[AI_CONFIG_SETTING_KEY] || getDefaultAiProviderConfig()
    );
    const incomingConfig = { ...nextConfig };

    const nextProvider = incomingConfig.provider || previousConfig.provider;
    if (
      !incomingConfig.clearApiKey &&
      String(nextProvider) === String(previousConfig.provider) &&
      !String(incomingConfig.apiKey || '').trim() &&
      previousConfig.apiKey
    ) {
      delete incomingConfig.apiKey;
    }
    delete incomingConfig.clearApiKey;

    const normalized = normalizeAiProviderConfig(incomingConfig, previousConfig);
    settings[AI_CONFIG_SETTING_KEY] = normalized;
    store.set('settings', settings);

    return redactAiProviderConfig(normalized);
  }

  function emitTaskEvent(event) {
    const payload = {
      ...event,
      taskId: event.taskId || (state.currentTask && state.currentTask.id) || '',
      at: event.at || new Date().toISOString()
    };
    const task = state.currentTask || state.lastTask;
    if (task) {
      task.events.push(payload);
    }

    const mainWindow =
      windowService && windowService.getMainWindow ? windowService.getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai:task:event', payload);
    }
  }

  function getTaskStatus() {
    const task = state.currentTask || state.lastTask;
    if (!task) {
      return {
        running: false,
        status: 'idle',
        events: []
      };
    }

    return {
      id: task.id,
      running: task.status === 'running',
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt || '',
      events: task.events.slice(-80),
      result: task.result ? compactTaskResult(task.result) : null,
      error: task.error || ''
    };
  }

  async function runTask(taskFn) {
    if (state.currentTask && state.currentTask.status === 'running') {
      throw new Error('已有 AI 采集任务正在运行，请等待完成后再开始新任务。');
    }

    const controller = new AbortController();
    const task = {
      id: randomUUID(),
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: '',
      events: [],
      result: null,
      error: '',
      controller
    };
    state.currentTask = task;
    emitTaskEvent({ type: 'task:start', message: '采集任务已开始', taskId: task.id });

    try {
      const result = await taskFn({
        taskId: task.id,
        signal: controller.signal,
        onTaskEvent: emitTaskEvent
      });
      task.status = 'completed';
      task.result = result;
      task.finishedAt = new Date().toISOString();
      emitTaskEvent({
        type: 'task:done',
        message: result.writeSkipped
          ? result.writeSkipReason || '任务完成但未写入'
          : '采集任务完成',
        taskId: task.id,
        details: compactTaskResult(result)
      });
      return result;
    } catch (error) {
      const cancelled = isCancellationError(error, controller.signal);
      task.status = cancelled ? 'cancelled' : 'failed';
      task.error = cancelled ? '任务已取消' : error.message || String(error);
      task.finishedAt = new Date().toISOString();
      const cancelAlreadyEmitted =
        cancelled && task.events.some((event) => event.type === 'task:cancel');
      if (!cancelAlreadyEmitted) {
        emitTaskEvent({
          type: cancelled ? 'task:cancel' : 'task:error',
          message: task.error,
          taskId: task.id
        });
      }
      throw error;
    } finally {
      state.lastTask = task;
      state.taskHistory.set(task.id, task);
      if (state.taskHistory.size > 30) {
        const oldestKey = state.taskHistory.keys().next().value;
        state.taskHistory.delete(oldestKey);
      }
      state.currentTask = null;
    }
  }

  async function startTask(payload = {}) {
    const result = await runTask(async ({ taskId, signal, onTaskEvent }) => {
      const runner = await getHotelTaskRunner();
      flushStoreBeforeExternalWrite();
      return runner(
        {
          inputMode: payload.inputMode,
          addressQuery: payload.addressQuery,
          url: payload.url,
          urls: payload.urls,
          text: payload.text || payload.inputText || '',
          templateId: payload.templateId,
          templateName: payload.templateName,
          listFilters: payload.listFilters,
          targetCount: payload.targetCount,
          desiredHotelCount: payload.desiredHotelCount,
          maxCandidatesPerPage: payload.maxCandidatesPerPage,
          amapKey: payload.amapKey,
          listUrlFilters: payload.listUrlFilters,
          priceMin: payload.priceMin,
          priceMax: payload.priceMax,
          starLevels: payload.starLevels,
          sortMode: payload.sortMode,
          freeCancel: payload.freeCancel,
          reviewCountMin: payload.reviewCountMin,
          ctripScoreMin: payload.ctripScoreMin,
          accommodationTypeMode: payload.accommodationTypeMode,
          accommodationTypes: payload.accommodationTypes,
          roomTypes: payload.roomTypes,
          roomFeatures: payload.roomFeatures,
          featureThemes: payload.featureThemes,
          enableCollectPerfLog: payload.enableCollectPerfLog,
          collectBrowser: payload.collectBrowser,
          batchConcurrency: payload.batchConcurrency
        },
        {
          taskId,
          dataFolderPath: dataService.getDataFolderPath(),
          signal,
          onEvent: onTaskEvent
        }
      );
    });
    reloadStoreAfterExternalWrite(result);
    const compactResult = compactTaskResult(result);

    return {
      success: true,
      message: result.writeSkipped ? result.writeSkipReason || '任务完成但未写入' : '采集任务完成',
      collectResult: compactResult,
      toolResults: [
        {
          name: 'collect_and_write_ctrip_hotel',
          result: compactResult
        }
      ],
      taskStatus: getTaskStatus()
    };
  }

  async function testConnection(configOverride = {}) {
    const previousConfig = getProviderConfig({ includeSecret: true });
    const incomingConfig = { ...configOverride };
    if (
      String(incomingConfig.provider || previousConfig.provider) ===
        String(previousConfig.provider) &&
      !String(incomingConfig.apiKey || '').trim() &&
      previousConfig.apiKey
    ) {
      delete incomingConfig.apiKey;
    }
    const config = normalizeAiProviderConfig(incomingConfig, previousConfig);
    const message = await requestChatCompletion(
      config,
      [
        {
          role: 'user',
          content: '请只回复 OK。'
        }
      ],
      [],
      {
        maxTokens: 32
      }
    );

    return {
      success: true,
      message: message.content || 'OK'
    };
  }

  function cancelTask() {
    if (!state.currentTask || state.currentTask.status !== 'running') {
      return {
        success: false,
        error: '当前没有正在运行的采集任务'
      };
    }

    state.currentTask.controller.abort();
    emitTaskEvent({
      type: 'task:cancel',
      message: '任务已取消',
      taskId: state.currentTask.id
    });
    return {
      success: true
    };
  }

  async function refreshHotelData(payload = {}) {
    const result = await runTask(async ({ taskId, signal, onTaskEvent }) => {
      const scraperRunner = await loadScraperRunner();
      flushStoreBeforeExternalWrite();
      return scraperRunner.refreshExistingCtripHotels(
        {
          amapKey: payload.amapKey,
          collectBrowser: payload.collectBrowser,
          batchConcurrency: payload.batchConcurrency
        },
        {
          taskId,
          dataFolderPath: dataService.getDataFolderPath(),
          signal,
          onEvent: onTaskEvent
        }
      );
    });
    reloadStoreAfterExternalWrite(result);
    const compactResult = compactRefreshResult(result);

    return {
      success: true,
      message: result.message || `更新完成，本次更新 ${compactResult.updatedHotelCount} 家宾馆信息`,
      collectResult: compactResult,
      toolResults: [
        {
          name: 'refresh_existing_ctrip_hotels',
          result: compactResult
        }
      ],
      taskStatus: getTaskStatus()
    };
  }

  return {
    cancelTask,
    getProviderConfig,
    getProviderPresets: getAiProviderPresets,
    getTaskStatus,
    refreshHotelData,
    saveProviderConfig,
    startTask,
    testConnection
  };
}

module.exports = {
  AI_CONFIG_SETTING_KEY,
  createAiService
};
