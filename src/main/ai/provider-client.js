const { normalizeAiProviderConfig } = require('./provider-presets');

function buildChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    throw new Error('AI 接口地址不能为空');
  }

  return `${normalizedBaseUrl}/chat/completions`;
}

function buildAnthropicMessagesUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    throw new Error('AI 接口地址不能为空');
  }

  return `${normalizedBaseUrl}/v1/messages`;
}

function isAnthropicProtocol(config) {
  return (
    config.protocol === 'anthropic' ||
    /\/anthropic$/i.test(String(config.baseUrl || '').replace(/\/+$/, ''))
  );
}

function convertToolsToAnthropic(tools = []) {
  return tools
    .map((tool) => (tool && tool.function ? tool.function : null))
    .filter(Boolean)
    .map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.parameters || {
        type: 'object',
        properties: {}
      }
    }));
}

function convertMessagesToAnthropic(messages = []) {
  const systemParts = [];
  const converted = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (message.role === 'system') {
      if (message.content) {
        systemParts.push(String(message.content));
      }
      continue;
    }

    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: String(message.content || '')
          }
        ]
      });
      continue;
    }

    if (message.role === 'assistant' && Array.isArray(message.anthropic_content)) {
      converted.push({
        role: 'assistant',
        content: message.anthropic_content
      });
      continue;
    }

    if (
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0
    ) {
      const content = [];
      if (message.content) {
        content.push({
          type: 'text',
          text: String(message.content)
        });
      }
      for (const toolCall of message.tool_calls) {
        let input = {};
        try {
          input =
            toolCall.function && toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {};
        } catch (error) {
          input = {};
        }
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function && toolCall.function.name,
          input
        });
      }
      converted.push({
        role: 'assistant',
        content
      });
      continue;
    }

    converted.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '')
    });
  }

  return {
    system: systemParts.join('\n\n'),
    messages: converted
  };
}

function buildChatCompletionRequest(config, messages, tools = [], options = {}) {
  const normalizedConfig = normalizeAiProviderConfig(config);
  if (!normalizedConfig.apiKey) {
    throw new Error('请先填写 AI API Key');
  }
  if (!normalizedConfig.model) {
    throw new Error('请先填写 AI 模型名称');
  }

  if (isAnthropicProtocol(normalizedConfig)) {
    const anthropicMessages = convertMessagesToAnthropic(messages);
    const body = {
      model: normalizedConfig.model,
      max_tokens: options.maxTokens || 4096,
      messages: anthropicMessages.messages
    };
    if (anthropicMessages.system) {
      body.system = anthropicMessages.system;
    }
    if (Number.isFinite(normalizedConfig.temperature)) {
      body.temperature = normalizedConfig.temperature;
    }
    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = convertToolsToAnthropic(tools);
    }

    return {
      url: buildAnthropicMessagesUrl(normalizedConfig.baseUrl),
      init: {
        method: 'POST',
        headers: {
          'x-api-key': normalizedConfig.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      },
      body
    };
  }

  const body = {
    model: normalizedConfig.model,
    messages,
    temperature: normalizedConfig.temperature
  };

  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = options.toolChoice || 'auto';
  }

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  return {
    url: buildChatCompletionsUrl(normalizedConfig.baseUrl),
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalizedConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    body
  };
}

function parseChatCompletionMessage(payload) {
  if (payload && Array.isArray(payload.content)) {
    const textParts = [];
    const toolCalls = [];
    for (const item of payload.content) {
      if (item && item.type === 'text' && item.text) {
        textParts.push(item.text);
      }
      if (item && item.type === 'tool_use') {
        toolCalls.push({
          id: item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: JSON.stringify(item.input || {})
          }
        });
      }
    }

    return {
      role: 'assistant',
      content: textParts.join('\n'),
      tool_calls: toolCalls,
      anthropic_content: payload.content
    };
  }

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice && choice.message ? choice.message : null;
  if (!message) {
    throw new Error('AI 响应格式不正确：缺少 choices[0].message');
  }

  return {
    role: message.role || 'assistant',
    content: message.content || '',
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : []
  };
}

function buildProviderErrorMessage(status, message, config) {
  if (config.provider === 'mimo') {
    if (status === 401) {
      return `MiMo TokenPlan 鉴权失败：${message || 'Invalid API Key'}。请确认填写的是 TokenPlan 可调用的 API Key，不是计划名称/ID，并确认该 key 未停用或过期。`;
    }
    if (status === 400) {
      return `MiMo TokenPlan 参数错误：${message || 'Param Incorrect'}。请确认 Base URL 使用 /anthropic 线路，模型名使用 mimo-v2.5 或 mimo-v2.5-pro 这类小写 API id。`;
    }
  }

  return message;
}

async function requestChatCompletion(config, messages, tools = [], options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('当前运行环境不支持 fetch，无法调用 AI 接口');
  }

  const normalizedConfig = normalizeAiProviderConfig(config);
  const { url, init } = buildChatCompletionRequest(normalizedConfig, messages, tools, options);
  const response = await fetch(url, {
    ...init,
    signal: options.signal
  });
  const responseText = await response.text();
  let payload = null;

  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error(`AI 接口返回了非 JSON 内容：${responseText.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message =
      payload && payload.error && payload.error.message
        ? payload.error.message
        : responseText.slice(0, 300);
    throw new Error(
      `AI 接口请求失败 (${response.status}): ${buildProviderErrorMessage(response.status, message, normalizedConfig)}`
    );
  }

  return parseChatCompletionMessage(payload);
}

module.exports = {
  buildAnthropicMessagesUrl,
  buildChatCompletionRequest,
  buildChatCompletionsUrl,
  buildProviderErrorMessage,
  convertMessagesToAnthropic,
  convertToolsToAnthropic,
  parseChatCompletionMessage,
  requestChatCompletion
};
