import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handleTranslate } from '../src/commands/translate.js';

function createInteraction() {
    return {
        options: {
            getString: vi.fn((name: string) => {
                if (name === 'text') return 'Hello world';
                if (name === 'to') return 'es';
                if (name === 'visibility') return null;
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
        memberPermissions: {
            has: vi.fn(() => true),
        },
        locale: 'en-US',
        channel: { id: 'channel-1', isThread: vi.fn(() => false) },
        reply: vi.fn(),
        deferReply: vi.fn(),
        editReply: vi.fn(),
        deleteReply: vi.fn(),
    };
}

describe('handleTranslate', () => {
    it('should send only the translated text through the public webhook', async () => {
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
                provider: 'openai',
                inputTokens: 8,
                outputTokens: 4,
            }),
        };
        const interaction = createInteraction();

        await handleTranslate(interaction as never, {
            translationService: translationService as never,
            webhookService: webhookService as never,
        });

        expect(webhookService.sendTranslation).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: interaction.channel,
                content: expect.stringContaining('Hola mundo'),
                username: 'Guild Tester',
                userId: 'user-1',
            }),
        );
        expect(webhookService.sendTranslation).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'Hola mundo',
            }),
        );
        expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    });

    it('should send private translations through the deferred ephemeral reply', async () => {
        const webhookService = {
            sendTranslation: vi.fn().mockResolvedValue(undefined),
        };
        const translationService = {
            process: vi.fn().mockResolvedValue({
                status: 'success',
                deferred: true,
                translatedText: 'Hola mundo',
                originalText: 'Hello world',
                cached: true,
                targetLanguage: 'es',
                langSource: 'option',
                provider: 'openai',
                inputTokens: 8,
                outputTokens: 4,
            }),
        };
        const interaction = createInteraction();
        interaction.memberPermissions.has.mockReturnValue(false);
        interaction.options.getString = vi.fn((name: string) => {
            if (name === 'text') return 'Hello world';
            if (name === 'to') return 'es';
            if (name === 'visibility') return 'private';
            return null;
        });

        await handleTranslate(interaction as never, {
            translationService: translationService as never,
            webhookService: webhookService as never,
        });

        expect(webhookService.sendTranslation).not.toHaveBeenCalled();
        expect(interaction.deleteReply).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: 'Hola mundo',
        });
    });

    it('should send public thread translations through the parent webhook', async () => {
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
                provider: 'openai',
                inputTokens: 8,
                outputTokens: 4,
            }),
        };
        const interaction = createInteraction();
        const parent = { id: 'parent-channel' };
        interaction.channel = {
            id: 'thread-1',
            isThread: vi.fn(() => true),
            parent,
        } as never;

        await handleTranslate(interaction as never, {
            translationService: translationService as never,
            webhookService: webhookService as never,
        });

        expect(interaction.memberPermissions.has).toHaveBeenCalledWith(
            PermissionFlagsBits.SendMessagesInThreads,
        );
        expect(webhookService.sendTranslation).toHaveBeenCalledWith(
            expect.objectContaining({ channel: parent, threadId: 'thread-1' }),
        );
    });

    it('should reject public translations before calling the provider without send permission', async () => {
        const webhookService = {
            sendTranslation: vi.fn().mockResolvedValue(undefined),
        };
        const translationService = {
            process: vi.fn(),
        };
        const interaction = createInteraction();
        interaction.memberPermissions.has.mockReturnValue(false);

        await handleTranslate(interaction as never, {
            translationService: translationService as never,
            webhookService: webhookService as never,
        });

        expect(translationService.process).not.toHaveBeenCalled();
        expect(webhookService.sendTranslation).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith({
            content:
                'You need permission to send messages in this channel for a public translation.',
            flags: expect.anything(),
        });
    });
});
