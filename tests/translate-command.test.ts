import { describe, expect, it, vi } from 'vitest';
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
    it('should delegate webhook delivery to the webhook service and delete the deferred reply', async () => {
        const webhookService = {
            sendTranslation: vi.fn().mockResolvedValue(undefined),
        };
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
            webhookService: webhookService as never,
        });

        expect(webhookService.sendTranslation).toHaveBeenCalledWith(expect.objectContaining({
            channel: interaction.channel,
            content: 'Hola mundo',
            username: 'Guild Tester',
            userId: 'user-1',
        }));
        expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    });
});
