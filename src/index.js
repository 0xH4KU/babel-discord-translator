import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
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
        title: 'How to Use Babel',
        translate: ['Translate a Message (Private)',
            '**Desktop:** Right-click a message → Apps → **Babel**\n' +
            '**Mobile:** Long-press a message → Apps → **Babel**\n' +
            'Translation is only visible to you.'],
        quick: ['/translate (Public)',
            'Type text and send the translation **publicly** with your avatar:\n' +
            '`/translate text:Hello world`\n' +
            'You can also specify a target language with the hidden `to` option:\n' +
            '`/translate text:Hello world to:ja` → translates to Japanese'],
        setlang: ['/setlang',
            'Set your preferred translation language (remembered permanently):\n' +
            '`/setlang ja` → all translations will be in Japanese\n' +
            '`/setlang auto` → reset to auto-detect from Discord settings'],
        tips: ['Tips',
            '• All translations are **private** — only you can see them\n' +
            '• If a message is already in your language, Babel will skip the translation\n' +
            '• Your language is auto-detected from your Discord language settings\n' +
            '• Supported: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    zh: {
        title: '如何使用 Babel',
        translate: ['翻譯訊息（私密）',
            '**電腦版：** 右鍵點擊訊息 → 應用程式 → **Babel**\n' +
            '**手機版：** 長按訊息 → 應用程式 → **Babel**\n' +
            '翻譯結果僅你可見。'],
        quick: ['/translate（公開）',
            '輸入文字，用你的頭像和名字**公開發送**翻譯結果：\n' +
            '`/translate text:你好世界`\n' +
            '可用 `to` 參數指定目標語言：\n' +
            '`/translate text:你好世界 to:en` → 公開發送英文翻譯'],
        setlang: ['/setlang',
            '設定偏好翻譯語言（永久記住）：\n' +
            '`/setlang ja` → 之後所有翻譯都翻成日文\n' +
            '`/setlang auto` → 重置回自動偵測'],
        tips: ['小提示',
            '• 右鍵 → Babel = **私密**（只有你看得到）\n' +
            '• /translate = **公開**（以你的名義發送訊息，所有人可見）\n' +
            '• 如果訊息已經是你的語言，Babel 會自動跳過\n' +
            '• 支援：繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ja: {
        title: 'Babel の使い方',
        translate: ['メッセージを翻訳（プライベート）',
            '**PC：** 右クリック → アプリ → **Babel**\n**モバイル：** 長押し → アプリ → **Babel**\nあなただけに表示されます。'],
        quick: ['/translate（公開）',
            'テキストを入力し、アバターと名前で**公開送信**：\n`/translate text:こんにちは`\n`to` で翻訳先言語を指定：\n`/translate text:こんにちは to:en` → 英語の翻訳を公開送信'],
        setlang: ['/setlang', '翻訳先の言語を設定（永続保存）：\n`/setlang en` → 全て英語\n`/setlang auto` → 自動検出にリセット'],
        tips: ['ヒント', '• 右クリック → Babel = **プライベート**\n• /translate = **公開**（全員に見えるメッセージ）\n• 既にあなたの言語ならスキップ\n• 対応言語：繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ko: {
        title: 'Babel 사용법',
        translate: ['메시지 번역 (비공개)', '**PC:** 우클릭 → 앱 → **Babel**\n**모바일:** 길게 누르기 → 앱 → **Babel**\n본인에게만 보입니다.'],
        quick: ['/translate (공개)', '아바타와 이름으로 **공개 전송**:\n`/translate text:안녕하세요`\n`to`로 언어 지정:\n`/translate text:안녕하세요 to:en` → 영어 번역 공개 전송'],
        setlang: ['/setlang', '번역 언어 설정 (영구 저장):\n`/setlang en` → 모두 영어\n`/setlang auto` → 자동 감지'],
        tips: ['팁', '• 우클릭 = **비공개**\n• /translate = **공개** (모두 볼 수 있음)\n• 이미 사용자 언어이면 건너뜀\n• 지원: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    es: {
        title: 'Cómo usar Babel',
        translate: ['Traducir mensaje (Privado)', '**PC:** Clic derecho → Apps → **Babel**\n**Móvil:** Mantén presionado → Apps → **Babel**\nSolo tú ves la traducción.'],
        quick: ['/translate (Público)', 'Escribe texto y envía **públicamente** con tu avatar:\n`/translate text:Hola mundo`\nUsa `to` para elegir idioma:\n`/translate text:Hola mundo to:en` → publica en inglés'],
        setlang: ['/setlang', 'Configura idioma (permanente):\n`/setlang en` → todo en inglés\n`/setlang auto` → detección automática'],
        tips: ['Consejos', '• Clic derecho = **privado**\n• /translate = **público**\n• Babel omite si ya está en tu idioma\n• Idiomas: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    fr: {
        title: 'Comment utiliser Babel',
        translate: ['Traduire message (Privé)', '**PC :** Clic droit → Apps → **Babel**\n**Mobile :** Appui long → Apps → **Babel**\nSeul vous voyez la traduction.'],
        quick: ['/translate (Public)', 'Tapez texte et envoyez **publiquement** avec votre avatar :\n`/translate text:Bonjour`\nUtilisez `to` pour la langue :\n`/translate text:Bonjour to:en` → publie en anglais'],
        setlang: ['/setlang', 'Définir langue (sauvegardé) :\n`/setlang en` → tout en anglais\n`/setlang auto` → détection automatique'],
        tips: ['Astuces', '• Clic droit = **privé**\n• /translate = **public**\n• Babel saute si déjà dans votre langue\n• Langues : 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    de: {
        title: 'So verwendest du Babel',
        translate: ['Nachricht übersetzen (Privat)', '**PC:** Rechtsklick → Apps → **Babel**\n**Mobil:** Lange drücken → Apps → **Babel**\nNur für dich sichtbar.'],
        quick: ['/translate (Öffentlich)', 'Text eingeben und **öffentlich** mit Avatar senden:\n`/translate text:Hallo Welt`\nMit `to` Zielsprache wählen:\n`/translate text:Hallo Welt to:en` → postet auf Englisch'],
        setlang: ['/setlang', 'Sprache einstellen (dauerhaft):\n`/setlang en` → alles auf Englisch\n`/setlang auto` → automatische Erkennung'],
        tips: ['Tipps', '• Rechtsklick = **privat**\n• /translate = **öffentlich**\n• Babel überspringt wenn in deiner Sprache\n• Sprachen: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    pt: {
        title: 'Como usar o Babel',
        translate: ['Traduzir mensagem (Privado)', '**PC:** Clique direito → Apps → **Babel**\n**Mobile:** Pressione longo → Apps → **Babel**\nSó você vê.'],
        quick: ['/translate (Público)', 'Digite texto e envie **publicamente** com seu avatar:\n`/translate text:Olá mundo`\nUse `to` para idioma:\n`/translate text:Olá mundo to:en` → publica em inglês'],
        setlang: ['/setlang', 'Defina idioma (permanente):\n`/setlang en` → tudo em inglês\n`/setlang auto` → detecção automática'],
        tips: ['Dicas', '• Clique direito = **privado**\n• /translate = **público**\n• Babel ignora se já no seu idioma\n• Idiomas: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ru: {
        title: 'Как пользоваться Babel',
        translate: ['Перевести (Приватно)', '**ПК:** ПКМ → Приложения → **Babel**\n**Мобильное:** Долгое нажатие → **Babel**\nВидно только вам.'],
        quick: ['/translate (Публично)', 'Введите текст и отправьте **публично** с аватаром:\n`/translate text:Привет мир`\nПараметр `to` для языка:\n`/translate text:Привет мир to:en` → публикует на английском'],
        setlang: ['/setlang', 'Язык перевода (сохраняется):\n`/setlang en` → всё на английском\n`/setlang auto` → автоопределение'],
        tips: ['Подсказки', '• ПКМ = **приватно**\n• /translate = **публично**\n• Babel пропускает если на вашем языке\n• Языки: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    it: {
        title: 'Come usare Babel',
        translate: ['Traduci messaggio (Privato)', '**PC:** Clic destro → App → **Babel**\n**Mobile:** Tieni premuto → App → **Babel**\nSolo tu vedi.'],
        quick: ['/translate (Pubblico)', 'Scrivi testo e invia **pubblicamente** con avatar:\n`/translate text:Ciao mondo`\nUsa `to` per lingua:\n`/translate text:Ciao mondo to:en` → pubblica in inglese'],
        setlang: ['/setlang', 'Imposta lingua (permanente):\n`/setlang en` → tutto in inglese\n`/setlang auto` → rilevamento automatico'],
        tips: ['Suggerimenti', '• Clic destro = **privato**\n• /translate = **pubblico**\n• Babel salta se nella tua lingua\n• Lingue: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    vi: {
        title: 'Cách sử dụng Babel',
        translate: ['Dịch tin nhắn (Riêng tư)', '**PC:** Chuột phải → Ứng dụng → **Babel**\n**Di động:** Nhấn giữ → **Babel**\nChỉ bạn nhìn thấy.'],
        quick: ['/translate (Công khai)', 'Nhập văn bản và gửi **công khai** với avatar:\n`/translate text:Xin chào`\nDùng `to` để chọn ngôn ngữ:\n`/translate text:Xin chào to:en` → đăng tiếng Anh công khai'],
        setlang: ['/setlang', 'Cài ngôn ngữ (vĩnh viễn):\n`/setlang en` → tất cả tiếng Anh\n`/setlang auto` → tự động phát hiện'],
        tips: ['Mẹo', '• Chuột phải = **riêng tư**\n• /translate = **công khai**\n• Babel bỏ qua nếu đã bằng ngôn ngữ của bạn\n• Ngôn ngữ: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    th: {
        title: ' วิธีใช้ Babel',
        translate: ['แปลข้อความ (ส่วนตัว)', '**PC:** คลิกขวา → แอป → **Babel**\n**มือถือ:** กดค้าง → **Babel**\nเฉพาะคุณเห็น'],
        quick: ['/translate (สาธารณะ)', 'พิมพ์และส่ง**สาธารณะ**ด้วยอวาตาร์:\n`/translate text:สวัสดี`\nใช้ `to` เลือกภาษา:\n`/translate text:สวัสดี to:en` → โพสต์ภาษาอังกฤษ'],
        setlang: ['/setlang', 'ตั้งภาษา (ถาวร):\n`/setlang en` → ทั้งหมดอังกฤษ\n`/setlang auto` → ตรวจจับอัตโนมัติ'],
        tips: ['เคล็ดลับ', '• คลิกขวา = **ส่วนตัว**\n• /translate = **สาธารณะ**\n• Babel ข้ามถ้าภาษาของคุณแล้ว\n• ภาษา: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ar: {
        title: ' كيفية استخدام Babel',
        translate: ['ترجمة رسالة (خاص)', '**كمبيوتر:** زر أيمن → التطبيقات → **Babel**\n**جوال:** اضغط مطولاً → **Babel**\nلك فقط.'],
        quick: ['/translate (عام)', 'اكتب وأرسل **علنياً** بصورتك:\n`/translate text:مرحبا`\nاستخدم `to` للغة:\n`/translate text:مرحبا to:en` → ينشر بالإنجليزية'],
        setlang: ['/setlang', 'تعيين اللغة (دائم):\n`/setlang en` → الكل بالإنجليزية\n`/setlang auto` → كشف تلقائي'],
        tips: ['نصائح', '• زر أيمن = **خاص**\n• /translate = **عام**\n• Babel يتخطى إذا بلغتك\n• اللغات: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    hi: {
        title: 'Babel का उपयोग',
        translate: ['अनुवाद (निजी)', '**PC:** राइट-क्लिक → ऐप्स → **Babel**\n**मोबाइल:** लंबे समय दबाएं → **Babel**\nकेवल आपको दिखता है।'],
        quick: ['/translate (सार्वजनिक)', 'टेक्स्ट टाइप करें, अवतार के साथ **सार्वजनिक** भेजें:\n`/translate text:नमस्ते`\n`to` से भाषा चुनें:\n`/translate text:नमस्ते to:en` → अंग्रेजी में पोस्ट'],
        setlang: ['/setlang', 'भाषा सेट करें (स्थायी):\n`/setlang en` → सब अंग्रेजी\n`/setlang auto` → स्वचालित पहचान'],
        tips: ['सुझाव', '• राइट-क्लिक = **निजी**\n• /translate = **सार्वजनिक**\n• Babel छोड़ देगा अगर आपकी भाषा\n• भाषाएं: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    id: {
        title: 'Cara Menggunakan Babel',
        translate: ['Terjemahkan pesan (Pribadi)', '**PC:** Klik kanan → Aplikasi → **Babel**\n**Mobile:** Tekan lama → **Babel**\nHanya Anda yang melihat.'],
        quick: ['/translate (Publik)', 'Ketik teks dan kirim **publik** dengan avatar:\n`/translate text:Halo dunia`\nGunakan `to` untuk bahasa:\n`/translate text:Halo dunia to:en` → posting dalam Inggris'],
        setlang: ['/setlang', 'Atur bahasa (permanen):\n`/setlang en` → semua Inggris\n`/setlang auto` → deteksi otomatis'],
        tips: ['Tips', '• Klik kanan = **pribadi**\n• /translate = **publik**\n• Babel melewati jika bahasa Anda\n• Bahasa: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    tr: {
        title: 'Babel Nasıl Kullanılır',
        translate: ['Mesaj çevir (Özel)', '**PC:** Sağ tıkla → Uygulamalar → **Babel**\n**Mobil:** Uzun bas → **Babel**\nYalnızca siz görürsünüz.'],
        quick: ['/translate (Herkese Açık)', 'Metin yazın ve avatarınızla **herkese açık** gönderin:\n`/translate text:Merhaba dünya`\n`to` ile dili belirleyin:\n`/translate text:Merhaba dünya to:en` → İngilizce yayınla'],
        setlang: ['/setlang', 'Dil ayarla (kalıcı):\n`/setlang en` → hepsi İngilizce\n`/setlang auto` → otomatik algılama'],
        tips: ['İpuçları', '• Sağ tık = **özel**\n• /translate = **herkese açık**\n• Babel dilinizde ise atlar\n• Diller: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
};

// --- Discord Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
    console.log(` ${c.user.tag} is online`);
    startDashboard({
        cache,
        cooldown,
        log,
        client,
        getStats: () => ({ totalTranslations, apiCalls }),
    });
});

// --- Webhook management for /translate ---
const webhookCache = new Map(); // channelId → Webhook

async function getOrCreateWebhook(channel) {
    const cached = webhookCache.get(channel.id);
    if (cached) return cached;

    // Look for an existing Babel webhook in this channel
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === 'Babel' && w.owner?.id === channel.client.user.id);

    if (!webhook) {
        webhook = await channel.createWebhook({ name: 'Babel', reason: 'Babel /translate public output' });
    }

    webhookCache.set(channel.id, webhook);
    return webhook;
}

client.on(Events.InteractionCreate, async (interaction) => {
    // --- /setlang command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'setlang') {
        const lang = interaction.options.getString('language');
        const prefs = store.get('userLanguagePrefs') || {};

        if (lang === 'auto') {
            delete prefs[interaction.user.id];
            store.set('userLanguagePrefs', prefs);
            return interaction.reply({
                content: 'Language preference cleared. Will use your Discord locale automatically.',
                flags: MessageFlags.Ephemeral,
            });
        }

        prefs[interaction.user.id] = lang;
        store.set('userLanguagePrefs', prefs);
        return interaction.reply({
            content: ` Translation target set to: **${lang}**`,
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
            return interaction.reply({ content: 'This server is not authorized.', flags: MessageFlags.Ephemeral });
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

            // Send translation publicly via webhook with user's avatar and name
            const webhook = await getOrCreateWebhook(interaction.channel);
            const member = interaction.member;
            await webhook.send({
                content: result.text,
                username: member?.displayName || interaction.user.displayName,
                avatarURL: interaction.user.displayAvatarURL({ size: 128 }),
            });

            // Dismiss the ephemeral "thinking" message
            await interaction.deleteReply();
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

        const text = `## ${t.title}

**${t.translate[0]}**
${t.translate[1]}

**${t.quick[0]}**
${t.quick[1]}

**${t.setlang[0]}**
${t.setlang[1]}

**${t.tips[0]}**
${t.tips[1]}`;

        return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
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
            content: 'This server is not authorized.\n此伺服器未授權使用翻譯。',
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
