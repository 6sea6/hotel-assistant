const AI_PROVIDER_PRESETS = Object.freeze({
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
    modelOptions: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.2',
      'gpt-5.2-pro',
      'gpt-5-mini',
      'gpt-5-nano'
    ]
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    modelOptions: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat']
  },
  qwen: {
    id: 'qwen',
    name: '通义千问/阿里百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.6-max-preview',
    modelOptions: [
      'qwen3.6-max-preview',
      'qwen3-max',
      'qwen3-max-2026-01-23',
      'qwen3.6-plus',
      'qwen3.6-flash',
      'qwen-plus-latest',
      'qwen-turbo-latest'
    ]
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.1',
    modelOptions: ['glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5-air']
  },
  mimo: {
    id: 'mimo',
    name: 'MiMo TokenPlan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    protocol: 'anthropic',
    model: 'mimo-v2.5-pro',
    modelOptions: [
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'mimo-v2.5-tts-voiceclone',
      'mimo-v2.5-tts-voicedesign',
      'mimo-v2.5-tts',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'mimo-v2-tts'
    ]
  }
});

const DEFAULT_AI_PROVIDER_ID = 'deepseek';
const DEFAULT_AI_TEMPERATURE = 0.2;

function normalizeProviderId(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase();
  return AI_PROVIDER_PRESETS[normalized] ? normalized : DEFAULT_AI_PROVIDER_ID;
}

function getDefaultAiProviderConfig(provider = DEFAULT_AI_PROVIDER_ID) {
  const providerId = normalizeProviderId(provider);
  const preset = AI_PROVIDER_PRESETS[providerId];
  return {
    provider: providerId,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol || 'openai',
    model: preset.model,
    modelOptions: preset.modelOptions.slice(),
    apiKey: '',
    temperature: DEFAULT_AI_TEMPERATURE,
    enabled: false
  };
}

function normalizeBaseUrl(baseUrl, fallbackBaseUrl) {
  const normalized = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  return normalized || fallbackBaseUrl;
}

function normalizeProviderBaseUrl(provider, baseUrl, fallbackBaseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, fallbackBaseUrl);
  if (provider === 'mimo' && /^https:\/\/api\.xiaomimimo\.com\/v1$/i.test(normalizedBaseUrl)) {
    return fallbackBaseUrl;
  }
  if (provider === 'mimo') {
    const regionMatch = normalizedBaseUrl.match(
      /^https:\/\/(token-plan-(?:cn|sgp|ams)\.xiaomimimo\.com)\/v1$/i
    );
    if (regionMatch) {
      return `https://${regionMatch[1]}/anthropic`;
    }
  }

  return normalizedBaseUrl;
}

function normalizeProviderModel(provider, model, fallbackModel) {
  const normalizedModel = String(model || '').trim() || fallbackModel;
  if (provider !== 'mimo') {
    return normalizedModel;
  }

  return normalizedModel.replace(/^xiaomi\//i, '').toLowerCase();
}

function normalizeAiProviderConfig(config = {}, previousConfig = {}) {
  const provider = normalizeProviderId(config.provider || previousConfig.provider);
  const preset = AI_PROVIDER_PRESETS[provider];
  const apiKey = Object.prototype.hasOwnProperty.call(config, 'apiKey')
    ? String(config.apiKey || '').trim()
    : String(previousConfig.apiKey || '').trim();

  return {
    provider,
    baseUrl: normalizeProviderBaseUrl(
      provider,
      config.baseUrl ?? previousConfig.baseUrl,
      preset.baseUrl
    ),
    protocol: preset.protocol || 'openai',
    model: normalizeProviderModel(provider, config.model || previousConfig.model, preset.model),
    modelOptions: preset.modelOptions.slice(),
    apiKey,
    temperature: DEFAULT_AI_TEMPERATURE,
    enabled: Boolean(config.enabled ?? previousConfig.enabled)
  };
}

function redactAiProviderConfig(config = {}) {
  const normalized = normalizeAiProviderConfig(config);
  return {
    ...normalized,
    apiKey: '',
    hasApiKey: Boolean(String(config.apiKey || '').trim())
  };
}

function getAiProviderPresets() {
  return Object.values(AI_PROVIDER_PRESETS).map((preset) => ({
    ...preset,
    modelOptions: preset.modelOptions.slice()
  }));
}

module.exports = {
  AI_PROVIDER_PRESETS,
  DEFAULT_AI_PROVIDER_ID,
  DEFAULT_AI_TEMPERATURE,
  getAiProviderPresets,
  getDefaultAiProviderConfig,
  normalizeAiProviderConfig,
  normalizeProviderId,
  redactAiProviderConfig
};
