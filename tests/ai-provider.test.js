const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getAiProviderPresets,
  normalizeAiProviderConfig,
  redactAiProviderConfig
} = require('../src/main/ai/provider-presets');
const registerAiHandlers = require('../src/main/ipc-handlers/ai-handlers');
const { buildSystemPrompt, createAiService } = require('../src/main/services/ai-service');
const {
  buildAnthropicMessagesUrl,
  buildChatCompletionRequest,
  buildChatCompletionsUrl,
  buildProviderErrorMessage,
  convertMessagesToAnthropic,
  parseChatCompletionMessage
} = require('../src/main/ai/provider-client');
const { AI_TOOL_DEFINITIONS, sanitizeSettings } = require('../src/main/ai/tools');
const {
  buildScraperArgs,
  createWriteRollbackSnapshot,
  getVisibleLoginRetryNeed,
  isTaskCancelled,
  resolveRootPerfLogDir,
  resolveScraperPath,
  restoreWriteRollbackSnapshot,
  runRefreshHotelBatch
} = require('../src/main/ai/scraper-runner');

function createTrustedIpcEvent() {
  return {
    senderFrame: { url: 'file:///trusted/index.html' },
    sender: {}
  };
}

test('AI provider presets include MiMo and normalize config', () => {
  const presets = getAiProviderPresets();
  const mimo = presets.find((preset) => preset.id === 'mimo');
  const openai = presets.find((preset) => preset.id === 'openai');

  assert.equal(mimo.name, 'MiMo TokenPlan');
  assert.equal(mimo.baseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic');
  assert.equal(mimo.model, 'mimo-v2.5-pro');
  assert.ok(mimo.modelOptions.includes('mimo-v2.5'));
  assert.ok(mimo.modelOptions.includes('mimo-v2.5-tts'));
  assert.equal(openai.model, 'gpt-5.4');

  const normalized = normalizeAiProviderConfig({
    provider: 'mimo',
    apiKey: ' key ',
    temperature: 9
  });

  assert.equal(normalized.provider, 'mimo');
  assert.equal(normalized.baseUrl, mimo.baseUrl);
  assert.equal(normalized.model, 'mimo-v2.5-pro');
  assert.equal(normalized.apiKey, 'key');
  assert.equal(normalized.temperature, 0.2);

  const mixedCaseModel = normalizeAiProviderConfig({
    provider: 'mimo',
    model: 'MiMo-V2.5'
  });
  assert.equal(mixedCaseModel.model, 'mimo-v2.5');
});

test('MiMo normalizer migrates old non-TokenPlan base URL to TokenPlan endpoint', () => {
  const normalized = normalizeAiProviderConfig(
    {
      provider: 'mimo'
    },
    {
      provider: 'mimo',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro'
    }
  );

  assert.equal(normalized.baseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic');

  const regional = normalizeAiProviderConfig(
    {
      provider: 'mimo'
    },
    {
      provider: 'mimo',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro'
    }
  );

  assert.equal(regional.baseUrl, 'https://token-plan-sgp.xiaomimimo.com/anthropic');
});

test('AI config redaction removes API key but keeps key presence', () => {
  const redacted = redactAiProviderConfig({
    provider: 'deepseek',
    apiKey: 'secret'
  });

  assert.equal(redacted.apiKey, '');
  assert.equal(redacted.hasApiKey, true);
});

test('Chat completion request uses OpenAI-compatible tools shape', () => {
  assert.equal(
    buildChatCompletionsUrl('https://api.deepseek.com/'),
    'https://api.deepseek.com/chat/completions'
  );

  const request = buildChatCompletionRequest(
    {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'secret',
      temperature: 0.3
    },
    [{ role: 'user', content: 'hello' }],
    [
      {
        type: 'function',
        function: {
          name: 'list_templates',
          parameters: { type: 'object', properties: {} }
        }
      }
    ]
  );

  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.body.model, 'deepseek-chat');
  assert.equal(request.body.tool_choice, 'auto');
  assert.equal(request.init.headers.Authorization, 'Bearer secret');
});

test('MiMo requests use Anthropic-compatible TokenPlan shape', () => {
  assert.equal(
    buildAnthropicMessagesUrl('https://token-plan-cn.xiaomimimo.com/anthropic/'),
    'https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages'
  );

  const request = buildChatCompletionRequest(
    {
      provider: 'mimo',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
      model: 'mimo-v2.5',
      apiKey: 'secret',
      temperature: 0.2
    },
    [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' }
    ],
    [
      {
        type: 'function',
        function: {
          name: 'list_templates',
          description: 'list',
          parameters: { type: 'object', properties: {} }
        }
      }
    ],
    {
      maxTokens: 32
    }
  );

  assert.equal(request.url, 'https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages');
  assert.equal(request.body.system, 'system prompt');
  assert.equal(request.body.max_tokens, 32);
  assert.equal(request.body.tools[0].input_schema.type, 'object');
  assert.equal(request.init.headers['x-api-key'], 'secret');
});

test('Anthropic message conversion preserves tool result turns', () => {
  const converted = convertMessagesToAnthropic([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tool_1',
          function: {
            name: 'list_templates',
            arguments: '{}'
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'tool_1',
      content: '{"templates":[]}'
    }
  ]);

  assert.equal(converted.messages[0].content[0].type, 'tool_use');
  assert.equal(converted.messages[1].content[0].type, 'tool_result');
});

test('Anthropic message conversion preserves provider thinking blocks verbatim', () => {
  const rawContent = [
    {
      type: 'thinking',
      thinking: 'need tool',
      signature: ''
    },
    {
      type: 'tool_use',
      id: 'tool_1',
      name: 'list_templates',
      input: {}
    }
  ];
  const converted = convertMessagesToAnthropic([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tool_1',
          function: {
            name: 'list_templates',
            arguments: '{}'
          }
        }
      ],
      anthropic_content: rawContent
    }
  ]);

  assert.deepEqual(converted.messages[0].content, rawContent);
});

test('Chat completion parser preserves tool calls', () => {
  const message = parseChatCompletionMessage({
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'list_templates',
                arguments: '{}'
              }
            }
          ]
        }
      }
    ]
  });

  assert.equal(message.role, 'assistant');
  assert.equal(message.tool_calls.length, 1);
});

test('Chat completion parser supports Anthropic tool_use content', () => {
  const message = parseChatCompletionMessage({
    content: [
      {
        type: 'text',
        text: 'ok'
      },
      {
        type: 'tool_use',
        id: 'tool_1',
        name: 'list_templates',
        input: {}
      }
    ]
  });

  assert.equal(message.content, 'ok');
  assert.equal(message.tool_calls[0].function.name, 'list_templates');
  assert.equal(Array.isArray(message.anthropic_content), true);
});

test('MiMo error messages explain TokenPlan authentication and parameter failures', () => {
  assert.match(
    buildProviderErrorMessage(401, 'Invalid API Key', { provider: 'mimo' }),
    /TokenPlan 鉴权失败/
  );
  assert.match(
    buildProviderErrorMessage(400, 'Param Incorrect', { provider: 'mimo' }),
    /\/anthropic/
  );
});

test('AI settings sanitizer removes API key from settings-shaped objects', () => {
  const sanitized = sanitizeSettings({
    theme: 'totoro-blue',
    amapApiKey: 'amap-secret',
    ai_provider_config: {
      provider: 'openai',
      apiKey: 'secret'
    }
  });

  assert.equal(sanitized.ai_provider_config.apiKey, '');
  assert.equal(sanitized.ai_provider_config.hasApiKey, true);
  assert.equal(sanitized.amapApiKey, '[REDACTED]');
});

test('AI fallback system prompt is compact and ignores legacy guide text', () => {
  const prompt = buildSystemPrompt('legacy guide should be ignored');

  assert.match(prompt, /内置 AI 兜底助手/);
  assert.match(prompt, /详情页链接和酒店列表页链接/);
  assert.match(prompt, /列表页会先合并携程 URL 前筛/);
  assert.doesNotMatch(prompt, /排除名称关键词/);
  assert.match(prompt, /collect_and_write_ctrip_hotel/);
  assert.doesNotMatch(prompt, /legacy guide/);
});

test('AI collect tool schema documents list and detail URL inputs', () => {
  const collectTool = AI_TOOL_DEFINITIONS.find(
    (tool) => tool.function.name === 'collect_and_write_ctrip_hotel'
  );
  const properties = collectTool.function.parameters.properties;

  assert.match(collectTool.function.description, /详情页/);
  assert.match(collectTool.function.description, /列表页/);
  assert.ok(properties.url);
  assert.ok(properties.urls);
  assert.ok(properties.listFilters);
  assert.ok(properties.listUrlFilters);
  assert.ok(properties.desiredHotelCount);
  assert.equal(properties.minScore, undefined);
  assert.equal(properties.excludeKeywords, undefined);
  assert.ok(properties.excludeHotelTypes);
  assert.equal(properties.maxPages, undefined);
});

test('AI IPC registers direct task start endpoint', () => {
  const handlers = new Map();
  let aiServiceAccessCount = 0;
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
      assert.equal(typeof handler, 'function');
    }
  };

  registerAiHandlers({
    ipcMain,
    services: {
      getAiService() {
        aiServiceAccessCount += 1;
        return {
          getProviderConfig() {},
          getProviderPresets() {
            return [];
          },
          saveProviderConfig() {},
          testConnection() {},
          sendChat() {},
          startTask() {},
          cancelTask() {},
          getTaskStatus() {}
        };
      }
    }
  });

  assert.ok(handlers.has('ai:task:start'));
  assert.ok(handlers.has('ai:ctrip-list-url:parse'));
  assert.ok(handlers.has('ai:ctrip-list-url:build'));
  assert.equal(aiServiceAccessCount, 0);

  handlers.get('ai:config:presets')(createTrustedIpcEvent());
  assert.equal(aiServiceAccessCount, 1);
});

test('AI IPC keeps compatibility with direct aiService object', () => {
  const channels = [];
  registerAiHandlers({
    ipcMain: {
      handle(channel, handler) {
        channels.push(channel);
        assert.equal(typeof handler, 'function');
      }
    },
    services: {
      aiService: {
        getProviderConfig() {},
        getProviderPresets() {},
        saveProviderConfig() {},
        testConnection() {},
        sendChat() {},
        startTask() {},
        cancelTask() {},
        getTaskStatus() {}
      }
    }
  });

  assert.ok(channels.includes('ai:task:start'));
  assert.ok(channels.includes('ai:ctrip-list-url:parse'));
  assert.ok(channels.includes('ai:ctrip-list-url:build'));
});

test('AI IPC normalizes unsafe renderer payloads at the handler boundary', async () => {
  const handlers = new Map();
  const received = [];
  registerAiHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    },
    services: {
      aiService: {
        getProviderConfig() {},
        getProviderPresets() {},
        saveProviderConfig(config) {
          received.push({ channel: 'save', config });
          return { success: true };
        },
        testConnection(config) {
          received.push({ channel: 'test', config });
          return { success: true };
        },
        sendChat(payload) {
          received.push({ channel: 'chat', payload });
          return { success: true };
        },
        startTask(payload) {
          received.push({ channel: 'start', payload });
          return { success: true };
        },
        refreshHotelData(payload) {
          received.push({ channel: 'refresh', payload });
          return { success: true };
        },
        cancelTask() {},
        getTaskStatus() {}
      }
    }
  });

  const event = createTrustedIpcEvent();

  assert.deepEqual(await handlers.get('ai:config:save')(event, 'bad'), { success: true });
  assert.deepEqual(await handlers.get('ai:config:test')(event, null), { success: true });
  assert.deepEqual(await handlers.get('ai:chat:send')(event, 'bad'), {
    success: false,
    error: '无效的 AI 请求参数'
  });
  assert.deepEqual(await handlers.get('ai:task:start')(event, null), {
    success: false,
    error: '无效的 AI 请求参数'
  });
  assert.deepEqual(await handlers.get('ai:task:refresh-data')(event, []), {
    success: false,
    error: '无效的 AI 请求参数'
  });
  assert.deepEqual(await handlers.get('ai:task:refresh-data')(event, { batchConcurrency: 4 }), {
    success: false,
    error: '无效的 AI 请求参数'
  });
  assert.deepEqual(await handlers.get('ai:task:start')(event, { collectBrowser: 'chrome' }), {
    success: false,
    error: '无效的 AI 请求参数'
  });
  assert.deepEqual(
    await handlers.get('ai:task:refresh-data')(event, { collectBrowser: 'chrome' }),
    {
      success: false,
      error: '无效的 AI 请求参数'
    }
  );
  assert.deepEqual(await handlers.get('ai:task:start')(event, { url: 123 }), {
    success: false,
    error: '无效的 AI 请求参数'
  });
  assert.deepEqual(
    await handlers.get('ai:task:start')(event, {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      targetCount: 'many'
    }),
    {
      success: false,
      error: '无效的 AI 请求参数'
    }
  );
  assert.deepEqual(
    await handlers.get('ai:task:start')(event, {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      listFilters: 'bad'
    }),
    {
      success: false,
      error: '无效的 AI 请求参数'
    }
  );
  assert.deepEqual(
    await handlers.get('ai:task:start')(event, {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      excludeHotelTypes: [123]
    }),
    {
      success: false,
      error: '无效的 AI 请求参数'
    }
  );
  assert.deepEqual(
    await handlers.get('ai:task:start')(event, {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      collectBrowser: '360',
      batchConcurrency: 3
    }),
    { success: true }
  );
  assert.deepEqual(
    await handlers.get('ai:task:refresh-data')(event, {
      collectBrowser: '360',
      batchConcurrency: 3
    }),
    { success: true }
  );

  assert.deepEqual(received, [
    { channel: 'save', config: {} },
    { channel: 'test', config: {} },
    {
      channel: 'start',
      payload: {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
        collectBrowser: '360',
        batchConcurrency: 3
      }
    },
    {
      channel: 'refresh',
      payload: {
        collectBrowser: '360',
        batchConcurrency: 3
      }
    }
  ]);
});

test('AI IPC validates Ctrip list URL parser and builder inputs', async () => {
  const handlers = new Map();
  registerAiHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    },
    services: {
      aiService: {
        getProviderConfig() {},
        getProviderPresets() {},
        saveProviderConfig() {},
        testConnection() {},
        sendChat() {},
        startTask() {},
        refreshHotelData() {},
        cancelTask() {},
        getTaskStatus() {}
      }
    }
  });
  const event = createTrustedIpcEvent();

  assert.deepEqual(await handlers.get('ai:ctrip-list-url:parse')(event, 42), {
    success: false,
    error: '无效的携程列表页链接'
  });
  assert.deepEqual(
    await handlers.get('ai:ctrip-list-url:parse')(event, 'http://hotels.ctrip.com/'),
    {
      success: false,
      error: '无效的携程列表页链接'
    }
  );
  assert.deepEqual(
    await handlers.get('ai:ctrip-list-url:build')(event, {
      baseUrl: 'file:///tmp/list.html',
      settings: {}
    }),
    {
      success: false,
      error: '无效的携程列表页链接'
    }
  );
  assert.deepEqual(
    await handlers.get('ai:ctrip-list-url:build')(event, {
      baseUrl: 'https://hotels.ctrip.com/hotels/list',
      settings: 'bad'
    }),
    {
      success: false,
      error: '无效的携程列表页参数'
    }
  );
});

test('scraper runner resolves the embedded scraper in the app repository', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'embedded-scraper-'));
  const currentDir = path.join(tempRoot, 'project', 'src', 'main', 'ai');
  const embeddedRunner = path.join(tempRoot, 'project', 'scraper', 'src', 'task-runner.js');

  fs.mkdirSync(path.dirname(embeddedRunner), { recursive: true });
  fs.writeFileSync(embeddedRunner, 'module.exports = {};', 'utf-8');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(
    resolveScraperPath({
      currentDir,
      existsSync: fs.existsSync,
      isBundledWithScraper: () => false
    }),
    path.join(tempRoot, 'project', 'scraper')
  );
});

test('scraper runner perfLogDir resolves to program root logs/perf', () => {
  const perfLogDir = resolveRootPerfLogDir();

  assert.equal(perfLogDir, path.resolve('logs', 'perf'));
  assert.ok(!perfLogDir.includes('scraper-data'));
  assert.ok(perfLogDir.endsWith(path.join('logs', 'perf')));
});

test('scraper runner maps batch concurrency to scraper arguments', () => {
  const args = buildScraperArgs(
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      templateId: '100',
      collectBrowser: '360',
      batchConcurrency: 3
    },
    path.join(os.tmpdir(), 'hotel-scraper-workdir')
  );

  assert.equal(args.browser, '360');
  assert.equal(args['batch-concurrency'], 3);
});

test('scraper runner perfLogDir is independent of workDir', () => {
  const perfLogDir = resolveRootPerfLogDir();
  const fakeWorkDir = path.join(os.tmpdir(), 'some-work-dir', 'scraper-data');

  assert.notEqual(perfLogDir, path.join(fakeWorkDir, 'logs', 'perf'));
  assert.ok(!perfLogDir.includes('scraper-data'));
});

test('AI scraper write rollback restores compare-app store snapshot', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-write-rollback-'));
  const previousDataDir = process.env.HOTEL_COMPARE_APP_DATA_DIR;
  const previousSharedDir = process.env.HOTEL_COMPARE_SHARED_DIR;
  const storePath = path.join(tempDataDir, 'hotel-data.json');
  const originalStore = {
    hotels: [{ id: 'existing-hotel', name: '原有酒店' }],
    templates: [{ id: 'tpl-1', name: '武汉模板' }],
    settings: { theme: 'totoro-blue' }
  };
  const events = [];

  process.env.HOTEL_COMPARE_APP_DATA_DIR = tempDataDir;
  process.env.HOTEL_COMPARE_SHARED_DIR = path.resolve(__dirname, '..', 'shared', 'compare-app');
  fs.writeFileSync(storePath, JSON.stringify(originalStore, null, 2), 'utf8');

  t.after(() => {
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
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  const rollbackState = {};
  await createWriteRollbackSnapshot(resolveScraperPath(), rollbackState);
  fs.writeFileSync(
    storePath,
    JSON.stringify(
      {
        hotels: [...originalStore.hotels, { id: 'cancelled-task-hotel', name: '本次任务写入酒店' }],
        templates: [],
        settings: {}
      },
      null,
      2
    ),
    'utf8'
  );

  const result = restoreWriteRollbackSnapshot(rollbackState, {
    onEvent(event) {
      events.push(event);
    }
  });

  assert.equal(result.restored, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(storePath, 'utf8')), originalStore);
  assert.ok(events.some((event) => event.type === 'write:rollback-start'));
  assert.ok(events.some((event) => event.type === 'write:rollback-done'));
});

test('AI scraper write rollback removes a store file created after the snapshot', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-write-rollback-missing-'));
  const previousDataDir = process.env.HOTEL_COMPARE_APP_DATA_DIR;
  const previousSharedDir = process.env.HOTEL_COMPARE_SHARED_DIR;
  const storePath = path.join(tempDataDir, 'hotel-data.json');

  process.env.HOTEL_COMPARE_APP_DATA_DIR = tempDataDir;
  process.env.HOTEL_COMPARE_SHARED_DIR = path.resolve(__dirname, '..', 'shared', 'compare-app');

  t.after(() => {
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
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  const rollbackState = {};
  await createWriteRollbackSnapshot(resolveScraperPath(), rollbackState);
  fs.writeFileSync(storePath, JSON.stringify({ hotels: [{ id: 'new' }] }, null, 2), 'utf8');

  const result = restoreWriteRollbackSnapshot(rollbackState);

  assert.equal(result.restored, true);
  assert.equal(fs.existsSync(storePath), false);
});

test('AI scraper cancellation detector accepts abort signals and cancellation errors', () => {
  const controller = new AbortController();
  assert.equal(isTaskCancelled(new Error('普通失败'), controller.signal), false);
  assert.equal(isTaskCancelled(new Error('connection aborted unexpectedly'), null), false);

  controller.abort();
  assert.equal(isTaskCancelled(new Error('普通失败'), controller.signal), true);
  assert.equal(isTaskCancelled(new Error('任务已取消'), null), true);
  assert.equal(
    isTaskCancelled(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      null
    ),
    true
  );
});

test('direct AI task start runs the hotel task runner without provider config', async () => {
  const calls = [];
  const events = [];
  const service = createAiService({
    dataService: {
      getDataFolderPath() {
        return 'E:/实验/1/宾馆比较助手';
      }
    },
    windowService: {
      getMainWindow() {
        return {
          isDestroyed: () => false,
          webContents: {
            send(channel, payload) {
              events.push({ channel, payload });
            }
          }
        };
      }
    },
    hotelTaskRunner: async (input, context) => {
      calls.push({ input, context });
      context.onEvent({ type: 'scrape:start', message: '正在采集携程酒店页面' });
      return {
        success: true,
        hotelName: '测试酒店',
        eligibleCount: 1,
        eligibleRoomTypes: [{ dailyPrice: 300, totalPrice: 300 }],
        writeResult: { operation: 'inserted' }
      };
    }
  });

  const result = await service.startTask({
    url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
    templateId: '100',
    templateName: '武汉',
    desiredHotelCount: 5,
    excludeHotelTypes: ['民宿'],
    amapKey: 'custom-amap-key',
    collectBrowser: '360',
    batchConcurrency: 3,
    listUrlFilters: {
      priceMin: 50,
      priceMax: 200,
      starLevels: [3, 4],
      sortMode: 'review_high',
      freeCancel: true,
      reviewCountMin: 500,
      ctripScoreMin: 4.5
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.templateName, '武汉');
  assert.equal(calls[0].input.desiredHotelCount, 5);
  assert.deepEqual(calls[0].input.excludeHotelTypes, ['民宿']);
  assert.equal(calls[0].input.amapKey, 'custom-amap-key');
  assert.equal(calls[0].input.collectBrowser, '360');
  assert.equal(calls[0].input.batchConcurrency, 3);
  assert.deepEqual(calls[0].input.listUrlFilters, {
    priceMin: 50,
    priceMax: 200,
    starLevels: [3, 4],
    sortMode: 'review_high',
    freeCancel: true,
    reviewCountMin: 500,
    ctripScoreMin: 4.5
  });
  assert.equal(calls[0].context.dataFolderPath, 'E:/实验/1/宾馆比较助手');
  assert.equal(result.collectResult.hotelName, '测试酒店');
  assert.equal(result.collectResult.totalPrice, 300);
  assert.equal(result.toolResults[0].name, 'collect_and_write_ctrip_hotel');
  assert.ok(
    events.some((event) => event.channel === 'ai:task:event' && event.payload.type === 'task:done')
  );
});

test('direct AI refresh passes batch concurrency to scraper runner', async (t) => {
  const aiServicePath = require.resolve('../src/main/services/ai-service');
  const lazyLoader = require('../src/main/ai/scraper-lazy-loader');
  const originalLoadScraperRunner = lazyLoader.loadScraperRunner;
  const originalAiServiceCache = require.cache[aiServicePath];
  const calls = [];
  const events = [];

  lazyLoader.loadScraperRunner = async () => ({
    refreshExistingCtripHotels: async (input, context) => {
      calls.push({ input, context });
      context.onEvent({ type: 'refresh:summary', message: '更新完成' });
      return {
        success: true,
        totalHotelCount: 2,
        updatedHotelCount: 2,
        updatedRoomTypeCount: 4,
        deletedRoomTypeCount: 0,
        skippedHotelCount: 0,
        items: [],
        writeResult: { batchMode: true, appliedCount: 2 }
      };
    }
  });
  delete require.cache[aiServicePath];

  t.after(() => {
    lazyLoader.loadScraperRunner = originalLoadScraperRunner;
    delete require.cache[aiServicePath];
    if (originalAiServiceCache) {
      require.cache[aiServicePath] = originalAiServiceCache;
    }
  });

  const {
    createAiService: createAiServiceWithMockRunner
  } = require('../src/main/services/ai-service');
  const service = createAiServiceWithMockRunner({
    dataService: {
      getDataFolderPath() {
        return 'E:/实验/1/宾馆比较助手';
      }
    },
    windowService: {
      getMainWindow() {
        return {
          isDestroyed: () => false,
          webContents: {
            send(channel, payload) {
              events.push({ channel, payload });
            }
          }
        };
      }
    }
  });

  const result = await service.refreshHotelData({
    amapKey: 'custom-amap-key',
    collectBrowser: '360',
    batchConcurrency: 3
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.amapKey, 'custom-amap-key');
  assert.equal(calls[0].input.collectBrowser, '360');
  assert.equal(calls[0].input.batchConcurrency, 3);
  assert.equal(calls[0].context.dataFolderPath, 'E:/实验/1/宾馆比较助手');
  assert.equal(result.collectResult.updatedHotelCount, 2);
  assert.ok(
    events.some(
      (event) => event.channel === 'ai:task:event' && event.payload.type === 'refresh:summary'
    )
  );
});

test('refresh hotel batch runner honors bounded concurrency and writes once after collection', async () => {
  const events = [];
  const writtenBatches = [];
  let activeRefreshes = 0;
  let maxActiveRefreshes = 0;

  const result = await runRefreshHotelBatch({
    hotelUrls: [
      'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      'https://hotels.ctrip.com/hotels/detail/?hotelId=2',
      'https://hotels.ctrip.com/hotels/detail/?hotelId=3'
    ],
    requestedConcurrency: 2,
    signal: null,
    emit(type, message, details) {
      events.push({ type, message, details });
    },
    processHotel: async ({ url, index }) => {
      activeRefreshes += 1;
      maxActiveRefreshes = Math.max(maxActiveRefreshes, activeRefreshes);
      await new Promise((resolve) => setTimeout(resolve, index === 1 ? 30 : 5));
      activeRefreshes -= 1;

      if (index === 3) {
        return {
          hotelName: '酒店三',
          url,
          status: 'skipped',
          updatedHotels: [],
          updatedRoomTypeCount: 0,
          deletedRoomTypeCount: 0,
          skipReason: '没有有效房型',
          error: ''
        };
      }

      return {
        hotelName: `酒店${index}`,
        url,
        status: 'updated',
        updatedHotels: [
          { name: `酒店${index}`, room_type: '大床房' },
          { name: `酒店${index}`, room_type: '双床房' }
        ],
        updatedRoomTypeCount: 2,
        deletedRoomTypeCount: index === 1 ? 1 : 0,
        skipReason: '',
        error: ''
      };
    },
    writeHotels: async (hotels) => {
      writtenBatches.push(hotels);
      return { batchMode: true, appliedCount: hotels.length };
    }
  });

  assert.equal(maxActiveRefreshes, 2);
  assert.equal(writtenBatches.length, 1);
  assert.deepEqual(
    writtenBatches[0].map((hotel) => `${hotel.name}:${hotel.room_type}`),
    ['酒店1:大床房', '酒店1:双床房', '酒店2:大床房', '酒店2:双床房']
  );
  assert.equal(result.requestedConcurrency, 2);
  assert.equal(result.effectiveConcurrency, 2);
  assert.equal(result.updatedHotelCount, 2);
  assert.equal(result.updatedRoomTypeCount, 4);
  assert.equal(result.deletedRoomTypeCount, 1);
  assert.equal(result.skippedHotelCount, 1);
  assert.equal(result.items.length, 3);
  assert.equal(events.filter((event) => event.type === 'refresh:item-start').length, 3);
  assert.equal(events.filter((event) => event.type === 'refresh:item-done').length, 2);
  assert.equal(events.filter((event) => event.type === 'refresh:item-skipped').length, 1);
  assert.equal(events.filter((event) => event.type === 'refresh:write').length, 1);
  assert.equal(events.find((event) => event.type === 'refresh:write').details.scope, 'final');
});

test('refresh hotel batch runner stays serial when requested concurrency is one', async () => {
  let activeRefreshes = 0;
  let maxActiveRefreshes = 0;

  const result = await runRefreshHotelBatch({
    hotelUrls: ['url-1', 'url-2'],
    requestedConcurrency: 1,
    emit() {},
    processHotel: async ({ url, index }) => {
      activeRefreshes += 1;
      maxActiveRefreshes = Math.max(maxActiveRefreshes, activeRefreshes);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRefreshes -= 1;
      return {
        hotelName: `酒店${index}`,
        url,
        status: 'updated',
        updatedHotels: [{ name: `酒店${index}`, room_type: '大床房' }],
        updatedRoomTypeCount: 1,
        deletedRoomTypeCount: 0,
        skipReason: '',
        error: ''
      };
    },
    writeHotels: async () => ({ batchMode: true, appliedCount: 2 })
  });

  assert.equal(maxActiveRefreshes, 1);
  assert.equal(result.requestedConcurrency, 1);
  assert.equal(result.effectiveConcurrency, 1);
  assert.equal(result.updatedHotelCount, 2);
});

test('direct AI task reloads the data store after scraper writeback', async () => {
  const dataFolderPath = 'E:/实验/1/宾馆比较助手';
  const store = {
    get() {
      return {};
    },
    set() {}
  };
  const reinitializeCalls = [];
  const service = createAiService({
    dataService: {
      getStore() {
        return store;
      },
      getDataFolderPath() {
        return dataFolderPath;
      },
      reinitializeStore(folder) {
        reinitializeCalls.push(folder);
      }
    },
    windowService: {
      getMainWindow() {
        return {
          isDestroyed: () => false,
          webContents: {
            send() {}
          }
        };
      }
    },
    hotelTaskRunner: async () => ({
      success: true,
      hotelName: '测试酒店',
      eligibleCount: 1,
      eligibleRoomTypes: [{ dailyPrice: 300, totalPrice: 300 }],
      writeResult: { operation: 'inserted' }
    })
  });

  await service.startTask({
    url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
    templateId: '100'
  });

  assert.deepEqual(reinitializeCalls, [dataFolderPath]);
});

test('direct AI task cancellation emits cancel status instead of task error', async () => {
  const events = [];
  let capturedContext = null;
  const service = createAiService({
    dataService: {
      getDataFolderPath() {
        return 'E:/实验/1/宾馆比较助手';
      }
    },
    windowService: {
      getMainWindow() {
        return {
          isDestroyed: () => false,
          webContents: {
            send(channel, payload) {
              events.push({ channel, payload });
            }
          }
        };
      }
    },
    hotelTaskRunner: async (_input, context) => {
      capturedContext = context;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (context.signal.aborted) {
        throw new Error('任务已取消');
      }
      return {
        success: true,
        hotelName: '不应完成',
        eligibleCount: 1,
        writeResult: { operation: 'inserted' }
      };
    }
  });

  const taskPromise = service.startTask({
    url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
    templateName: '武汉'
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const cancelResult = service.cancelTask();
  assert.equal(cancelResult.success, true);
  assert.equal(capturedContext.signal.aborted, true);
  await assert.rejects(taskPromise, /任务已取消/);

  const status = service.getTaskStatus();
  assert.equal(status.status, 'cancelled');
  assert.equal(status.error, '任务已取消');
  assert.ok(events.some((event) => event.payload.type === 'task:cancel'));
  assert.equal(
    events.some((event) => event.payload.type === 'task:error'),
    false
  );
});

test('AI scraper retry detector asks for visible login when Ctrip price is locked or missing', () => {
  const locked = getVisibleLoginRetryNeed({
    success: true,
    totalPrice: null,
    roomPrices: [],
    pageSnapshot: {
      room_candidates_count: 2,
      room_price_visible: false,
      selected_room_price_locked: true,
      sources: []
    }
  });

  assert.equal(locked.needed, true);
  assert.match(locked.reason, /登录看低价/);

  const missingPrice = getVisibleLoginRetryNeed({
    success: true,
    totalPrice: null,
    roomPrices: [],
    pageSnapshot: {
      room_candidates_count: 3,
      room_price_visible: false,
      sources: []
    }
  });

  assert.equal(missingPrice.needed, true);
  assert.match(missingPrice.reason, /未采集到有效价格/);

  const priced = getVisibleLoginRetryNeed({
    success: true,
    totalPrice: 885,
    roomPrices: [885],
    pageSnapshot: {
      room_candidates_count: 2,
      room_price_visible: true,
      sources: []
    }
  });

  assert.equal(priced.needed, false);
});
