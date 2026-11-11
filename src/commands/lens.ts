import { sendPrivateChunks, replyToTranslationFailure } from '../shared/discord-reply.js';
import {
    MessageFlags,
    type Attachment,
    type MessageContextMenuCommandInteraction,
} from 'discord.js';
import { BABEL_GUILD_PROFILE, type AppProfile } from '../apps/app-profile.js';
import { configRepository } from '../modules/config/config-repository.js';
import { detectTextWithBudget } from '../modules/translation/lens-ocr.js';
import { normalizeLensImage, renderLensImage } from '../modules/translation/lens-image.js';
import { type TranslationCache } from '../modules/translation/cache.js';
import type { TranslationRuntimeLimiter } from '../modules/translation/translation-runtime-limiter.js';
import { buildTranslationMessages } from '../shared/discord-message-format.js';
import { appLogger, createRequestId } from '../shared/structured-logger.js';
import type { VisionQuotaScope } from '../persistence/store.js';
import type { CommandDeps } from '../shared/types.js';

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const ALLOWED_IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const EXTERNAL_PROXY_HOST_PATTERN = /^images-ext-\d+\.discordapp\.net$/iu;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UNSUPPORTED_EMBED_MEDIA_PATTERN = /\.(?:gif|mp4|webm|mov|avi)(?:$|[?#])|[?&]format=gif\b/iu;

interface BabelLensCommandDeps extends CommandDeps {
    ocrCache: TranslationCache;
    renderLimiter: TranslationRuntimeLimiter;
    profile?: AppProfile;
}

export interface LensImageSource {
    url: string;
    size?: number;
    width?: number | null;
    height?: number | null;
}

interface EmbedMediaCandidate {
    url?: string | null;
    proxyURL?: string | null;
    width?: number | null;
    height?: number | null;
    contentType?: string | null;
}

interface EmbedCandidate {
    image?: EmbedMediaCandidate | null;
    thumbnail?: EmbedMediaCandidate | null;
}

interface SnapshotCandidate {
    attachments?: unknown;
    embeds?: Iterable<EmbedCandidate> | null;
}

function isAllowedDiscordImageHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return ALLOWED_IMAGE_HOSTS.has(normalized) || EXTERNAL_PROXY_HOST_PATTERN.test(normalized);
}

function isSupportedImage(attachment: Attachment): boolean {
    const contentType = attachment.contentType?.split(';', 1)[0]?.toLowerCase();
    return contentType
        ? SUPPORTED_IMAGE_TYPES.has(contentType)
        : /\.(?:jpe?g|png|webp)$/iu.test(attachment.name ?? attachment.url ?? '');
}

function validateSourceLimits(source: LensImageSource): LensImageSource {
    if (source.size !== undefined && source.size > MAX_IMAGE_BYTES) {
        throw new Error('Babel Lens supports images up to 7 MB.');
    }
    if (source.width && source.height && source.width * source.height > MAX_IMAGE_PIXELS) {
        throw new Error('Babel Lens supports images up to 16 megapixels.');
    }
    return source;
}

function findInCollection<T>(
    collection: unknown,
    predicate: (value: T) => boolean,
): T | undefined {
    if (!collection || typeof collection !== 'object') return undefined;
    if ('find' in collection && typeof collection.find === 'function') {
        return (collection as { find: (fn: (value: T) => boolean) => T | undefined }).find(
            predicate,
        );
    }
    if (Symbol.iterator in collection) {
        for (const item of collection as Iterable<T>) {
            if (predicate(item)) return item;
        }
    }
    return undefined;
}

function valuesOf<T>(collection: unknown): Iterable<T> {
    if (!collection || typeof collection !== 'object') return [];
    if ('values' in collection && typeof collection.values === 'function') {
        return (collection as { values: () => Iterable<T> }).values();
    }
    if (Symbol.iterator in collection) {
        return collection as Iterable<T>;
    }
    return [];
}

function pickEmbedMedia(media?: EmbedMediaCandidate | null): LensImageSource | null {
    if (!media) return null;
    const contentType = media.contentType?.split(';', 1)[0]?.toLowerCase();
    if (contentType && !SUPPORTED_IMAGE_TYPES.has(contentType)) return null;

    const candidates = [media.proxyURL, media.url].filter((value): value is string =>
        Boolean(value?.trim()),
    );
    for (const candidateUrl of candidates) {
        if (!contentType && UNSUPPORTED_EMBED_MEDIA_PATTERN.test(candidateUrl)) continue;
        try {
            const parsed = new URL(candidateUrl);
            if (parsed.protocol === 'https:' && isAllowedDiscordImageHost(parsed.hostname)) {
                return {
                    url: candidateUrl,
                    width: media.width,
                    height: media.height,
                };
            }
        } catch {
            continue;
        }
    }
    return null;
}

function findEmbedImage(embeds?: Iterable<EmbedCandidate> | null): LensImageSource | null {
    if (!embeds) return null;
    for (const embed of embeds) {
        const found = pickEmbedMedia(embed.image) ?? pickEmbedMedia(embed.thumbnail);
        if (found) return found;
    }
    return null;
}

function findImageAttachment(interaction: MessageContextMenuCommandInteraction): LensImageSource {
    const directAttachment = findInCollection<Attachment>(
        interaction.targetMessage.attachments,
        isSupportedImage,
    );
    if (directAttachment) {
        return validateSourceLimits({
            url: directAttachment.url,
            size: directAttachment.size,
            width: directAttachment.width,
            height: directAttachment.height,
        });
    }

    const snapshots = (interaction.targetMessage as { messageSnapshots?: unknown })
        .messageSnapshots;
    for (const snapshot of valuesOf<SnapshotCandidate>(snapshots)) {
        const snapAttachment = findInCollection<Attachment>(snapshot.attachments, isSupportedImage);
        if (snapAttachment) {
            return validateSourceLimits({
                url: snapAttachment.url,
                size: snapAttachment.size,
                width: snapAttachment.width,
                height: snapAttachment.height,
            });
        }
        const snapEmbed = findEmbedImage(snapshot.embeds);
        if (snapEmbed) return validateSourceLimits(snapEmbed);
    }

    const directEmbed = findEmbedImage(
        (interaction.targetMessage as { embeds?: Iterable<EmbedCandidate> | null }).embeds,
    );
    if (directEmbed) return validateSourceLimits(directEmbed);

    throw new Error('Babel Lens needs a PNG, JPEG, or WebP image on the selected message.');
}

async function downloadDiscordImage(source: LensImageSource): Promise<Buffer> {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !isAllowedDiscordImageHost(url.hostname)) {
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
    const messages = buildTranslationMessages({
        originalText: '',
        translatedText,
        targetLanguage: '',
        cached: false,
    });
    if (image) {
        await interaction.editReply({
            content: messages[0] ?? '',
            files: [{ attachment: image, name: 'babel-lens.jpg' }],
        });
        for (const message of messages.slice(1)) {
            await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        }
        return;
    }

    await sendPrivateChunks(interaction, messages);
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

    let imageSource: LensImageSource;
    try {
        imageSource = findImageAttachment(interaction);
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
            ? (interaction.authorizingIntegrationOwners?.['1'] ?? interaction.user.id)
            : null;
    const visionQuotaScope: VisionQuotaScope =
        profile.accessMode === 'guild'
            ? { scope: 'guild', scopeId: interaction.guildId! }
            : { scope: 'user', scopeId: billingUserId! };
    let sourceImage: Buffer | null = null;
    const result = await translationService.processImage({
        command: 'babel',
        commandLabel: 'Babel Lens (context menu)',
        guildId: interaction.guildId,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        billingUserId,
        userTag: interaction.user.tag,
        locale: interaction.locale,
        requestId,
        resolveImage: async () => {
            const normalized = await normalizeLensImage(await downloadDiscordImage(imageSource));
            sourceImage = normalized.image;
            return normalized;
        },
        resolveVision: (image) =>
            detectTextWithBudget(image, ocrCache, requestId, visionQuotaScope),
        beforeTranslate: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    });

    if (result.status !== 'success') {
        await replyToTranslationFailure(interaction, result);
        return;
    }

    if (!result.hasText) {
        await sendLensReply(interaction, 'Babel Lens found no meaningful text in this image.');
        return;
    }

    if (result.regions.length === 0) {
        await sendLensReply(interaction, result.translatedText);
        return;
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
        await sendLensReply(interaction, result.translatedText);
        return;
    }

    try {
        const rendered = await renderAdmission.reservation.run(() =>
            renderLensImage(sourceImage!, result.regions),
        );
        await sendLensReply(interaction, result.translatedText, rendered);
    } catch (error) {
        appLogger.child({ component: 'babel_lens', requestId }).error('lens.render.failed', {
            error: (error as Error).message,
        });
        await sendLensReply(interaction, result.translatedText);
    }
}

export const _test = {
    findImageAttachment,
    downloadDiscordImage,
    detectTextWithBudget,
    normalizeLensImage,
    isAllowedDiscordImageHost,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
};
