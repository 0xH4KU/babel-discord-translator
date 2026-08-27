import packageMetadata from '../../package.json' with { type: 'json' };

export const APP_VERSION = packageMetadata.version;
export const REPOSITORY_URL = 'https://github.com/0xH4KU/babel-discord-translator';

export interface VersionMetadata {
    version: string;
    repositoryUrl: string;
}

export function getVersionMetadata(): VersionMetadata {
    return {
        version: APP_VERSION,
        repositoryUrl: `${REPOSITORY_URL}/releases`,
    };
}
