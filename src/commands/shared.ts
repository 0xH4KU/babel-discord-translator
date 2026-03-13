/**
 * Shared utilities for command handlers.
 */

/**
 * Sanitize error messages before showing to Discord users.
 * Strips API keys, project IDs, and other sensitive info.
 */
export function sanitizeError(message: string): string {
    if (!message) return 'Unknown error';

    // Strip anything that looks like an API key (long alphanumeric strings)
    let sanitized = message.replace(/[A-Za-z0-9_-]{30,}/g, '***');

    // Strip URLs that might contain project IDs
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '[API endpoint]');

    // Truncate to reasonable length
    if (sanitized.length > 200) {
        sanitized = sanitized.slice(0, 200) + '…';
    }

    return sanitized;
}
