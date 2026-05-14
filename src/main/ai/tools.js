const { loadScraperRunner } = require('./scraper-lazy-loader');
const { redactAiProviderConfig } = require('./provider-presets');

const AI_TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'list_templates',
      description: '读取宾馆比较助手中已有模板，供 AI 根据用户输入匹配模板 ID 或模板名。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_settings',
      description: '读取当前比较助手设置。不会返回 API Key。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'collect_and_write_ctrip_hotel',
      description: '采集携程酒店链接，按指定模板筛选房型并在安全门通过后自动写入宾馆比较数据。',
      parameters: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: '完整携程酒店详情页链接。'
          },
          templateId: {
            type: 'string',
            description: '比较助手模板 ID，可把数字 ID 写成字符串。templateId 和 templateName 至少提供一个。'
          },
          templateName: {
            type: 'string',
            description: '比较助手模板名称。templateId 和 templateName 至少提供一个。'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_task_status',
      description: '读取当前或最近一次 AI 采集任务状态。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_visible_edge_login',
      description: '打开可见 Edge 登录准备窗口，用于携程登录态失效或价格不可见时让用户手动登录。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '携程酒店链接，可为空。'
          }
        },
        additionalProperties: false
      }
    }
  }
]);

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === 'object') {
    return rawArguments;
  }

  try {
    return JSON.parse(rawArguments);
  } catch (error) {
    throw new Error(`工具参数不是有效 JSON：${String(rawArguments).slice(0, 200)}`);
  }
}

function sanitizeSettings(settings = {}) {
  const sanitized = {
    ...settings
  };

  if (sanitized.ai_provider_config) {
    sanitized.ai_provider_config = redactAiProviderConfig(sanitized.ai_provider_config);
  }

  return sanitized;
}

async function executeAiTool(name, rawArguments, context) {
  const args = parseToolArguments(rawArguments);
  const { dataService, getTaskStatus, runTask } = context;
  const store = dataService.getStore();

  switch (name) {
    case 'list_templates':
      return {
        templates: store.get('templates') || []
      };
    case 'get_settings':
      return {
        settings: sanitizeSettings(store.get('settings') || {})
      };
    case 'collect_and_write_ctrip_hotel':
      return runTask(async ({ signal, onTaskEvent }) => {
        const { collectAndWriteCtripHotel } = await loadScraperRunner();
        return collectAndWriteCtripHotel(args, {
          dataFolderPath: dataService.getDataFolderPath(),
          signal,
          onEvent: onTaskEvent
        });
      });
    case 'get_task_status':
      return getTaskStatus();
    case 'open_visible_edge_login':
      return loadScraperRunner().then(({ openVisibleEdgeLogin }) => openVisibleEdgeLogin(args, {
        dataFolderPath: dataService.getDataFolderPath()
      }));
    default:
      throw new Error(`未知 AI 工具：${name}`);
  }
}

module.exports = {
  AI_TOOL_DEFINITIONS,
  executeAiTool,
  parseToolArguments,
  sanitizeSettings
};
