/**
 * External LLM API Client
 * Supports Ollama (Local & Ngrok), OpenAI, Gemini, Claude, Grok, Groq, Qwen, DeepSeek, Zhipu (ZAI), and Hugging Face.
 */

export interface ExternalGenerateOptions {
  modelId: string;
  provider: string;
  apiKey: string;
  ollamaUrl?: string;
  messages: Array<{ role: string; content: string; imageBase64?: string }>;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export async function generateExternalModel(options: ExternalGenerateOptions): Promise<string> {
  const { modelId, provider, apiKey, ollamaUrl, messages, prompt, temperature = 0.3, maxTokens = 2048, onToken, signal } = options;

  const cleanKey = apiKey ? apiKey.trim() : '';

  // Extract clean model name: e.g. "openai:gpt-4o" -> "gpt-4o", "gemini:gemini-2.5-flash" -> "gemini-2.5-flash", "ollama:llama3.2" -> "llama3.2"
  let rawModelName = modelId;
  if (rawModelName.includes(':')) {
    rawModelName = rawModelName.split(':').slice(1).join(':');
  } else if (rawModelName.startsWith(`${provider}/`)) {
    rawModelName = rawModelName.substring(provider.length + 1);
  }

  // Prepare standard messages
  const formattedMessages: Array<{ role: string; content: any; imageBase64?: string }> =
    messages && messages.length > 0
      ? messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
          content: m.content,
          imageBase64: m.imageBase64,
        }))
      : [{ role: 'user', content: prompt || '' }];

  // If external provider key is not locally set, route to unified /api/chat server proxy
  if (provider !== 'ollama' && !cleanKey) {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('makron_auth_token') : null;
      let storedKeys: Record<string, string> = {};
      if (typeof window !== 'undefined') {
        try {
          storedKeys = JSON.parse(localStorage.getItem('makron_api_keys') || '{}');
        } catch {}
      }
      const effectiveKey = cleanKey || storedKeys[provider] || undefined;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          modelId,
          provider,
          apiKey: effectiveKey,
          apiKeys: storedKeys,
          messages: formattedMessages,
          prompt,
          temperature,
          maxTokens,
        }),
        signal,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.response) {
          if (onToken) onToken(data.response);
          return data.response;
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `API key for provider "${provider}" is not configured. Please enter your API key in the Model selector or account.`);
      }
    } catch (proxyErr: any) {
      throw new Error(proxyErr.message || `API key for provider "${provider}" is not configured.`);
    }
  }

  // 1. Ollama Server (Local or Ngrok Tunnel)
  if (provider === 'ollama') {
    const rawUrl = ollamaUrl?.trim() || 'http://localhost:11434';
    const baseUrl = rawUrl.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true', // Bypasses Ngrok free tier interstitial warning page
    };
    if (cleanKey) {
      headers['Authorization'] = `Bearer ${cleanKey}`;
    }

    const openAiMessages = formattedMessages.map((m) => {
      if (m.imageBase64) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: String(m.content) },
            { type: 'image_url', image_url: { url: m.imageBase64 } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: rawModelName || 'llama3.2',
        messages: openAiMessages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Ollama Server error (${res.status}): ${errBody || res.statusText}. Please verify that your Ollama server is running and accessible at ${baseUrl}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    if (onToken && text) onToken(text);
    return text;
  }

  // 2. Google Gemini
  if (provider === 'gemini') {
    const geminiModel = rawModelName.startsWith('gemini-') ? rawModelName : 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${cleanKey}`;

    const contents = formattedMessages.map((m) => {
      const parts: any[] = [];
      if (m.imageBase64) {
        const match = m.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      }
      parts.push({ text: String(m.content) });
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    if (onToken && text) {
      onToken(text);
    }
    return text;
  }

  // 3. Anthropic Claude
  if (provider === 'claude') {
    const claudeModel = rawModelName.includes('claude-') ? rawModelName : 'claude-3-5-sonnet-20241022';
    const systemMsg = formattedMessages.find((m) => m.role === 'system');
    const nonSystem = formattedMessages.filter((m) => m.role !== 'system');

    const claudeMessages = nonSystem.map((m) => {
      if (m.imageBase64) {
        const match = m.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          return {
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2],
                },
              },
              { type: 'text', text: String(m.content) },
            ],
          };
        }
      }
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content),
      };
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: claudeModel,
        system: systemMsg ? String(systemMsg.content) : undefined,
        messages: claudeMessages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    if (onToken && text) onToken(text);
    return text;
  }

  // 4. OpenAI-compatible providers: OpenAI, Groq, DeepSeek, Grok (xAI), Qwen (DashScope), ZAI, HuggingFace
  let endpoint = 'https://api.openai.com/v1/chat/completions';
  const modelParam = rawModelName;

  if (provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  } else if (provider === 'deepseek') {
    endpoint = 'https://api.deepseek.com/chat/completions';
  } else if (provider === 'grok') {
    endpoint = 'https://api.x.ai/v1/chat/completions';
  } else if (provider === 'qwen') {
    endpoint = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
  } else if (provider === 'zai') {
    endpoint = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  } else if (provider === 'huggingface') {
    endpoint = `https://api-inference.huggingface.co/models/${rawModelName}/v1/chat/completions`;
  }

  const openAiMessages = formattedMessages.map((m) => {
    if (m.imageBase64) {
      return {
        role: m.role,
        content: [
          { type: 'text', text: String(m.content) },
          { type: 'image_url', image_url: { url: m.imageBase64 } },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelParam,
      messages: openAiMessages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${provider.toUpperCase()} API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || '';
  if (onToken && text) onToken(text);
  return text;
}
