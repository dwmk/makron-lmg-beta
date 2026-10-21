import { GoogleGenAI } from '@google/genai';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbService, initDatabase } from './src/server/db';
import { AuthUser, CustomAgent, ReasoningLevel } from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

// Auth Middleware (pure session-token based, no JWT)
interface AuthRequest extends Request {
  user?: AuthUser;
}

const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const user = await dbService.getUserBySessionToken(token);

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      tier: user.tier,
      apiKeysConfigured: Object.keys(user.apiKeys || {}).filter((k) => Boolean(user.apiKeys[k])),
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
};

// -----------------------------------------------------------------------------
// AUTH ROUTES
// -----------------------------------------------------------------------------

app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { user: newUser, sessionToken } = await dbService.createUser(email, password, name);

    res.json({
      token: sessionToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        tier: newUser.tier,
        agentCount: 0,
        apiKeysConfigured: [],
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

app.post('/api/auth/signin', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await dbService.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const bcrypt = await import('bcryptjs');
    const isValid = await bcrypt.default.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const sessionToken = await dbService.createSession(user.id);
    const userAgents = await dbService.getAgentsByUserId(user.id);

    res.json({
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tier: user.tier,
        agentCount: userAgents.length,
        apiKeysConfigured: Object.keys(user.apiKeys || {}).filter((k) => Boolean(user.apiKeys[k])),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Signin failed' });
  }
});

app.post('/api/auth/signout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await dbService.invalidateSession(token);
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await dbService.getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userAgents = await dbService.getAgentsByUserId(user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        tier: user.tier,
        verifiedType: user.verifiedType,
        agentCount: userAgents.length,
        apiKeysConfigured: Object.keys(user.apiKeys || {}).filter((k) => Boolean(user.apiKeys[k])),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, username, email, avatar } = req.body;
    // Users are not allowed to set their own verification badge
    const updated = await dbService.updateUserProfile(req.user!.id, {
      name,
      username,
      email,
      avatar,
    });
    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        username: updated.username,
        avatar: updated.avatar,
        tier: updated.tier,
        verifiedType: updated.verifiedType,
        apiKeysConfigured: Object.keys(updated.apiKeys || {}).filter((k) => Boolean(updated.apiKeys[k])),
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update profile' });
  }
});

// Ping Ollama endpoint for connection health checks
app.get('/api/ping-ollama', async (req: Request, res: Response) => {
  try {
    const urlParam = req.query.url as string;
    const rawUrl = urlParam?.trim() || 'http://localhost:11434';
    const baseUrl = rawUrl.replace(/\/+$/, '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    let checkRes: any = null;
    try {
      checkRes = await fetch(`${baseUrl}/api/version`, {
        method: 'GET',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: controller.signal,
      });
    } catch {
      checkRes = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: controller.signal,
      }).catch(() => null);
    } finally {
      clearTimeout(timer);
    }

    if (checkRes && checkRes.ok) {
      const data = await checkRes.json().catch(() => ({}));
      return res.json({ success: true, version: data.version || 'connected' });
    } else {
      return res.status(502).json({ success: false, error: 'Ollama server did not return a 200 OK status' });
    }
  } catch (err: any) {
    return res.status(502).json({ success: false, error: err.message || 'Ollama ping failed' });
  }
});

app.get('/api/auth/keys', async (req: Request, res: Response) => {
  try {
    let userId = 'guest_user';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const user = await dbService.getUserBySessionToken(token);
      if (user) userId = user.id;
    }
    const user = (await dbService.getUserById(userId)) || (await dbService.ensureGuestUser(userId));
    const summary: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(user?.apiKeys || {})) {
      summary[k] = Boolean(v && v.trim());
    }
    // Also surface platform environment credentials so they appear active without redundant entry
    if (process.env.GEMINI_API_KEY) summary['gemini'] = true;
    if (process.env.OPENAI_API_KEY) summary['openai'] = true;
    if (process.env.ANTHROPIC_API_KEY) summary['claude'] = true;
    if (process.env.GROQ_API_KEY) summary['groq'] = true;
    if (process.env.DEEPSEEK_API_KEY) summary['deepseek'] = true;
    if (process.env.GROK_API_KEY) summary['grok'] = true;

    res.json({ keys: summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/keys', async (req: Request, res: Response) => {
  try {
    let userId = 'guest_user';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const user = await dbService.getUserBySessionToken(token);
      if (user) userId = user.id;
    }
    await dbService.ensureGuestUser(userId);
    const { apiKeys } = req.body;
    if (!apiKeys || typeof apiKeys !== 'object') {
      return res.status(400).json({ error: 'Invalid apiKeys payload' });
    }
    await dbService.updateUserApiKeys(userId, apiKeys);
    res.json({ success: true, message: 'API keys saved securely' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// USER AGENT MANAGEMENT ROUTES (AUTHENTICATED)
// -----------------------------------------------------------------------------

app.get('/api/agents', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const agents = await dbService.getAgentsByUserId(req.user!.id);
    res.json({ agents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const agent = await dbService.createAgent(req.user!.id, req.body);
    res.status(201).json({ agent });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create agent' });
  }
});

app.put('/api/agents/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const updated = await dbService.updateAgent(req.params.id, req.user!.id, req.body);
    res.json({ agent: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update agent' });
  }
});

app.delete('/api/agents/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const success = await dbService.deleteAgent(req.params.id, req.user!.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete agent' });
  }
});

// -----------------------------------------------------------------------------
// CONVERSATION PUBLISHING & DERIVATIVE AGENT SYNC
// -----------------------------------------------------------------------------

app.post('/api/conversations/publish', async (req: Request, res: Response) => {
  try {
    let userId = 'guest_user';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = await dbService.getUserBySessionToken(token);
      if (user) {
        userId = user.id;
      }
    }

    // Ensure owner row exists in DB
    await dbService.ensureGuestUser(userId);

    const {
      customName,
      displayName,
      description,
      avatar,
      modelId,
      gender,
      systemPrompt,
      effortLevel,
      skills,
      themeColor,
      themePreset,
      themeMode,
      allowsFileUploads,
      embedEnabled,
      initialMessages,
    } = req.body;

    if (!customName || typeof customName !== 'string') {
      return res.status(400).json({ error: 'Valid custom URL name is required' });
    }

    const cleanSlug = customName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-');

    // Check if an agent already exists with this customName
    let agent = await dbService.getAgentByCustomName(cleanSlug);
    if (agent) {
      // Update existing
      agent = await dbService.updateAgent(agent.id, agent.userId, {
        displayName: displayName || cleanSlug,
        description: description || '',
        avatar: avatar || 'ꫧ',
        modelId: modelId || 'gemini-2.5-flash',
        gender: gender || 'neutral',
        systemPrompt: systemPrompt || '',
        effortLevel: effortLevel || 'auto',
        skills: Array.isArray(skills) ? skills : ['code_execution', 'file_generation'],
        themeColor: themeColor || '#8b5cf6',
        themePreset: themePreset || 'winter_midnight',
        themeMode: themeMode || 'dark',
        allowsFileUploads: Boolean(allowsFileUploads),
        embedEnabled: embedEnabled !== false,
        initialMessages,
      });
    } else {
      // Create new
      agent = await dbService.createAgent(userId, {
        customName: cleanSlug,
        displayName: displayName || cleanSlug,
        description: description || '',
        avatar: avatar || 'ꫧ',
        modelId: modelId || 'gemini-2.5-flash',
        gender: gender || 'neutral',
        systemPrompt: systemPrompt || '',
        effortLevel: effortLevel || 'auto',
        skills: Array.isArray(skills) ? skills : ['code_execution', 'file_generation'],
        themeColor: themeColor || '#8b5cf6',
        themePreset: themePreset || 'winter_midnight',
        themeMode: themeMode || 'dark',
        allowsFileUploads: Boolean(allowsFileUploads),
        embedEnabled: embedEnabled !== false,
        initialMessages,
      });
    }

    res.json({ success: true, agent });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to publish conversation' });
  }
});

app.post('/api/conversations/unpublish', async (req: Request, res: Response) => {
  try {
    const { customName, agentId } = req.body;
    let target = null;
    if (customName) {
      target = await dbService.getAgentByCustomName(customName);
    } else if (agentId) {
      target = (await dbService.getAgentsByUserId('any')).find((a) => a.id === agentId);
    }

    if (target) {
      await dbService.deleteAgent(target.id, target.userId);
    }
    res.json({ success: true, message: 'Agent unpublished successfully' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to unpublish agent' });
  }
});

// -----------------------------------------------------------------------------
// PUBLIC VISITOR AGENT ROUTES (NO AUTH REQUIRED)
// -----------------------------------------------------------------------------

// Get published agent metadata for /agent/:customName and /embed/agent/:customName
app.get('/api/public/agents/:customName', async (req: Request, res: Response) => {
  try {
    const { customName } = req.params;
    const agent = await dbService.getAgentByCustomName(customName);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${customName}" not found.` });
    }

    res.json({
      agent: {
        id: agent.id,
        customName: agent.customName,
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        modelId: agent.modelId,
        gender: agent.gender,
        systemPrompt: agent.systemPrompt,
        effortLevel: agent.effortLevel,
        skills: agent.skills,
        themeColor: agent.themeColor,
        themePreset: agent.themePreset,
        themeMode: agent.themeMode,
        themeBg: agent.themeBg,
        themeCard: agent.themeCard,
        themeText: agent.themeText,
        allowsFileUploads: agent.allowsFileUploads,
        embedEnabled: agent.embedEnabled,
        owner: agent.owner,
        initialMessages: agent.initialMessages || [],
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public status endpoint: pings API key validity or Ollama server availability
app.get('/api/public/agents/:customName/status', async (req: Request, res: Response) => {
  try {
    const { customName } = req.params;
    const agent = await dbService.getAgentByCustomName(customName);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${customName}" not found.` });
    }

    const targetModel = agent.modelId || 'gemini-2.5-flash';
    const lowerModel = targetModel.toLowerCase();

    // 1. Browser-based local models (handled in browser)
    const isBrowserModel =
      lowerModel.includes('onnx') ||
      lowerModel.includes('smollm') ||
      lowerModel.includes('xenova') ||
      lowerModel.startsWith('local') ||
      (lowerModel.includes('qwen') && (lowerModel.includes('0.5b') || lowerModel.includes('1.5b') || lowerModel.includes('instruct-onnx')));

    if (isBrowserModel) {
      return res.json({
        type: 'browser',
        modelId: targetModel,
      });
    }

    // 2. Load owner's configured credentials with guest and platform fallback
    const owner = (await dbService.getUserById(agent.userId)) || (await dbService.getUserById('guest_user'));
    const ownerApiKeys: Record<string, string> = {
      ...(owner?.apiKeys || {}),
      ...(process.env.GEMINI_API_KEY ? { gemini: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.OPENAI_API_KEY ? { openai: process.env.OPENAI_API_KEY } : {}),
      ...(process.env.ANTHROPIC_API_KEY ? { claude: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.GROQ_API_KEY ? { groq: process.env.GROQ_API_KEY } : {}),
      ...(process.env.DEEPSEEK_API_KEY ? { deepseek: process.env.DEEPSEEK_API_KEY } : {}),
      ...(process.env.GROK_API_KEY ? { grok: process.env.GROK_API_KEY } : {}),
    };

    const timeoutMs = 3500;

    // Helper: fetch with timeout
    const pingEndpoint = async (url: string, options: RequestInit = {}): Promise<boolean> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
      } catch {
        clearTimeout(timer);
        return false;
      }
    };

    // 3. Ollama model -> ping Ollama server
    if (lowerModel.startsWith('ollama') || lowerModel.includes('ollama:')) {
      const rawOllamaModel = targetModel.includes(':') ? targetModel.split(':')[1] : targetModel.replace('ollama/', '');
      const ollamaUrl = (ownerApiKeys.ollama_url || 'http://localhost:11434').replace(/\/+$/, '');

      let isUp = await pingEndpoint(`${ollamaUrl}/api/version`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      if (!isUp) {
        isUp = await pingEndpoint(`${ollamaUrl}/api/tags`, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
      }

      return res.json({
        type: 'ollama',
        active: isUp,
        status: isUp ? 'Active' : 'Offline',
        modelId: rawOllamaModel,
      });
    }

    // 4. API Key dependent models -> ping their respective API endpoints
    let isActive = false;

    if (lowerModel.includes('claude')) {
      const key = ownerApiKeys.claude;
      if (key) {
        isActive = await pingEndpoint('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
      }
    } else if (lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3') || lowerModel.includes('openai')) {
      const key = ownerApiKeys.openai;
      if (key) {
        isActive = await pingEndpoint('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
      }
    } else if (lowerModel.includes('groq') || (lowerModel.includes('llama') && !lowerModel.includes('ollama'))) {
      const key = ownerApiKeys.groq;
      if (key) {
        isActive = await pingEndpoint('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
      }
    } else if (lowerModel.includes('deepseek')) {
      const key = ownerApiKeys.deepseek;
      if (key) {
        isActive = await pingEndpoint('https://api.deepseek.com/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
      }
    } else if (lowerModel.includes('grok')) {
      const key = ownerApiKeys.grok;
      if (key) {
        isActive = await pingEndpoint('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
      }
    } else if (lowerModel.includes('zai') || lowerModel.includes('glm')) {
      const key = ownerApiKeys.zai;
      if (key) {
        isActive = await pingEndpoint('https://open.bigmodel.cn/api/paas/v4/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
      }
    } else if (lowerModel.includes('qwen')) {
      const key = ownerApiKeys.qwen;
      if (key) {
        isActive = await pingEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
      }
    } else {
      // Default / Gemini
      const key = ownerApiKeys.gemini || process.env.GEMINI_API_KEY;
      if (key) {
        isActive = await pingEndpoint(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${key}`);
      }
    }

    return res.json({
      type: 'api',
      active: isActive,
      status: isActive ? 'Active' : 'Offline',
      error: isActive ? undefined : 'API key invalid, missing or server unreachable',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public Chat endpoint for published agents
app.post('/api/public/agents/:customName/chat', async (req: Request, res: Response) => {
  try {
    const { customName } = req.params;
    const { message, history, attachments } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const agent = await dbService.getAgentByCustomName(customName);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${customName}" not found.` });
    }

    // Load owner's secure credentials from db with guest and platform fallback
    const owner = (await dbService.getUserById(agent.userId)) || (await dbService.getUserById('guest_user'));
    const ownerApiKeys: Record<string, string> = {
      ...(owner?.apiKeys || {}),
      ...(process.env.GEMINI_API_KEY ? { gemini: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.OPENAI_API_KEY ? { openai: process.env.OPENAI_API_KEY } : {}),
      ...(process.env.ANTHROPIC_API_KEY ? { claude: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.GROQ_API_KEY ? { groq: process.env.GROQ_API_KEY } : {}),
      ...(process.env.DEEPSEEK_API_KEY ? { deepseek: process.env.DEEPSEEK_API_KEY } : {}),
      ...(process.env.GROK_API_KEY ? { grok: process.env.GROK_API_KEY } : {}),
    };

    let responseText = '';

    const effortInstruction =
      agent.effortLevel === 'low'
        ? 'Provide direct, concise, immediate answers without preamble.'
        : agent.effortLevel === 'high' || agent.effortLevel === 'max'
        ? 'Provide comprehensive, thoroughly analyzed and structured multi-step solutions with detailed code or operational blueprints where appropriate.'
        : 'Provide balanced, well-reasoned, actionable assistance.';

    const systemInstruction = `You are "${agent.displayName}", an AI assistant.\n${agent.description ? `Description: ${agent.description}\n` : ''}${agent.systemPrompt ? `Context & Directives:\n${agent.systemPrompt}\n` : ''}\nEffort & Reasoning Policy: ${effortInstruction}\nActive Capabilities: ${agent.skills.join(', ')}`;

    const priorTurns = Array.isArray(history)
      ? history.slice(-12).map((h: { role: string; content: string }) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          text: h.content,
        }))
      : [];

    let attachmentsText = '';
    if (agent.allowsFileUploads && Array.isArray(attachments) && attachments.length > 0) {
      attachmentsText = '\n\nAttached User Documents:\n' + attachments.map((a: any) => `[File: ${a.name}]\n${a.content || a.extractedText || ''}`).join('\n\n');
    }

    const targetModel = agent.modelId || 'gemini-2.5-flash';
    const lowerModel = targetModel.toLowerCase();

    // 0. Browser-based local models (run client-side via Transformers.js in the browser)
    const isBrowserModel =
      lowerModel.includes('onnx') ||
      lowerModel.includes('smollm') ||
      lowerModel.includes('xenova') ||
      lowerModel.startsWith('local') ||
      (lowerModel.includes('qwen') && (lowerModel.includes('0.5b') || lowerModel.includes('1.5b') || lowerModel.includes('instruct-onnx')));

    if (isBrowserModel) {
      return res.json({
        response: `This assistant is running the client-side language model (${targetModel}) directly inside your browser.`,
        isBrowserModel: true,
        timestamp: Date.now(),
      });
    }

    // 1. Anthropic Claude
    if (lowerModel.includes('claude') && ownerApiKeys.claude) {
      try {
        const claudeMessages = [
          ...priorTurns.map((t: any) => ({
            role: t.role === 'model' ? 'assistant' : 'user',
            content: t.text,
          })),
          { role: 'user', content: message + attachmentsText },
        ];
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ownerApiKeys.claude,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: targetModel.includes('/') ? targetModel.split('/')[1] : targetModel,
            system: systemInstruction,
            messages: claudeMessages,
            max_tokens: 2048,
          }),
        });
        const cdata = await claudeRes.json();
        responseText = cdata.content?.[0]?.text || 'No response from Claude.';
      } catch (err: any) {
        responseText = `[Claude Error: ${err.message}]`;
      }
    }
    // 2. OpenAI / Compatible (Groq, DeepSeek, Grok, Qwen, ZAI)
    else if (
      (lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3') || lowerModel.includes('openai')) &&
      ownerApiKeys.openai
    ) {
      try {
        const fetchRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerApiKeys.openai}`,
          },
          body: JSON.stringify({
            model: targetModel.includes('/') ? targetModel.split('/')[1] : targetModel,
            messages: [
              { role: 'system', content: systemInstruction },
              ...priorTurns.map((t: any) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
              { role: 'user', content: message + attachmentsText },
            ],
            temperature: 0.3,
          }),
        });
        const openAiData = await fetchRes.json();
        responseText = openAiData.choices?.[0]?.message?.content || 'No response generated.';
      } catch (openAiErr: any) {
        responseText = `[OpenAI error: ${openAiErr.message}]`;
      }
    }
    // 3. Groq
    else if (lowerModel.includes('groq') || (lowerModel.includes('llama') && ownerApiKeys.groq)) {
      try {
        const fetchRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerApiKeys.groq}`,
          },
          body: JSON.stringify({
            model: targetModel.includes('/') ? targetModel.split('/')[1] : targetModel || 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemInstruction },
              ...priorTurns.map((t: any) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
              { role: 'user', content: message + attachmentsText },
            ],
            temperature: 0.3,
          }),
        });
        const groqData = await fetchRes.json();
        responseText = groqData.choices?.[0]?.message?.content || 'No response from Groq.';
      } catch (err: any) {
        responseText = `[Groq error: ${err.message}]`;
      }
    }
    // 4. Ollama
    else if (lowerModel.startsWith('ollama') || lowerModel.includes('ollama:')) {
      const rawOllamaModel = targetModel.includes(':') ? targetModel.split(':')[1] : targetModel.replace('ollama/', '');
      const ollamaUrl = (ownerApiKeys.ollama_url || 'http://localhost:11434').replace(/\/+$/, '');
      try {
        const ollamaRes = await fetch(`${ollamaUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify({
            model: rawOllamaModel || 'llama3.2',
            messages: [
              { role: 'system', content: systemInstruction },
              ...priorTurns.map((t: any) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
              { role: 'user', content: message + attachmentsText },
            ],
            temperature: 0.3,
          }),
        });
        if (ollamaRes.ok) {
          const odata = await ollamaRes.json();
          responseText = odata.choices?.[0]?.message?.content || 'No response from Ollama.';
        } else {
          responseText = `[Ollama server responded with status ${ollamaRes.status} at ${ollamaUrl}]`;
        }
      } catch (ollamaErr: any) {
        responseText = `[Unable to connect to Ollama server at ${ollamaUrl}: ${ollamaErr.message}]`;
      }
    }
    // 5. Gemini
    else if (lowerModel.includes('gemini') || !lowerModel.includes('/')) {
      const geminiKey = ownerApiKeys.gemini || process.env.GEMINI_API_KEY;
      if (geminiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const contents: any[] = [];

          for (const turn of priorTurns) {
            contents.push({ role: turn.role, parts: [{ text: turn.text }] });
          }
          contents.push({ role: 'user', parts: [{ text: message + attachmentsText }] });

          const result = await ai.models.generateContent({
            model: targetModel.startsWith('gemini') ? targetModel : 'gemini-2.5-flash',
            contents,
            config: {
              systemInstruction,
              temperature: agent.effortLevel === 'low' ? 0.2 : 0.7,
            },
          });

          responseText = result.text || 'I have processed your request.';
        } catch (geminiErr: any) {
          console.warn('Gemini call failed:', geminiErr);
          responseText = `[Error generating response: ${geminiErr.message || String(geminiErr)}]`;
        }
      } else {
        responseText = `Hello! I am ${agent.displayName}. My owner has configured me with the following directives:\n\n${agent.systemPrompt || 'General assistance.'}\n\nTo enable live cloud inference for this agent, configure the appropriate API key in your account settings.`;
      }
    } else {
      responseText = `Hello! I am ${agent.displayName}. This agent is configured with model "${targetModel}".`;
    }

    res.json({
      response: responseText,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Chat generation failed' });
  }
});

// -----------------------------------------------------------------------------
// UNIFIED INFERENCE PROXY (/api/chat)
// Re-uses credentials between internal and external environments
// -----------------------------------------------------------------------------
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { modelId, provider, messages, prompt, systemPrompt, temperature = 0.3, maxTokens = 2048, apiKey } = req.body;

    let userKeys: Record<string, string> = {
      ...(req.body.apiKeys || {}),
      ...(process.env.GEMINI_API_KEY ? { gemini: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.OPENAI_API_KEY ? { openai: process.env.OPENAI_API_KEY } : {}),
      ...(process.env.ANTHROPIC_API_KEY ? { claude: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.GROQ_API_KEY ? { groq: process.env.GROQ_API_KEY } : {}),
      ...(process.env.DEEPSEEK_API_KEY ? { deepseek: process.env.DEEPSEEK_API_KEY } : {}),
      ...(process.env.GROK_API_KEY ? { grok: process.env.GROK_API_KEY } : {}),
    };
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = await dbService.getUserBySessionToken(token);
      if (user?.apiKeys) {
        userKeys = { ...user.apiKeys, ...userKeys };
      }
    } else {
      const guest = await dbService.getUserById('guest_user');
      if (guest?.apiKeys) {
        userKeys = { ...guest.apiKeys, ...userKeys };
      }
    }

    const effectiveProvider = provider || (modelId?.includes(':') ? modelId.split(':')[0] : 'gemini');
    const lowerModel = (modelId || 'gemini-2.5-flash').toLowerCase();

    const formattedMessages = Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: prompt || '' }];

    let responseText = '';

    // 1. Gemini
    if (effectiveProvider === 'gemini' || lowerModel.includes('gemini')) {
      const key = apiKey || userKeys.gemini || process.env.GEMINI_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'Gemini API key is not configured.' });
      }
      const ai = new GoogleGenAI({ apiKey: key });
      const contents: any[] = [];
      for (const m of formattedMessages) {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
        });
      }
      const result = await ai.models.generateContent({
        model: modelId?.includes(':') ? modelId.split(':')[1] : (modelId || 'gemini-2.5-flash'),
        contents,
        config: {
          systemInstruction: systemPrompt || undefined,
          temperature,
        },
      });
      responseText = result.text || '';
    }
    // 2. Claude
    else if (effectiveProvider === 'claude' || lowerModel.includes('claude')) {
      const key = apiKey || userKeys.claude || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'Anthropic Claude API key is not configured.' });
      }
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId?.includes(':') ? modelId.split(':')[1] : 'claude-3-5-sonnet-20241022',
          system: systemPrompt || undefined,
          messages: formattedMessages.map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
          max_tokens: maxTokens,
        }),
      });
      const cdata = await claudeRes.json();
      responseText = cdata.content?.[0]?.text || '';
    }
    // 3. OpenAI
    else if (effectiveProvider === 'openai' || lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3')) {
      const key = apiKey || userKeys.openai || process.env.OPENAI_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'OpenAI API key is not configured.' });
      }
      const fetchRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelId?.includes(':') ? modelId.split(':')[1] : 'gpt-4o',
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...formattedMessages.map((m: any) => ({ role: m.role, content: m.content })),
          ],
          temperature,
        }),
      });
      const data = await fetchRes.json();
      responseText = data.choices?.[0]?.message?.content || '';
    }
    // 4. Groq
    else if (effectiveProvider === 'groq' || lowerModel.includes('groq')) {
      const key = apiKey || userKeys.groq || process.env.GROQ_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'Groq API key is not configured.' });
      }
      const fetchRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelId?.includes(':') ? modelId.split(':')[1] : 'llama-3.3-70b-versatile',
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...formattedMessages.map((m: any) => ({ role: m.role, content: m.content })),
          ],
          temperature,
        }),
      });
      const data = await fetchRes.json();
      responseText = data.choices?.[0]?.message?.content || '';
    }
    // 5. DeepSeek
    else if (effectiveProvider === 'deepseek' || lowerModel.includes('deepseek')) {
      const key = apiKey || userKeys.deepseek || process.env.DEEPSEEK_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'DeepSeek API key is not configured.' });
      }
      const fetchRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelId?.includes(':') ? modelId.split(':')[1] : 'deepseek-chat',
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...formattedMessages.map((m: any) => ({ role: m.role, content: m.content })),
          ],
          temperature,
        }),
      });
      const data = await fetchRes.json();
      responseText = data.choices?.[0]?.message?.content || '';
    } else {
      return res.status(400).json({ error: `Provider "${effectiveProvider}" is not supported.` });
    }

    res.json({ response: responseText, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server inference failed' });
  }
});

// -----------------------------------------------------------------------------
// EMBED WIDGET JAVASCRIPT SNIPPET (GET /embed.js)
// -----------------------------------------------------------------------------
app.get('/embed.js', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
(function() {
  var script = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var agentSlug = script.getAttribute('data-agent');
  if (!agentSlug) {
    console.error('[Makron Embed] Missing data-agent attribute on script tag.');
    return;
  }

  var host = window.location.origin;
  try {
    var url = new URL(script.src);
    host = url.origin;
  } catch(e) {}

  var themeColor = script.getAttribute('data-color') || '#64748b';

  // Create floating circular launcher with "ꫧ" in center
  var launcher = document.createElement('div');
  launcher.id = 'makron-launcher-' + agentSlug;
  launcher.style.position = 'fixed';
  launcher.style.bottom = '24px';
  launcher.style.right = '24px';
  launcher.style.width = '56px';
  launcher.style.height = '56px';
  launcher.style.borderRadius = '50%';
  launcher.style.backgroundColor = themeColor;
  launcher.style.color = '#ffffff';
  launcher.style.display = 'flex';
  launcher.style.alignItems = 'center';
  launcher.style.justifyContent = 'center';
  launcher.style.fontSize = '26px';
  launcher.style.fontWeight = 'bold';
  launcher.style.cursor = 'pointer';
  launcher.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
  launcher.style.zIndex = '999998';
  launcher.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
  launcher.innerText = 'ꫧ';

  launcher.onmouseenter = function() { launcher.style.transform = 'scale(1.08)'; };
  launcher.onmouseleave = function() { launcher.style.transform = 'scale(1)'; };

  // Create iframe container for embed agent chat
  var container = document.createElement('div');
  container.id = 'makron-frame-container-' + agentSlug;
  container.style.position = 'fixed';
  container.style.bottom = '92px';
  container.style.right = '24px';
  container.style.width = '380px';
  container.style.maxWidth = 'calc(100vw - 32px)';
  container.style.height = '560px';
  container.style.maxHeight = 'calc(100vh - 120px)';
  container.style.borderRadius = '16px';
  container.style.overflow = 'hidden';
  container.style.boxShadow = '0 12px 40px rgba(0,0,0,0.35)';
  container.style.zIndex = '999999';
  container.style.display = 'none';
  container.style.border = '1px solid rgba(255,255,255,0.15)';
  container.style.background = '#0a0a0a';

  var iframe = document.createElement('iframe');
  iframe.src = host + '/embed/agent/' + encodeURIComponent(agentSlug);
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.setAttribute('allow', 'clipboard-write');

  container.appendChild(iframe);
  document.body.appendChild(launcher);
  document.body.appendChild(container);

  var isOpen = false;
  launcher.onclick = function() {
    isOpen = !isOpen;
    container.style.display = isOpen ? 'block' : 'none';
    launcher.innerText = isOpen ? '✕' : 'ꫧ';
  };
})();
`);
});

// -----------------------------------------------------------------------------
// VITE DEV SERVER OR PRODUCTION STATIC SERVING
// -----------------------------------------------------------------------------

async function startServer() {
  await initDatabase();

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Makron Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Makron Server] Startup error:', err);
  process.exit(1);
});
