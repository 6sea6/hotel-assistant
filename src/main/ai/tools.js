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
      description:
        '采集携程酒店详情页或酒店列表页链接，支持多个 URL 和混合粘贴文本；列表页先前筛，再逐个进入详情页并在安全门通过后自动写入宾馆比较数据。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '完整携程酒店详情页或列表页链接；也可以放包含多个携程 URL 的粘贴文本。'
          },
          urls: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: '可选，多个携程酒店详情页或列表页 URL。'
          },
          text: {
            type: 'string',
            description: '可选，混合粘贴文本；工具会提取其中的携程酒店 URL。'
          },
          templateId: {
            type: 'string',
            description:
              '比较助手模板 ID，可把数字 ID 写成字符串。templateId 和 templateName 至少提供一个。'
          },
          templateName: {
            type: 'string',
            description: '比较助手模板名称。templateId 和 templateName 至少提供一个。'
          },
          listFilters: {
            type: 'object',
            description:
              '本地列表页前筛条件。详情页输入会忽略这些条件；这些条件不会写入携程 listFilters。',
            properties: {
              excludeAccommodationKeywords: {
                type: 'array',
                items: { type: 'string' },
                description: '排除住宿类型关键词，例如 民宿、公寓、青旅。'
              },
              excludeHotelTypes: {
                type: 'array',
                items: { type: 'string' },
                description:
                  '排除住宿类型关键词，excludeAccommodationKeywords 的别名。默认前筛会排除民宿、客栈、青年旅舍、公寓。'
              },
              targetCount: {
                type: 'integer',
                description: '目标采集酒店数量。'
              },
              desiredHotelCount: {
                type: 'integer',
                description: '目标采集酒店数量，targetCount 的别名。'
              },
              maxPages: {
                type: 'integer',
                description: '列表页最多扫描页数，从当前列表页开始最多读取几页候选酒店。'
              },
              maxCandidatesPerPage: {
                type: 'integer',
                description: '每个列表页最多解析候选数，用于限制前筛成本。'
              }
            },
            additionalProperties: false
          },
          listUrlFilters: {
            type: 'object',
            description:
              '携程列表页 URL 原生前筛条件，会合并进 listFilters 并保留未知片段。详情页输入会忽略。',
            properties: {
              priceMin: {
                type: ['number', 'null'],
                description: '携程 URL 价格下限，例如 50；为空表示不限。'
              },
              priceMax: {
                type: ['number', 'string', 'null'],
                description: '携程 URL 价格上限，例如 200，或字符串 max 表示以上。'
              },
              starLevels: {
                type: 'array',
                items: {
                  type: 'integer',
                  enum: [2, 3, 4, 5]
                },
                description: '携程 URL 星级多选，2=两星及以下，3=三星，4=四星，5=五星。'
              },
              sortMode: {
                type: ['string', 'null'],
                enum: ['popularity', 'price_low', 'review_high', null],
                description:
                  '携程 URL 排序：popularity 默认/欢迎度，price_low 低价优先，review_high 好评优先。'
              },
              freeCancel: {
                type: 'boolean',
                description: '携程 URL 免费取消筛选。'
              },
              reviewCountMin: {
                type: ['integer', 'null'],
                enum: [100, 200, 500, null],
                description: '携程 URL 点评/点赞数量下限档位。'
              },
              ctripScoreMin: {
                type: ['number', 'null'],
                enum: [4.0, 4.5, 4.7, null],
                description: '携程 URL 评分筛选档位。'
              }
            },
            additionalProperties: false
          },
          desiredHotelCount: {
            type: 'integer',
            description: '可选，列表页目标采集酒店数量；详情页输入会忽略。'
          },
          excludeHotelTypes: {
            type: 'array',
            items: { type: 'string' },
            description: '可选，列表页排除住宿类型关键词；详情页输入会忽略。'
          },
          maxPages: {
            type: 'integer',
            description: '可选，列表页最多扫描页数；详情页输入会忽略。'
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
  if (sanitized.amapApiKey) {
    sanitized.amapApiKey = '[REDACTED]';
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
        const settings = store.get('settings') || {};
        const collectArgs = {
          ...args
        };
        if (!collectArgs.amapKey && settings.amapApiKey) {
          collectArgs.amapKey = settings.amapApiKey;
        }
        return collectAndWriteCtripHotel(collectArgs, {
          dataFolderPath: dataService.getDataFolderPath(),
          signal,
          onEvent: onTaskEvent
        });
      });
    case 'get_task_status':
      return getTaskStatus();
    case 'open_visible_edge_login':
      return loadScraperRunner().then(({ openVisibleEdgeLogin }) =>
        openVisibleEdgeLogin(args, {
          dataFolderPath: dataService.getDataFolderPath()
        })
      );
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
