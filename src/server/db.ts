import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { AgentThemePreset, CustomAgent, PublicAgentOwner, ReasoningLevel, UserTier, VerifiedType } from '../types';

export interface DbUser {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  username?: string;
  avatar?: string;
  tier: UserTier;
  verifiedType?: VerifiedType;
  apiKeys: Record<string, string>;
  sessionToken?: string;
  createdAt: number;
}

import { type SeasonalTheme, SEASONAL_THEMES, PRESET_THEMES } from '../constants/themes';
export { type SeasonalTheme, SEASONAL_THEMES, PRESET_THEMES };

const DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
const hasNeonDb = Boolean(DB_URL && DB_URL.startsWith('postgres'));

const LOCAL_STORE_FILE = path.join(process.cwd(), '.neondb_local_store.json');

interface LocalStore {
  users: DbUser[];
  agents: CustomAgent[];
}

let localStore: LocalStore = {
  users: [],
  agents: [],
};

try {
  if (fs.existsSync(LOCAL_STORE_FILE)) {
    const raw = fs.readFileSync(LOCAL_STORE_FILE, 'utf-8');
    localStore = JSON.parse(raw);
  }
} catch {
  // fresh store
}

function saveLocalStore() {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(localStore, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write local store:', err);
  }
}

const sql = hasNeonDb ? neon(DB_URL) : null;

export async function initDatabase() {
  if (sql) {
    try {
      console.log('[NeonDB] Connecting and verifying schema structure...');
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          username VARCHAR(64),
          avatar TEXT,
          tier VARCHAR(32) DEFAULT 'free',
          verified_type VARCHAR(32),
          api_keys TEXT,
          session_token VARCHAR(128),
          created_at BIGINT
        );
      `;

      // Column additions for users if missing
      try {
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(64);`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_type VARCHAR(32);`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token VARCHAR(128);`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(32) DEFAULT 'free';`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_keys TEXT;`;
      } catch (colErr) {
        console.warn('[NeonDB] Users column verify notice:', colErr);
      }

      await sql`
        CREATE TABLE IF NOT EXISTS agents (
          id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
          custom_name VARCHAR(128) UNIQUE NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          description TEXT,
          avatar TEXT,
          model_id VARCHAR(128),
          gender VARCHAR(32) DEFAULT 'neutral',
          system_prompt TEXT,
          effort_level VARCHAR(32),
          skills TEXT,
          theme_color VARCHAR(64),
          theme_preset VARCHAR(64),
          theme_mode VARCHAR(16) DEFAULT 'dark',
          theme_bg VARCHAR(32),
          theme_card VARCHAR(32),
          theme_text VARCHAR(32),
          allows_file_uploads BOOLEAN DEFAULT false,
          embed_enabled BOOLEAN DEFAULT true,
          created_at BIGINT,
          updated_at BIGINT
        );
      `;

      // Column additions for agents if missing
      try {
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS model_id VARCHAR(128);`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS gender VARCHAR(32) DEFAULT 'neutral';`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_mode VARCHAR(16) DEFAULT 'dark';`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_bg VARCHAR(32);`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_card VARCHAR(32);`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_text VARCHAR(32);`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS allows_file_uploads BOOLEAN DEFAULT false;`;
        await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS embed_enabled BOOLEAN DEFAULT true;`;
      } catch (colErr) {
        console.warn('[NeonDB] Agents column verify notice:', colErr);
      }

      // Structure Integrity Check & Auto-Repair: ensure avatar, prompt, etc are TEXT, not VARCHAR(255)
      try {
        console.log('[NeonDB] Checking structure integrity for column lengths...');
        await sql`ALTER TABLE agents ALTER COLUMN avatar TYPE TEXT;`;
        await sql`ALTER TABLE agents ALTER COLUMN system_prompt TYPE TEXT;`;
        await sql`ALTER TABLE agents ALTER COLUMN description TYPE TEXT;`;
        await sql`ALTER TABLE agents ALTER COLUMN skills TYPE TEXT;`;
        await sql`ALTER TABLE agents ALTER COLUMN display_name TYPE TEXT;`;
        await sql`ALTER TABLE agents ALTER COLUMN model_id TYPE VARCHAR(255);`;

        await sql`ALTER TABLE users ALTER COLUMN avatar TYPE TEXT;`;
        await sql`ALTER TABLE users ALTER COLUMN api_keys TYPE TEXT;`;
        console.log('[NeonDB] Structure integrity check passed: text columns verified as TEXT.');
      } catch (alterErr) {
        console.warn('[NeonDB] Column type alteration notice:', alterErr);
      }

      // Dynamic information_schema scan to guarantee no VARCHAR(255) remains on text fields
      try {
        const columns = await sql`
          SELECT table_name as "tableName", column_name as "columnName", data_type as "dataType"
          FROM information_schema.columns
          WHERE table_name IN ('agents', 'users')
            AND column_name IN ('avatar', 'system_prompt', 'description', 'skills', 'api_keys')
        `;
        for (const c of columns) {
          if (c.dataType !== 'text') {
            console.log(`[NeonDB] Migrating ${c.tableName}.${c.columnName} from ${c.dataType} to TEXT`);
            if (c.tableName === 'agents') {
              if (c.columnName === 'avatar') await sql`ALTER TABLE agents ALTER COLUMN avatar TYPE TEXT;`;
              if (c.columnName === 'system_prompt') await sql`ALTER TABLE agents ALTER COLUMN system_prompt TYPE TEXT;`;
              if (c.columnName === 'description') await sql`ALTER TABLE agents ALTER COLUMN description TYPE TEXT;`;
              if (c.columnName === 'skills') await sql`ALTER TABLE agents ALTER COLUMN skills TYPE TEXT;`;
            } else if (c.tableName === 'users') {
              if (c.columnName === 'avatar') await sql`ALTER TABLE users ALTER COLUMN avatar TYPE TEXT;`;
              if (c.columnName === 'api_keys') await sql`ALTER TABLE users ALTER COLUMN api_keys TYPE TEXT;`;
            }
          }
        }
      } catch (schemaErr) {
        console.warn('[NeonDB] Information schema verification notice:', schemaErr);
      }

      console.log('[NeonDB] Schema and structure integrity verified successfully.');
    } catch (err) {
      console.warn('[NeonDB] Initialization error, falling back to local storage:', err);
    }
  } else {
    console.log('[Database] NeonDB URL not set in environment. Running with local persistent storage fallback.');
  }
}

export const dbService = {
  // --- USERS & SESSIONS ---
  async getUserByEmail(email: string): Promise<DbUser | null> {
    const cleanEmail = email.trim().toLowerCase();
    if (sql) {
      try {
        const rows = await sql`
          SELECT id, email, password_hash as "passwordHash", name, username, avatar, tier,
                 verified_type as "verifiedType", api_keys as "apiKeysJson", session_token as "sessionToken", created_at as "createdAt"
          FROM users WHERE email = ${cleanEmail} LIMIT 1
        `;
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            email: r.email,
            passwordHash: r.passwordHash,
            name: r.name,
            username: r.username,
            avatar: r.avatar,
            tier: (r.tier as UserTier) || 'free',
            verifiedType: (r.verifiedType as VerifiedType) || null,
            apiKeys: r.apiKeysJson ? JSON.parse(r.apiKeysJson) : {},
            sessionToken: r.sessionToken || undefined,
            createdAt: Number(r.createdAt),
          };
        }
        return null;
      } catch (err) {
        console.warn('Neon query error, falling back to local store:', err);
      }
    }

    const u = localStore.users.find((u) => u.email.toLowerCase() === cleanEmail);
    return u ? { ...u } : null;
  },

  async getUserById(id: string): Promise<DbUser | null> {
    if (sql) {
      try {
        const rows = await sql`
          SELECT id, email, password_hash as "passwordHash", name, username, avatar, tier,
                 verified_type as "verifiedType", api_keys as "apiKeysJson", session_token as "sessionToken", created_at as "createdAt"
          FROM users WHERE id = ${id} LIMIT 1
        `;
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            email: r.email,
            passwordHash: r.passwordHash,
            name: r.name,
            username: r.username,
            avatar: r.avatar,
            tier: (r.tier as UserTier) || 'free',
            verifiedType: (r.verifiedType as VerifiedType) || null,
            apiKeys: r.apiKeysJson ? JSON.parse(r.apiKeysJson) : {},
            sessionToken: r.sessionToken || undefined,
            createdAt: Number(r.createdAt),
          };
        }
        return null;
      } catch (err) {
        console.warn('Neon query error, falling back to local store:', err);
      }
    }

    const u = localStore.users.find((u) => u.id === id);
    return u ? { ...u } : null;
  },

  async getUserBySessionToken(token: string): Promise<DbUser | null> {
    if (!token || typeof token !== 'string') return null;
    if (sql) {
      try {
        const rows = await sql`
          SELECT id, email, password_hash as "passwordHash", name, username, avatar, tier,
                 verified_type as "verifiedType", api_keys as "apiKeysJson", session_token as "sessionToken", created_at as "createdAt"
          FROM users WHERE session_token = ${token} LIMIT 1
        `;
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            email: r.email,
            passwordHash: r.passwordHash,
            name: r.name,
            username: r.username,
            avatar: r.avatar,
            tier: (r.tier as UserTier) || 'free',
            verifiedType: (r.verifiedType as VerifiedType) || null,
            apiKeys: r.apiKeysJson ? JSON.parse(r.apiKeysJson) : {},
            sessionToken: r.sessionToken || undefined,
            createdAt: Number(r.createdAt),
          };
        }
        return null;
      } catch (err) {
        console.warn('Neon query error, falling back to local store:', err);
      }
    }

    const u = localStore.users.find((u) => u.sessionToken === token);
    return u ? { ...u } : null;
  },

  async createSession(userId: string): Promise<string> {
    const sessionToken = 'sess_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    if (sql) {
      try {
        await sql`UPDATE users SET session_token = ${sessionToken} WHERE id = ${userId}`;
      } catch (err) {
        console.warn('Neon session update error:', err);
      }
    }

    const u = localStore.users.find((u) => u.id === userId);
    if (u) {
      u.sessionToken = sessionToken;
      saveLocalStore();
    }
    return sessionToken;
  },

  async invalidateSession(token: string): Promise<void> {
    if (!token) return;
    if (sql) {
      try {
        await sql`UPDATE users SET session_token = NULL WHERE session_token = ${token}`;
      } catch (err) {
        console.warn('Neon session invalidate error:', err);
      }
    }
    const u = localStore.users.find((u) => u.sessionToken === token);
    if (u) {
      u.sessionToken = undefined;
      saveLocalStore();
    }
  },

  async createUser(email: string, password: string, name?: string): Promise<{ user: DbUser; sessionToken: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const existing = await this.getUserByEmail(cleanEmail);
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const id = 'usr_' + Math.random().toString(36).substring(2, 11);
    const username = cleanEmail.split('@')[0].replace(/[^a-z0-9_-]/g, '');
    const tier: UserTier = 'free';
    const verifiedType: VerifiedType = null;
    const createdAt = Date.now();
    const apiKeys: Record<string, string> = {};
    const sessionToken = 'sess_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);

    if (sql) {
      try {
        await sql`
          INSERT INTO users (id, email, password_hash, name, username, avatar, tier, verified_type, api_keys, session_token, created_at)
          VALUES (${id}, ${cleanEmail}, ${passwordHash}, ${name || ''}, ${username}, NULL, ${tier}, ${verifiedType}, ${JSON.stringify(apiKeys)}, ${sessionToken}, ${createdAt})
        `;
        const newUser: DbUser = { id, email: cleanEmail, passwordHash, name, username, tier, verifiedType, apiKeys, sessionToken, createdAt };
        return { user: newUser, sessionToken };
      } catch (err) {
        console.warn('Neon insert error, saving to local store:', err);
      }
    }

    const newUser: DbUser = { id, email: cleanEmail, passwordHash, name, username, tier, verifiedType, apiKeys, sessionToken, createdAt };
    localStore.users.push(newUser);
    saveLocalStore();
    return { user: newUser, sessionToken };
  },

  async updateUserProfile(
    userId: string,
    updates: {
      name?: string;
      username?: string;
      email?: string;
      avatar?: string | null;
      verifiedType?: VerifiedType;
    }
  ): Promise<DbUser> {
    const existing = await this.getUserById(userId);
    if (!existing) throw new Error('User not found');

    if (updates.email && updates.email.toLowerCase() !== existing.email.toLowerCase()) {
      const emailClash = await this.getUserByEmail(updates.email.toLowerCase());
      if (emailClash && emailClash.id !== userId) {
        throw new Error('This email is already in use by another account.');
      }
    }

    const updatedUser: DbUser = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      username: updates.username !== undefined ? updates.username : existing.username,
      email: updates.email !== undefined ? updates.email.toLowerCase() : existing.email,
      avatar: updates.avatar !== undefined ? (updates.avatar || undefined) : existing.avatar,
      // Verification type is managed exclusively by platform admins; users cannot self-assign
      verifiedType: existing.verifiedType,
    };

    if (sql) {
      try {
        await sql`
          UPDATE users SET
            name = ${updatedUser.name || ''},
            username = ${updatedUser.username || ''},
            email = ${updatedUser.email},
            avatar = ${updatedUser.avatar || null}
          WHERE id = ${userId}
        `;
      } catch (err) {
        console.warn('Neon profile update error:', err);
      }
    }

    const idx = localStore.users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      localStore.users[idx] = updatedUser;
      saveLocalStore();
    }

    return updatedUser;
  },

  async updateUserApiKeys(userId: string, apiKeys: Record<string, string>): Promise<void> {
    const existing = await this.getUserById(userId);
    if (!existing) return;

    const merged = { ...existing.apiKeys, ...apiKeys };

    if (sql) {
      try {
        await sql`UPDATE users SET api_keys = ${JSON.stringify(merged)} WHERE id = ${userId}`;
      } catch (err) {
        console.warn('Neon update error:', err);
      }
    }

    const u = localStore.users.find((u) => u.id === userId);
    if (u) {
      u.apiKeys = merged;
      saveLocalStore();
    }
  },

  async updateUserTier(userId: string, tier: UserTier): Promise<void> {
    if (sql) {
      try {
        await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
      } catch (err) {
        console.warn('Neon tier update error:', err);
      }
    }

    const u = localStore.users.find((u) => u.id === userId);
    if (u) {
      u.tier = tier;
      saveLocalStore();
    }
  },

  async ensureGuestUser(userId: string = 'guest_user'): Promise<DbUser> {
    const existing = await this.getUserById(userId);
    if (existing) return existing;

    const guestUser: DbUser = {
      id: userId,
      email: `${userId}@makron.local`,
      passwordHash: '',
      name: 'Workspace Creator',
      username: 'creator',
      avatar: 'ꫧ',
      tier: 'free',
      verifiedType: null,
      apiKeys: {},
      createdAt: Date.now(),
    };

    if (sql) {
      try {
        await sql`
          INSERT INTO users (id, email, password_hash, name, username, avatar, tier, verified_type, api_keys, created_at)
          VALUES (${guestUser.id}, ${guestUser.email}, ${guestUser.passwordHash}, ${guestUser.name || null}, ${guestUser.username || null}, ${guestUser.avatar || null}, ${guestUser.tier}, ${guestUser.verifiedType || null}, ${JSON.stringify(guestUser.apiKeys)}, ${guestUser.createdAt})
          ON CONFLICT (id) DO NOTHING
        `;
      } catch (err) {
        console.warn('Neon guest user creation notice:', err);
      }
    }

    if (!localStore.users.some((u) => u.id === userId)) {
      localStore.users.push(guestUser);
      saveLocalStore();
    }

    return guestUser;
  },

  // --- AGENTS ---
  async getAgentsByUserId(userId: string): Promise<CustomAgent[]> {
    if (sql) {
      try {
        const rows = await sql`
          SELECT id, user_id as "userId", custom_name as "customName", display_name as "displayName",
                 description, avatar, model_id as "modelId", gender, system_prompt as "systemPrompt",
                 effort_level as "effortLevel", skills as "skillsJson", theme_color as "themeColor",
                 theme_preset as "themePreset", theme_mode as "themeMode", theme_bg as "themeBg",
                 theme_card as "themeCard", theme_text as "themeText",
                 allows_file_uploads as "allowsFileUploads", embed_enabled as "embedEnabled",
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM agents WHERE user_id = ${userId} ORDER BY created_at DESC
        `;
        const neonAgents = rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          customName: r.customName,
          displayName: r.displayName,
          description: r.description || '',
          avatar: r.avatar || 'ꫧ',
          modelId: r.modelId || 'gemini-2.5-flash',
          gender: (r.gender as 'male' | 'female' | 'neutral') || 'neutral',
          systemPrompt: r.systemPrompt || '',
          effortLevel: (r.effortLevel as ReasoningLevel) || 'auto',
          skills: r.skillsJson ? JSON.parse(r.skillsJson) : [],
          themeColor: r.themeColor || '#8b5cf6',
          themePreset: (r.themePreset as AgentThemePreset) || 'winter_midnight',
          themeMode: (r.themeMode as 'light' | 'dark') || 'dark',
          themeBg: r.themeBg || undefined,
          themeCard: r.themeCard || undefined,
          themeText: r.themeText || undefined,
          allowsFileUploads: Boolean(r.allowsFileUploads),
          embedEnabled: Boolean(r.embedEnabled),
          createdAt: Number(r.createdAt),
          updatedAt: Number(r.updatedAt),
        }));

        // Merge with any localStore agents for this user that may have been created during temporary db issues
        const neonIds = new Set(neonAgents.map((a) => a.id));
        const neonSlugs = new Set(neonAgents.map((a) => a.customName.toLowerCase()));
        const missingLocal = localStore.agents.filter(
          (a) => a.userId === userId && !neonIds.has(a.id) && !neonSlugs.has(a.customName.toLowerCase())
        );

        return [...neonAgents, ...missingLocal];
      } catch (err) {
        console.warn('Neon get agents error:', err);
      }
    }

    return localStore.agents.filter((a) => a.userId === userId);
  },

  async getAgentByCustomName(customName: string): Promise<CustomAgent | null> {
    const slug = customName.trim().toLowerCase();
    let agentRecord: CustomAgent | null = null;
    let ownerUserId = '';

    if (sql) {
      try {
        const rows = await sql`
          SELECT id, user_id as "userId", custom_name as "customName", display_name as "displayName",
                 description, avatar, model_id as "modelId", gender, system_prompt as "systemPrompt",
                 effort_level as "effortLevel", skills as "skillsJson", theme_color as "themeColor",
                 theme_preset as "themePreset", theme_mode as "themeMode", theme_bg as "themeBg",
                 theme_card as "themeCard", theme_text as "themeText",
                 allows_file_uploads as "allowsFileUploads", embed_enabled as "embedEnabled",
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM agents WHERE LOWER(custom_name) = ${slug} LIMIT 1
        `;
        if (rows.length > 0) {
          const r = rows[0];
          ownerUserId = r.userId;
          agentRecord = {
            id: r.id,
            userId: r.userId,
            customName: r.customName,
            displayName: r.displayName,
            description: r.description || '',
            avatar: r.avatar || 'ꫧ',
            modelId: r.modelId || 'gemini-2.5-flash',
            gender: (r.gender as 'male' | 'female' | 'neutral') || 'neutral',
            systemPrompt: r.systemPrompt || '',
            effortLevel: (r.effortLevel as ReasoningLevel) || 'auto',
            skills: r.skillsJson ? JSON.parse(r.skillsJson) : [],
            themeColor: r.themeColor || '#8b5cf6',
            themePreset: (r.themePreset as AgentThemePreset) || 'winter_midnight',
            themeMode: (r.themeMode as 'light' | 'dark') || 'dark',
            themeBg: r.themeBg || undefined,
            themeCard: r.themeCard || undefined,
            themeText: r.themeText || undefined,
            allowsFileUploads: Boolean(r.allowsFileUploads),
            embedEnabled: Boolean(r.embedEnabled),
            createdAt: Number(r.createdAt),
            updatedAt: Number(r.updatedAt),
          };
        }
      } catch (err) {
        console.warn('Neon get agent by name error:', err);
      }
    }

    if (!agentRecord) {
      const a = localStore.agents.find((a) => a.customName.toLowerCase() === slug);
      if (a) {
        agentRecord = { ...a };
        ownerUserId = a.userId;
      }
    }

    if (agentRecord && ownerUserId) {
      // Fetch public owner metadata
      const ownerUser = await this.getUserById(ownerUserId);
      if (ownerUser) {
        agentRecord.owner = {
          name: ownerUser.name || ownerUser.email.split('@')[0],
          username: ownerUser.username || ownerUser.email.split('@')[0],
          avatar: ownerUser.avatar,
          verifiedType: ownerUser.verifiedType,
        };
      }

      const localMatch = localStore.agents.find((a) => a.customName.toLowerCase() === slug);
      if (localMatch?.initialMessages) {
        agentRecord.initialMessages = localMatch.initialMessages;
      }
    }

    return agentRecord;
  },

  async getAgentById(id: string): Promise<CustomAgent | null> {
    if (sql) {
      try {
        const rows = await sql`
          SELECT id, user_id as "userId", custom_name as "customName", display_name as "displayName",
                 description, avatar, model_id as "modelId", gender, system_prompt as "systemPrompt",
                 effort_level as "effortLevel", skills as "skillsJson", theme_color as "themeColor",
                 theme_preset as "themePreset", theme_mode as "themeMode", theme_bg as "themeBg",
                 theme_card as "themeCard", theme_text as "themeText",
                 allows_file_uploads as "allowsFileUploads", embed_enabled as "embedEnabled",
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM agents WHERE id = ${id} LIMIT 1
        `;
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            userId: r.userId,
            customName: r.customName,
            displayName: r.displayName,
            description: r.description || '',
            avatar: r.avatar || 'ꫧ',
            modelId: r.modelId || 'gemini-2.5-flash',
            gender: (r.gender as 'male' | 'female' | 'neutral') || 'neutral',
            systemPrompt: r.systemPrompt || '',
            effortLevel: (r.effortLevel as ReasoningLevel) || 'auto',
            skills: r.skillsJson ? JSON.parse(r.skillsJson) : [],
            themeColor: r.themeColor || '#8b5cf6',
            themePreset: (r.themePreset as AgentThemePreset) || 'winter_midnight',
            themeMode: (r.themeMode as 'light' | 'dark') || 'dark',
            themeBg: r.themeBg || undefined,
            themeCard: r.themeCard || undefined,
            themeText: r.themeText || undefined,
            allowsFileUploads: Boolean(r.allowsFileUploads),
            embedEnabled: Boolean(r.embedEnabled),
            createdAt: Number(r.createdAt),
            updatedAt: Number(r.updatedAt),
          };
        }
        return null;
      } catch (err) {
        console.warn('Neon get agent by id error:', err);
      }
    }

    const a = localStore.agents.find((a) => a.id === id);
    return a ? { ...a } : null;
  },

  async createAgent(
    userId: string,
    agentData: Omit<CustomAgent, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<CustomAgent> {
    const user = await this.getUserById(userId);
    if (!user) throw new Error('User not found');

    const userAgents = await this.getAgentsByUserId(userId);
    const maxAgents = user.tier === 'paid' ? 100 : 3;

    if (userAgents.length >= maxAgents) {
      throw new Error(`Agent limit reached for your account.`);
    }

    const cleanSlug = agentData.customName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanSlug) throw new Error('A valid custom name identifier is required.');

    const existingSlug = await this.getAgentByCustomName(cleanSlug);
    if (existingSlug) {
      throw new Error(`The custom name "${cleanSlug}" is already taken. Please choose another.`);
    }

    const id = 'agt_' + Math.random().toString(36).substring(2, 11);
    const now = Date.now();

    // Seasonal theme resolution
    let themePreset = agentData.themePreset || 'winter_midnight';
    const seasonalPreset = SEASONAL_THEMES[themePreset];

    let themeColor = seasonalPreset ? seasonalPreset.color : agentData.themeColor || '#8b5cf6';
    let themeMode: 'light' | 'dark' = seasonalPreset ? seasonalPreset.mode : 'dark';
    let themeBg = seasonalPreset ? seasonalPreset.bg : undefined;
    let themeCard = seasonalPreset ? seasonalPreset.card : undefined;
    let themeText = seasonalPreset ? seasonalPreset.text : undefined;

    if (user.tier === 'free') {
      if (!seasonalPreset && !PRESET_THEMES[themePreset]) {
        themePreset = 'winter_midnight';
      }
      if (SEASONAL_THEMES[themePreset]) {
        const s = SEASONAL_THEMES[themePreset];
        themeColor = s.color;
        themeMode = s.mode;
        themeBg = s.bg;
        themeCard = s.card;
        themeText = s.text;
      }
    } else if (themePreset === 'custom') {
      themeColor = agentData.themeColor || '#3b82f6';
      themeMode = agentData.themeMode || 'dark';
    }

    const newAgent: CustomAgent = {
      id,
      userId,
      customName: cleanSlug,
      displayName: agentData.displayName.trim() || cleanSlug,
      description: agentData.description || '',
      avatar: agentData.avatar || 'ꫧ',
      modelId: agentData.modelId || 'gemini-2.5-flash',
      gender: agentData.gender || 'neutral',
      systemPrompt: agentData.systemPrompt || '',
      effortLevel: agentData.effortLevel || 'auto',
      skills: agentData.skills || ['code_execution', 'file_generation'],
      themeColor,
      themePreset,
      themeMode,
      themeBg,
      themeCard,
      themeText,
      allowsFileUploads: Boolean(agentData.allowsFileUploads),
      embedEnabled: agentData.embedEnabled !== false,
      initialMessages: agentData.initialMessages,
      createdAt: now,
      updatedAt: now,
    };

    if (sql) {
      try {
        await sql`
          INSERT INTO agents (
            id, user_id, custom_name, display_name, description, avatar,
            model_id, gender, system_prompt, effort_level, skills,
            theme_color, theme_preset, theme_mode, theme_bg, theme_card, theme_text,
            allows_file_uploads, embed_enabled, created_at, updated_at
          ) VALUES (
            ${newAgent.id}, ${newAgent.userId}, ${newAgent.customName}, ${newAgent.displayName},
            ${newAgent.description}, ${newAgent.avatar}, ${newAgent.modelId}, ${newAgent.gender},
            ${newAgent.systemPrompt}, ${newAgent.effortLevel}, ${JSON.stringify(newAgent.skills)},
            ${newAgent.themeColor}, ${newAgent.themePreset}, ${newAgent.themeMode},
            ${newAgent.themeBg || null}, ${newAgent.themeCard || null}, ${newAgent.themeText || null},
            ${newAgent.allowsFileUploads}, ${newAgent.embedEnabled},
            ${newAgent.createdAt}, ${newAgent.updatedAt}
          )
        `;
        // Keep local mirror updated
        localStore.agents = [newAgent, ...localStore.agents.filter((a) => a.id !== newAgent.id)];
        saveLocalStore();
        return newAgent;
      } catch (err: any) {
        console.warn('Neon create agent error:', err);
        // If error is about character varying(255) / code 22001, auto-repair and retry immediately
        if (String(err?.message || '').includes('character varying') || err?.code === '22001') {
          try {
            console.log('[NeonDB] Structure repair: modifying avatar and text columns to TEXT and retrying INSERT...');
            await sql`ALTER TABLE agents ALTER COLUMN avatar TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN system_prompt TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN description TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN skills TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN display_name TYPE TEXT;`;

            await sql`
              INSERT INTO agents (
                id, user_id, custom_name, display_name, description, avatar,
                model_id, gender, system_prompt, effort_level, skills,
                theme_color, theme_preset, theme_mode, theme_bg, theme_card, theme_text,
                allows_file_uploads, embed_enabled, created_at, updated_at
              ) VALUES (
                ${newAgent.id}, ${newAgent.userId}, ${newAgent.customName}, ${newAgent.displayName},
                ${newAgent.description}, ${newAgent.avatar}, ${newAgent.modelId}, ${newAgent.gender},
                ${newAgent.systemPrompt}, ${newAgent.effortLevel}, ${JSON.stringify(newAgent.skills)},
                ${newAgent.themeColor}, ${newAgent.themePreset}, ${newAgent.themeMode},
                ${newAgent.themeBg || null}, ${newAgent.themeCard || null}, ${newAgent.themeText || null},
                ${newAgent.allowsFileUploads}, ${newAgent.embedEnabled},
                ${newAgent.createdAt}, ${newAgent.updatedAt}
              )
            `;
            localStore.agents = [newAgent, ...localStore.agents.filter((a) => a.id !== newAgent.id)];
            saveLocalStore();
            return newAgent;
          } catch (retryErr) {
            console.error('[NeonDB] Auto-repair retry failed:', retryErr);
          }
        }
      }
    }

    localStore.agents.push(newAgent);
    saveLocalStore();
    return newAgent;
  },

  async updateAgent(
    id: string,
    userId: string,
    updates: Partial<Omit<CustomAgent, 'id' | 'userId' | 'createdAt'>>
  ): Promise<CustomAgent> {
    const user = await this.getUserById(userId);
    if (!user) throw new Error('User not found');

    const existing = await this.getAgentById(id);
    if (!existing) throw new Error('Agent not found');
    if (existing.userId !== userId) throw new Error('Unauthorized');

    if (updates.customName && updates.customName.toLowerCase() !== existing.customName.toLowerCase()) {
      const cleanSlug = updates.customName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const clash = await this.getAgentByCustomName(cleanSlug);
      if (clash && clash.id !== id) {
        throw new Error(`The custom name "${cleanSlug}" is already taken.`);
      }
      updates.customName = cleanSlug;
    }

    if (updates.themePreset && SEASONAL_THEMES[updates.themePreset]) {
      const s = SEASONAL_THEMES[updates.themePreset];
      updates.themeColor = s.color;
      updates.themeMode = s.mode;
      updates.themeBg = s.bg;
      updates.themeCard = s.card;
      updates.themeText = s.text;
    }

    const updated: CustomAgent = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    if (sql) {
      try {
        await sql`
          UPDATE agents SET
            custom_name = ${updated.customName},
            display_name = ${updated.displayName},
            description = ${updated.description},
            avatar = ${updated.avatar},
            model_id = ${updated.modelId || 'gemini-2.5-flash'},
            gender = ${updated.gender || 'neutral'},
            system_prompt = ${updated.systemPrompt},
            effort_level = ${updated.effortLevel},
            skills = ${JSON.stringify(updated.skills)},
            theme_color = ${updated.themeColor},
            theme_preset = ${updated.themePreset},
            theme_mode = ${updated.themeMode || 'dark'},
            theme_bg = ${updated.themeBg || null},
            theme_card = ${updated.themeCard || null},
            theme_text = ${updated.themeText || null},
            allows_file_uploads = ${updated.allowsFileUploads},
            embed_enabled = ${updated.embedEnabled},
            updated_at = ${updated.updatedAt}
          WHERE id = ${id} AND user_id = ${userId}
        `;
        const idx = localStore.agents.findIndex((a) => a.id === id);
        if (idx >= 0) localStore.agents[idx] = updated;
        saveLocalStore();
        return updated;
      } catch (err: any) {
        console.warn('Neon update agent error:', err);
        if (String(err?.message || '').includes('character varying') || err?.code === '22001') {
          try {
            console.log('[NeonDB] Structure repair during update: modifying text columns to TEXT and retrying...');
            await sql`ALTER TABLE agents ALTER COLUMN avatar TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN system_prompt TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN description TYPE TEXT;`;
            await sql`ALTER TABLE agents ALTER COLUMN skills TYPE TEXT;`;

            await sql`
              UPDATE agents SET
                custom_name = ${updated.customName},
                display_name = ${updated.displayName},
                description = ${updated.description},
                avatar = ${updated.avatar},
                model_id = ${updated.modelId || 'gemini-2.5-flash'},
                gender = ${updated.gender || 'neutral'},
                system_prompt = ${updated.systemPrompt},
                effort_level = ${updated.effortLevel},
                skills = ${JSON.stringify(updated.skills)},
                theme_color = ${updated.themeColor},
                theme_preset = ${updated.themePreset},
                theme_mode = ${updated.themeMode || 'dark'},
                theme_bg = ${updated.themeBg || null},
                theme_card = ${updated.themeCard || null},
                theme_text = ${updated.themeText || null},
                allows_file_uploads = ${updated.allowsFileUploads},
                embed_enabled = ${updated.embedEnabled},
                updated_at = ${updated.updatedAt}
              WHERE id = ${id} AND user_id = ${userId}
            `;
            const idx = localStore.agents.findIndex((a) => a.id === id);
            if (idx >= 0) localStore.agents[idx] = updated;
            saveLocalStore();
            return updated;
          } catch (retryErr) {
            console.error('[NeonDB] Update retry failed:', retryErr);
          }
        }
      }
    }

    const idx = localStore.agents.findIndex((a) => a.id === id);
    if (idx >= 0) {
      localStore.agents[idx] = updated;
      saveLocalStore();
    }
    return updated;
  },

  async deleteAgent(id: string, userId: string): Promise<boolean> {
    if (sql) {
      try {
        await sql`DELETE FROM agents WHERE id = ${id} AND user_id = ${userId}`;
        return true;
      } catch (err) {
        console.warn('Neon delete agent error:', err);
      }
    }

    const before = localStore.agents.length;
    localStore.agents = localStore.agents.filter((a) => !(a.id === id && a.userId === userId));
    saveLocalStore();
    return localStore.agents.length < before;
  },
};
