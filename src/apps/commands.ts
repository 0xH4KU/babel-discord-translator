import type { AppProfile } from './app-profile.js';

interface DiscordCommandChoice {
    name: string;
    value: string;
}

interface DiscordCommandOption {
    name: string;
    description: string;
    type: number;
    required?: boolean;
    choices?: DiscordCommandChoice[];
}

export interface DiscordCommand {
    name: string;
    type: number;
    description?: string;
    integration_types?: number[];
    contexts?: number[];
    options?: DiscordCommandOption[];
}

const INTEGRATION_USER_INSTALL = 1;
const CONTEXT_GUILD = 0;
const CONTEXT_BOT_DM = 1;
const CONTEXT_PRIVATE_CHANNEL = 2;

const USER_INSTALL_COMMAND_CONTEXT = {
    integration_types: [INTEGRATION_USER_INSTALL],
    contexts: [CONTEXT_GUILD, CONTEXT_BOT_DM, CONTEXT_PRIVATE_CHANNEL],
};

const LANGUAGE_CHOICES = [
    { name: '繁體中文', value: 'zh-TW' },
    { name: '简体中文', value: 'zh-CN' },
    { name: 'English', value: 'en' },
    { name: '日本語', value: 'ja' },
    { name: '한국어', value: 'ko' },
    { name: 'Español', value: 'es' },
    { name: 'Français', value: 'fr' },
    { name: 'Deutsch', value: 'de' },
    { name: 'Português', value: 'pt' },
    { name: 'Русский', value: 'ru' },
    { name: 'Italiano', value: 'it' },
    { name: 'Tiếng Việt', value: 'vi' },
    { name: 'ไทย', value: 'th' },
    { name: 'العربية', value: 'ar' },
    { name: 'Bahasa Indonesia', value: 'id' },
];

const SETLANG_LANGUAGE_CHOICES = [
    { name: 'Auto (use Discord locale)', value: 'auto' },
    ...LANGUAGE_CHOICES,
];

const TRANSLATE_LANGUAGE_CHOICES = [{ name: 'Auto', value: 'auto' }, ...LANGUAGE_CHOICES];

function withInstallContext(profile: AppProfile): Partial<DiscordCommand> {
    return profile.accessMode === 'user-install' ? USER_INSTALL_COMMAND_CONTEXT : {};
}

export function getCommandsForProfile(profile: AppProfile): DiscordCommand[] {
    const context = withInstallContext(profile);
    const commands: DiscordCommand[] = [
        {
            name: profile.commandName,
            type: 3,
            ...context,
        },
        {
            name: 'setlang',
            type: 1,
            description: 'Set your preferred translation language',
            ...context,
            options: [
                {
                    name: 'language',
                    description: 'Target language',
                    type: 3,
                    required: true,
                    choices: SETLANG_LANGUAGE_CHOICES,
                },
            ],
        },
    ];

    if (profile.enableTranslateCommand) {
        commands.push({
            name: 'translate',
            type: 1,
            description: 'Translate text',
            options: [
                {
                    name: 'text',
                    description: 'Text to translate',
                    type: 3,
                    required: true,
                },
                {
                    name: 'to',
                    description: 'Target language',
                    type: 3,
                    required: false,
                    choices: TRANSLATE_LANGUAGE_CHOICES,
                },
                {
                    name: 'visibility',
                    description: 'Where to send the translation',
                    type: 3,
                    required: false,
                    choices: [
                        { name: 'Public channel message', value: 'public' },
                        { name: 'Private ephemeral reply', value: 'private' },
                    ],
                },
            ],
        });
    }

    commands.push(
        {
            name: 'help',
            type: 1,
            description: `Show how to use ${profile.productName}`,
            ...context,
        },
        {
            name: 'mylang',
            type: 1,
            description: 'Check your current translation language',
            ...context,
        },
    );

    return commands;
}
