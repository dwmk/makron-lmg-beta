import React, { useEffect, useState } from 'react';
import { Check, Key, Shield, X } from 'lucide-react';
import { VENDOR_CONFIGS } from '../models/manager';

interface ApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  onKeysUpdated?: (updatedKeys: Record<string, string>) => void;
}

export const ApiKeysModal: React.FC<ApiKeysModalProps> = ({ isOpen, onClose, token, onKeysUpdated }) => {
  const [keysInput, setKeysInput] = useState<Record<string, string>>({});
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadKeyStatus();
    }
  }, [isOpen, token]);

  const loadKeyStatus = async () => {
    try {
      // 1. Check local storage
      let localKeys: Record<string, boolean> = {};
      if (typeof window !== 'undefined') {
        try {
          const raw = JSON.parse(localStorage.getItem('makron_api_keys') || '{}');
          for (const [k, v] of Object.entries(raw)) {
            if (v && typeof v === 'string' && v.trim()) localKeys[k] = true;
          }
        } catch {}
      }

      // 2. Fetch server status (includes environment keys like gemini)
      const res = await fetch('/api/auth/keys', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setConfiguredKeys({ ...localKeys, ...(data.keys || {}) });
      } else {
        setConfiguredKeys(localKeys);
      }
    } catch {
      // ignore
    }
  };

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError(null);
    setSaved(false);

    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(keysInput)) {
        if (v && v.trim()) payload[k] = v.trim();
      }
      if (ollamaUrl.trim()) {
        payload.ollamaUrl = ollamaUrl.trim();
      }

      // 1. Save to local storage for immediate browser usage
      if (typeof window !== 'undefined') {
        try {
          const existing = JSON.parse(localStorage.getItem('makron_api_keys') || '{}');
          const merged = { ...existing, ...payload };
          localStorage.setItem('makron_api_keys', JSON.stringify(merged));
        } catch {}
      }

      // 2. Persist to server (authenticated user or guest workspace session)
      const res = await fetch('/api/auth/keys', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ apiKeys: payload }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save API keys');
      }

      setSaved(true);
      setKeysInput({});
      await loadKeyStatus();
      if (onKeysUpdated) onKeysUpdated(payload);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message || 'Error updating keys');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl max-w-lg w-full p-6 shadow-2xl relative max-h-[88vh] flex flex-col">
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-blue-500" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Model API Keys Vault
          </h2>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4 leading-relaxed">
          Configure API credentials for external model vendors. Stored securely in your database account and used to empower both platform workflows and your published custom agents.
        </p>

        {error && (
          <div className="mb-4 p-2.5 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
            {error}
          </div>
        )}

        {saved && (
          <div className="mb-4 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-1.5">
            <Check className="w-4 h-4" />
            <span>API credentials saved securely to your database account.</span>
          </div>
        )}

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto pr-1 space-y-3.5">
          {VENDOR_CONFIGS.map((vendor) => {
            const isConfigured = Boolean(configuredKeys[vendor.id]);
            return (
              <div key={vendor.id} className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {vendor.name}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      ({vendor.defaultModel})
                    </span>
                  </div>
                  {isConfigured && (
                    <span className="text-[10px] text-emerald-500 font-mono flex items-center gap-1">
                      <Check className="w-3 h-3" /> Configured
                    </span>
                  )}
                </div>

                <div className="relative">
                  <Key className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5" />
                  <input
                    type="password"
                    placeholder={isConfigured ? '•••••••••••••••• (Leave blank to keep existing)' : vendor.keyPlaceholder}
                    value={keysInput[vendor.id] || ''}
                    onChange={(e) =>
                      setKeysInput((prev) => ({ ...prev, [vendor.id]: e.target.value }))
                    }
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            );
          })}

          {/* Ollama Server Option */}
          <div className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Ollama Local / Remote Server URL
              </span>
              {configuredKeys.ollamaUrl && (
                <span className="text-[10px] text-emerald-500 font-mono flex items-center gap-1">
                  <Check className="w-3 h-3" /> Configured
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="http://localhost:11434 (or Ngrok URL)"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2 sticky bottom-0 bg-white dark:bg-neutral-900 py-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {loading ? 'Saving...' : 'Save API Keys'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
