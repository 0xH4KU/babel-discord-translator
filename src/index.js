import { Client, Events, GatewayIntentBits, MessageFlags, EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { store } from './store.js';
import { translate } from './translate.js';
import { TranslationCache } from './cache.js';
import { CooldownManager } from './cooldown.js';
import { TranslationLog } from './log.js';
import { usage } from './usage.js';
import { startDashboard } from './dashboard.js';

// --- State ---
const cache = new TranslationCache(store.get('cacheMaxSize'));
const cooldown = new CooldownManager(store.get('cooldownSeconds'));
const log = new TranslationLog();
let totalTranslations = 0;
let apiCalls = 0;

// --- /help localized strings ---
const HELP_TEXTS = {
    en: {
        title: '📖 How to Use Babel',
        translate: ['🔄 Translate a Message', 'Right-click a message → Apps → **Babel**'],
        quick: ['✏️ Quick Translate', '`/translate` — Type text directly to translate'],
        setlang: ['🌍 Set Your Language', '`/setlang` — Choose your preferred target language'],
        tips: ['💡 Tips', '• Translations are private (only you can see them)\n• Your language is auto-detected from Discord settings'],
    },
    zh: {
        title: '📖 如何使用 Babel',
        translate: ['🔄 翻譯訊息', '右鍵點擊訊息 → 應用程式 → **Babel**'],
        quick: ['✏️ 快速翻譯', '`/translate` — 直接輸入文字翻譯'],
        setlang: ['🌍 設定語言', '`/setlang` — 選擇你偏好的翻譯目標語言'],
        tips: ['💡 小提示', '• 翻譯結果僅你可見\n• 語言會從 Discord 設定自動偵測'],
    },
    ja: {
        title: '📖 Babel の使い方',
        translate: ['🔄 メッセージを翻訳', 'メッセージを右クリック → アプリ → **Babel**'],
        quick: ['✏️ クイック翻訳', '`/translate` — テキストを直接入力して翻訳'],
        setlang: ['🌍 言語設定', '`/setlang` — 翻訳先の言語を選択'],
        tips: ['💡 ヒント', '• 翻訳結果はあなただけに表示されます\n• 言語は Discord の設定から自動検出されます'],
    },
    ko: {
        title: '📖 Babel 사용법',
        translate: ['🔄 메시지 번역', '메시지 우클릭 → 앱 → **Babel**'],
        quick: ['✏️ 빠른 번역', '`/translate` — 텍스트를 직접 입력하여 번역'],
        setlang: ['🌍 언어 설정', '`/setlang` — 원하는 번역 대상 언어를 선택'],
        tips: ['💡 팁', '• 번역 결과는 본인에게만 보입니다\n• 언어는 Discord 설정에서 자동 감지됩니다'],
    },
    es: {
        title: '📖 Cómo usar Babel',
        translate: ['🔄 Traducir un mensaje', 'Clic derecho en un mensaje → Apps → **Babel**'],
        quick: ['✏️ Traducción rápida', '`/translate` — Escribe texto directamente para traducir'],
        setlang: ['🌍 Configurar idioma', '`/setlang` — Elige tu idioma de traducción preferido'],
        tips: ['💡 Consejos', '• Las traducciones son privadas (solo tú las ves)\n• Tu idioma se detecta automáticamente desde Discord'],
    },
    fr: {
        title: '📖 Comment utiliser Babel',
        translate: ['🔄 Traduire un message', 'Clic droit sur un message → Apps → **Babel**'],
        quick: ['✏️ Traduction rapide', '`/translate` — Tapez du texte directement pour traduire'],
        setlang: ['🌍 Définir la langue', '`/setlang` — Choisissez votre langue cible préférée'],
        tips: ['💡 Astuces', '• Les traductions sont privées (vous seul les voyez)\n• Votre langue est détectée automatiquement depuis Discord'],
    },
    de: {
        title: '📖 So verwendest du Babel',
        translate: ['🔄 Nachricht übersetzen', 'Rechtsklick auf eine Nachricht → Apps → **Babel**'],
        quick: ['✏️ Schnellübersetzung', '`/translate` — Text direkt eingeben zum Übersetzen'],
        setlang: ['🌍 Sprache einstellen', '`/setlang` — Wähle deine bevorzugte Zielsprache'],
        tips: ['💡 Tipps', '• Übersetzungen sind privat (nur für dich sichtbar)\n• Deine Sprache wird automatisch aus Discord erkannt'],
    },
    pt: {
        title: '📖 Como usar o Babel',
        translate: ['🔄 Traduzir mensagem', 'Clique direito numa mensagem → Apps → **Babel**'],
        quick: ['✏️ Tradução rápida', '`/translate` — Digite texto diretamente para traduzir'],
        setlang: ['🌍 Definir idioma', '`/setlang` — Escolha seu idioma de tradução preferido'],
        tips: ['💡 Dicas', '• As traduções são privadas (só você vê)\n• Seu idioma é detectado automaticamente pelo Discord'],
    },
    ru: {
        title: '📖 Как пользоваться Babel',
        translate: ['🔄 Перевести сообщение', 'ПКМ по сообщению → Приложения → **Babel**'],
        quick: ['✏️ Быстрый перевод', '`/translate` — Введите текст для перевода'],
        setlang: ['🌍 Установить язык', '`/setlang` — Выберите предпочтительный язык перевода'],
        tips: ['💡 Подсказки', '• Переводы видны только вам\n• Язык определяется автоматически из настроек Discord'],
    },
    it: {
        title: '📖 Come usare Babel',
        translate: ['🔄 Traduci un messaggio', 'Clic destro su un messaggio → App → **Babel**'],
        quick: ['✏️ Traduzione rapida', '`/translate` — Scrivi testo direttamente per tradurre'],
        setlang: ['🌍 Imposta lingua', '`/setlang` — Scegli la tua lingua di traduzione preferita'],
        tips: ['💡 Suggerimenti', '• Le traduzioni sono private (solo tu le vedi)\n• La lingua viene rilevata automaticamente da Discord'],
    },
    vi: {
        title: '📖 Cách sử dụng Babel',
        translate: ['🔄 Dịch tin nhắn', 'Nhấp chuột phải vào tin nhắn → Ứng dụng → **Babel**'],
        quick: ['✏️ Dịch nhanh', '`/translate` — Nhập văn bản trực tiếp để dịch'],
        setlang: ['🌍 Cài đặt ngôn ngữ', '`/setlang` — Chọn ngôn ngữ dịch ưa thích'],
        tips: ['💡 Mẹo', '• Bản dịch là riêng tư (chỉ bạn nhìn thấy)\n• Ngôn ngữ được phát hiện tự động từ Discord'],
    },
    th: {
        title: '📖 วิธีใช้ Babel',
        translate: ['🔄 แปลข้อความ', 'คลิกขวาที่ข้อความ → แอป → **Babel**'],
        quick: ['✏️ แปลด่วน', '`/translate` — พิมพ์ข้อความเพื่อแปลโดยตรง'],
        setlang: ['🌍 ตั้งค่าภาษา', '`/setlang` — เลือกภาษาเป้าหมายที่ต้องการ'],
        tips: ['💡 เคล็ดลับ', '• ผลแปลเป็นส่วนตัว (เฉพาะคุณเห็น)\n• ภาษาตรวจจับอัตโนมัติจาก Discord'],
    },
    ar: {
        title: '📖 كيفية استخدام Babel',
        translate: ['🔄 ترجمة رسالة', 'انقر بزر الماوس الأيمن → التطبيقات → **Babel**'],
        quick: ['✏️ ترجمة سريعة', '`/translate` — اكتب النص مباشرة للترجمة'],
        setlang: ['🌍 تعيين اللغة', '`/setlang` — اختر لغة الترجمة المفضلة'],
        tips: ['💡 نصائح', '• الترجمات خاصة (أنت فقط تراها)\n• يتم اكتشاف لغتك تلقائياً من Discord'],
    },
    hi: {
        title: '📖 Babel का उपयोग कैसे करें',
        translate: ['🔄 संदेश अनुवाद करें', 'संदेश पर राइट-क्लिक → ऐप्स → **Babel**'],
        quick: ['✏️ त्वरित अनुवाद', '`/translate` — सीधे टेक्स्ट टाइप करके अनुवाद करें'],
        setlang: ['🌍 भाषा सेट करें', '`/setlang` — अपनी पसंदीदा अनुवाद भाषा चुनें'],
        tips: ['💡 सुझाव', '• अनुवाद निजी हैं (केवल आप देख सकते हैं)\n• भाषा Discord सेटिंग से स्वचालित रूप से पहचानी जाती है'],
    },
    id: {
        title: '📖 Cara Menggunakan Babel',
        translate: ['🔄 Terjemahkan pesan', 'Klik kanan pesan → Aplikasi → **Babel**'],
        quick: ['✏️ Terjemahan cepat', '`/translate` — Ketik teks langsung untuk diterjemahkan'],
        setlang: ['🌍 Atur bahasa', '`/setlang` — Pilih bahasa terjemahan yang diinginkan'],
        tips: ['💡 Tips', '• Terjemahan bersifat pribadi (hanya Anda yang melihat)\n• Bahasa terdeteksi otomatis dari pengaturan Discord'],
    },
    tr: {
        title: '📖 Babel Nasıl Kullanılır',
        translate: ['🔄 Mesaj çevir', 'Mesaja sağ tıkla → Uygulamalar → **Babel**'],
        quick: ['✏️ Hızlı çeviri', '`/translate` — Çevirmek için doğrudan metin yazın'],
        setlang: ['🌍 Dil ayarla', '`/setlang` — Tercih ettiğiniz çeviri dilini seçin'],
        tips: ['💡 İpuçları', '• Çeviriler özeldir (yalnızca siz görürsünüz)\n• Diliniz Discord ayarlarından otomatik algılanır'],
    },
};

// --- Discord Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
    console.log(`✅ ${c.user.tag} is online`);
    startDashboard({
        cache,
        cooldown,
        log,
        client,
        getStats: () => ({ totalTranslations, apiCalls }),
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    // --- /setlang command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'setlang') {
        const lang = interaction.options.getString('language');
        const prefs = store.get('userLanguagePrefs') || {};

        if (lang === 'auto') {
            delete prefs[interaction.user.id];
            store.set('userLanguagePrefs', prefs);
            return interaction.reply({
                content: '✅ Language preference cleared. Will use your Discord locale automatically.',
                flags: MessageFlags.Ephemeral,
            });
        }

        prefs[interaction.user.id] = lang;
        store.set('userLanguagePrefs', prefs);
        return interaction.reply({
            content: `✅ Translation target set to: **${lang}**`,
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- /translate command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'translate') {
        const text = interaction.options.getString('text');
        const targetOpt = interaction.options.getString('to');

        if (!store.isSetupComplete()) {
            return interaction.reply({ content: 'Bot not configured yet.', flags: MessageFlags.Ephemeral });
        }
        const allowedGuilds = store.get('allowedGuildIds');
        if (!allowedGuilds.includes(interaction.guildId)) {
            return interaction.reply({ content: '⛔ This server is not authorized.', flags: MessageFlags.Ephemeral });
        }
        if (usage.isBudgetExceeded()) {
            return interaction.reply({ content: '已達每日預算上限 / Daily budget exceeded', flags: MessageFlags.Ephemeral });
        }
        const cd = cooldown.check(interaction.user.id);
        if (!cd.allowed) {
            return interaction.reply({ content: `冷卻中，請等 ${cd.remaining} 秒 / Please wait ${cd.remaining}s`, flags: MessageFlags.Ephemeral });
        }

        // Resolve target language
        const userPrefs = store.get('userLanguagePrefs') || {};
        const userPref = userPrefs[interaction.user.id];
        const localeLang = localeToLang(interaction.locale);
        const targetLanguage = targetOpt && targetOpt !== 'auto'
            ? targetOpt
            : (userPref || localeLang || 'auto');

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        cooldown.set(interaction.user.id);
        totalTranslations++;

        try {
            const result = await translate(text, targetLanguage);
            usage.record(result.inputTokens, result.outputTokens);
            apiCalls++;

            const original = text.length > 200 ? text.slice(0, 200) + '…' : text;
            const reply = `> ${original.replace(/\n/g, '\n> ')}\n\n${result.text}`;
            await interaction.editReply({ content: reply });
        } catch (error) {
            console.error('[/translate]', error.message);
            await interaction.editReply({ content: `翻譯失敗 / Translation failed: ${error.message}` });
        }
        return;
    }

    // --- /help command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'help') {
        const locale = interaction.locale || 'en';
        const lang = locale.startsWith('zh') ? 'zh'
            : locale.split('-')[0];

        const t = HELP_TEXTS[lang] || HELP_TEXTS.en;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t.title)
            .addFields(
                { name: t.translate[0], value: t.translate[1] },
                { name: t.quick[0], value: t.quick[1] },
                { name: t.setlang[0], value: t.setlang[1] },
                { name: t.tips[0], value: t.tips[1] },
            )
            .setFooter({ text: 'Babel · Powered by Gemini' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }


    if (!interaction.isMessageContextMenuCommand()) return;
    if (interaction.commandName !== 'Babel') return;

    // --- Setup check ---
    if (!store.isSetupComplete()) {
        return interaction.reply({
            content: 'Bot not configured yet. Please complete setup in the dashboard.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Whitelist check ---
    const allowedGuilds = store.get('allowedGuildIds');
    if (!allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({
            content: '⛔ This server is not authorized.\n此伺服器未授權使用翻譯。',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Budget check ---
    if (usage.isBudgetExceeded()) {
        return interaction.reply({
            content: '已達每日預算上限，明天再試吧！\nDaily budget exceeded, try again tomorrow!',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Cooldown check ---
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        return interaction.reply({
            content: `冷卻中，請等 ${cd.remaining} 秒 / Please wait ${cd.remaining}s`,
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- No text content ---
    const content = interaction.targetMessage.content;
    if (!content?.trim()) {
        return interaction.reply({
            content: '沒有文字內容 / No text content',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Resolve target language ---
    const userPrefs = store.get('userLanguagePrefs') || {};
    const userPref = userPrefs[interaction.user.id];
    const localeLang = localeToLang(interaction.locale);
    const targetLanguage = userPref || localeLang || 'auto';
    const langSource = userPref ? 'setlang' : localeLang ? 'locale' : 'auto';
    console.log(`[Translate] user=${interaction.user.tag} lang=${targetLanguage} (from ${langSource}, locale=${interaction.locale})`);

    // --- Same-language check (skip redundant translations) ---
    if (isSameLanguage(content, targetLanguage, interaction.locale)) {
        console.log(`[Translate] Skipped: content already in target language`);
        return interaction.reply({
            content: 'This message is already in your language!',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Defer + translate ---
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    cooldown.set(interaction.user.id);
    totalTranslations++;

    try {
        // Cache key includes language to store per-language translations
        const cacheKey = `${interaction.targetMessage.id}:${targetLanguage}`;
        let translated = cache.get(cacheKey);
        const cached = !!translated;

        if (cached) {
            console.log(`[Translate] Cache HIT: ${cacheKey}`);
        } else {
            console.log(`[Translate] Cache MISS: ${cacheKey}, calling API...`);
            const result = await translate(content, targetLanguage);
            translated = result.text;
            cache.set(cacheKey, translated);
            usage.record(result.inputTokens, result.outputTokens);
            apiCalls++;
        }

        // Log the translation
        log.add({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            contentPreview: content,
            cached,
            targetLanguage,
            langSource,
        });

        // Format: original (truncated) + translation
        const original = content.length > 200 ? content.slice(0, 200) + '…' : content;
        const reply = `> ${original.replace(/\n/g, '\n> ')}\n\n${translated}`;
        await interaction.editReply({ content: reply });
    } catch (error) {
        console.error('[Translate]', error.message);
        await interaction.editReply({
            content: `翻譯失敗 / Translation failed: ${error.message}`,
        });
    }
});

/**
 * Map Discord locale code to a short language code.
 * Returns null for locales that should use the default auto-detect.
 */
function localeToLang(locale) {
    if (!locale) return null;
    // If it's a Chinese or English locale, use auto-detect (default behavior)
    if (locale.startsWith('zh') || locale.startsWith('en')) return null;
    // For other locales, extract the base language code
    return locale.split('-')[0];
}

/**
 * Detect the dominant script of text content.
 * Returns: 'zh', 'ja', 'ko', 'ru', 'ar', 'th', 'hi', or null (Latin/unknown).
 */
function detectScript(text) {
    let cjk = 0, kana = 0, hangul = 0, cyrillic = 0, arabic = 0, thai = 0, devanagari = 0;

    for (const char of text) {
        const c = char.codePointAt(0);
        if (c >= 0x4e00 && c <= 0x9fff) cjk++;
        else if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff)) kana++;
        else if (c >= 0xac00 && c <= 0xd7af) hangul++;
        else if (c >= 0x0400 && c <= 0x04ff) cyrillic++;
        else if (c >= 0x0600 && c <= 0x06ff) arabic++;
        else if (c >= 0x0e00 && c <= 0x0e7f) thai++;
        else if (c >= 0x0900 && c <= 0x097f) devanagari++;
    }

    // Japanese = has kana (hiragana/katakana), may also have kanji
    if (kana > 0) return 'ja';
    if (hangul > 0) return 'ko';
    if (cjk > 0) return 'zh'; // Chinese (simplified & traditional treated the same)
    if (cyrillic > 0) return 'ru';
    if (arabic > 0) return 'ar';
    if (thai > 0) return 'th';
    if (devanagari > 0) return 'hi';

    return null; // Latin or unrecognizable — don't block
}

/**
 * Map a language code to its script family.
 */
function langToScript(lang) {
    if (!lang) return null;
    const map = {
        'zh-TW': 'zh', 'zh-CN': 'zh', zh: 'zh',
        ja: 'ja', ko: 'ko', ru: 'ru',
        ar: 'ar', th: 'th', hi: 'hi',
    };
    return map[lang] || map[lang.split('-')[0]] || null;
}

/**
 * Check if content is already in the user's target language.
 * Only checks non-Latin scripts (Chinese, Japanese, Korean, etc.)
 * since Latin-script languages can't be reliably distinguished.
 */
function isSameLanguage(content, targetLanguage, userLocale) {
    const contentScript = detectScript(content);
    if (!contentScript) return false; // Latin/unknown — let it through

    if (targetLanguage === 'auto') {
        // In auto mode, check against user's Discord locale
        const userScript = langToScript(userLocale);
        return contentScript === userScript;
    }

    // For explicit target, check if content matches target language's script
    return contentScript === langToScript(targetLanguage);
}

// Cleanup expired cooldowns every minute
setInterval(() => cooldown.cleanup(), 60_000);

// --- Start ---
client.login(config.discordToken);
