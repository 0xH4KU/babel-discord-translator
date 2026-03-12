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
        title: '📖 How to Use Babel',
        translate: ['🔄 Translate a Message',
            '**Desktop:** Right-click a message → Apps → **Babel**\n' +
            '**Mobile:** Long-press a message → Apps → **Babel**'],
        quick: ['✏️ /translate',
            'Type text directly to translate:\n' +
            '`/translate text:Hello world`\n' +
            'You can also specify a target language with the hidden `to` option:\n' +
            '`/translate text:Hello world to:ja` → translates to Japanese'],
        setlang: ['🌍 /setlang',
            'Set your preferred translation language (remembered permanently):\n' +
            '`/setlang ja` → all translations will be in Japanese\n' +
            '`/setlang auto` → reset to auto-detect from Discord settings'],
        tips: ['💡 Tips',
            '• All translations are **private** — only you can see them\n' +
            '• If a message is already in your language, Babel will skip the translation\n' +
            '• Your language is auto-detected from your Discord language settings\n' +
            '• Supported: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    zh: {
        title: '📖 如何使用 Babel',
        translate: ['🔄 翻譯訊息',
            '**電腦版：** 右鍵點擊訊息 → 應用程式 → **Babel**\n' +
            '**手機版：** 長按訊息 → 應用程式 → **Babel**'],
        quick: ['✏️ /translate',
            '直接輸入文字翻譯：\n' +
            '`/translate text:你好世界`\n' +
            '也可以用隱藏的 `to` 選項指定目標語言：\n' +
            '`/translate text:你好世界 to:en` → 翻譯成英文'],
        setlang: ['🌍 /setlang',
            '設定偏好翻譯語言（永久記住）：\n' +
            '`/setlang ja` → 之後所有翻譯都翻成日文\n' +
            '`/setlang auto` → 重置回自動偵測'],
        tips: ['💡 小提示',
            '• 所有翻譯結果都是**私密**的，只有你看得到\n' +
            '• 如果訊息已經是你的語言，Babel 會自動跳過翻譯\n' +
            '• 語言會自動從你的 Discord 語言設定偵測\n' +
            '• 支援：繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ja: {
        title: '📖 Babel の使い方',
        translate: ['🔄 メッセージを翻訳',
            '**PC：** メッセージを右クリック → アプリ → **Babel**\n' +
            '**モバイル：** メッセージを長押し → アプリ → **Babel**'],
        quick: ['✏️ /translate',
            'テキストを直接入力して翻訳：\n' +
            '`/translate text:こんにちは`\n' +
            '隠しオプション `to` で翻訳先言語を指定可能：\n' +
            '`/translate text:こんにちは to:en` → 英語に翻訳'],
        setlang: ['🌍 /setlang',
            '翻訳先の言語を設定（永続保存）：\n' +
            '`/setlang en` → 全ての翻訳が英語になります\n' +
            '`/setlang auto` → 自動検出にリセット'],
        tips: ['💡 ヒント',
            '• 翻訳結果は**プライベート**です（あなただけに表示）\n' +
            '• メッセージが既にあなたの言語の場合、翻訳をスキップします\n' +
            '• 言語は Discord の言語設定から自動検出されます\n' +
            '• 対応言語：繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ko: {
        title: '📖 Babel 사용법',
        translate: ['🔄 메시지 번역',
            '**PC:** 메시지 우클릭 → 앱 → **Babel**\n' +
            '**모바일:** 메시지 길게 누르기 → 앱 → **Babel**'],
        quick: ['✏️ /translate',
            '텍스트를 직접 입력하여 번역：\n' +
            '`/translate text:안녕하세요`\n' +
            '숨겨진 `to` 옵션으로 번역 대상 언어를 지정할 수 있습니다：\n' +
            '`/translate text:안녕하세요 to:en` → 영어로 번역'],
        setlang: ['🌍 /setlang',
            '선호 번역 언어를 설정합니다 (영구 저장)：\n' +
            '`/setlang en` → 모든 번역이 영어로 됩니다\n' +
            '`/setlang auto` → 자동 감지로 재설정'],
        tips: ['💡 팁',
            '• 번역 결과는 **비공개**입니다 (본인만 볼 수 있음)\n' +
            '• 메시지가 이미 사용자 언어인 경우 번역을 건너뜁니다\n' +
            '• 언어는 Discord 언어 설정에서 자동 감지됩니다\n' +
            '• 지원: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    es: {
        title: '📖 Cómo usar Babel',
        translate: ['🔄 Traducir un mensaje',
            '**PC:** Clic derecho en un mensaje → Apps → **Babel**\n' +
            '**Móvil:** Mantén presionado un mensaje → Apps → **Babel**'],
        quick: ['✏️ /translate',
            'Escribe texto directamente para traducir:\n' +
            '`/translate text:Hola mundo`\n' +
            'También puedes usar la opción oculta `to` para elegir idioma:\n' +
            '`/translate text:Hola mundo to:en` → traduce al inglés'],
        setlang: ['🌍 /setlang',
            'Configura tu idioma de traducción (se guarda permanentemente):\n' +
            '`/setlang en` → todas las traducciones serán en inglés\n' +
            '`/setlang auto` → restablecer a detección automática'],
        tips: ['💡 Consejos',
            '• Las traducciones son **privadas** (solo tú las ves)\n' +
            '• Si el mensaje ya está en tu idioma, Babel lo omite\n' +
            '• Tu idioma se detecta automáticamente desde Discord\n' +
            '• Idiomas: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    fr: {
        title: '📖 Comment utiliser Babel',
        translate: ['🔄 Traduire un message',
            '**PC :** Clic droit sur un message → Apps → **Babel**\n' +
            '**Mobile :** Appui long sur un message → Apps → **Babel**'],
        quick: ['✏️ /translate',
            'Tapez du texte directement pour traduire :\n' +
            '`/translate text:Bonjour le monde`\n' +
            "Vous pouvez aussi utiliser l'option cachée `to` :\n" +
            '`/translate text:Bonjour to:en` → traduit en anglais'],
        setlang: ['🌍 /setlang',
            'Définir votre langue de traduction (sauvegardé) :\n' +
            '`/setlang en` → toutes les traductions seront en anglais\n' +
            '`/setlang auto` → réinitialiser la détection automatique'],
        tips: ['💡 Astuces',
            '• Les traductions sont **privées** (vous seul les voyez)\n' +
            '• Si le message est déjà dans votre langue, Babel le saute\n' +
            '• Votre langue est détectée automatiquement depuis Discord\n' +
            '• Langues : 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    de: {
        title: '📖 So verwendest du Babel',
        translate: ['🔄 Nachricht übersetzen',
            '**PC:** Rechtsklick auf eine Nachricht → Apps → **Babel**\n' +
            '**Mobil:** Nachricht lange drücken → Apps → **Babel**'],
        quick: ['✏️ /translate',
            'Text direkt eingeben zum Übersetzen:\n' +
            '`/translate text:Hallo Welt`\n' +
            'Mit der versteckten `to`-Option kannst du die Zielsprache wählen:\n' +
            '`/translate text:Hallo Welt to:en` → übersetzt ins Englische'],
        setlang: ['🌍 /setlang',
            'Bevorzugte Übersetzungssprache einstellen (dauerhaft):\n' +
            '`/setlang en` → alle Übersetzungen auf Englisch\n' +
            '`/setlang auto` → zurücksetzen auf automatische Erkennung'],
        tips: ['💡 Tipps',
            '• Übersetzungen sind **privat** (nur für dich sichtbar)\n' +
            '• Ist die Nachricht bereits in deiner Sprache, wird sie übersprungen\n' +
            '• Deine Sprache wird automatisch aus Discord erkannt\n' +
            '• Sprachen: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    pt: {
        title: '📖 Como usar o Babel',
        translate: ['🔄 Traduzir mensagem',
            '**PC:** Clique direito numa mensagem → Apps → **Babel**\n' +
            '**Mobile:** Pressione longo numa mensagem → Apps → **Babel**'],
        quick: ['✏️ /translate',
            'Digite texto diretamente para traduzir:\n' +
            '`/translate text:Olá mundo`\n' +
            'Use a opção oculta `to` para escolher o idioma:\n' +
            '`/translate text:Olá mundo to:en` → traduz para inglês'],
        setlang: ['🌍 /setlang',
            'Defina seu idioma de tradução (permanente):\n' +
            '`/setlang en` → todas as traduções em inglês\n' +
            '`/setlang auto` → redefinir para detecção automática'],
        tips: ['💡 Dicas',
            '• As traduções são **privadas** (só você vê)\n' +
            '• Se a mensagem já está no seu idioma, Babel a ignora\n' +
            '• Seu idioma é detectado automaticamente pelo Discord\n' +
            '• Idiomas: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ru: {
        title: '📖 Как пользоваться Babel',
        translate: ['🔄 Перевести сообщение',
            '**ПК:** ПКМ по сообщению → Приложения → **Babel**\n' +
            '**Мобильное:** Долгое нажатие → Приложения → **Babel**'],
        quick: ['✏️ /translate',
            'Введите текст для перевода:\n' +
            '`/translate text:Привет мир`\n' +
            'Скрытая опция `to` позволяет выбрать язык:\n' +
            '`/translate text:Привет мир to:en` → перевод на английский'],
        setlang: ['🌍 /setlang',
            'Установите язык перевода (сохраняется):\n' +
            '`/setlang en` → все переводы на английском\n' +
            '`/setlang auto` → сброс на автоопределение'],
        tips: ['💡 Подсказки',
            '• Переводы **приватные** (видны только вам)\n' +
            '• Если сообщение уже на вашем языке, перевод пропускается\n' +
            '• Язык определяется автоматически из настроек Discord\n' +
            '• Языки: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    it: {
        title: '📖 Come usare Babel',
        translate: ['🔄 Traduci un messaggio',
            '**PC:** Clic destro su un messaggio → App → **Babel**\n' +
            '**Mobile:** Tieni premuto un messaggio → App → **Babel**'],
        quick: ['✏️ /translate',
            'Scrivi testo direttamente per tradurre:\n' +
            '`/translate text:Ciao mondo`\n' +
            "Usa l'opzione nascosta `to` per scegliere la lingua:\n" +
            '`/translate text:Ciao mondo to:en` → traduce in inglese'],
        setlang: ['🌍 /setlang',
            'Imposta la lingua di traduzione (permanente):\n' +
            '`/setlang en` → tutte le traduzioni in inglese\n' +
            '`/setlang auto` → ripristina il rilevamento automatico'],
        tips: ['💡 Suggerimenti',
            '• Le traduzioni sono **private** (solo tu le vedi)\n' +
            '• Se il messaggio è già nella tua lingua, viene saltato\n' +
            '• La lingua viene rilevata automaticamente da Discord\n' +
            '• Lingue: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    vi: {
        title: '📖 Cách sử dụng Babel',
        translate: ['🔄 Dịch tin nhắn',
            '**PC:** Nhấp chuột phải vào tin nhắn → Ứng dụng → **Babel**\n' +
            '**Di động:** Nhấn giữ tin nhắn → Ứng dụng → **Babel**'],
        quick: ['✏️ /translate',
            'Nhập văn bản trực tiếp để dịch:\n' +
            '`/translate text:Xin chào`\n' +
            'Dùng tùy chọn ẩn `to` để chọn ngôn ngữ:\n' +
            '`/translate text:Xin chào to:en` → dịch sang tiếng Anh'],
        setlang: ['🌍 /setlang',
            'Cài đặt ngôn ngữ dịch (lưu vĩnh viễn):\n' +
            '`/setlang en` → tất cả bản dịch bằng tiếng Anh\n' +
            '`/setlang auto` → đặt lại về tự động phát hiện'],
        tips: ['💡 Mẹo',
            '• Bản dịch là **riêng tư** (chỉ bạn nhìn thấy)\n' +
            '• Nếu tin nhắn đã bằng ngôn ngữ của bạn, Babel sẽ bỏ qua\n' +
            '• Ngôn ngữ được phát hiện tự động từ Discord\n' +
            '• Ngôn ngữ: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    th: {
        title: '📖 วิธีใช้ Babel',
        translate: ['🔄 แปลข้อความ',
            '**PC:** คลิกขวาที่ข้อความ → แอป → **Babel**\n' +
            '**มือถือ:** กดค้างที่ข้อความ → แอป → **Babel**'],
        quick: ['✏️ /translate',
            'พิมพ์ข้อความเพื่อแปลโดยตรง:\n' +
            '`/translate text:สวัสดี`\n' +
            'ใช้ตัวเลือกซ่อน `to` เพื่อเลือกภาษา:\n' +
            '`/translate text:สวัสดี to:en` → แปลเป็นภาษาอังกฤษ'],
        setlang: ['🌍 /setlang',
            'ตั้งค่าภาษาแปล (บันทึกถาวร):\n' +
            '`/setlang en` → แปลทั้งหมดเป็นภาษาอังกฤษ\n' +
            '`/setlang auto` → รีเซ็ตเป็นตรวจจับอัตโนมัติ'],
        tips: ['💡 เคล็ดลับ',
            '• ผลแปลเป็น**ส่วนตัว** (เฉพาะคุณเห็น)\n' +
            '• หากข้อความเป็นภาษาของคุณแล้ว Babel จะข้ามไป\n' +
            '• ภาษาตรวจจับอัตโนมัติจาก Discord\n' +
            '• ภาษา: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    ar: {
        title: '📖 كيفية استخدام Babel',
        translate: ['🔄 ترجمة رسالة',
            '**الكمبيوتر:** انقر بزر الماوس الأيمن → التطبيقات → **Babel**\n' +
            '**الجوال:** اضغط مطولاً على الرسالة → التطبيقات → **Babel**'],
        quick: ['✏️ /translate',
            'اكتب النص مباشرة للترجمة:\n' +
            '`/translate text:مرحبا`\n' +
            'استخدم خيار `to` المخفي لاختيار اللغة:\n' +
            '`/translate text:مرحبا to:en` → ترجمة إلى الإنجليزية'],
        setlang: ['🌍 /setlang',
            'تعيين لغة الترجمة (يُحفظ بشكل دائم):\n' +
            '`/setlang en` → جميع الترجمات بالإنجليزية\n' +
            '`/setlang auto` → إعادة التعيين للكشف التلقائي'],
        tips: ['💡 نصائح',
            '• الترجمات **خاصة** (أنت فقط تراها)\n' +
            '• إذا كانت الرسالة بلغتك بالفعل، سيتخطاها Babel\n' +
            '• يتم اكتشاف لغتك تلقائياً من Discord\n' +
            '• اللغات: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    hi: {
        title: '📖 Babel का उपयोग कैसे करें',
        translate: ['🔄 संदेश अनुवाद करें',
            '**PC:** संदेश पर राइट-क्लिक → ऐप्स → **Babel**\n' +
            '**मोबाइल:** संदेश को लंबे समय तक दबाएं → ऐप्स → **Babel**'],
        quick: ['✏️ /translate',
            'सीधे टेक्स्ट टाइप करके अनुवाद करें:\n' +
            '`/translate text:नमस्ते`\n' +
            'छिपे `to` विकल्प से भाषा चुनें:\n' +
            '`/translate text:नमस्ते to:en` → अंग्रेजी में अनुवाद'],
        setlang: ['🌍 /setlang',
            'अनुवाद भाषा सेट करें (स्थायी रूप से सहेजा जाता है):\n' +
            '`/setlang en` → सभी अनुवाद अंग्रेजी में\n' +
            '`/setlang auto` → स्वचालित पहचान पर रीसेट'],
        tips: ['💡 सुझाव',
            '• अनुवाद **निजी** हैं (केवल आप देख सकते हैं)\n' +
            '• यदि संदेश पहले से आपकी भाषा में है, Babel छोड़ देगा\n' +
            '• भाषा Discord सेटिंग से स्वचालित रूप से पहचानी जाती है\n' +
            '• भाषाएं: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    id: {
        title: '📖 Cara Menggunakan Babel',
        translate: ['🔄 Terjemahkan pesan',
            '**PC:** Klik kanan pesan → Aplikasi → **Babel**\n' +
            '**Mobile:** Tekan lama pesan → Aplikasi → **Babel**'],
        quick: ['✏️ /translate',
            'Ketik teks langsung untuk diterjemahkan:\n' +
            '`/translate text:Halo dunia`\n' +
            'Gunakan opsi tersembunyi `to` untuk memilih bahasa:\n' +
            '`/translate text:Halo dunia to:en` → terjemahkan ke Inggris'],
        setlang: ['🌍 /setlang',
            'Atur bahasa terjemahan (disimpan permanen):\n' +
            '`/setlang en` → semua terjemahan dalam bahasa Inggris\n' +
            '`/setlang auto` → reset ke deteksi otomatis'],
        tips: ['💡 Tips',
            '• Terjemahan bersifat **pribadi** (hanya Anda yang melihat)\n' +
            '• Jika pesan sudah dalam bahasa Anda, Babel akan melewatinya\n' +
            '• Bahasa terdeteksi otomatis dari pengaturan Discord\n' +
            '• Bahasa: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
    },
    tr: {
        title: '📖 Babel Nasıl Kullanılır',
        translate: ['🔄 Mesaj çevir',
            '**PC:** Mesaja sağ tıkla → Uygulamalar → **Babel**\n' +
            '**Mobil:** Mesaja uzun bas → Uygulamalar → **Babel**'],
        quick: ['✏️ /translate',
            'Çevirmek için doğrudan metin yazın:\n' +
            '`/translate text:Merhaba dünya`\n' +
            'Gizli `to` seçeneğiyle hedef dili belirleyin:\n' +
            '`/translate text:Merhaba dünya to:en` → İngilizceye çevir'],
        setlang: ['🌍 /setlang',
            'Çeviri dilini ayarlayın (kalıcı olarak kaydedilir):\n' +
            '`/setlang en` → tüm çeviriler İngilizce olur\n' +
            '`/setlang auto` → otomatik algılamaya sıfırla'],
        tips: ['💡 İpuçları',
            '• Çeviriler **özeldir** (yalnızca siz görürsünüz)\n' +
            '• Mesaj zaten sizin dilinizde ise, Babel atlar\n' +
            '• Diliniz Discord ayarlarından otomatik algılanır\n' +
            '• Diller: 繁中・简中・EN・日本語・한국어・ES・FR・DE・PT・RU・IT・VI・TH・AR・HI・ID'],
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
