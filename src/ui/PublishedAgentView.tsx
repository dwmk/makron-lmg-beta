import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  FileText,
  Loader2,
  Paperclip,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { PublicAgentOwner, VerifiedType } from '../types';
import { modelManager, resolveModelDetails } from '../models/manager';
import { VerifiedBadge } from './VerifiedBadge';

interface PublishedAgentViewProps {
  customName: string;
}

interface PublicAgent {
  id: string;
  customName: string;
  displayName: string;
  description?: string;
  avatar: string;
  modelId?: string;
  gender?: 'male' | 'female' | 'neutral';
  systemPrompt?: string;
  effortLevel: string;
  skills: string[];
  themeColor: string;
  themePreset: string;
  themeMode?: 'light' | 'dark';
  themeBg?: string;
  themeCard?: string;
  themeText?: string;
  allowsFileUploads: boolean;
  embedEnabled: boolean;
  owner?: PublicAgentOwner;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Guaranteed voice arrays for text-to-speech
export const GUARANTEED_FEMALE_VOICES = [
  'Google US English',
  'Microsoft Zira - English (United States)',
  'Samantha',
  'Victoria',
  'Karen',
  'Moira',
  'Tessa',
  'Fiona',
  'Microsoft Jenny Online (Natural) - English (United States)',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Google UK English Female',
  'en-US-Standard-C',
  'en-US-Standard-E',
  'en-US-Wavenet-C',
  'en-US-Wavenet-E',
];

export const GUARANTEED_MALE_VOICES = [
  'Google UK English Male',
  'Microsoft David - English (United States)',
  'Microsoft Mark - English (United States)',
  'Alex',
  'Daniel',
  'Oliver',
  'Fred',
  'Microsoft Guy Online (Natural) - English (United States)',
  'Google US English Male',
  'en-US-Standard-B',
  'en-US-Standard-D',
  'en-US-Wavenet-B',
  'en-US-Wavenet-D',
];

export const PublishedAgentView: React.FC<PublishedAgentViewProps> = ({ customName }) => {
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchAgent = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/agents/${encodeURIComponent(customName)}`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Agent not found');
        }
        const data = await res.json();
        setAgent(data.agent);

        // If conversation history was published, derive those turns for visitor sandbox showcase
        if (Array.isArray(data.agent.initialMessages) && data.agent.initialMessages.length > 0) {
          setMessages(
            data.agent.initialMessages.map((m: any) => ({
              id: m.id || 'msg_' + Math.random().toString(36).substring(2, 9),
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content,
              timestamp: m.timestamp || Date.now(),
            }))
          );
        } else {
          // Initial welcome turn
          setMessages([
            {
              id: 'welcome',
              role: 'assistant',
              content: `Hello! I am **${data.agent.displayName}**.\n\n${
                data.agent.description || 'How can I assist you today?'
              }`,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load agent');
      } finally {
        setLoading(false);
      }
    };

    fetchAgent();
  }, [customName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Clean up speech synthesis when unmounting
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakText = (text: string, msgId: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    if (currentlySpeakingId === msgId) {
      window.speechSynthesis.cancel();
      setCurrentlySpeakingId(null);
      return;
    }

    window.speechSynthesis.cancel();
    // Clean markdown characters for spoken text
    const cleanText = text
      .replace(/[*#`_\[\]()]/g, ' ')
      .replace(/\n+/g, '. ')
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const availableVoices = window.speechSynthesis.getVoices();
    const targetGender = agent?.gender || 'female';

    if (targetGender === 'female') {
      const match = availableVoices.find((v) =>
        GUARANTEED_FEMALE_VOICES.some((targetName) =>
          v.name.toLowerCase().includes(targetName.toLowerCase())
        ) ||
        v.name.toLowerCase().includes('female') ||
        v.name.toLowerCase().includes('zira') ||
        v.name.toLowerCase().includes('samantha')
      );
      if (match) utterance.voice = match;
      utterance.pitch = 1.1;
      utterance.rate = 1.0;
    } else if (targetGender === 'male') {
      const match = availableVoices.find((v) =>
        GUARANTEED_MALE_VOICES.some((targetName) =>
          v.name.toLowerCase().includes(targetName.toLowerCase())
        ) ||
        v.name.toLowerCase().includes('male') ||
        v.name.toLowerCase().includes('david') ||
        v.name.toLowerCase().includes('alex')
      );
      if (match) utterance.voice = match;
      utterance.pitch = 0.9;
      utterance.rate = 1.0;
    }

    utterance.onend = () => setCurrentlySpeakingId(null);
    utterance.onerror = () => setCurrentlySpeakingId(null);

    setCurrentlySpeakingId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const [modelLoadingText, setModelLoadingText] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<'Active' | 'Idle' | 'Offline' | 'Checking'>('Checking');

  useEffect(() => {
    const unsub = modelManager.onProgress((p) => {
      if (p.status === 'progress' && p.progress < 100) {
        setModelLoadingText(`Loading model weights: ${p.progress}%`);
      } else if (p.status === 'ready' || p.status === 'done') {
        setModelLoadingText(null);
        setAgentStatus('Active');
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!agent) return;

    let isMounted = true;

    const checkStatus = async () => {
      const targetModel = agent.modelId || 'gemini-2.5-flash';
      const modelDetails = resolveModelDetails(targetModel);

      // 1. If relying on browser-based model: show "Idle" if not preloaded or not found in browser storage, else "Active"
      if (modelDetails.isLocal) {
        if (modelManager.getIsLoaded() && modelManager.getCurrentModelId() === modelDetails.id) {
          if (isMounted) setAgentStatus('Active');
          return;
        }

        let foundInStorage = false;
        if (typeof window !== 'undefined') {
          // Check Cache API
          if ('caches' in window) {
            try {
              const cacheKeys = await window.caches.keys();
              const modelKeyFragment = (modelDetails.id.split('/').pop() || modelDetails.id).toLowerCase();
              for (const key of cacheKeys) {
                if (key.includes('transformers') || key.includes('onnx') || key.includes('huggingface')) {
                  const cache = await window.caches.open(key);
                  const requests = await cache.keys();
                  if (requests.some((r) => r.url.toLowerCase().includes(modelKeyFragment))) {
                    foundInStorage = true;
                    break;
                  }
                }
              }
            } catch {
              // cache error
            }
          }

          // Check IndexedDB
          if (!foundInStorage && 'indexedDB' in window && typeof indexedDB.databases === 'function') {
            try {
              const dbs = await indexedDB.databases();
              if (dbs.some((d) => d.name && (d.name.includes('transformers') || d.name.includes('onnx')))) {
                foundInStorage = true;
              }
            } catch {
              // idb error
            }
          }
        }

        if (isMounted) {
          setAgentStatus(foundInStorage ? 'Active' : 'Idle');
        }
        return;
      }

      // 2. If depends on API key or Ollama server: ping them to show active status on frontend, else "Offline"
      try {
        const res = await fetch(`/api/public/agents/${encodeURIComponent(customName)}/status`);
        if (!isMounted) return;
        if (res.ok) {
          const data = await res.json();
          if (data.type === 'browser') {
            setAgentStatus(modelManager.getIsLoaded() ? 'Active' : 'Idle');
          } else {
            setAgentStatus(data.active ? 'Active' : 'Offline');
          }
        } else {
          setAgentStatus('Offline');
        }
      } catch {
        if (isMounted) setAgentStatus('Offline');
      }
    };

    checkStatus();

    return () => {
      isMounted = false;
    };
  }, [agent, customName]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || sending || !agent) return;

    const userText = input.trim();
    const currentFiles = [...attachedFiles];
    setInput('');
    setAttachedFiles([]);

    const userMsg: ChatMessage = {
      id: 'usr_' + Date.now(),
      role: 'user',
      content:
        userText +
        (currentFiles.length > 0
          ? `\n\n*(Attached ${currentFiles.length} file(s): ${currentFiles
              .map((f) => f.name)
              .join(', ')})*`
          : ''),
      timestamp: Date.now(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setSending(true);

    try {
      const modelDetails = resolveModelDetails(agent.modelId || '');
      const isLocalModel = modelDetails.isLocal;

      if (isLocalModel) {
        // Execute client-side via Transformers.js in the visitor's browser
        if (!modelManager.getIsLoaded() || modelManager.getCurrentModelId() !== modelDetails.id) {
          setModelLoadingText(`Loading ${modelDetails.name} weights...`);
          await modelManager.loadModel(modelDetails.id, 'webgpu');
          setModelLoadingText(null);
        }

        const effortInstruction =
          agent.effortLevel === 'low'
            ? 'Provide direct, concise, immediate answers without preamble.'
            : agent.effortLevel === 'high' || agent.effortLevel === 'max'
            ? 'Provide comprehensive, thoroughly analyzed and structured multi-step solutions with detailed code or operational blueprints where appropriate.'
            : 'Provide balanced, well-reasoned, actionable assistance.';

        const systemInstruction = `You are "${agent.displayName}", an AI assistant.\n${agent.description ? `Description: ${agent.description}\n` : ''}${agent.systemPrompt ? `Context & Directives:\n${agent.systemPrompt}\n` : ''}\nEffort & Reasoning Policy: ${effortInstruction}`;

        const history = nextMessages
          .filter((m) => m.id !== 'welcome')
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content }));

        let attachmentsText = '';
        if (agent.allowsFileUploads && currentFiles.length > 0) {
          attachmentsText =
            '\n\nAttached User Documents:\n' +
            currentFiles.map((a: any) => `[File: ${a.name}]\n${a.content || ''}`).join('\n\n');
        }

        const messagesPayload = [
          { role: 'system', content: systemInstruction },
          ...history,
          { role: 'user', content: (userText || 'Please inspect attached documents') + attachmentsText },
        ];

        const generatedText = await modelManager.generate({
          modelId: modelDetails.id,
          messages: messagesPayload,
          maxNewTokens: 1024,
          temperature: agent.effortLevel === 'low' ? 0.2 : 0.6,
        });

        const botMsg: ChatMessage = {
          id: 'bot_' + Date.now(),
          role: 'assistant',
          content: generatedText || 'I have completed your request.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, botMsg]);
      } else {
        // Cloud API model - request server endpoint
        const history = nextMessages
          .filter((m) => m.id !== 'welcome')
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch(`/api/public/agents/${encodeURIComponent(customName)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userText || 'Please inspect the attached documents.',
            history,
            attachments: currentFiles,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Chat request failed');
        }

        const botMsg: ChatMessage = {
          id: 'bot_' + Date.now(),
          role: 'assistant',
          content: data.response || 'No response returned.',
          timestamp: data.timestamp || Date.now(),
        };
        setMessages((prev) => [...prev, botMsg]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          role: 'assistant',
          content: `⚠️ ${err.message || 'Failed to generate response. Please try again.'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setModelLoadingText(null);
      setSending(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setAttachedFiles((prev) => [...prev, { name: file.name, content: text }]);
        }
      };
      reader.readAsText(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-xl font-bold mb-3 animate-pulse">
          ꫧ
        </div>
        <p className="text-xs text-neutral-400 font-mono">Loading virtual assistant...</p>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4 text-center">
        <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400 mb-3">
          <Bot className="w-6 h-6" />
        </div>
        <h1 className="text-base font-semibold mb-1">Agent Unavailable</h1>
        <p className="text-xs text-neutral-400 max-w-sm mb-4">
          {error || `The agent "/agent/${customName}" does not exist or is currently unpublished.`}
        </p>
        <a
          href="/"
          className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition"
        >
          Return to Platform
        </a>
      </div>
    );
  }

  const themeColor = agent.themeColor || '#8b5cf6';
  const isLight = agent.themeMode === 'light';
  const bgColor = agent.themeBg || (isLight ? '#f8fafc' : '#0a0a0a');
  const cardColor = agent.themeCard || (isLight ? '#ffffff' : '#141416');
  const textColor = agent.themeText || (isLight ? '#0f172a' : '#fafafa');
  const borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';

  const owner = agent.owner;

  return (
    <div
      className="min-h-screen flex flex-col font-sans transition-colors duration-200"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {/* Top Header */}
      <header
        className="h-16 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 backdrop-blur-md border-b"
        style={{
          backgroundColor: isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(10, 10, 12, 0.85)',
          borderColor: borderColor,
        }}
      >
        {/* Left: Agent Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0 overflow-hidden"
            style={{ backgroundColor: themeColor }}
          >
            {agent.avatar && agent.avatar.startsWith('data:image') ? (
              <img src={agent.avatar} alt="Agent Avatar" className="w-full h-full object-cover" />
            ) : (
              <span>{agent.avatar || 'ꫧ'}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xs sm:text-sm font-semibold tracking-tight truncate">
                {agent.displayName}
              </h1>
              {agentStatus === 'Active' && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium font-mono shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              )}
              {agentStatus === 'Idle' && (
                <span className="flex items-center gap-1 text-[10px] text-amber-500 dark:text-amber-400 font-medium font-mono shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  Idle
                </span>
              )}
              {agentStatus === 'Offline' && (
                <span className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500 font-medium font-mono shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                  Offline
                </span>
              )}
              {agentStatus === 'Checking' && (
                <span className="flex items-center gap-1 text-[10px] text-neutral-400 font-medium font-mono shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
                  Checking...
                </span>
              )}
            </div>
            {agent.description && (
              <p className="text-[11px] opacity-70 line-clamp-1 truncate max-w-xs sm:max-w-md">
                {agent.description}
              </p>
            )}
          </div>
        </div>

        {/* Right: Owner's Display Name, Username, Avatar & Verified Badge */}
        <div className="flex items-center gap-3 shrink-0">
          {owner ? (
            <div className="flex items-center gap-2.5 pl-3 border-l" style={{ borderColor: borderColor }}>
              <div className="text-right hidden sm:block">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-xs font-semibold leading-tight">{owner.name || owner.username}</span>
                  <VerifiedBadge type={owner.verifiedType} size="md" />
                </div>
                <span className="text-[10px] opacity-60 font-mono block">@{owner.username}</span>
              </div>

              {/* Mobile display for small screens */}
              <div className="flex items-center gap-1 sm:hidden">
                <span className="text-xs font-semibold max-w-[80px] truncate">{owner.name || owner.username}</span>
                <VerifiedBadge type={owner.verifiedType} size="sm" />
              </div>

              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden border shadow-2xs"
                style={{ backgroundColor: themeColor, borderColor: borderColor }}
              >
                {owner.avatar && owner.avatar.startsWith('data:image') ? (
                  <img src={owner.avatar} alt={owner.name || 'Owner'} className="w-full h-full object-cover" />
                ) : (
                  <span>{(owner.name || owner.username || 'O')[0].toUpperCase()}</span>
                )}
              </div>
            </div>
          ) : (
            <a
              href="/"
              className="flex items-center gap-1.5 text-[11px] opacity-70 hover:opacity-100 transition"
              title="Makron Platform"
            >
              <span className="font-bold">ꫧ</span>
              <span className="hidden sm:inline font-mono">Makron</span>
            </a>
          )}
        </div>
      </header>

      {/* Chat Messages */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 flex flex-col space-y-4 overflow-y-auto">
        {messages.map((m) => {
          const isUser = m.role === 'user';
          const isSpeaking = currentlySpeakingId === m.id;

          return (
            <div
              key={m.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {!isUser && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5 shadow-2xs overflow-hidden"
                  style={{ backgroundColor: themeColor }}
                >
                  {agent.avatar && agent.avatar.startsWith('data:image') ? (
                    <img src={agent.avatar} alt="Agent" className="w-full h-full object-cover" />
                  ) : (
                    <span>{agent.avatar || 'ꫧ'}</span>
                  )}
                </div>
              )}

              <div className="max-w-[85%] flex flex-col items-start gap-1">
                <div
                  className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-xs ${
                    isUser ? 'text-white' : ''
                  }`}
                  style={
                    isUser
                      ? { backgroundColor: themeColor }
                      : {
                          backgroundColor: cardColor,
                          border: `1px solid ${borderColor}`,
                          color: textColor,
                        }
                  }
                >
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  ) : (
                    <div className="prose prose-xs max-w-none break-words" style={{ color: textColor }}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                {/* Text-To-Speech Button for Assistant Messages */}
                {!isUser && (
                  <button
                    type="button"
                    onClick={() => speakText(m.content, m.id)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] opacity-60 hover:opacity-100 transition cursor-pointer select-none"
                    style={{ color: textColor }}
                    title={isSpeaking ? 'Stop voice readout' : 'Read aloud with AI voice'}
                  >
                    {isSpeaking ? (
                      <>
                        <VolumeX className="w-3 h-3 text-red-500 animate-pulse" />
                        <span className="text-red-500 font-medium">Stop audio</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3 h-3" />
                        <span>Listen ({agent.gender === 'male' ? 'Male Voice' : 'Female Voice'})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5 shadow-2xs overflow-hidden"
              style={{ backgroundColor: themeColor }}
            >
              {agent.avatar && agent.avatar.startsWith('data:image') ? (
                <img src={agent.avatar} alt="Agent" className="w-full h-full object-cover" />
              ) : (
                <span>{agent.avatar || 'ꫧ'}</span>
              )}
            </div>
            <div
              className="rounded-2xl px-4 py-2.5 text-xs flex items-center gap-2 border shadow-xs"
              style={{
                backgroundColor: cardColor,
                borderColor: borderColor,
                color: textColor,
              }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="opacity-70">{modelLoadingText || 'Thinking...'}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Bottom Composer */}
      <footer
        className="p-4 border-t sticky bottom-0 z-20 backdrop-blur-md"
        style={{
          backgroundColor: isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(10, 10, 12, 0.9)',
          borderColor: borderColor,
        }}
      >
        <div className="max-w-3xl w-full mx-auto">
          {/* File attachment preview chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((f, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border shadow-2xs"
                  style={{
                    backgroundColor: cardColor,
                    borderColor: borderColor,
                    color: textColor,
                  }}
                >
                  <FileText className="w-3 h-3 opacity-60" />
                  <span className="truncate max-w-[150px]">{f.name}</span>
                  <button
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-0.5 opacity-60 hover:opacity-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSendMessage}
            className="flex items-end gap-2 rounded-2xl p-1.5 shadow-lg border transition"
            style={{
              backgroundColor: cardColor,
              borderColor: borderColor,
            }}
          >
            {agent.allowsFileUploads && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  className="p-2 opacity-60 hover:opacity-100 transition rounded-xl cursor-pointer"
                  style={{ color: textColor }}
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </>
            )}

            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={`Message ${agent.displayName}...`}
              className="flex-1 bg-transparent border-0 px-2.5 py-1.5 text-xs resize-none focus:outline-hidden min-h-[36px] max-h-[140px]"
              style={{ color: textColor }}
            />

            <button
              type="submit"
              disabled={(!input.trim() && attachedFiles.length === 0) || sending}
              className="p-2 text-white rounded-xl transition disabled:opacity-40 cursor-pointer shadow-xs shrink-0"
              style={{ backgroundColor: themeColor }}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
};
