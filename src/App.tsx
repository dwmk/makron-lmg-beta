/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { eventBus, OrchestratorEvent } from './events/emitter';
import { VirtualFileSystem } from './filesystem/virtualFs';
import { AVAILABLE_MODELS, resolveModelDetails } from './models/manager';
import { orchestrator } from './orchestrator/engine';
import { db } from './storage/indexeddb';
import {
  AgentCapabilities,
  AttachedFile,
  AuthUser,
  Conversation,
  ExecutionState,
  Message,
  ReasoningLevel,
  UserSettings,
} from './types';
import { ApiKeysModal } from './ui/ApiKeysModal';
import { AuthModal } from './ui/AuthModal';
import { Composer } from './ui/Composer';
import { ContextModal } from './ui/ContextModal';
import { CustomAgentsModal } from './ui/CustomAgentsModal';
import { EmbedAgentView } from './ui/EmbedAgentView';
import { Header } from './ui/Header';
import { MessageList } from './ui/MessageList';
import { ModelModal } from './ui/ModelModal';
import { ProfileModal } from './ui/ProfileModal';
import { PublishAgentModal } from './ui/PublishAgentModal';
import { PublishedAgentView } from './ui/PublishedAgentView';
import { SettingsModal } from './ui/SettingsModal';
import { Sidebar } from './ui/Sidebar';
import { WorkspaceDrawer } from './ui/WorkspaceDrawer';

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [executionState, setExecutionState] = useState<ExecutionState>('idle');
  const [storageUsage, setStorageUsage] = useState({ usage: 0, quota: 0 });
  const [workspaceFileCount, setWorkspaceFileCount] = useState(0);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<{
    modelId: string;
    progress: number;
    loaded: number;
    total: number;
    file: string;
    text?: string;
  } | null>(null);

  // Reasoning Power & Capabilities Controls
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>('auto');
  const [capabilities, setCapabilities] = useState<AgentCapabilities>({
    allowInternet: false,
    allowTools: true,
    allowFiles: true,
    allowImage: false,
    autoCapabilities: true,
  });

  // Settings
  const [settings, setSettings] = useState<UserSettings>({
    theme: 'dark',
    defaultModelId: AVAILABLE_MODELS[0].id,
    devicePreference: 'webgpu',
    autoApproveTools: false,
    lastNonEmptySystemPrompt: 'You are an expert autonomous software engineer and analyst. Break down goals into structured steps and use available tools to build precise solutions.',
    maxRepairAttempts: 2,
  });

  // Modals & Panels
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);

  // Auth & Custom Agents State
  const [authToken, setAuthToken] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('makron_auth_token') : null
  );
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isCustomAgentsModalOpen, setIsCustomAgentsModalOpen] = useState(false);
  const [isApiKeysModalOpen, setIsApiKeysModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  // Routing check for published agents and embed widget
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (currentPath.startsWith('/embed/agent/')) {
    const slug = currentPath.replace('/embed/agent/', '').split('/')[0];
    return <EmbedAgentView customName={slug} />;
  }
  if (currentPath.startsWith('/agent/')) {
    const slug = currentPath.replace('/agent/', '').split('/')[0];
    return <PublishedAgentView customName={slug} />;
  }

  // 1. Initial Load
  useEffect(() => {
    // Validate session token if present
    if (authToken) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && data.user) {
            setAuthUser(data.user);
          } else {
            localStorage.removeItem('makron_auth_token');
            setAuthToken(null);
            setAuthUser(null);
          }
        })
        .catch(() => {});
    }
    const initApp = async () => {
      const savedSettings = await db.getSettings();

      // Migrate legacy model IDs
      const normalizeModelId = (id: string) => {
        if (id === 'onnx-community/SmolLM2-135M-Instruct') return 'onnx-community/SmolLM2-135M-Instruct-ONNX';
        if (id === 'onnx-community/SmolLM2-360M-Instruct') return 'onnx-community/SmolLM2-360M-Instruct-ONNX';
        return id;
      };

      if (savedSettings.defaultModelId) {
        const normalized = normalizeModelId(savedSettings.defaultModelId);
        if (normalized !== savedSettings.defaultModelId) {
          savedSettings.defaultModelId = normalized;
          await db.saveSettings(savedSettings);
        }
      }

      // Default to SmolLM2 135M if not specified or legacy Qwen default
      if (!savedSettings.defaultModelId || savedSettings.defaultModelId === 'onnx-community/Qwen2.5-0.5B-Instruct') {
        savedSettings.defaultModelId = 'onnx-community/SmolLM2-135M-Instruct-ONNX';
        await db.saveSettings(savedSettings);
      }

      setSettings(savedSettings);

      // Apply initial theme
      if (savedSettings.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      // Load conversations
      const convList = await db.getConversations();
      for (const c of convList) {
        const norm = normalizeModelId(c.modelId);
        if (norm !== c.modelId) {
          c.modelId = norm;
          await db.saveConversation(c);
        }
      }
      setConversations(convList);

      if (convList.length > 0) {
        selectConversation(convList[0]);
      } else {
        await createNewConversation();
      }

      refreshStorage();
    };

    initApp();
  }, []);

  // 2. Subscribe to orchestrator event bus
  useEffect(() => {
    const unsubscribe = eventBus.subscribe((event: OrchestratorEvent) => {
      if (event.type === 'state_change') {
        setExecutionState(event.state);
        if (event.state !== 'downloading_model') {
          setModelDownloadProgress(null);
        }
      } else if (event.type === 'model_progress') {
        setModelDownloadProgress({
          modelId: event.modelId,
          progress: event.progress,
          loaded: event.loaded,
          total: event.total,
          file: event.file,
          text: event.text,
        });
      } else if (event.type === 'final_token') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, content: m.content + event.token } : m
          )
        );
      } else if (event.type === 'roadmap_generated') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, roadmap: event.roadmap, status: 'running' } : m))
        );
      } else if (event.type === 'step_start') {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== event.messageId) return m;
            const existingSteps = m.executionSteps || [];
            const index = existingSteps.findIndex((s) => s.id === event.step.id);
            const updated =
              index >= 0
                ? existingSteps.map((s, i) => (i === index ? event.step : s))
                : [...existingSteps, event.step];
            return { ...m, executionSteps: updated };
          })
        );
      } else if (event.type === 'step_update') {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== event.messageId) return m;
            const updated = (m.executionSteps || []).map((s) => (s.id === event.step.id ? event.step : s));
            return { ...m, executionSteps: updated };
          })
        );
      } else if (event.type === 'review_complete') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, reviewResult: event.review } : m))
        );
      } else if (event.type === 'completed') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, content: event.finalOutput, status: 'completed' } : m
          )
        );
        refreshWorkspaceFiles();
        refreshStorage();
      } else if (event.type === 'error') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, content: event.error, status: 'error' } : m
          )
        );
      } else if (event.type === 'file_changed') {
        refreshWorkspaceFiles();
      }
    });

    return unsubscribe;
  }, [activeConv?.id]);

  const refreshStorage = async () => {
    const est = await db.getStorageEstimate();
    setStorageUsage(est);
  };

  const refreshWorkspaceFiles = async () => {
    if (!activeConv) return;
    const files = await VirtualFileSystem.listFiles(activeConv.id);
    setWorkspaceFileCount(files.length);
  };

  const selectConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    const msgs = await db.getMessages(conv.id);
    setMessages(msgs);
    const files = await VirtualFileSystem.listFiles(conv.id);
    setWorkspaceFileCount(files.length);
  };

  const createNewConversation = async () => {
    const id = 'conv_' + Math.random().toString(36).substring(2, 11);
    const newConv: Conversation = {
      id,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: settings.defaultModelId,
      systemPrompt: settings.lastNonEmptySystemPrompt,
    };

    await db.saveConversation(newConv);
    setConversations((prev) => [newConv, ...prev]);
    await selectConversation(newConv);
    refreshStorage();
  };

  const handleDeleteConversation = async (id: string) => {
    await db.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);

    if (activeConv?.id === id) {
      if (remaining.length > 0) {
        selectConversation(remaining[0]);
      } else {
        await createNewConversation();
      }
    }
    refreshStorage();
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    const target = conversations.find((c) => c.id === id);
    if (!target) return;
    const updated = { ...target, title: newTitle, updatedAt: Date.now() };
    await db.saveConversation(updated);
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    if (activeConv?.id === id) {
      setActiveConv(updated);
    }
  };

  const handleToggleTheme = async () => {
    const next: 'dark' | 'light' = settings.theme === 'dark' ? 'light' : 'dark';
    const updated: UserSettings = { ...settings, theme: next };
    setSettings(updated);
    await db.saveSettings(updated);

    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleSelectModel = async (modelId: string) => {
    if (!activeConv) return;
    const details = resolveModelDetails(modelId, settings.vendorModels || {});
    if (!details.supportsVision && capabilities.allowImage) {
      setCapabilities((prev) => ({ ...prev, allowImage: false }));
    }
    const updated = { ...activeConv, modelId, updatedAt: Date.now() };
    await db.saveConversation(updated);
    setActiveConv(updated);
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleSaveContextPrompt = async (prompt: string) => {
    if (!activeConv) return;
    const updatedConv = { ...activeConv, systemPrompt: prompt, updatedAt: Date.now() };
    await db.saveConversation(updatedConv);
    setActiveConv(updatedConv);

    if (prompt) {
      const updatedSettings = { ...settings, lastNonEmptySystemPrompt: prompt };
      setSettings(updatedSettings);
      await db.saveSettings(updatedSettings);
    }
  };

  const handleSendMessage = async (
    content: string,
    attachments: AttachedFile[],
    options?: {
      reasoningLevel?: ReasoningLevel;
      capabilities?: AgentCapabilities;
    }
  ) => {
    if (!activeConv) return;

    // Update conversation title from prompt if default
    if (activeConv.title === 'New Conversation' && content) {
      const trimmedTitle = content.slice(0, 32).trim() + (content.length > 32 ? '...' : '');
      handleRenameConversation(activeConv.id, trimmedTitle);
    }

    const userMessageId = 'msg_' + Math.random().toString(36).substring(2, 11);
    const userMsg: Message = {
      id: userMessageId,
      conversationId: activeConv.id,
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments,
      status: 'completed',
    };

    await db.saveMessage(userMsg);

    const assistantMessageId = 'msg_' + Math.random().toString(36).substring(2, 11);
    const placeholderAssistantMsg: Message = {
      id: assistantMessageId,
      conversationId: activeConv.id,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'running',
    };

    setMessages((prev) => [...prev, userMsg, placeholderAssistantMsg]);

    const activeLevel = options?.reasoningLevel || reasoningLevel;
    const activeCaps = options?.capabilities || capabilities;

    try {
      await orchestrator.execute({
        conversationId: activeConv.id,
        messageId: assistantMessageId,
        userPrompt: content,
        systemPrompt: activeConv.systemPrompt,
        modelId: activeConv.modelId,
        settings,
        reasoningLevel: activeLevel,
        capabilities: activeCaps,
        recentMessages: messages,
      });
    } catch (err: any) {
      console.warn('Execution terminated:', err.message);
      setExecutionState('idle');
    }
  };

  const handleCancelExecution = () => {
    orchestrator.cancelExecution();
    setExecutionState('cancelled');
  };

  const handleApproveTool = (stepId: string, toolCallId: string) => {
    orchestrator.respondToApproval(toolCallId, true);
  };

  const handleDenyTool = (stepId: string, toolCallId: string) => {
    orchestrator.respondToApproval(toolCallId, false);
  };

  const handleOpenFile = (path: string) => {
    setPreviewFilePath(path);
    setIsWorkspaceOpen(true);
  };

  const handleSignOut = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/signout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // ignore
      }
    }
    localStorage.removeItem('makron_auth_token');
    setAuthToken(null);
    setAuthUser(null);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 transition-colors">
      {/* Sidebar Navigation */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConv?.id || null}
        onSelectConversation={(id) => {
          const target = conversations.find((c) => c.id === id);
          if (target) selectConversation(target);
        }}
        onNewConversation={createNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        storageUsage={storageUsage}
        onOpenSettings={() => {
          setIsSidebarOpen(false);
          setIsSettingsModalOpen(true);
        }}
        authUser={authUser}
        onOpenAuth={() => {
          setIsSidebarOpen(false);
          setIsAuthModalOpen(true);
        }}
        onOpenProfile={() => {
          setIsSidebarOpen(false);
          setIsProfileModalOpen(true);
        }}
        onOpenAgents={() => {
          setIsSidebarOpen(false);
          setIsCustomAgentsModalOpen(true);
        }}
        onOpenApiKeys={() => {
          setIsSidebarOpen(false);
          setIsApiKeysModalOpen(true);
        }}
        onSignOut={handleSignOut}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header
          conversation={activeConv}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          onOpenWorkspace={() => {
            setPreviewFilePath(null);
            setIsWorkspaceOpen(true);
          }}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onRenameConversation={handleRenameConversation}
          theme={settings.theme}
          onToggleTheme={handleToggleTheme}
          executionState={executionState}
          workspaceFileCount={workspaceFileCount}
          onOpenPublishModal={() => setIsPublishModalOpen(true)}
        />

        {/* Message Stream Area */}
        <MessageList
          messages={messages}
          activeExecutionState={executionState}
          modelDownloadProgress={modelDownloadProgress}
          onOpenFile={handleOpenFile}
          onApproveTool={handleApproveTool}
          onDenyTool={handleDenyTool}
          onSelectPromptSuggestion={(prompt) => handleSendMessage(prompt, [])}
          onRedoMessage={(content, atts) => handleSendMessage(content, atts || [])}
          onEditMessage={async (id, newContent) => {
            const target = messages.find((m) => m.id === id);
            if (!target) return;
            const updated = { ...target, content: newContent };
            await db.saveMessage(updated);
            setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
            handleSendMessage(newContent, target.attachments || []);
          }}
        />

        {/* Bottom Composer */}
        <Composer
          onSendMessage={handleSendMessage}
          onCancelExecution={handleCancelExecution}
          executionState={executionState}
          disabled={!activeConv}
          reasoningLevel={reasoningLevel}
          onChangeReasoningLevel={setReasoningLevel}
          capabilities={capabilities}
          onChangeCapabilities={setCapabilities}
          currentModelId={activeConv?.modelId || settings.defaultModelId}
          vendorModels={settings.vendorModels || {}}
          onOpenModels={() => setIsModelModalOpen(true)}
          onOpenContext={() => setIsContextModalOpen(true)}
        />
      </div>

      {/* Modals & Drawers */}
      <ContextModal
        isOpen={isContextModalOpen}
        onClose={() => setIsContextModalOpen(false)}
        systemPrompt={activeConv?.systemPrompt || ''}
        onSave={handleSaveContextPrompt}
        lastNonEmptyPrompt={settings.lastNonEmptySystemPrompt}
      />

      {activeConv && (
        <WorkspaceDrawer
          isOpen={isWorkspaceOpen}
          onClose={() => setIsWorkspaceOpen(false)}
          conversationId={activeConv.id}
          initialFilePath={previewFilePath}
          onFilesChanged={refreshWorkspaceFiles}
        />
      )}

      <ModelModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        selectedModelId={activeConv?.modelId || settings.defaultModelId}
        onSelectModel={handleSelectModel}
        preferredDevice={settings.devicePreference}
        hfToken={settings.hfToken}
        onUpdateHfToken={async (token) => {
          const updated = { ...settings, hfToken: token };
          setSettings(updated);
          await db.saveSettings(updated);
        }}
        onChangeDevice={async (dev) => {
          const updated = { ...settings, devicePreference: dev };
          setSettings(updated);
          await db.saveSettings(updated);
        }}
        apiKeys={settings.apiKeys || {}}
        onUpdateApiKey={async (provider, key) => {
          const updatedKeys = { ...(settings.apiKeys || {}), [provider]: key };
          const updated = {
            ...settings,
            apiKeys: updatedKeys,
          };
          if (provider === 'huggingface') {
            updated.hfToken = key;
          }
          setSettings(updated);
          await db.saveSettings(updated);

          // Sync unified keys in localStorage
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('makron_api_keys', JSON.stringify(updatedKeys));
            } catch {}
          }

          // Sync with backend keys endpoint so server-side proxy immediately has it
          fetch('/api/auth/keys', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ apiKeys: { [provider]: key } }),
          }).catch(() => {});
        }}
        vendorModels={settings.vendorModels || {}}
        onUpdateVendorModel={async (provider, model) => {
          const updated = {
            ...settings,
            vendorModels: { ...(settings.vendorModels || {}), [provider]: model },
          };
          setSettings(updated);
          await db.saveSettings(updated);
        }}
        ollamaUrl={settings.ollamaUrl || ''}
        onUpdateOllamaUrl={async (url) => {
          const updated = { ...settings, ollamaUrl: url };
          setSettings(updated);
          await db.saveSettings(updated);
        }}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={async (newSet) => {
          setSettings(newSet);
          await db.saveSettings(newSet);
        }}
        storageUsage={storageUsage}
        onDataWiped={async () => {
          const reloaded = await db.getConversations();
          setConversations(reloaded);
          if (reloaded.length > 0) {
            await selectConversation(reloaded[0]);
          } else {
            setMessages([]);
            await createNewConversation();
          }
          await refreshStorage();
          await refreshWorkspaceFiles();
        }}
      />

      {/* Account & Custom Agent Modals */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(token, user) => {
          setAuthToken(token);
          setAuthUser(user);
        }}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={authUser}
        token={authToken}
        onProfileUpdated={(updated) => setAuthUser(updated)}
      />

      <CustomAgentsModal
        isOpen={isCustomAgentsModalOpen}
        onClose={() => setIsCustomAgentsModalOpen(false)}
        token={authToken}
        user={authUser}
        onOpenApiKeys={() => setIsApiKeysModalOpen(true)}
      />

      <ApiKeysModal
        isOpen={isApiKeysModalOpen}
        onClose={() => setIsApiKeysModalOpen(false)}
        token={authToken}
        onKeysUpdated={(newKeys) => {
          if (newKeys && typeof newKeys === 'object') {
            const updated = {
              ...settings,
              apiKeys: { ...(settings.apiKeys || {}), ...newKeys },
            };
            setSettings(updated);
            db.saveSettings(updated);
          }
          if (authToken) {
            fetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${authToken}` },
            })
              .then((r) => r.json())
              .then((d) => d?.user && setAuthUser(d.user));
          }
        }}
      />

      {/* Publish Custom Agent Modal */}
      <PublishAgentModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        conversation={activeConv}
        onSaveConversation={async (updated) => {
          await db.saveConversation(updated);
          setActiveConv(updated);
          setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }}
        token={authToken}
        user={authUser}
        messages={messages}
      />
    </div>
  );
}
