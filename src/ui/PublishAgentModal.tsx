import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { SEASONAL_THEMES } from '../constants/themes';
import { resolveModelDetails } from '../models/manager';
import { AgentThemePreset, AuthUser, Conversation, Message, ReasoningLevel } from '../types';
import { AvatarCropperModal } from './AvatarCropperModal';

interface PublishAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  onSaveConversation: (updated: Conversation) => Promise<void>;
  token: string | null;
  user: AuthUser | null;
  messages?: Message[];
}

const AVAILABLE_SKILLS = [
  { id: 'code_execution', label: 'Code Execution' },
  { id: 'file_generation', label: 'File Generation' },
  { id: 'web_search', label: 'Web Search' },
  { id: 'doc_extract', label: 'Document Analysis' },
  { id: 'data_processing', label: 'Data Processing' },
];

const PRESET_AVATARS = ['ꫧ', '🤖', '⚡', '🧠', '🦉', '✨', '🚀', '🎯', '🔮'];

export const PublishAgentModal: React.FC<PublishAgentModalProps> = ({
  isOpen,
  onClose,
  conversation,
  onSaveConversation,
  token,
  user,
  messages = [],
}) => {
  const [isPublished, setIsPublished] = useState(false);
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('ꫧ');
  const [modelId, setModelId] = useState('gemini-2.5-flash');
  const [gender, setGender] = useState<'male' | 'female' | 'neutral'>('female');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [effortLevel, setEffortLevel] = useState<ReasoningLevel>('auto');
  const [selectedSkills, setSelectedSkills] = useState<string[]>(['code_execution', 'file_generation']);
  const [themePreset, setThemePreset] = useState<AgentThemePreset>('winter_midnight');
  const [customColor, setCustomColor] = useState('#8b5cf6');
  const [allowsFileUploads, setAllowsFileUploads] = useState(false);
  const [embedEnabled, setEmbedEnabled] = useState(true);
  const [includeHistory, setIncludeHistory] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  // Status check for published agent
  const [liveStatus, setLiveStatus] = useState<'Active' | 'Idle' | 'Offline' | 'Checking'>('Checking');

  useEffect(() => {
    if (!isOpen || !conversation) return;

    const baseTitle = conversation.title || 'agent';
    const fallbackSlug = baseTitle
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-agent';

    setIsPublished(Boolean(conversation.isPublished));
    setSlug(conversation.publishedSlug || fallbackSlug);
    setDisplayName(conversation.title || 'Custom Assistant');
    setDescription(conversation.description || 'Specialized AI assistant template derived from conversation sandbox.');
    setAvatar(conversation.avatar || 'ꫧ');
    setModelId(conversation.modelId || 'gemini-2.5-flash');
    setGender(conversation.gender || 'female');
    setSystemPrompt(conversation.systemPrompt || '');
    setEffortLevel(conversation.effortLevel || 'auto');
    setSelectedSkills(conversation.skills || ['code_execution', 'file_generation']);
    setThemePreset(conversation.themePreset || 'winter_midnight');
    setCustomColor(conversation.themeColor || '#8b5cf6');
    setAllowsFileUploads(Boolean(conversation.allowsFileUploads));
    setEmbedEnabled(conversation.embedEnabled !== false);
    setIncludeHistory(conversation.includeHistory !== false);
    setError(null);
  }, [isOpen, conversation]);

  // Ping live status if published
  useEffect(() => {
    if (!isOpen || !isPublished || !slug) return;
    let isMounted = true;

    fetch(`/api/public/agents/${encodeURIComponent(slug)}/status`)
      .then((r) => r.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.type === 'browser') {
          setLiveStatus('Idle');
        } else if (data.status === 'Active' || data.active) {
          setLiveStatus('Active');
        } else {
          setLiveStatus('Offline');
        }
      })
      .catch(() => {
        if (isMounted) setLiveStatus('Offline');
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, isPublished, slug]);

  if (!isOpen || !conversation) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cleanSlug = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-');
  const publishedUrl = `${origin}/agent/${cleanSlug}`;
  const embedCode = `<iframe src="${origin}/embed/agent/${cleanSlug}" width="100%" height="600" frameborder="0"></iframe>`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publishedUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanSlug) {
      setError('Please provide a URL slug for the published agent.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isPublished) {
        const validMessages = includeHistory
          ? messages
              .filter((m) => m.content && m.status !== 'error')
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
              }))
          : undefined;

        // Send publish request to backend
        const res = await fetch('/api/conversations/publish', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            conversationId: conversation.id,
            customName: cleanSlug,
            displayName: displayName.trim() || cleanSlug,
            description: description.trim(),
            avatar,
            modelId,
            gender,
            systemPrompt,
            effortLevel,
            skills: selectedSkills,
            themeColor: customColor,
            themePreset,
            themeMode: SEASONAL_THEMES[themePreset]?.mode || 'dark',
            allowsFileUploads,
            embedEnabled,
            initialMessages: validMessages,
          }),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Failed to publish agent');
        }
      } else if (conversation.isPublished) {
        // Unpublish request
        await fetch('/api/conversations/unpublish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customName: conversation.publishedSlug || cleanSlug,
          }),
        }).catch(() => {});
      }

      // Update local Conversation derivative
      const updated: Conversation = {
        ...conversation,
        isPublished,
        publishedSlug: cleanSlug,
        avatar,
        themePreset,
        themeColor: customColor,
        themeMode: SEASONAL_THEMES[themePreset]?.mode || 'dark',
        description,
        gender,
        skills: selectedSkills,
        effortLevel,
        allowsFileUploads,
        embedEnabled,
        includeHistory,
        updatedAt: Date.now(),
      };

      await onSaveConversation(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error updating publish settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl relative my-auto max-h-[92vh] flex flex-col">
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Modal Header */}
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                  Publish Custom Agent Frontend
                </h2>
                {isPublished && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live Frontend
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Blend and publish this conversation as a polished, read-only external assistant for users.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-600 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Scrollable Form Body */}
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto pr-1 mt-4 space-y-4">
            {/* 1. Main Publish Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/70">
              <div>
                <label htmlFor="publish-toggle" className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 block">
                  Public Agent Visibility
                </label>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  When enabled, this conversation derivatives into a dedicated URL page that can be shared externally.
                </p>
              </div>
              <button
                id="publish-toggle"
                type="button"
                onClick={() => setIsPublished(!isPublished)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                  isPublished ? 'bg-emerald-600' : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    isPublished ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* If Published: Live Status and Direct Links */}
            {isPublished && (
              <div className="p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      Published Frontend Link:
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                      /agent/{cleanSlug}
                    </span>
                  </div>

                  <a
                    href={publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <span>Open Frontend</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-neutral-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-neutral-800 transition flex items-center gap-1.5"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Link Copied!' : 'Copy Share Link'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyEmbed}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-neutral-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-neutral-800 transition flex items-center gap-1.5"
                  >
                    {copiedEmbed ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedEmbed ? 'Embed Copied!' : 'Copy Embed Code'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 2. Custom URL Slug & Display Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 block mb-1">
                  Custom Agent Slug (URL Path)
                </label>
                <div className="flex items-center rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="font-mono text-[11px] select-none">/agent/</span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                    placeholder="agent-name"
                    className="w-full bg-transparent text-neutral-900 dark:text-neutral-100 outline-hidden font-mono text-xs font-semibold ml-0.5"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 block mb-1">
                  Agent Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Code Architect Agent"
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 outline-hidden focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* 3. Description */}
            <div>
              <label className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 block mb-1">
                Description & Subtitle
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary shown on published frontend header"
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 outline-hidden focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* 4. Mini Sized Avatar (Appears in Sidebar & Published Page) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                  Agent Avatar (Sidebar Mini Icon & Header)
                </label>
                <span className="text-[11px] text-neutral-400">
                  Rendered in conversation sidebar & public frontend
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Avatar Preview */}
                <div className="relative group shrink-0">
                  {avatar.startsWith('data:image') || avatar.startsWith('http') ? (
                    <img
                      src={avatar}
                      alt="Avatar"
                      className="w-11 h-11 rounded-full object-cover ring-2 ring-emerald-500/50 shadow-sm"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-emerald-500/15 dark:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 font-bold text-lg flex items-center justify-center ring-2 ring-emerald-500/40">
                      {avatar}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsCropperOpen(true)}
                    title="Upload & Crop Custom Photo"
                    className="absolute -bottom-1 -right-1 p-1 bg-emerald-600 text-white rounded-full shadow hover:bg-emerald-700 transition cursor-pointer"
                  >
                    <Camera className="w-3 h-3" />
                  </button>
                </div>

                {/* Preset emoji picker */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_AVATARS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setAvatar(emoji)}
                      className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center transition border ${
                        avatar === emoji
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 font-bold'
                          : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setIsCropperOpen(true)}
                    className="px-2 py-1 rounded text-xs font-medium border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center gap-1"
                  >
                    <Camera className="w-3 h-3" />
                    <span>Upload</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 5. Custom Agent Theme Preset (Explicit note: only applies to published frontend!) */}
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/50">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Published Frontend Theme Preset</span>
                </label>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                  Visible exclusively on published frontend
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2.5">
                Choose the visual atmosphere for visitors on <span className="font-mono">/agent/{cleanSlug}</span>. Your internal workspace chat retains your current light/dark workspace styling intact.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(SEASONAL_THEMES).slice(0, 8).map(([key, item]) => {
                  const isSelected = themePreset === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setThemePreset(key as AgentThemePreset)}
                      className={`p-2 rounded-lg border text-left transition flex items-center gap-2 ${
                        isSelected
                          ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-white dark:bg-neutral-900 font-medium'
                          : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-xs text-neutral-800 dark:text-neutral-200 truncate">
                        {item.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 6. Skills & Interaction Capabilities */}
            <div>
              <label className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 block mb-1.5">
                Active Capabilities & Tools
              </label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_SKILLS.map((skill) => {
                  const active = selectedSkills.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className={`px-2.5 py-1 rounded text-xs transition border ${
                        active
                          ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-medium'
                          : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-750'
                      }`}
                    >
                      {skill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 7. Settings Toggles (Voice, File Uploads, Embed) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-neutral-200 dark:border-neutral-800">
              <label className="flex items-center gap-2 p-2 rounded border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHistory}
                  onChange={(e) => setIncludeHistory(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>Include Sandbox History</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowsFileUploads}
                  onChange={(e) => setAllowsFileUploads(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>Allow File Uploads</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={embedEnabled}
                  onChange={(e) => setEmbedEnabled(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>Enable Iframe Embed</span>
              </label>

              <div className="flex items-center gap-2 p-2 rounded border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-700 dark:text-neutral-300">
                <Volume2 className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full bg-transparent text-xs text-neutral-800 dark:text-neutral-200 outline-hidden font-medium"
                >
                  <option value="female" className="dark:bg-neutral-900">Female Voice</option>
                  <option value="male" className="dark:bg-neutral-900">Male Voice</option>
                  <option value="neutral" className="dark:bg-neutral-900">Neutral Voice</option>
                </select>
              </div>
            </div>
          </form>

          {/* Modal Footer */}
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-neutral-200 dark:border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm ${
                isPublished
                  ? 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400'
                  : 'bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200'
              }`}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isPublished ? <Globe className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
              <span>{saving ? 'Saving...' : isPublished ? 'Save & Publish' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Avatar Cropper Modal */}
      <AvatarCropperModal
        isOpen={isCropperOpen}
        onClose={() => setIsCropperOpen(false)}
        onCropComplete={(croppedUrl) => {
          setAvatar(croppedUrl);
          setIsCropperOpen(false);
        }}
      />
    </>
  );
};
