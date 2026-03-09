import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

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
};

class ConfigStore {
    constructor() {
        this.data = { ...DEFAULTS };
        this.load();
    }

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

    save() {
        try {
            mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('[Store] Save error:', err.message);
        }
    }

    get(key) {
        return this.data[key] ?? DEFAULTS[key];
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
    }

    update(obj) {
        Object.assign(this.data, obj);
        this.save();
    }

    getAll() {
        return { ...this.data };
    }

    isSetupComplete() {
        return this.data.setupComplete === true;
    }
}

export const store = new ConfigStore();
