export const APP_VERSION = '0.1.0';

export const REPOSITORY_URL = 'https://github.com/0xH4KU/babel-discord-translator';

export function getVersionMetadata(): { version: string; repositoryUrl: string } {
    return {
        version: APP_VERSION,
        repositoryUrl: REPOSITORY_URL,
    };
}
