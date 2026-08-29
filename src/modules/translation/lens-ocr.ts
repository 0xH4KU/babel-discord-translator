import { createHash } from 'node:crypto';
import { detectTextWithCloudVision, type VisionTextResult } from '../../infra/cloud-vision-client.js';
import { store, type VisionQuotaScope } from '../../persistence/store.js';
import { appLogger } from '../../shared/structured-logger.js';
import { configRepository } from '../config/config-repository.js';
import type { TranslationCache } from './cache.js';

const inFlightOcr = new Map<string, Promise<VisionTextResult>>();

interface VisionRequestConfig {
    apiKey: string;
    limit: number;
}

function quotaOwner(scope?: VisionQuotaScope['scope']): string {
    return scope === 'guild'
        ? "This server's Babel Lens"
        : scope === 'user'
          ? 'Your Babel Lens'
          : 'Babel Lens';
}

export function assertVisionAvailable(quotaScope?: VisionQuotaScope): VisionRequestConfig {
    const config = configRepository.getRuntimeConfig();
    const limit = Math.max(Math.floor(config.visionMonthlyImageLimit), 0);
    if (limit === 0) throw new Error('Babel Lens is disabled in Settings.');
    if (
        quotaScope &&
        store.getVisionScopeLimit(quotaScope.scope, quotaScope.scopeId) === 0
    ) {
        throw new Error(`${quotaOwner(quotaScope.scope)} is disabled.`);
    }
    if (!config.visionApiKey) {
        throw new Error('Cloud Vision needs its API key configured in Settings.');
    }
    return { apiKey: config.visionApiKey, limit };
}

export async function detectTextWithBudget(
    image: Buffer,
    ocrCache: TranslationCache,
    requestId: string,
    quotaScope?: VisionQuotaScope,
): Promise<VisionTextResult> {
    const { apiKey, limit } = assertVisionAvailable(quotaScope);
    const hash = createHash('sha256').update(image).digest('hex');
    const cacheKey = `vision:text:v3:${hash}`;
    const cached = ocrCache.get(cacheKey);
    if (cached !== null) return JSON.parse(cached) as VisionTextResult;

    const pending = inFlightOcr.get(cacheKey);
    if (pending) return pending;

    const operation = (async () => {
        const month = new Date().toISOString().slice(0, 7);
        const logger = appLogger.child({ component: 'babel_lens', requestId });
        const quota = store.tryConsumeVisionImage(month, limit, quotaScope);
        if (!quota.consumed) {
            logger.warn('lens.vision.quota_blocked', {
                month,
                scope: quota.blockedBy,
                used: quota.used,
                limit: quota.limit,
            });
            const owner = quotaOwner(quota.blockedBy === 'global' ? undefined : quota.blockedBy);
            throw new Error(`${owner} monthly image limit reached (${quota.used}/${quota.limit}).`);
        }

        logger.info('lens.vision.request.started', {
            month,
            globalUsed: quota.globalUsed,
            globalLimit: limit,
            scope: quotaScope?.scope,
            scopeId: quotaScope?.scopeId,
            scopeUsed: quota.scopeUsed,
        });
        const detected = await detectTextWithCloudVision(image, { apiKey });
        ocrCache.set(cacheKey, JSON.stringify(detected));
        logger.info('lens.vision.request.completed', {
            month,
            globalUsed: quota.globalUsed,
            globalLimit: limit,
            scope: quotaScope?.scope,
            scopeId: quotaScope?.scopeId,
            scopeUsed: quota.scopeUsed,
            detectedCharacters: detected.text.length,
            detectedRegions: detected.regions.length,
        });
        return detected;
    })();

    inFlightOcr.set(cacheKey, operation);
    try {
        return await operation;
    } finally {
        if (inFlightOcr.get(cacheKey) === operation) inFlightOcr.delete(cacheKey);
    }
}
