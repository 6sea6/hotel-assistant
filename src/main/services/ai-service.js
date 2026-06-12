const { randomUUID } = require('crypto');
const {
  getAiProviderPresets,
  getDefaultAiProviderConfig,
  normalizeAiProviderConfig,
  redactAiProviderConfig
} = require('../ai/provider-presets');
const { requestChatCompletion } = require('../ai/provider-client');
const { loadScraperRunner } = require('../ai/scraper-lazy-loader');
const { AI_TOOL_DEFINITIONS, executeAiTool } = require('../ai/tools');
const {
  flushHotelRepositoryCache,
  resetHotelRepositoryCache
} = require('../repositories/hotel-repository');

const AI_CONFIG_SETTING_KEY = 'ai_provider_config';
const MAX_TOOL_ITERATIONS = 5;

function toJsonContent(value) {
  return JSON.stringify(value, null, 2);
}

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
    writeResult: result.writeResult || null,
    loginRetry: result.loginRetry || null,
    eligibleRoomTypes,
    eligibleHotels,
    pageSnapshot: result.pageSnapshot || null,
    error: result.error || ''
  };
}

function compactToolResult(toolName, result) {
  if (toolName === 'collect_and_write_ctrip_hotel') {
    return compactTaskResult(result);
  }

  return result;
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

function normalizeChatMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'user',
      content: String(message.content || '')
    }))
    .filter((message) => message.content.trim());
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

function buildSystemPrompt() {
  return `你是宾馆比较助手内置 AI 兜底助手。你的任务不是让用户复制命令，也不是直接改 hotel-data.json，而是在应用提供的受限工具内完成携程酒店采集、解释结果和诊断失败原因。

固定规则：
1. 支持处理携程酒店详情页链接和酒店列表页链接；如果用户粘贴混合文本，要从中提取携程 URL。
2. 必须使用用户当前选择的模板 ID 或模板名，不要根据日期、人数、目的地猜模板。
3. 不要伪造价格、评分、交通、房型、系统字段。
4. 不要手工写入 hotel-data.json，不要创建临时数据文件。
5. 写入前必须满足：采集成功、模板有效、eligibleCount > 0、存在有效价格、房型未被安全门排除。
6. 如果工具返回 writeSkipped、error、无价格、无符合房型，要如实说明原因。
7. 如果检测到登录看低价、解锁优惠、无有效价格，应提示程序打开可见采集浏览器登录窗口；用户登录携程并关闭窗口后，采集会自动重试。
8. 成功写入时说明：酒店名、可用房型数、价格摘要、写入状态。
9. 成功但未写入时说明：这是采集完成但安全门阻止写入，不等于程序崩溃。
10. 列表页会先合并携程 URL 前筛，并按目标数量选择候选，再逐个进入详情页复用原采集链路。
11. 永远不要输出或复述 API Key、token、本地敏感配置。

工具使用：
- list_templates：模板信息不明确时使用。
- collect_and_write_ctrip_hotel：已有模板和携程详情页/列表页链接时使用，支持多个 URL 或混合粘贴文本。
- get_task_status：查询当前任务进度时使用。
- open_visible_edge_login：需要用户重新登录携程时使用。

结果判断：
- success + writeResult：已成功写入，无异常原因。
- success + writeSkipped：采集完成但未写入，展示 writeSkipReason。
- success + eligibleCount=0：采集完成，但没有符合条件的房型。
- success + 无价格：需要登录携程或页面价格未展示，不写入。
- failed/error/cancelled：任务失败或中断，展示错误和建议。

回复风格：
用简洁中文，优先告诉用户现在发生了什么、是否写入、如果没写入该怎么做。`;
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

  async function sendChat(payload = {}) {
    const config = getProviderConfig({ includeSecret: true });
    if (!config.enabled) {
      throw new Error('请先在设置中启用 AI 接口。');
    }
    if (!config.apiKey) {
      throw new Error('请先填写 AI API Key。');
    }

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt()
      },
      ...normalizeChatMessages(payload.messages || [])
    ];
    const toolResults = [];

    for (let index = 0; index < MAX_TOOL_ITERATIONS; index += 1) {
      const assistantMessage = await requestChatCompletion(config, messages, AI_TOOL_DEFINITIONS);
      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls.length) {
        return {
          success: true,
          message: assistantMessage.content || '',
          toolResults,
          taskStatus: getTaskStatus()
        };
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function && toolCall.function.name;
        const toolArguments = toolCall.function && toolCall.function.arguments;
        emitTaskEvent({
          type: 'tool:start',
          message: `正在调用工具：${toolName || 'unknown'}`
        });
        const result = await executeAiTool(toolName, toolArguments, {
          dataService,
          signal:
            state.currentTask && state.currentTask.controller
              ? state.currentTask.controller.signal
              : null,
          onTaskEvent: emitTaskEvent,
          getTaskStatus,
          runTask: (taskFn) =>
            runTask(({ signal, onTaskEvent }) =>
              taskFn({
                signal,
                onTaskEvent
              })
            )
        });
        reloadStoreAfterExternalWrite(result);
        const compactResult = compactToolResult(toolName, result);
        toolResults.push({
          name: toolName,
          result: compactResult
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toJsonContent(compactResult)
        });
      }
    }

    return {
      success: true,
      message: '工具执行已完成，但 AI 没有给出最终回复。请查看任务状态。',
      toolResults,
      taskStatus: getTaskStatus()
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
    sendChat,
    startTask,
    testConnection
  };
}

module.exports = {
  AI_CONFIG_SETTING_KEY,
  buildSystemPrompt,
  createAiService
};
