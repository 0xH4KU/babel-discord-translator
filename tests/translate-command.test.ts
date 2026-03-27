import { describe, expect, it, vi } from 'vitest';
import { AppMetrics } from '../src/app-metrics.js';
import { handleTranslate } from '../src/commands/translate.js';

function createInteraction() {
    return {
        options: {
            getString: vi.fn((name: string) => {
                if (name === 'text') return 'Hello world';
                if (name === 'to') return 'es';
                return null;
            }),
        },
        guildId: 'guild-1',
        guild: { name: 'Test Guild' },
        user: {
            id: 'user-1',
            tag: 'user#0001',
            displayName: 'Tester',
            displayAvatarURL: vi.fn(() => 'https://example.com/avatar.png'),
        },
        member: {
            displayName: 'Guild Tester',
        },
        locale: 'en-US',
        channel: { id: 'channel-1' },
        reply: vi.fn(),
        deferReply: vi.fn(),
        editReply: vi.fn(),
        deleteReply: vi.fn(),
    };
}

describe('handleTranslate', () => {
    it('should record webhook recreation when a stale webhook is recovered', async () => {
        const metrics = new AppMetrics();
        const firstWebhook = {
            send: vi.fn().mockRejectedValue({ code: 10015, status: 404 }),
        };
        const secondWebhook = {
            send: vi.fn().mockResolvedValue(undefined),
        };
        const getOrCreateWebhook = vi.fn()
            .mockResolvedValueOnce(firstWebhook)
            .mockResolvedValueOnce(secondWebhook);
        const translationService = {
            process: vi.fn().mockResolvedValue({
                status: 'success',
                deferred: true,
                translatedText: 'Hola mundo',
                originalText: 'Hello world',
                cached: false,
                targetLanguage: 'es',
                langSource: 'option',
            }),
        };
        const interaction = createInteraction();

        await handleTranslate(interaction as never, {
            translationService: translationService as never,
            getOrCreateWebhook: getOrCreateWebhook as never,
            metrics,
        });

        expect(getOrCreateWebhook).toHaveBeenNthCalledWith(1, interaction.channel);
        expect(getOrCreateWebhook).toHaveBeenNthCalledWith(2, interaction.channel, true);
        expect(secondWebhook.send).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Hola mundo',
        }));
        expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
        expect(metrics.snapshot().webhookRecreateTotal).toBe(1);
    });
});
