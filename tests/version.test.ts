import { describe, expect, it } from 'vitest';
import packageMetadata from '../package.json' with { type: 'json' };
import { getVersionMetadata } from '../src/shared/version.js';

describe('version metadata', () => {
    it('links the package version to releases', () => {
        expect(getVersionMetadata()).toEqual({
            version: packageMetadata.version,
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases',
        });
    });
});
