/**
 * File-based configuration persistence with in-memory defaults.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { StoreData } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

const DEFAULTS: StoreData = {
    vertexAiApiKey: '',
    gcpProject: '',
    gcpLocation: 'global',
    geminiModel: 'gemini-2.5-flash-lite',
    allowedGuildIds: [],
    cooldownSeconds: 5,
    cacheMaxSize: 2000,
    setupComplete: false,
    // Pricing & Budget
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    dailyBudgetUsd: 0,
    tokenUsage: null,
    // Usage history (last 30 days)
    usageHistory: [],
    // Custom translation prompt (empty = use default)
    translationPrompt: '',
    // User language preferences { userId: 'ja' }
    userLanguagePrefs: {},
    // Max input text length (characters)
    maxInputLength: 2000,
    // Max output tokens for Gemini API response
    maxOutputTokens: 1000,
    // Per-guild budget & usage
    guildBudgets: {},
    guildTokenUsage: {},
    guildUsageHistory: {},
};

/**
 * Persistent configuration store backed by a JSON file.
 * Merges file data with defaults on load. Auto-saves on every write.
 */
class ConfigStore {
    data: StoreData;

    constructor() {
        this.data = { ...DEFAULTS };
        this.load();
    }

    /** Load config from disk, merging with defaults. */
    load(): void {
        try {
            if (existsSync(CONFIG_FILE)) {
                const raw = readFileSync(CONFIG_FILE, 'utf-8');
                this.data = { ...DEFAULTS, ...JSON.parse(raw) };
            }
        } catch (err) {
            console.error('[Store] Load error:', (err as Error).message);
        }
    }

    /** Persist current config to disk. */
    save(): void {
        try {
            mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('[Store] Save error:', (err as Error).message);
        }
    }

    /** Get a config value by key. */
    get<K extends keyof StoreData>(key: K): StoreData[K] {
        return this.data[key] ?? DEFAULTS[key];
    }

    /** Set a config value and persist to disk. */
    set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
        this.data[key] = value;
        this.save();
    }

    /** Merge multiple values and persist to disk. */
    update(obj: Partial<StoreData>): void {
        Object.assign(this.data, obj);
        this.save();
    }

    /** Get a shallow copy of all config data. */
    getAll(): StoreData {
        return { ...this.data };
    }

    /** Check if the initial setup wizard has been completed. */
    isSetupComplete(): boolean {
        return this.data.setupComplete === true;
    }
}

export const store = new ConfigStore();
