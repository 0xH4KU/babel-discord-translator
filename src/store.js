/**
 * File-based configuration persistence with in-memory defaults.
 * @module store
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

/** @type {Record<string, unknown>} */
const DEFAULTS = {
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
};

/**
 * Persistent configuration store backed by a JSON file.
 * Merges file data with defaults on load. Auto-saves on every write.
 */
class ConfigStore {
    constructor() {
        /** @type {Record<string, unknown>} */
        this.data = { ...DEFAULTS };
        this.load();
    }

    /** Load config from disk, merging with defaults. */
    load() {
        try {
            if (existsSync(CONFIG_FILE)) {
                const raw = readFileSync(CONFIG_FILE, 'utf-8');
                this.data = { ...DEFAULTS, ...JSON.parse(raw) };
            }
        } catch (err) {
            console.error('[Store] Load error:', err.message);
        }
    }

    /** Persist current config to disk. */
    save() {
        try {
            mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('[Store] Save error:', err.message);
        }
    }

    /**
     * Get a config value by key.
     * @param {string} key
     * @returns {unknown}
     */
    get(key) {
        return this.data[key] ?? DEFAULTS[key];
    }

    /**
     * Set a config value and persist to disk.
     * @param {string} key
     * @param {unknown} value
     */
    set(key, value) {
        this.data[key] = value;
        this.save();
    }

    /**
     * Merge multiple values and persist to disk.
     * @param {Record<string, unknown>} obj
     */
    update(obj) {
        Object.assign(this.data, obj);
        this.save();
    }

    /**
     * Get a shallow copy of all config data.
     * @returns {Record<string, unknown>}
     */
    getAll() {
        return { ...this.data };
    }

    /**
     * Check if the initial setup wizard has been completed.
     * @returns {boolean}
     */
    isSetupComplete() {
        return this.data.setupComplete === true;
    }
}

export const store = new ConfigStore();
