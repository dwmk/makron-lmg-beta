export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
  modelId: string;
  // Custom Agent & Published Frontend derivative fields
  isPublished?: boolean;
  publishedSlug?: string;
  publishedAgentId?: string;
  avatar?: string; // Mini-sized avatar for custom agents (emoji or base64 data URL)
  themePreset?: AgentThemePreset;
  themeColor?: string;
  themeMode?: 'light' | 'dark';
  description?: string;
  gender?: 'male' | 'female' | 'neutral';
  skills?: string[];
  effortLevel?: ReasoningLevel;
  allowsFileUploads?: boolean;
  embedEnabled?: boolean;
  includeHistory?: boolean;
}

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string;
  extractedText?: string;
}

export interface RoadmapStep {
  id: string;
  title: string;
  description: string;
  requiredTools?: string[];
  expectedOutput?: string;
  dependencies?: string[];
}

export interface Roadmap {
  objective: string;
  steps: RoadmapStep[];
  completionCriteria: string[];
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  params: Record<string, any>;
  result?: any;
  error?: string;
  approved?: boolean;
  status: 'pending_approval' | 'running' | 'success' | 'error' | 'denied';
}

export interface ExecutionStepRecord {
  id: string;
  stepNumber: number;
  title: string;
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  startTime?: number;
  endTime?: number;
  toolCalls?: ToolCallRecord[];
  output?: string;
  error?: string;
  fileChanges?: {
    path: string;
    action: 'create' | 'update' | 'delete';
  }[];
}

export interface ReviewResult {
  passed: boolean;
  completenessScore?: number;
  observations: string[];
  repairNeeded: boolean;
  repairNotes?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: AttachedFile[];
  roadmap?: Roadmap;
  executionSteps?: ExecutionStepRecord[];
  reviewResult?: ReviewResult;
  status?: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
}

export interface VirtualFile {
  id: string;
  conversationId: string;
  path: string;
  content: string;
  mimeType: string;
  updatedAt: number;
  size: number;
  version: number;
}

export interface Checkpoint {
  id: string;
  conversationId: string;
  name: string;
  timestamp: number;
  files: Record<string, string>; // path -> content
}

export type ModelProvider =
  | 'local'
  | 'ollama'
  | 'openai'
  | 'gemini'
  | 'claude'
  | 'grok'
  | 'groq'
  | 'qwen'
  | 'deepseek'
  | 'zai'
  | 'huggingface';

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  sizeLabel: string;
  defaultDtype: 'fp32' | 'fp16' | 'q8' | 'q4';
  recommendedDevice: 'webgpu' | 'wasm';
  contextWindow: number;
  isCustom?: boolean;
  provider?: ModelProvider;
  providerLogo?: string;
  supportsVision?: boolean;
}

export interface UserSettings {
  theme: 'dark' | 'light';
  defaultModelId: string;
  devicePreference: 'webgpu' | 'wasm';
  autoApproveTools: boolean;
  lastNonEmptySystemPrompt: string;
  maxRepairAttempts: number;
  hfToken?: string;
  apiKeys?: Record<string, string>;
  vendorModels?: Record<string, string>;
  ollamaUrl?: string;
}

export type ExecutionState =
  | 'idle'
  | 'downloading_model'
  | 'planning'
  | 'running'
  | 'waiting_approval'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ReasoningLevel = 'auto' | 'low' | 'med' | 'high' | 'max';

export interface AgentCapabilities {
  allowInternet: boolean;
  allowTools: boolean;
  allowFiles: boolean;
  allowImage?: boolean;
  autoCapabilities: boolean;
}

export type UserTier = 'free' | 'paid';

export type VerifiedType = 'paid' | 'celeb' | 'dev' | 'founder' | null;

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  username?: string;
  avatar?: string;
  tier: UserTier;
  verifiedType?: VerifiedType;
  agentCount?: number;
  apiKeysConfigured?: string[];
}

export type AgentThemePreset =
  | 'spring_blossom'
  | 'spring_mint'
  | 'spring_rain'
  | 'summer_sun'
  | 'summer_ocean'
  | 'summer_sunset'
  | 'autumn_maple'
  | 'autumn_harvest'
  | 'autumn_hearth'
  | 'winter_frost'
  | 'winter_midnight'
  | 'winter_aurora'
  | 'slate'
  | 'emerald'
  | 'indigo'
  | 'crimson'
  | 'amber'
  | 'violet'
  | 'custom';

export interface PublicAgentOwner {
  name?: string;
  username?: string;
  avatar?: string;
  verifiedType?: VerifiedType;
}

export interface CustomAgent {
  id: string;
  userId: string;
  customName: string; // The URL slug: /agent/{custom-name}
  displayName: string;
  description?: string;
  avatar: string; // Base64 image data URL or emoji/symbol
  modelId?: string; // Selected model for agent inference
  gender?: 'male' | 'female' | 'neutral'; // Gender for text-to-speech voice
  systemPrompt: string; // Context & knowledge base
  effortLevel: ReasoningLevel;
  skills: string[]; // e.g. ['code_execution', 'file_generation', 'web_search', 'doc_extract']
  themeColor: string; // Primary hex color
  themePreset: AgentThemePreset;
  themeMode?: 'light' | 'dark';
  themeBg?: string;
  themeCard?: string;
  themeText?: string;
  allowsFileUploads: boolean;
  embedEnabled: boolean;
  initialMessages?: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }>;
  owner?: PublicAgentOwner;
  createdAt: number;
  updatedAt: number;
}

