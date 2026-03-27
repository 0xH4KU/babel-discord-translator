import { describe, expect, it, vi } from 'vitest';
import { AppMetrics } from '../src/app-metrics.js';
import { createWebhookService, _test } from '../src/webhook-service.js';
import type { WebhookChannelLike, WebhookCollectionLike, WebhookLike } from '../src/webhook-service.js';

function createWebhookCollection(webhooks: WebhookLike[]): WebhookCollectionLike {
    return {
        find(predicate) {
            return webhooks.find(predicate);
        },
    };
}

function createWebhook(overrides: Partial<WebhookLike> = {}): WebhookLike {
    return {
        name: 'Babel',
        owner: { id: 'bot-1' },
        send: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function createChannel(id: string, webhooks: WebhookLike[] = []): WebhookChannelLike {
    return {
        id,
        client: {
            user: { id: 'bot-1' },
        },
        fetchWebhooks: vi.fn().mockResolvedValue(createWebhookCollection(webhooks)),
        createWebhook: vi.fn().mockImplementation(async () => createWebhook()),
    };
}

describe('WebhookService', () => {
    it('should recover from a stale webhook, recreate it, and record metrics', async () => {
        const metrics = new AppMetrics();
        const staleWebhook = createWebhook({
            send: vi.fn().mockRejectedValue({ code: 10015, status: 404 }),
        });
        const refreshedWebhook = createWebhook();
        const channel = createChannel('channel-1');

        (channel.fetchWebhooks as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(createWebhookCollection([staleWebhook]))
            .mockResolvedValueOnce(createWebhookCollection([]));
        (channel.createWebhook as ReturnType<typeof vi.fn>).mockResolvedValue(refreshedWebhook);

        const service = createWebhookService({ metrics });

        await service.sendTranslation({
            channel,
            content: 'Hola mundo',
            username: 'Tester',
            userId: 'user-1',
            guildId: 'guild-1',
            requestId: 'req-1',
        });

        expect(staleWebhook.send).toHaveBeenCalledTimes(1);
        expect(refreshedWebhook.send).toHaveBeenCalledWith({
            content: 'Hola mundo',
            username: 'Tester',
            avatarURL: undefined,
        });
        expect(channel.createWebhook).toHaveBeenCalledWith({
            name: 'Babel',
            reason: 'Babel /translate public output',
        });
        expect(metrics.snapshot().webhookRecreateTotal).toBe(1);
    });

    it('should apply LRU eviction to the cached channel webhooks', async () => {
        const channel1 = createChannel('channel-1', [createWebhook()]);
        const channel2 = createChannel('channel-2', [createWebhook()]);
        const channel3 = createChannel('channel-3', [createWebhook()]);
        const service = createWebhookService({ maxCacheSize: 2 });

        await service.sendTranslation({
            channel: channel1,
            content: 'one',
            username: 'Tester',
            userId: 'user-1',
        });
        await service.sendTranslation({
            channel: channel2,
            content: 'two',
            username: 'Tester',
            userId: 'user-1',
        });
        await service.sendTranslation({
            channel: channel1,
            content: 'three',
            username: 'Tester',
            userId: 'user-1',
        });
        await service.sendTranslation({
            channel: channel3,
            content: 'four',
            username: 'Tester',
            userId: 'user-1',
        });
        await service.sendTranslation({
            channel: channel2,
            content: 'five',
            username: 'Tester',
            userId: 'user-1',
        });

        expect(channel1.fetchWebhooks).toHaveBeenCalledTimes(1);
        expect(channel2.fetchWebhooks).toHaveBeenCalledTimes(2);
        expect(channel3.fetchWebhooks).toHaveBeenCalledTimes(1);
        expect(service.snapshot()).toEqual({
            size: 2,
            maxSize: 2,
            evictions: 2,
        });
    });
});

describe('classifyWebhookError', () => {
    const { classifyWebhookError } = _test;

    it('should classify stale webhook errors as retriable', () => {
        expect(classifyWebhookError({ code: 10015, status: 404 })).toEqual({
            kind: 'stale_webhook',
            retriable: true,
            statusCode: 404,
            discordCode: 10015,
        });
    });

    it('should classify permission failures as non-retriable', () => {
        expect(classifyWebhookError({ code: 50013, status: 403 })).toEqual({
            kind: 'permission_denied',
            retriable: false,
            statusCode: 403,
            discordCode: 50013,
        });
    });
});
