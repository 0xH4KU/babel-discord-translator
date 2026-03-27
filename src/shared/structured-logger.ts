import { randomUUID } from 'crypto';

export type StructuredLogLevel = 'info' | 'warn' | 'error';

export interface StructuredLogFields {
    requestId?: string;
    guildId?: string | null;
    userId?: string;
    command?: string;
    component?: string;
    [key: string]: unknown;
}

export interface StructuredLogger {
    log(event: string, fields?: StructuredLogFields): void;
    info(event: string, fields?: StructuredLogFields): void;
    warn(event: string, fields?: StructuredLogFields): void;
    error(event: string, fields?: StructuredLogFields): void;
    child(fields: StructuredLogFields): StructuredLogger;
}

interface StructuredLoggerSink {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

interface CreateStructuredLoggerOptions {
    baseFields?: StructuredLogFields;
    sink?: StructuredLoggerSink;
}

const SECRET_FIELD_PATTERN = /(api[-_]?key|token|password|secret|authorization|cookie)/i;
const DEFAULT_SINK: StructuredLoggerSink = process.env.NODE_ENV === 'test'
    ? {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    }
    : console;

function sanitizeMessageString(value: string): string {
    let sanitized = value.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]');
    sanitized = sanitized.replace(/[A-Za-z0-9_-]{30,}/g, '[REDACTED_SECRET]');

    if (sanitized.length > 500) {
        return sanitized.slice(0, 500) + '…';
    }

    return sanitized;
}

function sanitizeString(key: string, value: string): string {
    if (SECRET_FIELD_PATTERN.test(key) && key !== 'requestId') {
        return '[REDACTED]';
    }

    if (/error|message|detail|reason/i.test(key)) {
        return sanitizeMessageString(value);
    }

    if (value.length > 500) {
        return value.slice(0, 500) + '…';
    }

    return value.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]');
}

function sanitizeValue(key: string, value: unknown): unknown {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        return sanitizeString(key, value);
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: sanitizeMessageString(value.message),
        };
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(key, item));
    }

    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).flatMap(([childKey, childValue]) => {
                const sanitized = sanitizeValue(childKey, childValue);
                return sanitized === undefined ? [] : [[childKey, sanitized]];
            }),
        );
    }

    return String(value);
}

function sanitizeFields(fields: StructuredLogFields): StructuredLogFields {
    return Object.fromEntries(
        Object.entries(fields).flatMap(([key, value]) => {
            const sanitized = sanitizeValue(key, value);
            return sanitized === undefined ? [] : [[key, sanitized]];
        }),
    );
}

export function createStructuredLogger({
    baseFields = {},
    sink = DEFAULT_SINK,
}: CreateStructuredLoggerOptions = {}): StructuredLogger {
    const emit = (level: StructuredLogLevel, event: string, fields: StructuredLogFields = {}): void => {
        const payload = sanitizeFields({
            timestamp: new Date().toISOString(),
            level,
            event,
            ...baseFields,
            ...fields,
        });

        const message = JSON.stringify(payload);
        if (level === 'info') {
            sink.info(message);
            return;
        }

        sink[level](message);
    };

    return {
        log(event: string, fields?: StructuredLogFields): void {
            emit('info', event, fields);
        },
        info(event: string, fields?: StructuredLogFields): void {
            emit('info', event, fields);
        },
        warn(event: string, fields?: StructuredLogFields): void {
            emit('warn', event, fields);
        },
        error(event: string, fields?: StructuredLogFields): void {
            emit('error', event, fields);
        },
        child(fields: StructuredLogFields): StructuredLogger {
            return createStructuredLogger({
                baseFields: {
                    ...baseFields,
                    ...fields,
                },
                sink,
            });
        },
    };
}

export function createRequestId(): string {
    return randomUUID();
}

export const appLogger = createStructuredLogger();
