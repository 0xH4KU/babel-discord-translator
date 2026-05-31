interface MessageEmbedLike {
    title?: string | null;
    description?: string | null;
    fields?: Array<{ name?: string | null; value?: string | null }> | null;
}

interface MessageAttachmentLike {
    name?: string | null;
    filename?: string | null;
    description?: string | null;
}

interface MessageReferenceLike {
    messageId?: string | null;
}

interface MessageLike {
    content?: string | null;
    embeds?: MessageEmbedLike[] | null;
    attachments?:
        | { map(fn: (attachment: MessageAttachmentLike) => string): string[] }
        | MessageAttachmentLike[]
        | null;
    reference?: MessageReferenceLike | null;
}

function cleanPart(value: string | null | undefined): string | null {
    const cleaned = value?.trim();
    return cleaned ? cleaned : null;
}

function attachmentParts(attachments: MessageLike['attachments']): string[] {
    if (!attachments) {
        return [];
    }

    const render = (attachment: MessageAttachmentLike): string => {
        const name = cleanPart(attachment.name) ?? cleanPart(attachment.filename);
        const description = cleanPart(attachment.description);

        if (!name) {
            return '';
        }

        return description ? `Attachment: ${name} - ${description}` : `Attachment: ${name}`;
    };

    const rendered = Array.isArray(attachments) ? attachments.map(render) : attachments.map(render);
    return rendered.map((part) => part.trim()).filter(Boolean);
}

export function extractTranslatableMessageText(message: MessageLike): string {
    const content = cleanPart(message.content);
    if (content) {
        return content;
    }

    const parts: string[] = [];

    for (const embed of message.embeds ?? []) {
        const title = cleanPart(embed.title);
        const description = cleanPart(embed.description);

        if (title) parts.push(title);
        if (description) parts.push(description);

        for (const field of embed.fields ?? []) {
            const name = cleanPart(field.name);
            const value = cleanPart(field.value);

            if (name && value) {
                parts.push(`${name}: ${value}`);
            } else if (name || value) {
                parts.push(name ?? value!);
            }
        }
    }

    parts.push(...attachmentParts(message.attachments));

    const referencedMessageId = cleanPart(message.reference?.messageId);
    if (referencedMessageId) {
        parts.push(`Referenced message: ${referencedMessageId}`);
    }

    return parts.join('\n').trim();
}
