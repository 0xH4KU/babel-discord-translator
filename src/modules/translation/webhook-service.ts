import { appLogger, type StructuredLogger } from '../../shared/structured-logger.js';
import type { AppMetricsCollector } from '../../shared/app-metrics.js';

const DEFAULT_WEBHOOK_NAME = 'Babel';
const DEFAULT_WEBHOOK_REASON = 'Babel /translate public output';
const DEFAULT_WEBHOOK_CACHE_MAX_SIZE = 200;

export interface WebhookOwnerLike {
    id?: string;
}

export interface WebhookLike {
    name?: string;
    owner?: WebhookOwnerLike | null;
    send(payload: { content: string; username: string; avatarURL?: string }): Promise<unknown>;
}

export interface WebhookCollectionLike<TWebhook extends WebhookLike = WebhookLike> {
    find(predicate: (webhook: TWebhook) => boolean): TWebhook | undefined;
}

export interface WebhookChannelLike<TWebhook extends WebhookLike = WebhookLike> {
    id: string;
    client: {
        user: {
            id: string;
        } | null;
    };
    fetchWebhooks(): Promise<WebhookCollectionLike<TWebhook>>;
    createWebhook(options: { name: string; reason: string }): Promise<TWebhook>;
}

export interface TranslationWebhookSendRequest<TWebhook extends WebhookLike = WebhookLike> {
    channel: WebhookChannelLike<TWebhook>;
    content: string;
    username: string;
    avatarURL?: string;
    requestId?: string;
    guildId?: string | null;
    userId: string;
}

export interface WebhookCacheSnapshot {
    size: number;
    maxSize: number;
    evictions: number;
}

export type WebhookErrorKind = 'stale_webhook' | 'permission_denied' | 'unknown';

export interface ClassifiedWebhookError {
    kind: WebhookErrorKind;
    retriable: boolean;
    statusCode: number | null;
    discordCode: number | null;
}

export interface TranslationWebhookService {
    sendTranslation(request: TranslationWebhookSendRequest): Promise<void>;
    snapshot(): WebhookCacheSnapshot;
}

export interface WebhookServiceDeps {
    metrics?: AppMetricsCollector;
    maxCacheSize?: number;
    logger?: StructuredLogger;
}

export function classifyWebhookError(error: unknown): ClassifiedWebhookError {
    const details = error as { code?: number; status?: number } | null;
    const discordCode = typeof details?.code === 'number' ? details.code : null;
    const statusCode = typeof details?.status === 'number' ? details.status : null;

    if (discordCode === 10015 || statusCode === 404) {
        return {
            kind: 'stale_webhook',
            retriable: true,
            statusCode,
            discordCode,
        };
    }

    if (discordCode === 50001 || discordCode === 50013 || statusCode === 403) {
        return {
            kind: 'permission_denied',
            retriable: false,
            statusCode,
            discordCode,
        };
    }

    return {
        kind: 'unknown',
        retriable: false,
        statusCode,
        discordCode,
    };
}

export function createWebhookService({
    metrics,
    maxCacheSize = DEFAULT_WEBHOOK_CACHE_MAX_SIZE,
    logger = appLogger.child({ component: 'webhook_service' }),
}: WebhookServiceDeps = {}): TranslationWebhookService {
    const cache = new Map<string, WebhookLike>();
    let evictions = 0;

    const deleteCachedWebhook = (channelId: string): void => {
        cache.delete(channelId);
    };

    const getCachedWebhook = (channelId: string): WebhookLike | null => {
        const webhook = cache.get(channelId);
        if (!webhook) {
            return null;
        }

        cache.delete(channelId);
        cache.set(channelId, webhook);
        return webhook;
    };

    const cacheWebhook = (channelId: string, webhook: WebhookLike): void => {
        if (cache.has(channelId)) {
            cache.delete(channelId);
        } else if (cache.size >= maxCacheSize) {
            const oldestChannelId = cache.keys().next().value;
            if (oldestChannelId !== undefined) {
                cache.delete(oldestChannelId);
                evictions += 1;
            }
        }

        cache.set(channelId, webhook);
    };

    const getOrCreateWebhook = async <TWebhook extends WebhookLike>(
        channel: WebhookChannelLike<TWebhook>,
        forceRefresh: boolean = false,
    ): Promise<TWebhook> => {
        if (forceRefresh) {
            deleteCachedWebhook(channel.id);
        }

        const cached = getCachedWebhook(channel.id);
        if (cached) {
            return cached as TWebhook;
        }

        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find((candidate) => candidate.name === DEFAULT_WEBHOOK_NAME && candidate.owner?.id === channel.client.user?.id);

        if (!webhook) {
            webhook = await channel.createWebhook({
                name: DEFAULT_WEBHOOK_NAME,
                reason: DEFAULT_WEBHOOK_REASON,
            });
        }

        cacheWebhook(channel.id, webhook);
        return webhook;
    };

    return {
        async sendTranslation({
            channel,
            content,
            username,
            avatarURL,
            requestId,
            guildId,
            userId,
        }: TranslationWebhookSendRequest): Promise<void> {
            const requestLogger = logger.child({
                requestId,
                guildId: guildId ?? null,
                userId,
                channelId: channel.id,
            });

            requestLogger.info('translate.webhook.send.started');

            try {
                let webhook = await getOrCreateWebhook(channel);

                try {
                    await webhook.send({ content, username, avatarURL });
                    requestLogger.info('translate.webhook.send.completed', {
                        recoveredFromStaleWebhook: false,
                    });
                    return;
                } catch (error) {
                    const classified = classifyWebhookError(error);
                    if (classified.kind !== 'stale_webhook') {
                        throw error;
                    }

                    requestLogger.warn('translate.webhook.stale', {
                        statusCode: classified.statusCode,
                        discordCode: classified.discordCode,
                    });
                    metrics?.recordWebhookRecreate();

                    webhook = await getOrCreateWebhook(channel, true);
                    await webhook.send({ content, username, avatarURL });
                    requestLogger.info('translate.webhook.send.completed', {
                        recoveredFromStaleWebhook: true,
                    });
                }
            } catch (error) {
                const classified = classifyWebhookError(error);
                requestLogger.error('translate.webhook.send.failed', {
                    error: (error as Error).message,
                    errorKind: classified.kind,
                    retriable: classified.retriable,
                    statusCode: classified.statusCode,
                    discordCode: classified.discordCode,
                });
                throw error;
            }
        },
        snapshot(): WebhookCacheSnapshot {
            return {
                size: cache.size,
                maxSize: maxCacheSize,
                evictions,
            };
        },
    };
}

export const _test = {
    classifyWebhookError,
};
