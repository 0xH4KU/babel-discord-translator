import {
    MessageFlags,
    type Attachment,
    type MessageContextMenuCommandInteraction,
} from 'discord.js';
import { BABEL_GUILD_PROFILE, type AppProfile } from '../apps/app-profile.js';
import { configRepository } from '../modules/config/config-repository.js';
import {
    assertVisionAvailable,
    detectTextWithBudget,
} from '../modules/translation/lens-ocr.js';
import { renderLensImage } from '../modules/translation/lens-image.js';
import {
    formatDetectedText,
    normalizeRegionTranslation,
} from '../modules/translation/lens-regions.js';
import { type TranslationCache } from '../modules/translation/cache.js';
import type { TranslationRuntimeLimiter } from '../modules/translation/translation-runtime-limiter.js';
import { buildTranslationMessages } from '../shared/discord-message-format.js';
import { appLogger, createRequestId } from '../shared/structured-logger.js';
import type { VisionQuotaScope } from '../persistence/store.js';
import type { VisionTextResult } from '../infra/cloud-vision-client.js';
import type { CommandDeps } from '../shared/types.js';

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const ALLOWED_IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface BabelLensCommandDeps extends CommandDeps {
    ocrCache: TranslationCache;
    renderLimiter: TranslationRuntimeLimiter;
    profile?: AppProfile;
}

function getUserInstallOwnerId(interaction: MessageContextMenuCommandInteraction): string | null {
    return interaction.authorizingIntegrationOwners?.['1'] ?? null;
}

function isSupportedImage(attachment: Attachment): boolean {
    const contentType = attachment.contentType?.split(';', 1)[0]?.toLowerCase();
    return contentType
        ? SUPPORTED_IMAGE_TYPES.has(contentType)
        : /\.(?:jpe?g|png|webp)$/iu.test(attachment.name ?? '');
}

function findImageAttachment(interaction: MessageContextMenuCommandInteraction): Attachment {
    const attachment = interaction.targetMessage.attachments.find(isSupportedImage);
    if (!attachment) {
        throw new Error(
            'Babel Lens needs a PNG, JPEG, or WebP attachment on the selected message.',
        );
    }
    if (attachment.size > MAX_IMAGE_BYTES) {
        throw new Error('Babel Lens supports images up to 7 MB.');
    }
    if (
        attachment.width &&
        attachment.height &&
        attachment.width * attachment.height > MAX_IMAGE_PIXELS
    ) {
        throw new Error('Babel Lens supports images up to 16 megapixels.');
    }
    return attachment;
}

async function downloadDiscordImage(attachment: Attachment): Promise<Buffer> {
    const url = new URL(attachment.url);
    if (url.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) {
        throw new Error('Babel Lens only accepts images hosted by Discord.');
    }

    const response = await fetch(url, {
        signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Could not download the image (${response.status}).`);

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) {
        throw new Error('Babel Lens supports images up to 7 MB.');
    }

    const image = Buffer.from(await response.arrayBuffer());
    if (image.length === 0) throw new Error('The selected image is empty.');
    if (image.length > MAX_IMAGE_BYTES) {
        throw new Error('Babel Lens supports images up to 7 MB.');
    }
    return image;
}

async function sendLensReply(
    interaction: MessageContextMenuCommandInteraction,
    translatedText: string,
    image?: Buffer,
): Promise<void> {
    if (image) {
        await interaction.editReply({
            files: [{ attachment: image, name: 'babel-lens.jpg' }],
        });
        return;
    }

    const messages = buildTranslationMessages({
        originalText: '',
        translatedText,
        targetLanguage: '',
        cached: false,
    });
    await interaction.editReply({
        content: messages[0] ?? '',
    });

    for (const message of messages.slice(1)) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    }
}

export async function handleBabelLens(
    interaction: MessageContextMenuCommandInteraction,
    {
        translationService,
        ocrCache,
        renderLimiter,
        profile = BABEL_GUILD_PROFILE,
    }: BabelLensCommandDeps,
): Promise<void> {
    if (
        profile.accessMode === 'guild' &&
        (!interaction.guildId ||
            !configRepository.getRuntimeConfig().lensEnabledGuildIds.includes(interaction.guildId))
    ) {
        await interaction.reply({
            content: 'Babel Lens is not enabled for this server.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    let attachment: Attachment;
    try {
        attachment = findImageAttachment(interaction);
    } catch (error) {
        await interaction.reply({
            content: (error as Error).message,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const requestId = createRequestId();
    const billingUserId =
        profile.accessMode === 'user-install'
            ? (getUserInstallOwnerId(interaction) ?? interaction.user.id)
            : null;
    const visionQuotaScope: VisionQuotaScope =
        profile.accessMode === 'guild'
            ? { scope: 'guild', scopeId: interaction.guildId! }
            : { scope: 'user', scopeId: billingUserId! };
    let sourceImage: Buffer | null = null;
    let detectedText: VisionTextResult | null = null;
    const result = await translationService.process({
        command: 'babel',
        commandLabel: 'Babel Lens (context menu)',
        guildId: interaction.guildId,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        billingUserId,
        userTag: interaction.user.tag,
        locale: interaction.locale,
        requestId,
        preserveNumberedMarkers: true,
        resolveText: async () => {
            assertVisionAvailable(visionQuotaScope);
            sourceImage = await downloadDiscordImage(attachment);
            detectedText = await detectTextWithBudget(
                sourceImage,
                ocrCache,
                requestId,
                visionQuotaScope,
            );
            if (!detectedText.text) throw new Error('Cloud Vision found no text in this image.');
            return formatDetectedText(detectedText);
        },
        beforeTranslate: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    });

    if (result.status === 'blocked') {
        if (result.deferred) await interaction.editReply({ content: result.message });
        else await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        return;
    }
    if (result.status === 'error') {
        if (result.deferred) await interaction.editReply({ content: result.message });
        else await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        return;
    }

    // The resolver mutates this value inside TranslationService.process().
    const resolvedDetectedText = detectedText as VisionTextResult | null;
    const { markersMatch, displayText } = normalizeRegionTranslation(
        result.translatedText,
        resolvedDetectedText?.regions.length ?? 0,
    );
    if (!markersMatch) {
        appLogger.child({ component: 'babel_lens', requestId }).warn(
            'lens.translation.markers_invalid',
            {
                expectedMarkers: resolvedDetectedText?.regions.length ?? 0,
                translatedLength: result.translatedText.length,
            },
        );
    }

    const renderAdmission = renderLimiter.acquire({
        guildId: interaction.guildId,
        userId: billingUserId ?? interaction.user.id,
    });
    if (!renderAdmission.accepted) {
        appLogger
            .child({ component: 'babel_lens', requestId })
            .warn('lens.render.capacity_rejected', {
                reason: renderAdmission.reason,
                runtime: renderAdmission.snapshot,
            });
        await sendLensReply(interaction, displayText);
        return;
    }

    try {
        const rendered = await renderAdmission.reservation.run(() =>
            renderLensImage(
                sourceImage!,
                displayText,
                markersMatch ? (resolvedDetectedText ?? undefined) : undefined,
            ),
        );
        await sendLensReply(interaction, displayText, rendered);
    } catch (error) {
        appLogger.child({ component: 'babel_lens', requestId }).error('lens.render.failed', {
            error: (error as Error).message,
        });
        await sendLensReply(interaction, displayText);
    }
}

export const _test = {
    findImageAttachment,
    downloadDiscordImage,
    detectTextWithBudget,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
};
