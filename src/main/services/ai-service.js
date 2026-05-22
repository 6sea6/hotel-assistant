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

const AI_CONFIG_SETTING_KEY = 'ai_provider_config';
const MAX_TOOL_ITERATIONS = 5;

function toJsonContent(value) {
  return JSON.stringify(value, null, 2);
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
    reviewInputAvailable: Boolean(result.reviewInput),
    reviewTaskId:
      result.reviewInput && result.reviewInput.taskMeta ? result.reviewInput.taskMeta.taskId : '',
    outputFingerprint:
      result.reviewInput && result.reviewInput.taskMeta
        ? result.reviewInput.taskMeta.outputFingerprint
        : '',
    error: result.error || ''
  };
}

function compactToolResult(toolName, result) {
  if (toolName === 'collect_and_write_ctrip_hotel') {
    return compactTaskResult(result);
  }

  return result;
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

function buildSystemPrompt() {
  return `你是宾馆比较助手内置 AI 兜底助手。你的任务不是让用户复制命令，也不是直接改 hotel-data.json，而是在应用提供的受限工具内完成携程酒店采集、解释结果和诊断失败原因。

固定规则：
1. 支持处理携程酒店详情页链接和酒店列表页链接；如果用户粘贴混合文本，要从中提取携程 URL。
2. 必须使用用户当前选择的模板 ID 或模板名，不要根据日期、人数、目的地猜模板。
3. 不要伪造价格、评分、交通、房型、系统字段。
4. 不要手工写入 hotel-data.json，不要创建临时数据文件。
5. 写入前必须满足：采集成功、模板有效、eligibleCount > 0、存在有效价格、房型未被安全门排除。
6. 如果工具返回 writeSkipped、error、无价格、无符合房型，要如实说明原因。
7. 如果检测到登录看低价、解锁优惠、无有效价格，应提示程序打开可见 Edge 登录窗口；用户登录携程并关闭窗口后，采集会自动重试。
8. 成功写入时说明：酒店名、可用房型数、价格摘要、写入状态。
9. 成功但未写入时说明：这是采集完成但安全门阻止写入，不等于程序崩溃。
10. 列表页会先合并携程 URL 前筛，并按本地排除住宿类型、目标数量做候选筛选，再逐个进入详情页复用原采集链路。
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

const REVIEW_EVIDENCE_SOURCES = new Set([
  'finalHotels',
  'eligibleRoomTypes',
  'rejectedRoomTypes',
  'rawRoomCandidates',
  'normalizeLogs',
  'selectionLogs',
  'finalHotelFieldLogs',
  'pageSnapshotSummary'
]);

const REVIEW_REQUIRED_HOTEL_LOCKED_FIELDS = [
  'website',
  'check_in_date',
  'check_out_date',
  'days',
  'template_id',
  'template_info',
  'distance',
  'subway_station',
  'subway_distance',
  'transport_time',
  'bus_route'
];

const REVIEW_EXCLUDED_TRAFFIC_FIELDS = new Set([
  'distance',
  'subway_station',
  'subway_distance',
  'transport_time',
  'bus_route'
]);

function sanitizeForAi(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAi(item, seen));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api[-_]?key|token|secret|cookie|authorization|password/i.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = sanitizeForAi(item, seen);
  }
  return output;
}

function isReviewExcludedTrafficField(field) {
  return REVIEW_EXCLUDED_TRAFFIC_FIELDS.has(String(field || '').trim());
}

function stripReviewExcludedFields(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripReviewExcludedFields(item))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (
    isReviewExcludedTrafficField(value.field) ||
    isReviewExcludedTrafficField(value.sourceField)
  ) {
    return undefined;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isReviewExcludedTrafficField(key)) {
      continue;
    }
    const nextValue = stripReviewExcludedFields(item);
    if (nextValue !== undefined) {
      output[key] = nextValue;
    }
  }
  return output;
}

function sanitizeReviewInputForAi(reviewInput) {
  return stripReviewExcludedFields(sanitizeForAi(reviewInput));
}

function extractJsonObject(content = '') {
  const text = String(content || '').trim();
  if (!text) {
    throw new Error('AI 没有返回可解析的分析结果。');
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }
    throw error;
  }
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

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/(bearer\s+)[a-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[-_]?key|token|secret|cookie|authorization|password)["'\s:=]+)([^"',\s}{\]]+)/gi,
      '$1[REDACTED]'
    );
}

function truncateText(text, maxLength = 8000) {
  const safeText = redactSensitiveText(text);
  return safeText.length > maxLength ? `${safeText.slice(0, maxLength)}\n...[TRUNCATED]` : safeText;
}

function buildReviewSystemPrompt() {
  return `你是宾馆比较助手的采集复核助手。你只能分析程序提供的 review_input，不能重新采集网页、不能读取本地文件、不能使用 cookie/token/API key，也不能编造价格、房型或系统字段。

你的任务：
1. 判断脚本是否在解析、标准化、过滤、匹配或最终选择阶段遗漏了正确数据。
2. 如果证据充分，返回可预览的 revisedHotels。
3. 如果证据不足，返回 canApply=false，并说明缺少哪些证据。
4. 交通相关字段不参与本次复核，程序不会提供这类字段；不要检查、评价或修改交通相关字段。

必须返回纯 JSON，不要 Markdown，不要解释性前后缀。JSON 字段：
{
  "canApply": boolean,
  "summary": "简短结论",
  "issues": ["发现的问题"],
  "revisedHotels": [],
  "diffs": [{"field":"","before":"","after":"","reason":""}],
  "evidence": [{"source":"","id":"","field":"","value":"","supports":""}],
  "missingEvidence": ["缺少的证据"]
}

证据规则：
- evidence.source 只能是 finalHotels、eligibleRoomTypes、rejectedRoomTypes、rawRoomCandidates、normalizeLogs、selectionLogs、finalHotelFieldLogs、pageSnapshotSummary。
- 修改价格、房型、取消规则、人数、床型、面积、备注等字段时，必须能从 evidence 中找到对应来源和字段。
- 如果 rawRoomCandidates、eligibleRoomTypes、rejectedRoomTypes、normalizeLogs、selectionLogs 或 finalHotelFieldLogs 中没有支撑某个价格/房型/备注信息的证据，禁止编造，canApply=false。`;
}

function buildReviewUserPrompt(reviewInput) {
  return `请根据以下 review_input 分析本次携程酒店采集结果是否需要重填。只使用 review_input 中的证据。交通字段已从复核输入中移除，不要复核或修改交通字段。\n\nreview_input:\n${JSON.stringify(sanitizeReviewInputForAi(reviewInput), null, 2)}`;
}

function buildReviewJsonRepairPrompt(invalidContent, parseError) {
  return `下面是上一步模型返回的内容，但它不是合法 JSON，程序解析失败。

解析错误：
${compactErrorMessage(parseError)}

请你只做 JSON 格式修复：
1. 只输出一个合法 JSON 对象。
2. 不要 Markdown，不要代码块，不要解释。
3. 不要新增证据、价格、房型或字段含义，只修复逗号、引号、数组/对象闭合等语法问题。
4. 保留这些字段：canApply、summary、issues、revisedHotels、diffs、evidence、missingEvidence。

原始内容：
${truncateText(invalidContent)}`;
}

function buildUnparseableReviewResult(primaryError, repairError) {
  return {
    canApply: false,
    summary: 'AI 返回的分析结果不是合法 JSON，已拒绝写入。',
    issues: [
      'AI 已返回分析内容，但格式不符合程序要求。',
      '程序已尝试自动修复 JSON，仍无法安全解析。'
    ],
    revisedHotels: [],
    diffs: [],
    evidence: [],
    missingEvidence: [
      `首次解析失败：${compactErrorMessage(primaryError)}`,
      repairError ? `自动修复后仍失败：${compactErrorMessage(repairError)}` : ''
    ].filter(Boolean)
  };
}

function buildEvidenceIndex(reviewInput = {}) {
  const index = new Map();
  for (const source of REVIEW_EVIDENCE_SOURCES) {
    const value = reviewInput[source];
    if (Array.isArray(value)) {
      const ids = new Set(
        value.map((item, itemIndex) => String(item && item.id ? item.id : itemIndex))
      );
      index.set(source, ids);
    } else if (value && typeof value === 'object') {
      index.set(source, new Set(Object.keys(value)));
    } else {
      index.set(source, new Set());
    }
  }
  return index;
}

function normalizeAnalysisResult(rawResult = {}) {
  return {
    canApply: Boolean(rawResult.canApply),
    summary: String(rawResult.summary || ''),
    issues: Array.isArray(rawResult.issues) ? rawResult.issues.map(String).filter(Boolean) : [],
    revisedHotels: Array.isArray(rawResult.revisedHotels)
      ? rawResult.revisedHotels.filter((item) => item && typeof item === 'object')
      : [],
    diffs: Array.isArray(rawResult.diffs)
      ? rawResult.diffs.filter((item) => item && typeof item === 'object')
      : [],
    evidence: Array.isArray(rawResult.evidence)
      ? rawResult.evidence.filter((item) => item && typeof item === 'object')
      : [],
    missingEvidence: Array.isArray(rawResult.missingEvidence)
      ? rawResult.missingEvidence.map(String).filter(Boolean)
      : []
  };
}

function validateEvidenceReferences(analysis, reviewInput) {
  const evidenceIndex = buildEvidenceIndex(reviewInput);
  const errors = [];

  for (const item of analysis.evidence) {
    const source = String(item.source || '');
    const id = String(item.id || '');
    const field = String(item.field || '');
    if (!REVIEW_EVIDENCE_SOURCES.has(source)) {
      errors.push(`未知证据来源：${source || '空'}`);
      continue;
    }
    if (!field) {
      errors.push(`证据缺少字段名：${source}`);
    }
    if (source === 'pageSnapshotSummary') {
      if (id && !evidenceIndex.get(source).has(id)) {
        errors.push(`pageSnapshotSummary 中不存在字段：${id}`);
      }
      continue;
    }
    if (!id || !evidenceIndex.get(source).has(id)) {
      errors.push(`证据 ${source}.${id || '(空)'} 不存在`);
    }
  }

  return errors;
}

function hasPriceEvidence(analysis) {
  return analysis.evidence.some((item) => {
    const source = String(item.source || '');
    const field = String(item.field || '').toLowerCase();
    return (
      ['finalHotels', 'eligibleRoomTypes', 'rejectedRoomTypes', 'rawRoomCandidates'].includes(
        source
      ) && /price|价格|total|daily|rawpricetext/.test(field)
    );
  });
}

function validateAnalysisResult(analysis, reviewInput) {
  const normalized = normalizeAnalysisResult(analysis);
  const validationErrors = validateEvidenceReferences(normalized, reviewInput);

  if (normalized.canApply) {
    if (normalized.revisedHotels.length === 0) {
      validationErrors.push('AI 没有返回可写入的 revisedHotels。');
    }
    if (normalized.evidence.length === 0) {
      validationErrors.push('AI 没有返回 evidence，无法确认修正依据。');
    }
    const hasHotelWithPrice = normalized.revisedHotels.some(
      (hotel) =>
        (hotel.total_price !== null &&
          hotel.total_price !== undefined &&
          hotel.total_price !== '') ||
        (hotel.daily_price !== null && hotel.daily_price !== undefined && hotel.daily_price !== '')
    );
    if (hasHotelWithPrice && !hasPriceEvidence(normalized)) {
      validationErrors.push('AI 返回了价格，但没有提供价格证据。');
    }
  }

  if (validationErrors.length > 0) {
    normalized.canApply = false;
    normalized.missingEvidence = [...new Set([...normalized.missingEvidence, ...validationErrors])];
  }

  return normalized;
}

function lockReviewedHotelFields(revisedHotels = [], reviewInput = {}) {
  const finalHotels = Array.isArray(reviewInput.finalHotels) ? reviewInput.finalHotels : [];
  const baseHotel = finalHotels[0] || {};
  const taskMeta = reviewInput.taskMeta || {};
  const lockedValues = {
    website: baseHotel.website || taskMeta.url || '',
    check_in_date: baseHotel.check_in_date || taskMeta.checkInDate || '',
    check_out_date: baseHotel.check_out_date || taskMeta.checkOutDate || '',
    days: baseHotel.days,
    template_id: baseHotel.template_id ?? taskMeta.templateId ?? null,
    template_info: baseHotel.template_info || {
      id: taskMeta.templateId ?? null,
      name: taskMeta.templateName || '',
      destination: taskMeta.destination || '',
      check_in_date: taskMeta.checkInDate || '',
      check_out_date: taskMeta.checkOutDate || '',
      room_count: taskMeta.roomCount ?? taskMeta.guestCount ?? null
    },
    distance: baseHotel.distance ?? '',
    subway_station: baseHotel.subway_station ?? '',
    subway_distance: baseHotel.subway_distance ?? '',
    transport_time: baseHotel.transport_time ?? '',
    bus_route: baseHotel.bus_route ?? ''
  };

  return revisedHotels.map((hotel) => {
    const nextHotel = {
      ...baseHotel,
      ...hotel
    };
    for (const field of REVIEW_REQUIRED_HOTEL_LOCKED_FIELDS) {
      if (lockedValues[field] !== undefined) {
        nextHotel[field] = lockedValues[field];
      }
    }
    delete nextHotel.apiKey;
    delete nextHotel.token;
    delete nextHotel.secret;
    return nextHotel;
  });
}

function createAiService({ dataService, windowService, hotelTaskRunner = null }) {
  const state = {
    currentTask: null,
    lastTask: null,
    taskHistory: new Map(),
    pendingReviews: new Map()
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

  async function applyReviewedHotelsLazy(hotels, context) {
    const scraperRunner = await loadScraperRunner();
    return scraperRunner.applyReviewedHotels(hotels, context);
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
      reviewInputAvailable: Boolean(task.result && task.result.reviewInput),
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
      return runner(
        {
          url: payload.url,
          urls: payload.urls,
          text: payload.text || payload.inputText || '',
          templateId: payload.templateId,
          templateName: payload.templateName,
          listFilters: payload.listFilters,
          excludeAccommodationKeywords: payload.excludeAccommodationKeywords,
          excludeHotelTypes: payload.excludeHotelTypes,
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
          ctripScoreMin: payload.ctripScoreMin
        },
        {
          taskId,
          dataFolderPath: dataService.getDataFolderPath(),
          signal,
          onEvent: onTaskEvent
        }
      );
    });
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

  function getTaskById(taskId) {
    const id = String(taskId || '');
    const candidates = [state.currentTask, state.lastTask].filter(Boolean);
    return candidates.find((task) => String(task.id) === id) || state.taskHistory.get(id) || null;
  }

  function getReviewInputForTask(taskId, userConcern = '') {
    const task = getTaskById(taskId);
    if (!task) {
      throw new Error('未找到对应的采集任务，无法进行 AI 分析。');
    }
    if (!task.result || !task.result.reviewInput) {
      throw new Error('当前任务没有生成 review_input，无法进行 AI 分析。');
    }

    return {
      ...task.result.reviewInput,
      userConcern: String(userConcern || '').trim()
    };
  }

  async function analyzeCollection() {
    throw new Error('AI分析重填功能已关闭。');
  }

  async function applyCollectionReview() {
    throw new Error('AI覆盖写入功能已关闭。');
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

  return {
    analyzeCollection,
    applyCollectionReview,
    cancelTask,
    getProviderConfig,
    getProviderPresets: getAiProviderPresets,
    getTaskStatus,
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
