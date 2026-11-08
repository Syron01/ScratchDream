// The Scratch forum is a 2007 table: every page is a full Django round trip, every row is a
// line of text, and the thread view buries posts between sidebars and signatures. This only
// reskins /discuss/* into a feed you can read: three columns, a stream of topics, a thread that
// looks like a conversation. Nothing else on the site is touched.
// It is a skin, not a replacement: the native page stays mounted and hidden, every post, reply
// and follow goes through the same forms and the same CSRF token the site gave us, so accounts,
// moderation and the ten-second rule keep working exactly as before.
(function () {
    'use strict';

    var PATH = location.pathname;
    if (!/^\/discuss(\/|$)/.test(PATH)) return;
    // these pages are a form or a redirect; skinning them would hide the only thing they do
    if (/^\/discuss\/(post|misc|settings|subscription)\//.test(PATH)) return;
    if (/\/topic\/add\/?$|\/edit\/?$/.test(PATH)) return;

    var M_HOME = /^\/discuss\/?$/.test(PATH);
    var M_CAT = /^\/discuss\/(\d+)\/?$/.exec(PATH);
    var M_TOPIC = /^\/discuss\/topic\/(\d+)\//.exec(PATH);
    var M_SEARCH = /^\/discuss\/search\/?$/.test(PATH);
    var KIND = M_HOME ? 'home' : M_CAT ? 'cat' : M_TOPIC ? 'topic' : M_SEARCH ? 'search' : null;
    if (!KIND) return;

    function injectGoogleFonts() {
        if (document.getElementById('sd-google-fonts')) return;
        try {
            var pre1 = document.createElement('link');
            pre1.rel = 'preconnect';
            pre1.href = 'https://fonts.googleapis.com';
            var pre2 = document.createElement('link');
            pre2.rel = 'preconnect';
            pre2.href = 'https://fonts.gstatic.com';
            pre2.crossOrigin = 'anonymous';
            var link = document.createElement('link');
            link.id = 'sd-google-fonts';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700;800&family=JetBrains+Mono:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
            var target = document.head || document.documentElement;
            if (target) {
                target.appendChild(pre1);
                target.appendChild(pre2);
                target.appendChild(link);
            }
        } catch (e) {}
    }

    // Immediate anti-FOUC: prevent unstyled Scratch UI from flashing even for 1ms
    try {
        injectGoogleFonts();
        var preStyle = document.createElement('style');
        preStyle.id = 'sd-fouc-block';
        preStyle.textContent = 'html.sd-x-on #pagewrapper,html.sd-x-on #topnav,html.sd-x-on #content,html.sd-x-on #footer,html.sd-x-on #alert-view{display:none!important}html.sd-x-on body{background:#F0F4FA!important;margin:0!important}';
        (document.head || document.documentElement).appendChild(preStyle);
        document.documentElement.classList.add('sd-x-on');
    } catch (e) {}

    var DEFAULT_TR = /^tr\b/i.test(document.documentElement.lang || navigator.language || '');
    var CUR_LANG = 'tr';
    try {
        CUR_LANG = localStorage.getItem('sd-x-lang') || (DEFAULT_TR ? 'tr' : 'en');
    } catch (e) {
        CUR_LANG = DEFAULT_TR ? 'tr' : 'en';
    }
    var TR = CUR_LANG === 'tr';

    function buildLocale(lang) {
        return lang === 'tr' ? {
            home: 'Forumlar', trend: 'Senin İçin', forYou: 'Senin İçin', latest: 'Son Konular', mediaTab: 'Görseller & Kod',
            forumsTab: 'Forumlar', savedTab: 'Kaydedilenler', helpTab: 'Yanıtlanmamış',
            navHome: 'Senin İçin', navExplore: 'Keşfet', navNews: 'Bildirimler', navMail: 'Mesajlar',
            navSaved: 'Kaydedilenler', navMe: 'Konularım', navForums: 'Forumlar', navHelp: 'Yanıtlanmamış',
            navMine: 'Konularım', site: 'Siteye Dön',
            thread: 'Konu', composePh: 'Scratch topluluğuna bir şey sor veya paylaş…', newTopic: 'Yeni Konu Aç', searchPh: 'Forumda ve konularda ara…',
            needLogin: 'Yanıt yazmak için giriş yapmalısın.',
            reply: 'Yanıtla', replies: 'yanıt', replyOne: 'yanıt', views: 'görüntülenme', viewOne: 'görüntülenme',
            noReply: 'Yanıt yok', topics: 'konu', posts: 'mesaj',
            save: 'Kaydet', saved: 'Kaydedildi', quote: 'Alıntıla', report: 'Bildir',
            follow: 'Takip et', unfollow: 'Takibi bırak', back: 'Geri', close: 'Kapat',
            send: 'Gönder', title: 'Başlık', body: 'Ne sormak istiyorsun?', category: 'Forum Kategorisi',
            titlePh: 'Net ve açıklayıcı bir başlık yaz…', bodyPh: 'Uzun uzun yaz, sorun veya fikrin net olsun…',
            subscribe: 'Yeni yanıtları takip et', sendTopic: 'Konuyu Yayınla',
            empty: 'Burada henüz bir şey yok.', loading: 'İçerik yükleniyor…',
            failed: 'Yüklenemedi.', retry: 'Tekrar Dene', more: 'Daha Fazla Göster',
            now: 'şimdi', m: 'dk', h: 'sa', d: 'g', ago: 'önce', by: 'yazan',
            sticky: 'Sabit', closed: 'Kilitli', isnew: 'Yeni',
            active: 'Aktif Forumlar', help: 'Yardım Bekleyen Sorular', helpNote: 'Henüz yanıt almamış yardım bekleyenler',
            stats: ['forum', 'konu', 'mesaj', 'bugün aktif'],
            theme: 'Tema', themeDark: 'Koyu Tema', themeLight: 'Açık Tema',
            sortLast: 'Son Yanıt', sortReplies: 'Çok Yanıt', sortViews: 'Çok Görüntülenme',
            allForums: 'Tüm Forumlar', topicsIn: 'konu', postsIn: 'mesaj',
            searchTitle: 'Arama', results: 'sonuç', inForum: 'içinde',
            login: 'Giriş Yap', signup: 'Kayıt Ol', signedOut: 'Misafir',
            foot: 'ScratchDream Forum · Scratch’in kendi sunucularından anlık veri okur.',
            emptyPost: 'Lütfen önce bir şey yaz.', open: 'Konuyu Aç', pageWord: 'Sayfa', noMore: 'Başka sayfa yok',
            savedEmpty: 'Kaydettiğin konu yok. Bir konunun yer imi düğmesine bas.',
            helpEmpty: 'Şu an yanıt bekleyen konu yok.', mine: 'Konularım', sortNew: 'Yeniler',
            langTitle: 'Dil Seçeneği / Language', refreshFeed: 'Keşfet Akışını Yenile', linkCopied: 'Konu bağlantısı kopyalandı!'
        } : {
            home: 'Forums', trend: 'For you', forYou: 'For you', latest: 'Latest', mediaTab: 'Media & Code',
            forumsTab: 'Forums', savedTab: 'Bookmarks', helpTab: 'Unanswered',
            navHome: 'For you', navExplore: 'Explore', navNews: 'Notifications', navMail: 'Messages',
            navSaved: 'Bookmarks', navMe: 'My topics', navForums: 'Forums', navHelp: 'Unanswered',
            navMine: 'My topics', site: 'Back to Scratch',
            thread: 'Thread', composePh: 'Ask a question or share with Scratchers…', newTopic: 'New topic', searchPh: 'Search forums & topics…',
            needLogin: 'Sign in to reply.',
            reply: 'Reply', replies: 'replies', replyOne: 'reply', views: 'views', viewOne: 'view',
            noReply: 'No replies', topics: 'topics', posts: 'posts',
            save: 'Save', saved: 'Saved', quote: 'Quote', report: 'Report',
            follow: 'Follow', unfollow: 'Unfollow', back: 'Back', close: 'Close',
            send: 'Send', title: 'Title', body: 'What is your question?', category: 'Forum Category',
            titlePh: 'Write a clear, descriptive title…', bodyPh: 'Write it out, make the question clear…',
            subscribe: 'Notify me of replies', sendTopic: 'Post topic',
            empty: 'Nothing here yet.', loading: 'Loading topics…',
            failed: 'Could not be read.', retry: 'Retry', more: 'Show more',
            now: 'now', m: 'm', h: 'h', d: 'd', ago: 'ago', by: 'by',
            sticky: 'Sticky', closed: 'Closed', isnew: 'New',
            active: 'Active forums', help: 'Needs an answer', helpNote: 'Topics waiting for help with no reply',
            stats: ['forums', 'topics', 'posts', 'active today'],
            theme: 'Theme', themeDark: 'Dark Mode', themeLight: 'Light Mode',
            sortLast: 'Latest reply', sortReplies: 'Most replies', sortViews: 'Most views',
            allForums: 'All forums', topicsIn: 'topics', postsIn: 'posts',
            searchTitle: 'Search', results: 'results', inForum: 'in',
            login: 'Sign in', signup: 'Join Scratch', signedOut: 'Guest',
            foot: 'Forum view by ScratchDream. Reads Scratch’s own pages.',
            emptyPost: 'Please write something first.', open: 'Open topic', pageWord: 'Page', noMore: 'No more pages',
            savedEmpty: 'No saved topics yet. Tap the bookmark on any topic.',
            helpEmpty: 'Nothing is waiting for an answer right now.', mine: 'My topics', sortNew: 'Newest',
            langTitle: 'Language / Dil Seçeneği', refreshFeed: 'Refresh Explore Feed', linkCopied: 'Topic link copied to clipboard!'
        };
    }

    var L = buildLocale(CUR_LANG);
    var NUM = CUR_LANG === 'tr' ? 'tr-TR' : 'en-US';

    function setLanguage(lang) {
        CUR_LANG = lang;
        TR = lang === 'tr';
        try {
            localStorage.setItem('sd-x-lang', lang);
        } catch (e) {}
        L = buildLocale(CUR_LANG);
        NUM = CUR_LANG === 'tr' ? 'tr-TR' : 'en-US';
        paintSidebar();
        paintRail();
        if (state.tab === 'trend') paintTrend(true);
        else if (state.tab === 'forums') paintForums();
        else if (state.tab === 'help') paintHelp();
        else if (state.tab === 'saved') paintSaved();
    }
    var HOT = ['31', '7', '1', '29', '4', '30'];
    var TTL = 45 * 1000;
    var LIKES_KEY = 'sd-x-likes:v1';

    function getLikes() {
        try {
            return JSON.parse(localStorage.getItem(LIKES_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function isLiked(id) {
        return !!getLikes()[id];
    }

    function toggleLike(id) {
        var map = getLikes();
        if (map[id]) {
            delete map[id];
        } else {
            map[id] = 1;
        }
        try {
            localStorage.setItem(LIKES_KEY, JSON.stringify(map));
        } catch (e) {}
        return !!map[id];
    }

    function parseScratchblocks(codeStr) {
        if (!codeStr) return [];
        var rawLines = (codeStr || '').replace(/<br\s*\/?>/gi, '\n').split('\n');
        var blocks = [];
        for (var i = 0; i < rawLines.length; i++) {
            var raw = rawLines[i].trim();
            if (!raw) continue;
            // Split chained single-line blocks like "foo :: greyforever :: greycurrent"
            var subParts = raw.split(/\s*::\s*(?=[a-z]+(?:forever|repeat|if|else|end|when|set|say|turn|move|wait|define|touching|change))/i);
            if (subParts.length > 1) {
                for (var s = 0; s < subParts.length; s++) {
                    var sp = subParts[s].trim();
                    if (sp) blocks.push(sp);
                }
            } else {
                blocks.push(raw);
            }
        }
        return blocks.slice(0, 7);
    }

    function renderBlockLine(line) {
        if (!line) return null;
        var clean = line.trim().replace(/<br\s*\/?>/gi, '');
        if (!clean) return null;

        // Extract inline comment: "// comment text"
        var comment = '';
        var cIdx = clean.indexOf('//');
        if (cIdx !== -1) {
            comment = clean.slice(cIdx + 2).trim();
            clean = clean.slice(0, cIdx).trim();
        }

        // Extract explicit category/shape tag: ":: category [shape]"
        var explicitCat = '';
        var isHat = false;
        var isEnd = false;
        var tagMatch = /::\s*([a-zA-Z0-9_-]+)(?:\s+([a-zA-Z0-9_-]+))?/i.exec(clean);
        if (tagMatch) {
            var t1 = (tagMatch[1] || '').toLowerCase();
            var t2 = (tagMatch[2] || '').toLowerCase();
            if (t1 === 'hat' || t2 === 'hat') isHat = true;
            if (t1 === 'end' || t2 === 'end') isEnd = true;
            if (t1 && !/hat|reporter|boolean|stack|cap|c-block|end/i.test(t1)) {
                explicitCat = t1;
            }
            clean = clean.slice(0, tagMatch.index).trim();
        }

        if (!clean) return null;

        var cat = explicitCat;
        if (!cat) {
            if (/^when\b|broadcast|receive|cloned|green flag/i.test(clean)) cat = 'events';
            else if (/^forever\b|^repeat\b|^if\b|^else\b|^wait\b|^stop\b/i.test(clean)) cat = 'control';
            else if (/^say\b|^think\b|costume|backdrop|size|show\b|hide\b/i.test(clean)) cat = 'looks';
            else if (/play|sound|volume/i.test(clean)) cat = 'sound';
            else if (/touching|mouse|key\b|distance|ask\b|timer/i.test(clean)) cat = 'sensing';
            else if (/pick random|join|letter|length|\+|-|\*|\/|<|>|=/i.test(clean)) cat = 'operators';
            else if (/set\b|change.*by|show variable|hide variable|add.*to|delete/i.test(clean)) cat = 'data';
            else if (/^define\b/i.test(clean)) cat = 'custom';
            else if (/extension/i.test(clean)) cat = 'extension';
            else cat = 'motion';
        }
        if (/^when\b|^define\b/i.test(clean)) isHat = true;

        var b = el('div', 'x-sblock x-sb-' + cat + (isHat ? ' x-sblock-hat' : '') + (isEnd ? ' x-sblock-end' : ''));
        var html = clean
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\bgreen flag\b/gi, '<span class="x-b-flag">⚑</span>')
            .replace(/\(([^\)]+)\)/g, '<span class="x-b-in">$1</span>')
            .replace(/\[([^\]]+)\]/g, '<span class="x-b-drop">$1 ▾</span>')
            .replace(/([a-zA-Z0-9_]+)\s+v\b/g, '<span class="x-b-drop">$1 ▾</span>');
        b.innerHTML = html;

        if (comment) {
            var wrap = el('div', 'x-b-wrap');
            wrap.appendChild(b);
            var commEl = el('span', 'x-b-comment', '// ' + (comment.length > 55 ? comment.slice(0, 52) + '…' : comment));
            wrap.appendChild(commEl);
            return wrap;
        }

        return b;
    }

    function renderBlockStack(codeStr) {
        var stack = el('div', 'x-block-stack');
        var lines = parseScratchblocks(codeStr);
        var bBody = el('div', 'x-stack-body');
        lines.forEach(function (l) {
            var b = renderBlockLine(l);
            if (b) bBody.appendChild(b);
        });
        stack.appendChild(bBody);
        return stack;
    }

    // ---------------------------------------------------------------- small helpers
    function fmt(n) {
        return (n || 0).toLocaleString(NUM);
    }

    function num(val) {
        if (!val) return 0;
        var str = typeof val === 'string' ? val : (val.textContent || '');
        var cleaned = str.replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    }

    function userOf(node) {
        if (!node) return '';
        var link = node.querySelector ? node.querySelector('a') : null;
        if (link) return link.textContent.trim();
        var txt = (node.textContent || '').trim();
        txt = txt.replace(/^(by|yazan|par|von|de|od|от)\s+/i, '').trim();
        txt = txt.replace(/\s+tarafından$/i, '').trim();
        return txt;
    }

    function refreshSelf() {
        if (typeof paintSidebar === 'function') paintSidebar();
    }

    function ago(ms) {
        if (!ms) return '—';
        var s = (Date.now() - ms) / 1000;
        if (s < 90) return L.now;
        if (s < 3600) return Math.round(s / 60) + ' ' + L.m;
        if (s < 172800) return Math.round(s / 3600) + ' ' + L.h;
        return Math.round(s / 86400) + ' ' + L.d;
    }

    function agoAt(ms) {
        var t = ago(ms);
        return t === L.now ? t : t + ' ' + L.ago;
    }

    function cn(el, cls) {
        if (el) el.className = cls;
        return el;
    }

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function a(cls, href, text) {
        var node = el('a', cls, text);
        node.href = href;
        return node;
    }

    function on(node, fn) {
        node.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            fn(event);
        });
        return node;
    }

    function hue(name) {
        var h = 0;
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
        return h;
    }

    // Authentic Scratch 3.0 Palette (matching block categories)
    var SCRATCH_CATS = {
        motion: '#4C97FF',     // Motion Blue
        looks: '#9966FF',      // Looks Violet
        sound: '#CF63CF',      // Sound Magenta
        events: '#FFBF00',     // Events Yellow
        control: '#FFAB19',    // Control Orange
        sensing: '#5CB1D6',    // Sensing Cyan
        operators: '#59C059',  // Operators Green
        variables: '#FF8C1A',  // Variables Orange
        custom: '#FF6680'      // Alert/Bug Pink
    };

    function catColor(name) {
        var n = (name || '').toLowerCase();
        if (/script|code|kod/.test(n)) return SCRATCH_CATS.operators;
        if (/bug|hata|glitch/.test(n)) return SCRATCH_CATS.custom;
        if (/suggest|öneri/.test(n)) return SCRATCH_CATS.control;
        if (/question|soru|help|yardım/.test(n)) return SCRATCH_CATS.motion;
        if (/show|tell|göster/.test(n)) return SCRATCH_CATS.sensing;
        if (/new|yeni/.test(n)) return SCRATCH_CATS.looks;
        if (/collab|işbirliği/.test(n)) return SCRATCH_CATS.variables;
        if (/request|istek/.test(n)) return SCRATCH_CATS.sound;
        return SCRATCH_CATS.motion;
    }


    function initials(name) {
        return (name || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';
    }

        // Scratch image CDN & automatic user avatar fetcher: every user gets their real avatar!
    var UIDS = 'sd-x-uids:v1';
    var DEFAULT_AVATAR = 'https://cdn2.scratch.mit.edu/get_image/user/default_60x60.png';
    var UIDMAP = {};
    var AV_QUEUE = [];
    var AV_ACTIVE = 0;
    var AV_PENDING = {};

    try {
        UIDMAP = JSON.parse(localStorage.getItem(UIDS) || '{}') || {};
    } catch (error) { UIDMAP = {}; }

    function saveUids() {
        try {
            localStorage.setItem(UIDS, JSON.stringify(UIDMAP));
        } catch (error) { /* the cache is optional */ }
    }

    function fetchUserAvatar(name) {
        if (!name || name === '?' || name.length > 30 || AV_PENDING[name] || UIDMAP[name]) return;
        AV_PENDING[name] = true;
        AV_QUEUE.push(name);
        pumpAvatarQueue();
    }

    function pumpAvatarQueue() {
        if (AV_ACTIVE >= 4 || !AV_QUEUE.length) return;
        AV_ACTIVE++;
        var username = AV_QUEUE.shift();
        fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(username))
            .then(function (res) {
                if (!res.ok) throw new Error('status ' + res.status);
                return res.json();
            })
            .then(function (data) {
                var images = data && data.profile && data.profile.images;
                var url = images && (images['60x60'] || images['50x50'] || images['90x90'] || images['32x32']);
                var finalUrl = url || DEFAULT_AVATAR;
                if (finalUrl.indexOf('//') === 0) finalUrl = 'https:' + finalUrl;
                UIDMAP[username] = finalUrl;
                saveUids();
                applyAvatarToUser(username, finalUrl);
            })
            .catch(function () {
                // If API 404s or fails (deleted/banned user), fall back to official Scratch cat avatar
                UIDMAP[username] = DEFAULT_AVATAR;
                saveUids();
                applyAvatarToUser(username, DEFAULT_AVATAR);
            })
            .finally(function () {
                AV_ACTIVE--;
                pumpAvatarQueue();
            });
    }

    function applyAvatarToUser(name, url) {
        var sel = '.x-av[data-av-user="' + CSS.escape(name) + '"], .x-av[data-user="' + CSS.escape(name) + '"]';
        try {
            var nodes = document.querySelectorAll(sel);
            Array.prototype.forEach.call(nodes, function (node) {
                setAvatar(node, url);
            });
        } catch (e) {}
    }

    function setAvatar(node, url) {
        if (!node || !url) return;
        node.textContent = '';
        node.style.background = 'transparent';
        node.style.color = 'transparent';
        var img = el('img', 'x-av-img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        node.appendChild(img);
        node.classList.add('x-av-photo');
    }

    function skeleton(n) {
        var wrap = document.createDocumentFragment();
        for (var i = 0; i < n; i++) {
            var row = el('div', 'x-sk');
            row.appendChild(el('span', 'x-sk-av'));
            var body = el('div', 'x-sk-b');
            body.appendChild(el('i', 'x-sk-l x-w60'));
            body.appendChild(el('i', 'x-sk-l x-w90'));
            body.appendChild(el('i', 'x-sk-l x-w40'));
            row.appendChild(body);
            wrap.appendChild(row);
        }
        return wrap;
    }

    function hash(str) {
        var h = 0;
        var s = String(str || '');
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
        return Math.abs(h);
    }

    function avatarNode(name, extraClass) {
        var box = el('div', 'x-av' + (extraClass ? ' ' + extraClass : ''));
        var cleanName = (name || '?').trim();
        box.dataset.avUser = cleanName;
        box.dataset.user = cleanName;
        box.textContent = cleanName.charAt(0).toUpperCase();
        var cached = UIDMAP[cleanName];
        if (cached) {
            setAvatar(box, cached);
        } else {
            box.style.background = 'hsl(' + (hash(cleanName) % 360) + ', 45%, 45%)';
            box.style.color = '#fff';
            if (cleanName && cleanName !== '?') {
                fetchUserAvatar(cleanName);
            }
        }
        return box;
    }

    function avatarPic(node, name) {
        if (!name || name === '?') return;
        node.dataset.user = name;
        node.dataset.avUser = name;
        if (UIDMAP[name]) {
            setAvatar(node, UIDMAP[name]);
        } else {
            fetchUserAvatar(name);
        }
    }

    function applyKnownAvatars() {
        Array.prototype.forEach.call(document.querySelectorAll('.x-av[data-user]'), function (node) {
            var url = UIDMAP[node.dataset.user];
            if (url) setAvatar(node, url);
        });
    }

    var ICONS = {
        home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21h4"/>',
        mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
        bookmark: '<path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c1.8-4 4.5-5.2 7.5-5.2s5.7 1.2 7.5 5.2"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        reply: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
        eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
        dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        send: '<path d="M4 12 20 4l-6 16-3.2-6.4z"/>',
        back: '<path d="M15 5l-7 7 7 7"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
        moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
        flag: '<path d="M5 21V4c4.5-1.8 9 1.8 14 0v9c-5 1.8-9.5-1.8-14 0"/>',
        logo: '<path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z"/><path d="M8.4 10.3h5.2a2 2 0 1 1 0 4H9.8"/>',
        pin: '<path d="M9 3h6l-1 6 4 4v1H6v-1l4-4z"/><path d="M12 14v7"/>',
        grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"/>',
        help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 1.9-2.4 3.3"/><path d="M12 17.2h.01"/>',
        chat: '<path d="M4 5.5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
        code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
        bug: '<path d="m9 9-4-3m0 9 4-3m6-3 4-3m0 9-4-3M10 5a2 2 0 0 1 4 0v1h-4zm-1 5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/>',
        sparkle: '<path d="m12 3 2.8 5.6L21 11.4l-4.5 4.4 1 6.2L12 19l-5.5 3 1-6.2L3 11.4l6.2-2.8z"/>',
        chev: '<path d="m6 9 6 6 6-6"/>',
        heart: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/>',
        star: '<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>',
        remix: '<path d="M7 7h11v3l4-4-4-4v3H5v6h2V7zm10 10H6v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
        chevL: '<path d="m15 18-6-6 6-6"/>',
        chevR: '<path d="m9 18 6-6-6-6"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        mapPin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/>',
        globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
        refresh: '<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>',
        share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>'
    };

    function icon(name, cls) {
        var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('width', '18');
        s.setAttribute('height', '18');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '1.7');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        s.setAttribute('aria-hidden', 'true');
        if (cls) s.setAttribute('class', cls);
        s.innerHTML = ICONS[name] || '';
        return s;
    }

    function makeFormattingToolbar(textarea) {
        var bar = el('div', 'x-format-bar');
        var tools = [
            ['B', 'Kalın / Bold', '[b]', '[/b]'],
            ['I', 'Eğik / Italic', '[i]', '[/i]'],
            ['Link', 'Bağlantı / URL', '[url=https://scratch.mit.edu]', '[/url]'],
            ['Blocks', 'Scratch Blocks', '[scratchblocks]\n', '\n[/scratchblocks]'],
            ['Quote', 'Alıntı / Quote', '[quote]', '[/quote]'],
            ['Code', 'Kod / Code', '[code]', '[/code]'],
            ['Img', 'Resim / Image', '[img]', '[/img]']
        ];
        tools.forEach(function (t) {
            var btn = el('button', 'x-fbtn');
            btn.type = 'button';
            btn.textContent = t[0];
            btn.title = t[1];
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var start = textarea.selectionStart;
                var end = textarea.selectionEnd;
                var sel = textarea.value.substring(start, end) || (t[0] === 'Blocks' ? 'when green flag clicked\nmove (10) steps' : 'metin');
                var replace = t[2] + sel + t[3];
                textarea.setRangeText(replace, start, end, 'select');
                textarea.focus();
                textarea.dispatchEvent(new Event('input'));
            });
            bar.appendChild(btn);
        });
        return bar;
    }

    var MON = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        oca: 0, 'şub': 1, sub: 1, nis: 3, haz: 5, tem: 6, agu: 7, 'ağu': 7, eyl: 8, eki: 9, kas: 10, ara: 11
    };

    function whenMs(text) {
        var t = (text || '').replace(/\s+/g, ' ').trim();
        var clock = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
        if (!clock) return 0;
        var d = new Date();
        d.setHours(+clock[1], +clock[2], +(clock[3] || 0), 0);
        if (/^(today|bugün|heute)/i.test(t)) return d.getTime();
        if (/^(yesterday|dün|gestern)/i.test(t)) {
            d.setDate(d.getDate() - 1);
            return d.getTime();
        }
        var m = /^([^\s.,]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
        if (!m) return 0;
        var idx = MON[m[1].slice(0, 3).toLowerCase()];
        if (idx === undefined) return 0;
        d.setFullYear(+m[3], idx, +m[2]);
        return d.getTime();
    }

    var NATIVE = {
        csrf: '', replyForm: null, body: null, follow: null, following: false,
        quotes: {}, reports: {}
    };

    function capture() {
        var csrf = document.querySelector('input[name="csrfmiddlewaretoken"]');
        NATIVE.csrf = csrf ? csrf.value : '';
        var ta = document.querySelector('textarea[name="body"]');
        NATIVE.body = ta;
        NATIVE.replyForm = ta ? ta.form : null;
        var add = document.querySelector('form[action*="/subscription/topic/"][action$="/add/"]');
        var del = document.querySelector('form[action*="/subscription/topic/"][action$="/delete/"]');
        NATIVE.follow = del || add;
        NATIVE.following = !!del;
        Array.prototype.forEach.call(document.querySelectorAll('.blockpost[id^="p"]'), function (post) {
            var id = post.id.slice(1);
            Array.prototype.forEach.call(post.querySelectorAll('a,button'), function (node) {
                var text = (node.textContent || '').trim().toLowerCase();
                var title = (node.getAttribute('title') || '').toLowerCase();
                var click = (node.getAttribute('onclick') || '').toLowerCase();
                if (!NATIVE.quotes[id] &&
                    (text === 'quote' || text === 'alıntı' || /insert.?quote/.test(click) ||
                        /quotation/.test(title))) NATIVE.quotes[id] = node;
                if (!NATIVE.reports[id]) {
                    var href = node.getAttribute('href') || '';
                    if (/action=report/.test(href)) NATIVE.reports[id] = node.href;
                }
            });
        });
    }

    // ---------------------------------------------------------------- parsing
    function parseTopics(root, cat) {
        var out = [];
        Array.prototype.forEach.call(root.querySelectorAll('td.tcl'), function (cell) {
            var link = cell.querySelector('h3 a[href*="/discuss/topic/"]');
            if (!link) return;
            var m = /\/discuss\/topic\/(\d+)/.exec(link.getAttribute('href'));
            if (!m) return;
            var row = link.closest('tr');
            var tc2 = row.querySelector('td.tc2');
            var tc3 = row.querySelector('td.tc3');
            var tcr = row.querySelector('td.tcr');
            var catLink = tc2 && tc2.querySelector('a[href^="/discuss/"]');
            var repliesVal = catLink ? num(tc3) : num(tc2);
            var viewsVal = catLink ? (repliesVal * 14 + 10) : num(tc3);
            out.push({
                id: m[1],
                title: link.textContent.trim(),
                author: userOf(cell.querySelector('.byuser')),
                replies: repliesVal,
                views: viewsVal,
                catId: cat ? cat.id : (catLink ? (/\/discuss\/(\d+)/.exec(catLink.getAttribute('href')) || [])[1] : ''),
                catName: cat ? cat.name : (catLink ? catLink.textContent.trim() : ''),
                ms: whenMs(tcr && tcr.textContent),
                sticky: !!cell.querySelector('.isticky'),
                closed: !!cell.querySelector('.iclosed') || /\bclosed\b/.test(row.className || ''),
                isnew: !!cell.querySelector('.inew')
            });
        });
        return out;
    }

    function parseTopicPosts(doc) {
        var root = doc || document;
        var out = [];
        Array.prototype.forEach.call(root.querySelectorAll('.blockpost[id^="p"]'), function (post) {
            var user = post.querySelector('.postleft dt a');
            var body = post.querySelector('.postmsg .post_body_html') || post.querySelector('.postmsg');
            var av = post.querySelector('.postavatar img');
            var head = post.querySelector('.box-head a');
            var uname = user ? user.textContent.trim() : '?';
            var avSrc = av ? av.getAttribute('src') : '';
            if (uname && uname !== '?' && avSrc) UIDMAP[uname] = avSrc;
            out.push({
                id: post.id.slice(1),
                num: (post.querySelector('.conr') || {}).textContent || '',
                user: uname,
                href: user ? user.getAttribute('href') : '/',
                avatar: avSrc,
                ms: whenMs(head ? head.textContent : ''),
                html: body ? body.cloneNode(true) : el('p', null, ''),
                edited: (post.querySelector('.postedit') || {}).textContent || ''
            });
        });
        saveUids();
        return out;
    }

    // ---------------------------------------------------------------- cached network reads
    // anonymous on purpose: Scratch's cache answers an anonymous forum page instead of Django
    // rebuilding it, and the feed is public anyway
    var memo = {};

    function cacheGet(key, url, parse, done) {
        if (memo[key]) return done(memo[key]);
        try {
            var hit = JSON.parse(localStorage.getItem('sd-x:' + key) || 'null');
            if (hit && hit.at && Date.now() - hit.at < TTL) {
                memo[key] = hit.v;
                return done(hit.v);
            }
        } catch (error) { /* private mode keeps the session uncached */ }
        fetch(url, {credentials: 'omit'}).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.text();
        }).then(function (text) {
            var doc = new DOMParser().parseFromString(text, 'text/html');
            var value = parse(doc);
            memo[key] = value;
            try {
                localStorage.setItem('sd-x:' + key, JSON.stringify({at: Date.now(), v: value}));
            } catch (error) { /* quota is not worth failing the view for */ }
            done(value);
        }).catch(function (e) {
            done(null);
        });
    }

    var indexCache = null;

    function loadIndex(done) {
        if (indexCache) return done(indexCache);
        if (KIND === 'home') {
            var localCats = parseIndexFrom(document);
            if (localCats && localCats.length) {
                indexCache = localCats;
                try {
                    localStorage.setItem('sd-x:index', JSON.stringify({at: Date.now(), v: localCats}));
                } catch (error) {}
                return done(localCats);
            }
        }
        cacheGet('index', '/discuss/', function (doc) {
            return parseIndexFrom(doc);
        }, function (cats) {
            indexCache = cats && cats.length ? cats : null;
            done(cats || []);
        });
    }

    // the same reader as the category table, pointed at a parsed document instead of the live page
    function parseIndexFrom(doc) {
        var out = [];
        Array.prototype.forEach.call(doc.querySelectorAll('table tr'), function (row) {
            var cell = row.querySelector('td.tcl');
            if (!cell) return;
            var link = cell.querySelector('h3 a[href^="/discuss/"]');
            if (!link) return;
            var m = /^\/discuss\/(\d+)\/?$/.exec(link.getAttribute('href'));
            if (!m) return;
            var tclcon = cell.querySelector('.tclcon');
            var copy = tclcon ? tclcon.cloneNode(true) : null;
            if (copy) Array.prototype.forEach.call(copy.querySelectorAll('h3,.byuser'), function (n) {
                n.remove();
            });
            out.push({
                id: m[1],
                name: link.textContent.trim(),
                desc: copy ? copy.textContent.replace(/\s+/g, ' ').trim() : '',
                topics: num(row.querySelector('td.tc2')),
                posts: num(row.querySelector('td.tc3')),
                ms: whenMs((row.querySelector('td.tcr a') || {}).textContent)
            });
        });
        return out;
    }

    var MED_KEY = 'sd-x-med:v2';
    var MED_CACHE = {};
    try {
        MED_CACHE = JSON.parse(localStorage.getItem(MED_KEY) || '{}') || {};
    } catch (e) { MED_CACHE = {}; }

    function saveMedCache() {
        try {
            localStorage.setItem(MED_KEY, JSON.stringify(MED_CACHE));
        } catch (e) {}
    }

    function enrichTopic(topic, onUpdate) {
        if (!topic || !topic.id) return;
        var hit = MED_CACHE[topic.id];
        if (hit) {
            topic.media = hit.media;
            topic.snippet = hit.snippet;
            return;
        }
        fetchDoc('/discuss/topic/' + topic.id + '/').then(function (tdoc) {
            var firstPost = tdoc.querySelector('.blockpost[id^="p"]');
            if (!firstPost) return;
            var postMsg = firstPost.querySelector('.postmsg');
            if (!postMsg) return;

            var imgs = postMsg.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) {
                var isrc = imgs[i].getAttribute('src') || '';
                if (isrc && !/\/smilies\//i.test(isrc) && !/\/avatars?\//i.test(isrc)) {
                    topic.media = { type: 'image', src: isrc };
                    break;
                }
            }

            if (!topic.media) {
                var pLink = postMsg.querySelector('a[href*="/projects/"]');
                if (pLink) {
                    var pMatch = /\/projects\/(\d+)/.exec(pLink.getAttribute('href') || '');
                    if (pMatch) {
                        topic.media = { type: 'project', id: pMatch[1], title: pLink.textContent.trim() || 'Scratch Project' };
                    }
                }
            }

            var cleanText = postMsg.textContent.replace(/\s+/g, ' ').trim();
            if (cleanText.length > 20) {
                topic.snippet = cleanText.slice(0, 180) + '…';
            }

            MED_CACHE[topic.id] = { media: topic.media, snippet: topic.snippet };
            saveMedCache();
            if (onUpdate && (topic.media || topic.snippet)) onUpdate(topic);
        }).catch(function () {});
    }

    function loadFeed(cats, done, onEnrich, forceFresh) {
        if (!cats || !cats.length) return done([]);

        var activePool = ['4', '8', '6', '10', '9', '29', '30', '31', '7', '48', '49', '60', '3', '1'];
        var selectedCats = [];
        if (CUR_LANG === 'tr') {
            var trCat = cats.filter(function (c) { return c.id === '43'; })[0];
            if (trCat) selectedCats.push(trCat);
        }

        // Randomly sample 5 diverse active categories from the pool for exciting variety on each refresh
        var shuffledPool = activePool.slice().sort(function () { return 0.5 - Math.random(); });
        for (var i = 0; i < shuffledPool.length && selectedCats.length < 6; i++) {
            var cId = shuffledPool[i];
            var fCat = cats.filter(function (c) { return c.id === cId; })[0];
            if (fCat && !selectedCats.some(function (sc) { return sc.id === fCat.id; })) {
                selectedCats.push(fCat);
            }
        }

        var left = selectedCats.length;
        var all = [];
        selectedCats.forEach(function (cat) {
            var cacheKey = 'cat:' + cat.id;
            if (forceFresh) {
                delete memo[cacheKey];
                try { localStorage.removeItem('sd-x:' + cacheKey); } catch (e) {}
            }
            cacheGet(cacheKey, '/discuss/' + cat.id + '/' + (forceFresh ? '?_t=' + Date.now() : ''), function (doc) {
                return parseTopics(doc, cat);
            }, function (list) {
                if (list) all = all.concat(list);
                if (--left === 0) {
                    var seen = {};
                    var merged = all.filter(function (t) {
                        if (seen[t.id]) return false;
                        seen[t.id] = 1;
                        return !!t.ms;
                    });

                    merged.forEach(function (t) {
                        var score = 0;
                        var hoursAgo = Math.max(0.1, (Date.now() - (t.ms || 0)) / (3600 * 1000));
                        var recencyBoost = Math.max(0, 130 - Math.pow(hoursAgo, 0.5) * 16);
                        score += recencyBoost;
                        score += Math.min((t.replies || 0) * 2, 40);
                        score += Math.min((t.views || 0) / 15, 25);

                        // Don't let old pinned sticky threads dominate on every refresh
                        if (t.sticky) score -= 35;
                        if (CUR_LANG === 'tr' && t.catId === '43') score += 35;

                        // Exploration factor: ensures topics rotate dynamically upon every refresh
                        score += (Math.random() - 0.5) * 55;
                        t.score = score;
                    });

                    var blended = diversityBlend(merged);
                    done(blended);

                    var topCand = blended.slice(0, 8);
                    topCand.forEach(function (topic, idx) {
                        if (!MED_CACHE[topic.id]) {
                            setTimeout(function () {
                                enrichTopic(topic, onEnrich);
                            }, idx * 120);
                        }
                    });
                }
            });
        });
    }

    function diversityBlend(topics) {
        var sorted = topics.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
        var result = [];
        var catCounts = {};
        var deferred = [];

        sorted.forEach(function (t) {
            var cId = t.catId || 'other';
            catCounts[cId] = catCounts[cId] || 0;
            if (catCounts[cId] < 2 || result.length < 3) {
                catCounts[cId]++;
                result.push(t);
            } else {
                deferred.push(t);
            }
        });
        return result.concat(deferred);
    }

    function loadUnanswered(done) {
        cacheGet('unanswered', '/discuss/search/?action=show_unanswered', function (doc) {
            return parseTopics(doc, null);
        }, function (list) {
            done(list || []);
        });
    }

    // ---------------------------------------------------------------- saves (bookmarks)
    var SAVES = 'sd-x-saves:v1';

    function saves() {
        try {
            return JSON.parse(localStorage.getItem(SAVES) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    function isSaved(id) {
        return !!saves()[id];
    }

    function toggleSave(topic) {
        var all = saves();
        if (all[topic.id]) delete all[topic.id];
        else all[topic.id] = {
            id: topic.id, title: topic.title, catId: topic.catId || '',
            catName: topic.catName || '', ms: topic.ms || 0, saw: Date.now()
        };
        try {
            localStorage.setItem(SAVES, JSON.stringify(all));
        } catch (error) { /* a full quota keeps the toggle visual only */ }
        return !!all[topic.id];
    }

    // ---------------------------------------------------------------- shell
    var app = null, mainFeed = null, mainHead = null, sideUser = null, sidebar = null;
    var state = {tab: 'trend', sort: 'last', cats: [], me: null, messages: 0, unanswered: null};

    function theme() {
        return document.documentElement.classList.contains('sd-x-light') ? 'light' : 'dark';
    }

    function paintTheme() {
        document.documentElement.classList.toggle('sd-x-light', theme() === 'light');
        document.documentElement.classList.toggle('sd-x-dark', theme() !== 'light');
        var btn = document.querySelector('.x-themebtn');
        if (btn) {
            btn.innerHTML = '';
            btn.appendChild(icon(theme() === 'light' ? 'moon' : 'sun'));
            btn.appendChild(el('span', null, theme() === 'light' ? L.themeDark : L.themeLight));
            btn.title = L.theme;
        }
    }

    function shell() {
        app = el('div', 'x-app');
        app.id = 'sd-x';
        sidebar = el('aside', 'x-side');
        var main = el('main', 'x-main');
        mainHead = el('header', 'x-top');
        mainFeed = el('div', 'x-feed');
        main.appendChild(mainHead);
        main.appendChild(mainFeed);
        app.appendChild(sidebar);
        app.appendChild(main);
        app.appendChild(el('aside', 'x-rail', ''));
        app.appendChild(mobileNav());
        document.body.appendChild(app);
        paintSidebar();
        paintRail();
    }

    function navRow(name, label, href, active) {
        var row = a('x-nav' + (active ? ' on' : ''), href);
        row.appendChild(icon(name));
        row.appendChild(el('span', null, label));
        return row;
    }

    function paintSidebar() {
        if (!sidebar) return;
        sidebar.innerHTML = '';
        var logo = a('x-logo', '/discuss/');
        var brandText = el('span', 'x-brand-title');
        var bScratch = el('span', 'x-brand-scratch', 'Scratch');
        var bForum = el('span', 'x-brand-forum', 'Forum');
        brandText.appendChild(bScratch);
        brandText.appendChild(document.createTextNode(' '));
        brandText.appendChild(bForum);
        logo.appendChild(brandText);
        sidebar.appendChild(logo);

        sidebar.appendChild(navTab('home', L.navHome, 'trend'));
        sidebar.appendChild(navTab('grid', L.navForums, 'forums'));
        sidebar.appendChild(navTab('help', L.navHelp, 'help'));
        sidebar.appendChild(navTab('bookmark', L.navSaved, 'saved'));
        var mine = navRow('user', L.navMine, '/discuss/search/?action=show_user&show_as=topics');
        if (KIND === 'search' && /action=show_user/.test(location.search)) mine.classList.add('on');
        sidebar.appendChild(mine);

        var cta = el('button', 'x-cta', L.newTopic);
        cta.type = 'button';
        cta.addEventListener('click', function () {
            openCompose();
        });
        sidebar.appendChild(cta);

        sideUser = el('div', 'x-me');
        if (state.me) {
            var link = a('x-me-link', '/users/' + encodeURIComponent(state.me) + '/');
            link.addEventListener('click', function (e) {
                e.preventDefault();
                openProfile(state.me);
            });
            link.appendChild(avatarNode(state.me, 'x-av-sm'));
            var who = el('div', 'x-me-t');
            who.appendChild(el('b', null, state.me));
            if (state.messages) who.appendChild(el('span', null, state.messages + ' ' + L.navMail.toLowerCase()));
            link.appendChild(who);
            sideUser.appendChild(link);
        } else {
            var links = el('div', 'x-me-links');
            links.appendChild(a('x-login', '/login/', L.login));
            links.appendChild(a('x-join', '/join/', L.signup));
            sideUser.appendChild(links);
        }
        sidebar.appendChild(sideUser);
        paintTheme();
    }

    function navTab(name, label, tab) {
        var on = (KIND === 'home' && state.tab === tab) ||
            (tab === 'trend' && (KIND === 'cat' || KIND === 'topic'));
        var row = a('x-nav' + (on ? ' on' : ''),
            '/discuss/' + (tab === 'trend' ? '' : '?view=' + tab));
        row.appendChild(icon(name));
        row.appendChild(el('span', null, label));
        row.addEventListener('click', function (event) {
            event.preventDefault();
            if (KIND !== 'home') {
                navigate('/discuss/' + (tab === 'trend' ? '' : '?view=' + tab));
            } else {
                setView(tab);
            }
        });
        return row;
    }

    function setView(tab) {
        state.tab = tab;
        try {
            history.pushState(null, '', '/discuss/' + (tab === 'trend' ? '' : '?view=' + tab));
        } catch (error) { /* the view still changes without the address */ }
        paintSidebar();
        viewHome();
    }

    function mobileNav() {
        var bar = el('nav', 'x-mobnav');
        var isSearch = KIND === 'search';
        var isHome = KIND === 'home' && (!state.tab || state.tab === 'trend');
        var isForums = KIND === 'cat' || (KIND === 'home' && state.tab === 'forums');
        var isSaved = KIND === 'home' && state.tab === 'saved';
        var isProfile = KIND === 'home' && state.tab === 'profile';

        var navList = [
            { id: 'home', icon: 'home', label: L.trend, path: '/discuss/', active: isHome },
            { id: 'search', icon: 'search', label: L.searchTitle, path: '/discuss/search/', active: isSearch },
            { id: 'forums', icon: 'grid', label: L.forumsTab, path: '/discuss/?view=forums', active: isForums },
            { id: 'saved', icon: 'bookmark', label: L.savedTab, path: '/discuss/?view=saved', active: isSaved },
            { id: 'user', icon: 'user', label: state.me ? '@' + state.me : L.login, path: state.me ? '/discuss/?user=' + encodeURIComponent(state.me) : '/login/', active: isProfile }
        ];

        navList.forEach(function (item) {
            var link = a('x-mob' + (item.active ? ' on' : ''), item.path);
            link.appendChild(icon(item.icon));
            link.appendChild(el('span', 'x-mob-lbl', item.label));
            link.addEventListener('click', function (e) {
                e.preventDefault();
                if (item.id === 'user' && state.me) {
                    openProfile(state.me);
                } else if (item.id === 'home') {
                    navigate('/discuss/');
                } else {
                    navigate(item.path);
                }
            });
            bar.appendChild(link);
        });

        // Floating Action Button on mobile
        var fab = el('button', 'x-mob-fab');
        fab.type = 'button';
        fab.title = L.newTopic;
        fab.setAttribute('aria-label', L.newTopic);
        fab.appendChild(icon('plus'));
        fab.addEventListener('click', function (e) {
            e.stopPropagation();
            openCompose();
        });
        bar.appendChild(fab);

        return bar;
    }

    function header(title, sub) {
        mainHead.innerHTML = '';
        var row = el('div', 'x-top-inner');
        var back = on(a('x-iconbtn x-back', '/discuss/'), function () {
            history.length > 1 ? history.back() : (location.href = '/discuss/');
        });
        back.appendChild(icon('back'));
        row.appendChild(back);
        var head = el('div', 'x-top-t');
        head.appendChild(el('h1', 'x-title', title));
        if (sub) head.appendChild(el('p', 'x-sub', sub));
        row.appendChild(head);
        row.appendChild(a('x-iconbtn x-searchbtn', '/discuss/search/', '').appendChild(icon('search')).parentNode);
        mainHead.appendChild(row);
        return row;
    }

    function tabs(items, active, go, cls, rightEl) {
        var bar = el('div', 'x-tabs ' + (cls || ''));
        items.forEach(function (item) {
            var b = el('button', 'x-tab' + (item[0] === active ? ' on' : ''), item[1]);
            b.type = 'button';
            b.addEventListener('click', function () {
                go(item[0]);
            });
            bar.appendChild(b);
        });
        if (rightEl) {
            rightEl.classList.add('x-tab-right');
            bar.appendChild(rightEl);
        }
        mainHead.appendChild(bar);
        return bar;
    }

    function note(text, failed, retry) {
        var box = el('div', 'x-note');
        box.appendChild(el('p', null, text));
        if (retry) {
            var b = el('button', 'x-send', L.retry);
            b.type = 'button';
            b.addEventListener('click', retry);
            box.appendChild(b);
        }
        if (failed) box.classList.add('x-fail');
        return box;
    }

    // ---------------------------------------------------------------- topic cards (Twitter / X Tweet Card)
    function topicCard(topic) {
        var card = el('article', 'x-item x-tweet-card');
        card.tabIndex = 0;
        card.dataset.topicId = String(topic.id);

        var av = avatarNode(topic.author);
        if (topic.author) {
            av.style.cursor = 'pointer';
            av.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openProfile(topic.author);
            });
        }
        card.appendChild(av);

        var body = el('div', 'x-tweet-content');

        // Top line: Name @handle · time + Category Pill + Bookmark
        var head = el('div', 'x-tweet-head');
        var uLink = a('x-tweet-name', '/users/' + encodeURIComponent(topic.author || '') + '/', topic.author || '?');
        head.appendChild(uLink);

        var badge = el('span', 'x-verified-badge');
        badge.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24"><path fill="#4C97FF" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        head.appendChild(badge);

        var handle = el('span', 'x-tweet-handle', '@' + (topic.author || '').toLowerCase());
        head.appendChild(handle);

        if (topic.ms) head.appendChild(el('span', 'x-tweet-time', '· ' + ago(topic.ms)));

        if (topic.catName) {
            var cat = a('x-cat', '/discuss/' + topic.catId + '/', topic.catName);
            var cCol = catColor(topic.catName);
            cat.style.setProperty('--cat-c', cCol);
            head.appendChild(cat);
        }

        var save = el('button', 'x-act x-save', '');
        save.type = 'button';
        save.title = isSaved(topic.id) ? L.saved : L.save;
        save.setAttribute('aria-label', save.title);
        save.appendChild(icon('bookmark'));
        if (isSaved(topic.id)) save.classList.add('on');
        save.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            var now = toggleSave(topic);
            save.classList.toggle('on', now);
            save.title = now ? L.saved : L.save;
            toast(now ? L.saved : L.save);
        });
        head.appendChild(save);
        body.appendChild(head);

        // Tweet Title / Text
        var title = a('x-tweet-title', '/discuss/topic/' + topic.id + '/');
        title.appendChild(el('span', null, topic.title));
        body.appendChild(title);

        if (topic.snippet) {
            var snip = el('p', 'x-tweet-snippet', topic.snippet);
            body.appendChild(snip);
        }

        // Embedded Visual Media Box (Image or Project)
        if (topic.media) {
            var mediaBox = el('div', 'x-tweet-media');
            if (topic.media.type === 'image') {
                var mImg = el('img', 'x-tweet-img');
                var isrc = topic.media.src;
                mImg.src = isrc.indexOf('//') === 0 ? 'https:' + isrc : isrc;
                mImg.alt = topic.title;
                mImg.loading = 'lazy';
                mImg.onerror = function () {
                    if (mediaBox && mediaBox.parentNode) mediaBox.remove();
                };
                mediaBox.appendChild(mImg);
            } else if (topic.media.type === 'project') {
                var pCard = a('x-tweet-proj-card', 'https://scratch.mit.edu/projects/' + topic.media.id + '/');
                pCard.target = '_blank';
                var pThumb = el('img', 'x-proj-thumb');
                pThumb.src = 'https://cdn2.scratch.mit.edu/get_image/project/' + topic.media.id + '_480x360.png';
                pThumb.onerror = function () {
                    if (mediaBox && mediaBox.parentNode) mediaBox.remove();
                };
                pCard.appendChild(pThumb);
                var pInfo = el('div', 'x-proj-info');
                pInfo.appendChild(el('b', 'x-proj-title', topic.media.title));
                pInfo.appendChild(el('span', 'x-proj-btn', 'Play Project ↗'));
                pCard.appendChild(pInfo);
                mediaBox.appendChild(pCard);
            }
            body.appendChild(mediaBox);
        }

        // Twitter / X Action Strip (Reply, Repost, Like, Views, Share)
        var actions = el('div', 'x-tweet-actions');

        // Reply
        var replyBtn = el('button', 'x-tw-act x-tw-reply');
        replyBtn.type = 'button';
        replyBtn.appendChild(icon('chat'));
        replyBtn.appendChild(el('span', null, fmt(topic.replies || 0)));
        replyBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            navigate('/discuss/topic/' + topic.id + '/#reply');
        });
        actions.appendChild(replyBtn);

        // Repost / Remix
        var repostBtn = el('button', 'x-tw-act x-tw-repost');
        repostBtn.type = 'button';
        repostBtn.appendChild(icon('reply'));
        repostBtn.appendChild(el('span', null, String(Math.floor((topic.views || 0) / 30) || 0)));
        repostBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            navigator.clipboard.writeText('https://scratch.mit.edu/discuss/topic/' + topic.id + '/');
            toast('Topic link copied to share!');
        });
        actions.appendChild(repostBtn);

        // Like (Interactive with Heart Icon & Counter)
        var liked = isLiked(topic.id);
        var likeBtn = el('button', 'x-tw-act x-tw-like' + (liked ? ' on' : ''));
        likeBtn.type = 'button';
        likeBtn.appendChild(icon('heart'));
        var likeCountVal = (topic.replies || 0) + Math.floor((topic.views || 0) / 20) + (liked ? 1 : 0);
        var likeCountSpan = el('span', null, fmt(likeCountVal));
        likeBtn.appendChild(likeCountSpan);
        likeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var nowLiked = toggleLike(topic.id);
            likeBtn.classList.toggle('on', nowLiked);
            likeCountVal += (nowLiked ? 1 : -1);
            likeCountSpan.textContent = fmt(likeCountVal);
            toast(nowLiked ? 'Liked post!' : 'Unliked post');
        });
        actions.appendChild(likeBtn);

        // Views / Impressions
        var viewBtn = el('span', 'x-tw-act x-tw-views');
        viewBtn.appendChild(icon('eye'));
        viewBtn.appendChild(el('span', null, fmt(topic.views || 0)));
        actions.appendChild(viewBtn);

        // Share
        var shareBtn = el('button', 'x-tw-act x-tw-share');
        shareBtn.type = 'button';
        shareBtn.appendChild(icon('external'));
        shareBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            navigator.clipboard.writeText('https://scratch.mit.edu/discuss/topic/' + topic.id + '/');
            toast('Link copied to clipboard!');
        });
        actions.appendChild(shareBtn);

        body.appendChild(actions);
        card.appendChild(body);

        function go() {
            navigate('/discuss/topic/' + topic.id + '/');
        }
        card.addEventListener('click', function (event) {
            if (event.target.closest('a,button')) return;
            go();
        });
        card.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') go();
        });
        return card;
    }

        function catIconName(name) {
        var n = (name || '').toLowerCase();
        if (/script|code|kod/.test(n)) return 'code';
        if (/bug|hata|glitch/.test(n)) return 'bug';
        if (/suggest|öneri/.test(n)) return 'sparkle';
        if (/question|soru|help|yardım/.test(n)) return 'help';
        if (/show|tell|göster/.test(n)) return 'eye';
        if (/new|yeni/.test(n)) return 'user';
        return 'chat';
    }

    function forumCard(cat) {
        var card = a('x-item x-forumcard', '/discuss/' + cat.id + '/');
        card.tabIndex = 0;
        var col = catColor(cat.name);
        var tile = el('div', 'x-cat-icon');
        tile.style.backgroundColor = col;
        tile.style.color = '#FFFFFF';
        tile.appendChild(icon(catIconName(cat.name)));
        card.appendChild(tile);

        var body = el('div', 'x-body');
        var line = el('div', 'x-line1');
        line.appendChild(el('b', 'x-name', cat.name));
        if (cat.id === '43') {
            line.appendChild(el('span', 'x-pill x-pill-tr', '🇹🇷 Türkçe'));
        } else if (WORLD_FORUMS && WORLD_FORUMS[cat.id]) {
            line.appendChild(el('span', 'x-pill', '🌍 International'));
        }
        if (cat.ms) line.appendChild(el('span', 'x-time', '· ' + ago(cat.ms)));
        body.appendChild(line);
        if (cat.desc) body.appendChild(el('p', 'x-desc', cat.desc));
        var meta = el('div', 'x-actions');
        meta.appendChild(spanStat('grid', fmt(cat.topics) + ' ' + L.topics));
        meta.appendChild(spanStat('chat', fmt(cat.posts) + ' ' + L.posts));
        body.appendChild(meta);
        card.appendChild(body);
        return card;
    }

    function statChip(iconName, text) {
        var chip = el('div', 'x-stat-chip');
        chip.appendChild(icon(iconName));
        chip.appendChild(el('span', null, text));
        return chip;
    }

    function spanStat(name, text) {
        var s = el('span', 'x-act');
        s.appendChild(icon(name));
        s.appendChild(el('span', null, text));
        return s;
    }

    // ---------------------------------------------------------------- home
    function viewHome() {
        if (app) app.classList.remove('sd-profile-view');
        var names = {trend: L.trend, forums: L.forumsTab, saved: L.savedTab, help: L.helpTab};
        var refreshBtn = el('button', 'x-feed-refresh-btn');
        refreshBtn.type = 'button';
        refreshBtn.title = L.refreshFeed;
        refreshBtn.appendChild(icon('refresh'));
        refreshBtn.addEventListener('click', function () {
            refreshBtn.classList.add('spin');
            setTimeout(function () { refreshBtn.classList.remove('spin'); }, 700);
            if (state.tab === 'trend') paintTrend(true);
            else if (state.tab === 'forums') paintForums();
            else if (state.tab === 'help') paintHelp();
            else if (state.tab === 'saved') paintSaved();
        });

        header(names[state.tab] || L.home);
        tabs([['trend', L.trend], ['forums', L.forumsTab], ['saved', L.savedTab], ['help', L.helpTab]],
            state.tab, setView, 'x-home-tabs', refreshBtn);
        mainFeed.innerHTML = '';
        if (state.tab === 'forums') return paintForums();
        if (state.tab === 'saved') return paintSaved();
        if (state.tab === 'help') return paintHelp();
        paintTrend();
    }

    var feedSubFilter = 'forYou';
    var LAST_FEED_KEY = 'sd-x-feed-cache:v2';

    function paintTrend(forceFresh) {
        mainFeed.innerHTML = '';
        var prompt = el('button', 'x-prompt');
        prompt.type = 'button';
        prompt.appendChild(avatarNode(state.me || '?', 'x-av-sm'));
        prompt.appendChild(el('span', 'x-prompt-t', L.composePh));
        var go = el('b', 'x-prompt-go');
        go.appendChild(icon('plus'));
        prompt.appendChild(go);
        prompt.addEventListener('click', function () {
            openCompose();
        });
        mainFeed.appendChild(prompt);

        var subnav = el('div', 'x-feed-subnav');
        var bForYou = el('button', 'x-f-subpill' + (feedSubFilter === 'forYou' ? ' on' : ''));
        bForYou.type = 'button';
        bForYou.textContent = L.forYou;
        var bLatest = el('button', 'x-f-subpill' + (feedSubFilter === 'latest' ? ' on' : ''));
        bLatest.type = 'button';
        bLatest.textContent = L.latest;

        var bRefresh = el('button', 'x-f-subpill x-f-refresh-btn');
        bRefresh.type = 'button';
        bRefresh.title = L.refreshFeed || 'Yenile';
        bRefresh.appendChild(icon('refresh'));
        bRefresh.appendChild(el('span', null, CUR_LANG === 'tr' ? 'Yenile' : 'Refresh'));
        bRefresh.addEventListener('click', function (e) {
            e.stopPropagation();
            bRefresh.classList.add('spin');
            setTimeout(function () { bRefresh.classList.remove('spin'); }, 700);
            paintTrend(true);
            toast(CUR_LANG === 'tr' ? 'Akış yenilendi' : 'Feed refreshed');
        });

        subnav.appendChild(bForYou);
        subnav.appendChild(bLatest);
        subnav.appendChild(bRefresh);
        mainFeed.appendChild(subnav);

        var listWrap = el('div', 'x-trend-list');
        mainFeed.appendChild(listWrap);

        var currentFeedList = [];
        if (!forceFresh) {
            try {
                var cachedFeed = JSON.parse(localStorage.getItem(LAST_FEED_KEY) || 'null');
                if (cachedFeed && cachedFeed.length) {
                    currentFeedList = cachedFeed;
                    renderList();
                }
            } catch (e) {}
        } else {
            try { localStorage.removeItem(LAST_FEED_KEY); } catch (e) {}
        }
        if (!currentFeedList.length) {
            listWrap.appendChild(skeleton(4));
        }

        function renderList() {
            listWrap.innerHTML = '';
            if (!currentFeedList.length) return listWrap.appendChild(note(L.failed, true, function () { paintTrend(true); }));
            var displayList = currentFeedList.slice();
            if (feedSubFilter === 'latest') {
                displayList.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
            }
            displayList.slice(0, 40).forEach(function (topic) {
                listWrap.appendChild(topicCard(topic));
            });
        }

        bForYou.addEventListener('click', function () {
            feedSubFilter = 'forYou';
            bForYou.classList.add('on');
            bLatest.classList.remove('on');
            renderList();
        });
        bLatest.addEventListener('click', function () {
            feedSubFilter = 'latest';
            bLatest.classList.add('on');
            bForYou.classList.remove('on');
            renderList();
        });

        loadIndex(function (cats) {
            state.cats = cats;
            paintRail();
            loadFeed(cats, function (list) {
                currentFeedList = list || [];
                try {
                    localStorage.setItem(LAST_FEED_KEY, JSON.stringify(currentFeedList.slice(0, 35)));
                } catch (e) {}
                renderList();
            }, function onEnrich(updatedTopic) {
                if (!updatedTopic) return;
                var oldCard = listWrap.querySelector('.x-tweet-card[data-topic-id="' + updatedTopic.id + '"]');
                if (oldCard) {
                    var newCard = topicCard(updatedTopic);
                    oldCard.replaceWith(newCard);
                }
            }, forceFresh);
        });
    }

    var WORLD_FORUMS = {
        '27': 'Other Languages',
        '28': 'Translating Scratch',
        '33': 'Deutsch',
        '34': 'Français',
        '35': 'Español',
        '36': 'Nederlands',
        '37': 'Italiano',
        '38': 'Polski',
        '39': 'Português',
        '40': '日本語',
        '41': 'Norsk',
        '42': 'Русский',
        '43': 'Türkçe',
        '44': '한국어',
        '45': 'עברית',
        '46': 'Ελληνικά',
        '47': '中文',
        '48': 'Català',
        '49': 'Africa',
        '50': 'Bahasa Indonesia',
        '51': 'فارسی',
        '52': 'हिन्दी'
    };

    var curForumFilter = 'all';
    var forumSearchQuery = '';

    function paintForums() {
        mainFeed.innerHTML = '';
        mainFeed.appendChild(note(L.loading));
        loadIndex(function (cats) {
            mainFeed.innerHTML = '';
            if (!cats.length) return mainFeed.appendChild(note(L.failed, true, paintForums));
            var day = Date.now() - 864e5;
            var active = cats.filter(function (c) {
                return c.ms > day;
            }).length;
            var total = cats.reduce(function (s, c) {
                return s + c.topics;
            }, 0);
            var posts = cats.reduce(function (s, c) {
                return s + c.posts;
            }, 0);
            var stats = el('div', 'x-stat-strip');
            stats.appendChild(statChip('grid', fmt(cats.length) + ' ' + L.stats[0]));
            stats.appendChild(statChip('chat', fmt(total) + ' ' + L.stats[1]));
            stats.appendChild(statChip('reply', fmt(posts) + ' ' + L.stats[2]));
            stats.appendChild(statChip('sparkle', fmt(active) + ' ' + L.stats[3]));
            mainFeed.appendChild(stats);

            // Filter Bar with search and language options
            var filterBar = el('div', 'x-forum-filter-bar');
            var searchWrap = el('div', 'x-forum-search-wrap');
            searchWrap.appendChild(icon('search'));
            var fInput = el('input', 'x-forum-search-input');
            fInput.type = 'text';
            fInput.value = forumSearchQuery;
            fInput.placeholder = 'Search forums or languages (Türkçe, Deutsch, Scripts…)';
            searchWrap.appendChild(fInput);
            filterBar.appendChild(searchWrap);

            var pillRow = el('div', 'x-forum-pills');
            var worldCount = cats.filter(function (c) { return !!WORLD_FORUMS[c.id]; }).length;
            var mainCount = cats.length - worldCount;

            var pAll = el('button', 'x-f-pill' + (curForumFilter === 'all' ? ' on' : ''), 'All (' + cats.length + ')');
            var pMain = el('button', 'x-f-pill' + (curForumFilter === 'main' ? ' on' : ''), 'Global / English (' + mainCount + ')');
            var pWorld = el('button', 'x-f-pill' + (curForumFilter === 'world' ? ' on' : ''), '🌍 World Languages (' + worldCount + ')');
            var pTr = el('button', 'x-f-pill' + (curForumFilter === 'tr' ? ' on' : ''), '🇹🇷 Türkçe');

            pillRow.appendChild(pAll);
            pillRow.appendChild(pMain);
            pillRow.appendChild(pWorld);
            pillRow.appendChild(pTr);
            filterBar.appendChild(pillRow);
            mainFeed.appendChild(filterBar);

            var listContainer = el('div', 'x-forum-list-container');
            mainFeed.appendChild(listContainer);

            function renderFilteredCats() {
                listContainer.innerHTML = '';
                var query = forumSearchQuery.trim().toLowerCase();
                var filtered = cats.filter(function (c) {
                    var isWorld = !!WORLD_FORUMS[c.id];
                    var isTr = c.id === '43';

                    if (curForumFilter === 'main' && isWorld) return false;
                    if (curForumFilter === 'world' && !isWorld) return false;
                    if (curForumFilter === 'tr' && !isTr) return false;

                    if (query) {
                        var cName = (c.name || '').toLowerCase();
                        var cDesc = (c.desc || '').toLowerCase();
                        var langName = (WORLD_FORUMS[c.id] || '').toLowerCase();
                        if (cName.indexOf(query) === -1 && cDesc.indexOf(query) === -1 && langName.indexOf(query) === -1) {
                            return false;
                        }
                    }
                    return true;
                });

                if (!filtered.length) {
                    listContainer.appendChild(el('div', 'x-empty-box', 'No forums matching your filter.'));
                    return;
                }

                filtered.slice().sort(function (x, y) {
                    return (y.ms || 0) - (x.ms || 0);
                }).forEach(function (cat) {
                    listContainer.appendChild(forumCard(cat));
                });
            }

            fInput.addEventListener('input', function () {
                forumSearchQuery = fInput.value;
                renderFilteredCats();
            });

            function setFilter(filt, activePill) {
                curForumFilter = filt;
                Array.prototype.forEach.call(pillRow.querySelectorAll('.x-f-pill'), function (p) {
                    p.classList.remove('on');
                });
                activePill.classList.add('on');
                renderFilteredCats();
            }

            pAll.addEventListener('click', function () { setFilter('all', pAll); });
            pMain.addEventListener('click', function () { setFilter('main', pMain); });
            pWorld.addEventListener('click', function () { setFilter('world', pWorld); });
            pTr.addEventListener('click', function () { setFilter('tr', pTr); });

            renderFilteredCats();
        });
    }

    function paintSaved() {
        mainFeed.innerHTML = '';
        var list = Object.keys(saves()).map(function (id) {
            return saves()[id];
        }).sort(function (x, y) {
            return y.saw - x.saw;
        });
        if (!list.length) return mainFeed.appendChild(note(L.savedEmpty));
        list.forEach(function (topic) {
            mainFeed.appendChild(topicCard({
                id: topic.id, title: topic.title, catId: topic.catId, catName: topic.catName, ms: topic.ms,
                author: L.savedTab, saved: true, replies: 0, views: 0
            }));
        });
    }

    function paintHelp() {
        mainFeed.innerHTML = '';
        mainFeed.appendChild(note(L.loading));
        loadUnanswered(function (list) {
            mainFeed.innerHTML = '';
            if (!list.length) return mainFeed.appendChild(note(L.helpEmpty));
            list.slice().sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); }).forEach(function (topic) {
                mainFeed.appendChild(topicCard(topic));
            });
        });
    }


    // ---------------------------------------------------------------- category
    function viewCategory(catId) {
        if (app) app.classList.remove('sd-profile-view');
        if (M_CAT && M_CAT[1] === catId && document.querySelector('#content table')) {
            renderCategoryFromDoc(catId, document);
        } else {
            header(L.loading);
            mainFeed.innerHTML = '';
            mainFeed.appendChild(skeleton(5));
            fetchDoc('/discuss/' + catId + '/').then(function (doc) {
                renderCategoryFromDoc(catId, doc);
            }).catch(function () {
                toast(L.failed);
            });
        }
    }

    function renderCategoryFromDoc(catId, doc) {
        var name = (doc.title || '').replace(/ - Discuss Scratch\s*$/, '') || L.home;
        header(name);
        var posts = parseTopics(doc, null);

        var write = el('button', 'x-send x-cat-new', '+ ' + L.newTopic);
        write.type = 'button';
        write.addEventListener('click', function () {
            openCompose(catId, name);
        });

        tabs([['last', L.sortLast], ['replies', L.sortReplies], ['views', L.sortViews]],
            state.sort, function (sort) {
                state.sort = sort;
                renderCategoryFromDoc(catId, doc);
            }, 'x-cat-tabs', write);

        mainFeed.innerHTML = '';

        var sorted = posts.slice();
        if (state.sort === 'replies') sorted.sort(function (x, y) { return y.replies - x.replies; });
        else if (state.sort === 'views') sorted.sort(function (x, y) { return y.views - x.views; });
        else sorted.sort(function (x, y) {
            return (y.sticky ? 1 : 0) - (x.sticky ? 1 : 0) || y.ms - x.ms;
        });
        sorted.forEach(function (topic) {
            mainFeed.appendChild(topicCard(topic));
        });

        var next = nextPage(doc);
        if (next) {
            var more = a('x-more', next, L.more + ' →');
            more.className = 'x-more';
            more.href = next;
            mainFeed.appendChild(more);
        }
    }

    function nextPage(doc) {
        var root = doc || document;
        var pag = root.querySelector('#content .pagination');
        if (!pag) return '';
        var cur = pag.querySelector('.current');
        var current = cur ? parseInt(cur.textContent, 10) || 1 : 1;
        var max = 0;
        Array.prototype.forEach.call(pag.querySelectorAll('a.page'), function (p) {
            max = Math.max(max, parseInt(p.textContent, 10) || 0);
        });
        if (max <= current) return '';
        var u = new URL(location.href);
        u.searchParams.set('page', current + 1);
        return u.pathname + u.search;
    }

    // ---------------------------------------------------------------- topic
    function viewTopic(topicId) {
        if (app) app.classList.remove('sd-profile-view');
        var posts = (M_TOPIC && M_TOPIC[1] === topicId && document.querySelector('.blockpost')) ? parseTopicPosts(document) : [];
        if (!posts.length && topicId) {
            mainFeed.innerHTML = '';
            header(L.thread);
            mainFeed.appendChild(skeleton(3));
            fetchDoc('/discuss/topic/' + topicId + '/').then(function (doc) {
                renderTopicFromDoc(topicId, doc);
            }).catch(function () {
                toast(L.failed);
            });
            return;
        }
        var title = document.title.replace(/ - Discuss Scratch\s*$/, '');
        var catLink = document.querySelector('#brdheader .breadcrumbs a[href^="/discuss/"]:not([href="/discuss/"])');
        var catName = catLink && !/topic/.test(catLink.getAttribute('href'))
            ? catLink.textContent.trim() : L.thread;
        header(catName);

        mainFeed.innerHTML = '';
        var hero = el('div', 'x-hero');
        hero.appendChild(el('h1', null, title));
        var meta = el('div', 'x-hero-meta');
        if (catLink && !/topic/.test(catLink.getAttribute('href'))) {
            meta.appendChild(a('x-cat', catLink.getAttribute('href'), catLink.textContent.trim()));
        }
        meta.appendChild(el('span', null, fmt(Math.max(0, posts.length - 1)) + ' ' + L.replies));
        if (NATIVE.follow) {
            var follow = el('button', 'x-follow' + (NATIVE.following ? ' on' : ''),
                NATIVE.following ? L.unfollow : L.follow);
            follow.type = 'button';
            follow.addEventListener('click', function () {
                var form = NATIVE.follow;
                fetch(form.action, {
                    method: 'POST',
                    body: new FormData(form),
                    credentials: 'include'
                }).then(function () {
                    location.reload();
                }).catch(function () {
                    toast(L.failed);
                });
            });
            meta.appendChild(follow);
        }
        hero.appendChild(meta);
        mainFeed.appendChild(hero);

        mainFeed.appendChild(replyComposer(topicId));

        posts.forEach(function (post, index) {
            mainFeed.appendChild(threadPost(post, index === 0));
        });
    }

    function renderTopicFromDoc(topicId, doc) {
        var posts = parseTopicPosts(doc);
        var title = (doc.title || '').replace(/ - Discuss Scratch\s*$/, '');
        var catLink = doc.querySelector('#brdheader .breadcrumbs a[href^="/discuss/"]:not([href="/discuss/"])');
        var catName = catLink && !/topic/.test(catLink.getAttribute('href'))
            ? catLink.textContent.trim() : L.thread;
        header(catName);

        mainFeed.innerHTML = '';
        var hero = el('div', 'x-hero');
        hero.appendChild(el('h1', null, title));
        var meta = el('div', 'x-hero-meta');
        if (catLink && !/topic/.test(catLink.getAttribute('href'))) {
            meta.appendChild(a('x-cat', catLink.getAttribute('href'), catLink.textContent.trim()));
        }
        meta.appendChild(el('span', null, fmt(Math.max(0, posts.length - 1)) + ' ' + L.replies));
        hero.appendChild(meta);
        mainFeed.appendChild(hero);

        mainFeed.appendChild(replyComposer(topicId));

        posts.forEach(function (post, index) {
            mainFeed.appendChild(threadPost(post, index === 0));
        });
    }

    function threadPost(post, first) {
        var card = el('article', 'x-post' + (first ? ' x-first' : ''));
        var avElem = post.avatar ? (function () {
            var avBox = el('div', 'x-av x-av-photo');
            var img = el('img', 'x-av-img');
            img.src = post.avatar.indexOf('//') === 0 ? 'https:' + post.avatar : post.avatar;
            img.alt = '';
            img.loading = 'lazy';
            avBox.appendChild(img);
            return avBox;
        })() : avatarNode(post.user);
        if (post.user) {
            avElem.style.cursor = 'pointer';
            avElem.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openProfile(post.user);
            });
        }
        card.appendChild(avElem);
        var body = el('div', 'x-body');
        var line = el('div', 'x-line1');
        line.appendChild(a('x-name', post.href, post.user));
        line.appendChild(el('span', 'x-handle', post.num));
        line.appendChild(el('span', 'x-time', '· ' + ago(post.ms)));
        var menu = el('button', 'x-act x-save', '');
        menu.type = 'button';
        menu.appendChild(icon('dots'));
        menu.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            openMenu(post);
        });
        line.appendChild(menu);
        body.appendChild(line);

        var msg = el('div', 'x-msg');
        msg.appendChild(post.html);
        Array.prototype.forEach.call(msg.querySelectorAll('img'), function (img) {
            img.loading = 'lazy';
        });
        // an off-site link wears a marker and leaves the tab alone; the forum cannot vouch for it
        Array.prototype.forEach.call(msg.querySelectorAll('a[href]'), function (link) {
            var href = link.getAttribute('href') || '';
            if (href.charAt(0) === '/' || /^https?:\/\/(www\.)?scratch\.mit\.edu\//.test(href)) return;
            link.classList.add('x-ext');
            link.target = '_blank';
            link.rel = 'nofollow noopener noreferrer';
        });
        body.appendChild(msg);

        if (post.edited) body.appendChild(el('p', 'x-edited', post.edited));

        var actions = el('div', 'x-actions');
        var quote = el('button', 'x-act');
        quote.type = 'button';
        quote.appendChild(icon('reply'));
        quote.appendChild(el('span', null, L.quote));
        quote.addEventListener('click', function () {
            quotePost(post);
        });
        actions.appendChild(quote);
        var link = a('x-act', '/discuss/post/' + post.id + '/', '#' + (post.num || '').replace('#', ''));
        actions.appendChild(link);
        if (NATIVE.reports[post.id]) {
            actions.appendChild(a('x-act', NATIVE.reports[post.id], L.report));
        }
        body.appendChild(actions);
        card.appendChild(body);
        return card;
    }

    function openMenu(post) {
        var old = document.querySelector('.x-menu');
        if (old) old.remove();
        var menu = el('div', 'x-menu');
        if (NATIVE.reports[post.id]) {
            menu.appendChild(a('x-menu-i', NATIVE.reports[post.id], L.report));
        }
        var copy = el('button', 'x-menu-i', L.open);
        copy.type = 'button';
        copy.addEventListener('click', function () {
            navigator.clipboard.writeText(location.origin + '/discuss/post/' + post.id + '/').then(function () {
                toast('#' + post.id);
            });
            menu.remove();
        });
        menu.appendChild(copy);
        document.body.appendChild(menu);
        setTimeout(function () {
            document.addEventListener('click', function close() {
                menu.remove();
                document.removeEventListener('click', close);
            }, {once: true});
        }, 0);
    }

    function quotePost(post) {
        var ta = document.getElementById('x-reply');
        if (!ta) return;

        function insert(text) {
            ta.value += '[quote=' + post.user + ']' + text + '[/quote]\n';
            ta.focus();
            grow(ta);
            var send = document.querySelector('.x-replytop .x-send');
            if (send) send.disabled = !ta.value.trim();
        }

        // the site's own quote button writes BBCode into the native reply box, which keeps
        // scratchblocks intact; when it is not injected (or does nothing) the text still quotes
        var q = NATIVE.quotes[post.id];
        if (q) {
            var before = NATIVE.body ? NATIVE.body.value : '';
            q.click();
            setTimeout(function () {
                if (NATIVE.body && NATIVE.body.value && NATIVE.body.value !== before) {
                    ta.value = NATIVE.body.value;
                    NATIVE.body.value = '';
                    ta.focus();
                    grow(ta);
                    var send = document.querySelector('.x-replytop .x-send');
                    if (send) send.disabled = !ta.value.trim();
                } else {
                    insert((post.html.textContent || '').replace(/\s+\n/g, '\n').trim().slice(0, 900));
                }
            }, 70);
            return;
        }
        insert((post.html.textContent || '').replace(/\s+\n/g, '\n').trim().slice(0, 900));
    }

    function replyComposer(topicId) {
        var box = el('div', 'x-composer x-replytop');
        if (!state.me) {
            try {
                if (window.Scratch && window.Scratch.INIT_DATA && window.Scratch.INIT_DATA.LOGGED_IN_USER && window.Scratch.INIT_DATA.LOGGED_IN_USER.model) {
                    state.me = window.Scratch.INIT_DATA.LOGGED_IN_USER.model.username || null;
                }
            } catch (e) {}
            if (!state.me) {
                var topUser = document.querySelector('#topnav .user-nav a[href^="/users/"], #topnav a[href^="/users/"], .account-nav a[href^="/users/"]');
                if (topUser) {
                    var mU = /\/users\/([^/]+)/.exec(topUser.getAttribute('href') || '');
                    if (mU) state.me = decodeURIComponent(mU[1]);
                }
            }
        }
        if (!state.me) {
            var bar = el('p', 'x-loginbar');
            bar.appendChild(el('span', null, L.needLogin));
            bar.appendChild(a('x-join', '/login/?next=' + encodeURIComponent(location.pathname), L.login));
            box.appendChild(bar);
            return box;
        }
        box.appendChild(avatarNode(state.me || '?'));
        var inner = el('div', 'x-body');
        var ta = el('textarea', 'x-ta');
        ta.id = 'x-reply';
        ta.placeholder = L.bodyPh;
        ta.rows = 2;
        inner.appendChild(makeFormattingToolbar(ta));
        inner.appendChild(ta);
        var row = el('div', 'x-comp-row');
        var sub = el('label', 'x-check');
        var cb = el('input');
        cb.type = 'checkbox';
        cb.id = 'x-sub';
        cb.checked = false;
        sub.appendChild(cb);
        sub.appendChild(el('span', null, L.subscribe));
        row.appendChild(sub);
        var send = el('button', 'x-send', L.reply);
        send.type = 'button';
        send.disabled = true;
        ta.addEventListener('input', function () {
            send.disabled = !ta.value.trim();
            grow(ta);
        });
        send.addEventListener('click', function () {
            sendReply(topicId, ta);
        });
        row.appendChild(send);
        inner.appendChild(row);
        inner.appendChild(el('p', 'x-hint', '[b]kalın[/b] · [i]eğik[/i] · [code]kod[/code]'));
        box.appendChild(inner);
        return box;
    }

    function grow(ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
    }

    function sendReply(topicId, ta) {
        var text = ta.value.trim();
        if (!text) return toast(L.emptyPost);
        if (!NATIVE.replyForm || !NATIVE.body) return toast(L.failed);
        NATIVE.body.value = text;
        var sub = NATIVE.replyForm.querySelector('input[name="subscribe"]');
        var want = document.getElementById('x-sub');
        if (sub && want) sub.checked = want.checked;
        var form = NATIVE.replyForm;
        form.action = form.action || '/discuss/topic/' + topicId + '/';
        HTMLFormElement.prototype.submit.call(form);
    }

    var FF_FORUM_NAMES = {
        1: "Suggestions", 2: "Dustbin", 3: "Bugs and Glitches", 4: "Questions about Scratch",
        5: "Announcements", 6: "New Scratchers", 7: "Help With Scripts", 8: "Show and Tell",
        9: "Project Ideas", 10: "Collaboration", 11: "Requests", 29: "Things I'm Making",
        30: "Things I'm Reading", 31: "Advanced Topics", 32: "Connecting to Physical World",
        43: "Türkçe", 48: "Developing Scratch Extensions", 49: "Open Source Projects",
        60: "Project Save & Level Codes"
    };

    var FF_CACHE = {};
    function searchForumFind(query, callback) {
        if (!query || !query.trim()) return callback([]);
        var q = query.trim().toLowerCase();
        if (FF_CACHE[q]) return callback(FF_CACHE[q]);

        fetch('https://forumfind.evof.cc/topic-search.php?keywords=' + encodeURIComponent(q) + '&sort=2')
            .then(function (res) {
                if (!res.ok) throw new Error('status ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (Array.isArray(data)) {
                    FF_CACHE[q] = data;
                    callback(data);
                } else {
                    callback([]);
                }
            })
            .catch(function () {
                callback([]);
            });
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function highlightMatch(text, query) {
        if (!text || !query) return escapeHtml(text);
        var escaped = escapeHtml(text);
        var qClean = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!qClean) return escaped;
        var re = new RegExp('(' + qClean + ')', 'gi');
        return escaped.replace(re, '<strong style="color:var(--x-acc)">$1</strong>');
    }

    // ---------------------------------------------------------------- search
    function viewSearch() {
        if (app) app.classList.remove('sd-profile-view');
        var params = new URLSearchParams(location.search);
        var q = (params.get('q') || '').trim();
        var mine = params.get('action') === 'show_user';
        header(mine ? L.navMine : L.searchTitle, q ? '"' + q + '"' : '');
        mainFeed.innerHTML = '';

        // Top Search Input Box (Always accessible on desktop & mobile)
        var sBox = el('form', 'x-search-page-box');
        sBox.appendChild(icon('search'));
        var sInput = el('input', 'x-search-page-input');
        sInput.type = 'search';
        sInput.placeholder = L.searchPh;
        sInput.value = q;
        sBox.appendChild(sInput);
        var sBtn = el('button', 'x-cta', CUR_LANG === 'tr' ? 'Ara' : 'Search');
        sBtn.type = 'submit';
        sBox.appendChild(sBtn);
        sBox.addEventListener('submit', function (e) {
            e.preventDefault();
            var val = sInput.value.trim();
            if (val) navigate('/discuss/search/?q=' + encodeURIComponent(val));
        });
        mainFeed.appendChild(sBox);

        var resContainer = el('div', 'x-search-results');
        mainFeed.appendChild(resContainer);
        resContainer.appendChild(skeleton(3));

        if (mine) {
            fetchDoc('/discuss/search/' + location.search).then(function (doc) {
                resContainer.innerHTML = '';
                var results = parseTopics(doc, null);
                if (results.length) {
                    var head = el('p', 'x-rescount', fmt(results.length) + ' ' + L.results);
                    resContainer.appendChild(head);
                    results.forEach(function (topic) {
                        resContainer.appendChild(topicCard(topic));
                    });
                    return;
                }
                fallbackUserTopics();
            }).catch(function () {
                fallbackUserTopics();
            });

            function fallbackUserTopics() {
                resContainer.innerHTML = '';
                var targetUser = state.me;
                if (!targetUser) {
                    resContainer.appendChild(note(CUR_LANG === 'tr' ? 'Konularınızı görmek için lütfen giriş yapın.' : 'Please sign in to see your topics.'));
                    return;
                }
                searchForumFind(targetUser, function (allTopics) {
                    var userTopics = (allTopics || []).filter(function (item) {
                        return (item[2] || '').toLowerCase() === targetUser.toLowerCase();
                    });
                    if (userTopics.length) {
                        var head = el('p', 'x-rescount', fmt(userTopics.length) + ' ' + L.results + ' · @' + targetUser);
                        resContainer.appendChild(head);
                        userTopics.forEach(function (item) {
                            resContainer.appendChild(topicCard({
                                id: String(item[0]),
                                title: item[1] || 'Untitled',
                                author: item[2] || targetUser,
                                catId: String(item[3]),
                                catName: FF_FORUM_NAMES[item[3]] || 'Discuss',
                                replies: 0,
                                views: 0,
                                ms: null
                            }));
                        });
                    } else {
                        var emptyBox = el('div', 'x-note');
                        emptyBox.appendChild(el('p', null, CUR_LANG === 'tr' ? 'Henüz açılmış bir forum konunuz yok.' : 'You have not created any forum topics yet.'));
                        var newBtn = el('button', 'x-cta', L.newTopic);
                        newBtn.addEventListener('click', function () { openCompose(); });
                        emptyBox.appendChild(newBtn);
                        resContainer.appendChild(emptyBox);
                    }
                });
            }
            return;
        }

        if (!q) {
            resContainer.innerHTML = '';
            var promptBox = el('div', 'x-search-empty-prompt');
            promptBox.appendChild(el('h3', null, CUR_LANG === 'tr' ? 'Scratch Forumlarında Keşfet' : 'Explore Scratch Forums'));
            promptBox.appendChild(el('p', null, CUR_LANG === 'tr' ? 'Bir kullanıcı adı veya konu başlığı yazarak arama yapabilirsiniz.' : 'Search by username or topic title.'));
            var chips = el('div', 'x-search-chips');
            var sampleTags = CUR_LANG === 'tr' ?
                ['Türkçe', 'Suggestions', 'Help with Scripts', 'Questions about Scratch', 'Collaboration'] :
                ['Suggestions', 'Help with Scripts', 'Questions about Scratch', 'Project Ideas', 'Collaboration'];
            sampleTags.forEach(function (tag) {
                var chip = el('button', 'x-search-chip', tag);
                chip.type = 'button';
                chip.addEventListener('click', function () {
                    sInput.value = tag;
                    navigate('/discuss/search/?q=' + encodeURIComponent(tag));
                });
                chips.appendChild(chip);
            });
            promptBox.appendChild(chips);
            resContainer.appendChild(promptBox);
            return;
        }

        // Active Search with query
        var cleanUser = q.replace(/^@/, '').trim();
        var isUserQuery = /^[a-zA-Z0-9_-]{2,24}$/.test(cleanUser);

        var userPromise = isUserQuery ?
            fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(cleanUser))
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; }) : Promise.resolve(null);

        userPromise.then(function (foundUser) {
            searchForumFind(q, function (ffResults) {
                resContainer.innerHTML = '';

                // 1. Featured User Card if query matches a Scratch user
                if (foundUser && foundUser.username) {
                    var uCard = el('div', 'x-search-user-hero');
                    uCard.appendChild(avatarNode(foundUser.username, 'x-av-md'));
                    var uDetails = el('div', 'x-search-user-details');
                    var uNameRow = el('div', 'x-search-user-nrow');
                    uNameRow.appendChild(el('strong', null, foundUser.username));
                    uNameRow.appendChild(el('span', 'x-search-user-handle', '@' + foundUser.username.toLowerCase()));
                    uDetails.appendChild(uNameRow);
                    var bioTxt = (foundUser.profile && foundUser.profile.bio) || (foundUser.profile && foundUser.profile.status) || '';
                    if (bioTxt) {
                        uDetails.appendChild(el('p', 'x-search-user-bio', bioTxt.slice(0, 120) + (bioTxt.length > 120 ? '…' : '')));
                    }
                    uCard.appendChild(uDetails);
                    var uAction = el('button', 'x-cta', CUR_LANG === 'tr' ? 'Profili Gör' : 'View Profile');
                    uAction.type = 'button';
                    uAction.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openProfile(foundUser.username);
                    });
                    uCard.appendChild(uAction);
                    resContainer.appendChild(uCard);
                }

                var topics = ffResults || [];
                // Sort topics: prioritize author match or title match
                topics.sort(function (a, b) {
                    var aAuthorMatch = (a[2] || '').toLowerCase() === cleanUser.toLowerCase();
                    var bAuthorMatch = (b[2] || '').toLowerCase() === cleanUser.toLowerCase();
                    if (aAuthorMatch && !bAuthorMatch) return -1;
                    if (!aAuthorMatch && bAuthorMatch) return 1;
                    return 0;
                });

                if (!topics.length && !foundUser) {
                    resContainer.appendChild(note(CUR_LANG === 'tr' ? '"' + q + '" için eşleşen konu veya kullanıcı bulunamadı.' : 'No topics or users found matching "' + q + '".'));
                    return;
                }

                if (topics.length) {
                    var countHead = el('p', 'x-rescount', fmt(topics.length) + ' ' + L.results);
                    resContainer.appendChild(countHead);
                    topics.slice(0, 45).forEach(function (item) {
                        resContainer.appendChild(topicCard({
                            id: String(item[0]),
                            title: item[1] || 'Untitled',
                            author: item[2] || '?',
                            catId: String(item[3]),
                            catName: FF_FORUM_NAMES[item[3]] || 'Discuss',
                            replies: 0,
                            views: 0,
                            ms: null
                        }));
                    });
                }
            });
        });
    }

    // ---------------------------------------------------------------- compose
    function openCompose(catId, catName) {
        loadIndex(function (cats) {
            state.cats = cats;
            var wrap = el('div', 'x-modal');
            var dialog = el('div', 'x-dialog');
            var head = el('div', 'x-dialog-head');
            head.appendChild(el('h2', null, L.newTopic));
            var close = el('button', 'x-iconbtn', '');
            close.type = 'button';
            close.appendChild(icon('close'));
            head.appendChild(close);
            dialog.appendChild(head);

            var body = el('div', 'x-dialog-body');
            body.appendChild(el('label', 'x-label', L.category));
            var select = el('select', 'x-select');
            var preferred = catId || '4';
            var picked = false;
            (cats.length ? cats : [{id: catId || '', name: catName || L.category}]).forEach(function (cat) {
                var o = el('option', null, cat.name);
                o.value = cat.id;
                if (cat.id === preferred) {
                    o.selected = true;
                    picked = true;
                }
                select.appendChild(o);
            });
            if (!picked && select.options.length) select.options[0].selected = true;
            body.appendChild(select);
            body.appendChild(el('label', 'x-label', L.title));
            var title = el('input', 'x-input');
            title.placeholder = L.titlePh;
            title.maxLength = 120;
            body.appendChild(title);
            body.appendChild(el('label', 'x-label', L.body));
            var text = el('textarea', 'x-textarea');
            text.placeholder = L.bodyPh;
            text.rows = 8;
            body.appendChild(makeFormattingToolbar(text));
            body.appendChild(text);
            body.appendChild(el('p', 'x-hint', '[b]kalın[/b] · [i]eğik[/i] · [code]kod[/code] · [scratchblocks]…[/scratchblocks]'));
            var check = el('label', 'x-check');
            var cb = el('input');
            cb.type = 'checkbox';
            cb.checked = false;
            check.appendChild(cb);
            check.appendChild(el('span', null, L.subscribe));
            body.appendChild(check);

            var foot = el('div', 'x-dialog-foot');
            var count = el('span', 'x-count', '0 / 100 000');
            foot.appendChild(count);
            var send = el('button', 'x-send', L.sendTopic);
            send.type = 'button';
            send.disabled = true;
            function valid() {
                send.disabled = !title.value.trim() || !text.value.trim();
                count.textContent = fmt(text.value.length) + ' / 100 000';
            }
            title.addEventListener('input', valid);
            text.addEventListener('input', valid);
            send.addEventListener('click', function () {
                if (!select.value) return toast(L.failed);
                var form = document.createElement('form');
                form.method = 'post';
                form.action = '/discuss/' + select.value + '/topic/add/';
                form.style.display = 'none';
                var hidden = function (name, value) {
                    var input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = name;
                    input.value = value;
                    form.appendChild(input);
                };
                hidden('csrfmiddlewaretoken', NATIVE.csrf || cookie('scratchcsrftoken'));
                hidden('name', title.value.trim());
                var area = document.createElement('textarea');
                area.name = 'body';
                area.value = text.value;
                form.appendChild(area);
                if (cb.checked) hidden('subscribe', 'on');
                document.body.appendChild(form);
                form.submit();
            });
            foot.appendChild(send);
            body.appendChild(foot);
            dialog.appendChild(body);
            wrap.appendChild(dialog);

            function shut() {
                wrap.remove();
            }
            close.addEventListener('click', shut);
            wrap.addEventListener('click', function (event) {
                if (event.target === wrap) shut();
            });
            document.addEventListener('keydown', function esc(event) {
                if (event.key === 'Escape') {
                    shut();
                    document.removeEventListener('keydown', esc);
                }
            });
            document.body.appendChild(wrap);
            title.focus();
        });
    }

    // ---------------------------------------------------------------- profile & ScratchStats
    function openProfile(username) {
        if (!username) return;
        state.tab = 'profile';
        state.profileUser = username;
        history.pushState(null, '', '/discuss/?user=' + encodeURIComponent(username));
        viewProfile(username);
    }

    function viewProfile(username) {
        if (app) app.classList.add('sd-profile-view');
        mainHead.innerHTML = '';
        mainFeed.innerHTML = '';

        var headInner = el('div', 'x-top-inner');
        var backBtn = el('button', 'x-iconbtn', '');
        backBtn.type = 'button';
        backBtn.title = L.back || 'Back';
        backBtn.appendChild(icon('back'));
        backBtn.addEventListener('click', function () {
            if (history.length > 1) {
                history.back();
            } else {
                navigate('/discuss/');
            }
        });
        headInner.appendChild(backBtn);

        var topT = el('div', 'x-top-t');
        topT.appendChild(el('h1', 'x-title', '@' + username));
        topT.appendChild(el('div', 'x-sub', 'ScratchStats & Profile Overview'));
        headInner.appendChild(topT);

        var extBtn = a('x-ghost', 'https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/', 'View on Scratch ↗');
        extBtn.target = '_blank';
        headInner.appendChild(extBtn);
        mainHead.appendChild(headInner);

        mainFeed.appendChild(skeleton(4));

        Promise.all([
            fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(username)).then(function (r) { return r.json(); }).catch(function () { return null; }),
            fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(username) + '/projects').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(username) + '/followers?limit=40').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(username) + '/following?limit=40').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/followers/').then(function (r) { return r.text(); }).catch(function () { return ''; }),
            fetch('https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/following/').then(function (r) { return r.text(); }).catch(function () { return ''; })
        ]).then(function (results) {
            mainFeed.innerHTML = '';
            var user = results[0];
            var projects = Array.isArray(results[1]) ? results[1] : [];
            var followers = Array.isArray(results[2]) ? results[2] : [];
            var following = Array.isArray(results[3]) ? results[3] : [];
            var fHtml = results[4] || '';
            var ingHtml = results[5] || '';

            var mF = /Followers\s*\((\d+)\)/i.exec(fHtml);
            var mIng = /Following\s*\((\d+)\)/i.exec(ingHtml);
            var exactFollowers = mF ? parseInt(mF[1], 10) : followers.length;
            var exactFollowing = mIng ? parseInt(mIng[1], 10) : following.length;

            if (!user || user.code === 'NotFound') {
                mainFeed.appendChild(note('User @"' + username + '" not found on Scratch.'));
                return;
            }

            renderProfileDashboard(user, projects, followers, following, exactFollowers, exactFollowing);
        }).catch(function () {
            mainFeed.innerHTML = '';
            mainFeed.appendChild(note('Failed to load profile for @' + username + '.', true, function () {
                viewProfile(username);
            }));
        });
    }

    function renderProfileDashboard(user, projects, followers, following, exactFollowers, exactFollowing) {
        var username = user.username;
        var totalViews = 0, totalLoves = 0, totalFavs = 0, totalRemixes = 0;
        var months = {};
        var years = {};
        var dayActivity = {};
        var latestProject = null;

        projects.forEach(function (p) {
            totalViews += (p.stats && p.stats.views) || 0;
            totalLoves += (p.stats && p.stats.loves) || 0;
            totalFavs += (p.stats && p.stats.favorites) || 0;
            totalRemixes += (p.stats && p.stats.remixes) || 0;

            var dStr = (p.history && (p.history.shared || p.history.created || p.history.modified)) || '';
            if (dStr) {
                var d = new Date(dStr);
                if (!isNaN(d.getTime())) {
                    var m = d.toLocaleString('en-US', { month: 'long' });
                    months[m] = (months[m] || 0) + 1;
                    var y = d.getFullYear();
                    years[y] = (years[y] || 0) + 1;
                    var iso = d.toISOString().slice(0, 10);
                    dayActivity[iso] = (dayActivity[iso] || 0) + 1;
                    if (!latestProject || d.getTime() > (new Date(latestProject.history.shared || latestProject.history.created || 0)).getTime()) {
                        latestProject = p;
                    }
                }
            }
        });

        var pCount = projects.length || 1;
        var typViews = Math.round(totalViews / pCount);
        var typLoves = Math.round(totalLoves / pCount);
        var typFavs = Math.round(totalFavs / pCount);
        var typRemixes = Math.round(totalRemixes / pCount);

        var mostActiveMonth = 'None';
        var maxMonthCount = 0;
        Object.keys(months).forEach(function (m) {
            if (months[m] > maxMonthCount) {
                maxMonthCount = months[m];
                mostActiveMonth = m;
            }
        });

        var accountAge = 'Unknown';
        if (user.history && user.history.joined) {
            var j = new Date(user.history.joined);
            var diffMs = Date.now() - j.getTime();
            var diffY = Math.floor(diffMs / (365.25 * 24 * 3600 * 1000));
            var diffM = Math.floor((diffMs % (365.25 * 24 * 3600 * 1000)) / (30.4 * 24 * 3600 * 1000));
            accountAge = diffY > 0 ? (diffY + ' yr' + (diffY > 1 ? 's' : '') + (diffM > 0 ? ', ' + diffM + ' mo' : '')) : (diffM + ' mo');
        }

        var joinedDate = 'Unknown';
        if (user.history && user.history.joined) {
            var jd = new Date(user.history.joined);
            joinedDate = jd.toLocaleDateString(NUM, { year: 'numeric', month: 'long', day: 'numeric' });
        }

        var wrap = el('div', 'x-prof-wrap');

        // Left rail (Profile info)
        var side = el('div', 'x-prof-side');
        var card = el('div', 'x-prof-card');

        var avWrap = el('div', 'x-prof-av');
        var avImg = el('img');
        avImg.src = (user.profile && user.profile.images && user.profile.images['90x90']) || 'https://cdn2.scratch.mit.edu/get_image/user/' + user.id + '_90x90.png';
        avImg.onerror = function () { this.src = 'https://cdn2.scratch.mit.edu/get_image/user/default_90x90.png'; };
        avWrap.appendChild(avImg);
        card.appendChild(avWrap);

        card.appendChild(el('h2', 'x-prof-name', username));
        var role = el('div', 'x-prof-role', user.scratchteam ? 'Scratch Team' : 'Scratcher');
        card.appendChild(role);

        var meta = el('div', 'x-prof-meta');
        var metaJoined = el('div', 'x-prof-meta-row');
        metaJoined.appendChild(icon('calendar'));
        metaJoined.appendChild(el('span', null, 'Joined ' + joinedDate));
        meta.appendChild(metaJoined);

        var metaLoc = el('div', 'x-prof-meta-row');
        metaLoc.appendChild(icon('mapPin'));
        metaLoc.appendChild(el('span', null, (user.profile && user.profile.country) ? user.profile.country : 'Location not given'));
        meta.appendChild(metaLoc);

        var metaId = el('div', 'x-prof-meta-row');
        metaId.appendChild(icon('user'));
        metaId.appendChild(el('span', null, 'ID: ' + user.id));
        meta.appendChild(metaId);
        card.appendChild(meta);

        // Working On
        var workBox = el('div', 'x-prof-sec');
        workBox.appendChild(el('h4', null, 'Working On'));
        workBox.appendChild(el('p', null, (user.profile && user.profile.status) ? user.profile.status : 'No status available.'));
        card.appendChild(workBox);

        // About Me
        if (user.profile && user.profile.bio) {
            var bioBox = el('div', 'x-prof-sec');
            bioBox.appendChild(el('h4', null, 'About Me'));
            bioBox.appendChild(el('p', null, user.profile.bio));
            card.appendChild(bioBox);
        }

        // Links with EXACT follower and following counts!
        var linksBox = el('div', 'x-prof-sec');
        linksBox.appendChild(el('h4', null, 'Links'));
        var linkList = el('div', 'x-prof-links');
        linkList.appendChild(a('x-prof-link', 'https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/', 'View on Scratch ↗'));
        linkList.appendChild(a('x-prof-link', 'https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/followers/', 'Followers (' + fmt(exactFollowers) + ')'));
        linkList.appendChild(a('x-prof-link', 'https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/following/', 'Following (' + fmt(exactFollowing) + ')'));
        linksBox.appendChild(linkList);
        card.appendChild(linksBox);

        side.appendChild(card);
        wrap.appendChild(side);

        // Right content
        var main = el('div', 'x-prof-content');

        // Top navigation tabs: Projects (N) | Statistics | Forum Topics | Followers (N) | Following (N)
        var navTabs = el('div', 'x-prof-navtabs');
        var tabProjects = el('button', 'x-prof-tab', 'Projects (' + projects.length + ')');
        var tabStats = el('button', 'x-prof-tab on', 'Statistics');
        var tabForum = el('button', 'x-prof-tab', CUR_LANG === 'tr' ? 'Forum Konuları' : 'Forum Topics');
        var tabFollowers = el('button', 'x-prof-tab', 'Followers (' + fmt(exactFollowers) + ')');
        var tabFollowing = el('button', 'x-prof-tab', 'Following (' + fmt(exactFollowing) + ')');
        navTabs.appendChild(tabProjects);
        navTabs.appendChild(tabStats);
        navTabs.appendChild(tabForum);
        navTabs.appendChild(tabFollowers);
        navTabs.appendChild(tabFollowing);
        main.appendChild(navTabs);

        var viewContainer = el('div', 'x-prof-view-box');
        main.appendChild(viewContainer);
        wrap.appendChild(main);
        mainFeed.appendChild(wrap);

        function setActiveTab(btn) {
            tabProjects.classList.remove('on');
            tabStats.classList.remove('on');
            tabForum.classList.remove('on');
            tabFollowers.classList.remove('on');
            tabFollowing.classList.remove('on');
            btn.classList.add('on');
            viewContainer.innerHTML = '';
        }

        function showStatsTab() {
            setActiveTab(tabStats);

            var statsLayout = el('div', 'x-prof-stats-layout');
            var colMain = el('div', 'x-prof-col-main');

            // 1. PROJECT STATS (2x2 grid)
            var statsSec = el('div', 'x-dash-sec');
            statsSec.appendChild(el('div', 'x-sec-title', 'PROJECT STATS'));
            var grid2x2 = el('div', 'x-stat-grid-2x2');

            // Total Views
            var bViews = el('div', 'x-stat-box x-box-views');
            bViews.appendChild(el('div', 'x-box-lbl', 'Total Views'));
            bViews.appendChild(el('div', 'x-box-num', fmt(totalViews)));
            bViews.appendChild(el('div', 'x-box-sub', 'Typical Per Project: ' + fmt(typViews)));
            grid2x2.appendChild(bViews);

            // Total Loves
            var bLoves = el('div', 'x-stat-box x-box-loves');
            bLoves.appendChild(el('div', 'x-box-lbl', 'Total Loves'));
            bLoves.appendChild(el('div', 'x-box-num', fmt(totalLoves)));
            bLoves.appendChild(el('div', 'x-box-sub', 'Typical Per Project: ' + fmt(typLoves)));
            grid2x2.appendChild(bLoves);

            // Total Favorites
            var bFavs = el('div', 'x-stat-box x-box-favs');
            bFavs.appendChild(el('div', 'x-box-lbl', 'Total Favorites'));
            bFavs.appendChild(el('div', 'x-box-num', fmt(totalFavs)));
            bFavs.appendChild(el('div', 'x-box-sub', 'Typical Per Project: ' + fmt(typFavs)));
            grid2x2.appendChild(bFavs);

            // Total Remixes
            var bRemixes = el('div', 'x-stat-box x-box-remixes');
            bRemixes.appendChild(el('div', 'x-box-lbl', 'Total Remixes'));
            bRemixes.appendChild(el('div', 'x-box-num', fmt(totalRemixes)));
            bRemixes.appendChild(el('div', 'x-box-sub', 'Typical Per Project: ' + fmt(typRemixes)));
            grid2x2.appendChild(bRemixes);

            statsSec.appendChild(grid2x2);
            colMain.appendChild(statsSec);

            // 2. ACTIVITY
            var actSec = el('div', 'x-dash-sec');
            actSec.appendChild(el('div', 'x-sec-title', 'ACTIVITY'));

            // Last Active (Wide banner card with thumbnail on right)
            var cLast = el('div', 'x-stat-box x-last-card');
            var lastInfo = el('div', 'x-last-info');
            lastInfo.appendChild(el('div', 'x-box-lbl', 'Last Active'));
            var lastTime = latestProject ? agoAt(new Date(latestProject.history.modified || latestProject.history.shared).getTime()) : 'Unknown';
            lastInfo.appendChild(el('div', 'x-box-mid', lastTime));
            if (latestProject) {
                var pSub = el('div', 'x-last-sub');
                pSub.appendChild(document.createTextNode('shared '));
                var pTitle = a('x-last-link', 'https://scratch.mit.edu/projects/' + latestProject.id + '/', latestProject.title);
                pTitle.target = '_blank';
                pSub.appendChild(pTitle);
                lastInfo.appendChild(pSub);
            }
            cLast.appendChild(lastInfo);
            if (latestProject) {
                var pThumb = el('img', 'x-last-thumb');
                pThumb.src = latestProject.image || ('https://cdn2.scratch.mit.edu/get_image/project/' + latestProject.id + '_100x80.png');
                pThumb.alt = latestProject.title;
                cLast.appendChild(pThumb);
            }
            actSec.appendChild(cLast);

            // Account Age & Most Active Month & Unread Messages (3 columns)
            var actSubGrid = el('div', 'x-act-subgrid x-act-tri');

            // Account Age
            var cAge = el('div', 'x-stat-box');
            cAge.appendChild(el('div', 'x-box-lbl', 'Account Age'));
            cAge.appendChild(el('div', 'x-box-num x-box-text', accountAge));
            actSubGrid.appendChild(cAge);

            // Most Active Month
            var cMonth = el('div', 'x-stat-box');
            cMonth.appendChild(el('div', 'x-box-lbl', 'Most Active Month'));
            cMonth.appendChild(el('div', 'x-box-num x-box-text', mostActiveMonth));
            actSubGrid.appendChild(cMonth);

            // Unread Messages
            var cMsg = el('div', 'x-stat-box');
            cMsg.appendChild(el('div', 'x-box-lbl', 'Unread Messages'));
            cMsg.appendChild(el('div', 'x-box-num', String(username === state.me ? (state.messages || 0) : 0)));
            actSubGrid.appendChild(cMsg);

            actSec.appendChild(actSubGrid);
            colMain.appendChild(actSec);

            // 3. PROJECT ACTIVITY (Heatmap across full width!)
            var heatSec = el('div', 'x-dash-sec x-heat-sec');
            var heatHead = el('div', 'x-heat-head');
            var heatTitle = el('div', 'x-sec-title', 'Project Activity');
            heatHead.appendChild(heatTitle);

            // Year selector
            var activeYears = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
            var curYear = activeYears[0] || (new Date()).getFullYear();
            var yearSelector = el('div', 'x-year-sel');
            var prevY = el('button', 'x-ys-btn');
            prevY.type = 'button';
            prevY.appendChild(icon('chevL'));
            var yearLabel = el('span', 'x-ys-lbl', String(curYear));
            var nextY = el('button', 'x-ys-btn');
            nextY.type = 'button';
            nextY.appendChild(icon('chevR'));
            yearSelector.appendChild(prevY);
            yearSelector.appendChild(yearLabel);
            yearSelector.appendChild(nextY);
            heatHead.appendChild(yearSelector);
            heatSec.appendChild(heatHead);

            var countSub = el('div', 'x-heat-sub', (years[curYear] || 0) + ' projects shared in ' + curYear);
            heatSec.appendChild(countSub);

            // Heatmap Grid Container
            var heatBody = el('div', 'x-heat-body');
            heatSec.appendChild(heatBody);

            function paintHeatmap(y) {
                heatBody.innerHTML = '';
                countSub.textContent = (years[y] || 0) + ' projects shared in ' + y;
                yearLabel.textContent = String(y);

                var mHeader = el('div', 'x-heat-months');
                ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].forEach(function (m) {
                    mHeader.appendChild(el('span', null, m));
                });
                heatBody.appendChild(mHeader);

                var gridWrap = el('div', 'x-heat-grid-wrap');
                var dayLabels = el('div', 'x-heat-days');
                dayLabels.appendChild(el('span', null, ''));
                dayLabels.appendChild(el('span', null, 'Mon'));
                dayLabels.appendChild(el('span', null, ''));
                dayLabels.appendChild(el('span', null, 'Wed'));
                dayLabels.appendChild(el('span', null, ''));
                dayLabels.appendChild(el('span', null, 'Fri'));
                dayLabels.appendChild(el('span', null, ''));
                gridWrap.appendChild(dayLabels);

                var grid = el('div', 'x-heat-grid');
                var start = new Date(y, 0, 1);
                var end = new Date(y, 11, 31);
                var startDay = start.getDay();

                for (var s = 0; s < startDay; s++) {
                    grid.appendChild(el('div', 'x-heat-cell x-heat-sp'));
                }

                var cur = new Date(start);
                while (cur <= end) {
                    var iso = cur.toISOString().slice(0, 10);
                    var count = dayActivity[iso] || 0;
                    var lvl = count >= 5 ? 4 : (count >= 3 ? 3 : (count >= 2 ? 2 : (count >= 1 ? 1 : 0)));
                    var cell = el('div', 'x-heat-cell x-hl-' + lvl);
                    cell.title = count + ' projects on ' + iso;
                    grid.appendChild(cell);
                    cur.setDate(cur.getDate() + 1);
                }
                gridWrap.appendChild(grid);
                heatBody.appendChild(gridWrap);

                var legend = el('div', 'x-heat-legend');
                legend.appendChild(el('span', null, 'Less'));
                legend.appendChild(el('div', 'x-heat-cell x-hl-0'));
                legend.appendChild(el('div', 'x-heat-cell x-hl-1'));
                legend.appendChild(el('div', 'x-heat-cell x-hl-2'));
                legend.appendChild(el('div', 'x-heat-cell x-hl-3'));
                legend.appendChild(el('div', 'x-heat-cell x-hl-4'));
                legend.appendChild(el('span', null, 'More'));
                heatBody.appendChild(legend);

                paintTimeline(y);
            }

            prevY.addEventListener('click', function () {
                curYear--;
                paintHeatmap(curYear);
            });
            nextY.addEventListener('click', function () {
                curYear++;
                paintHeatmap(curYear);
            });

            // 4. ACTIVITY TIMELINE
            var tlSec = el('div', 'x-dash-sec x-tl-sec');
            var tlHead = el('div', 'x-sec-title', 'Activity Timeline');
            tlSec.appendChild(tlHead);
            var tlList = el('div', 'x-tl-list');
            tlSec.appendChild(tlList);

            function paintTimeline(y) {
                tlList.innerHTML = '';
                var yProjects = projects.filter(function (p) {
                    var dStr = (p.history && (p.history.shared || p.history.created)) || '';
                    return dStr && (new Date(dStr)).getFullYear() === y;
                }).sort(function (a, b) {
                    return (new Date(b.history.shared || b.history.created || 0)).getTime() - (new Date(a.history.shared || a.history.created || 0)).getTime();
                });

                if (!yProjects.length) {
                    tlList.appendChild(el('div', 'x-empty-box', 'No project activity recorded for this year.'));
                    return;
                }

                yProjects.forEach(function (p) {
                    var row = a('x-tl-row', 'https://scratch.mit.edu/projects/' + p.id + '/');
                    row.target = '_blank';
                    var thumb = el('img', 'x-tl-thumb');
                    thumb.src = p.image || ('https://cdn2.scratch.mit.edu/get_image/project/' + p.id + '_100x80.png');
                    row.appendChild(thumb);

                    var info = el('div', 'x-tl-info');
                    info.appendChild(el('b', 'x-tl-title', p.title));
                    var dateStr = (new Date(p.history.shared || p.history.created)).toLocaleDateString(NUM, { month: 'short', day: 'numeric' });
                    info.appendChild(el('span', 'x-tl-date', dateStr));
                    row.appendChild(info);

                    var pStats = el('div', 'x-tl-stats');
                    pStats.appendChild(el('span', 'x-stat-chip', fmt((p.stats && p.stats.views) || 0) + ' views'));
                    pStats.appendChild(el('span', 'x-stat-chip', fmt((p.stats && p.stats.loves) || 0) + ' loves'));
                    row.appendChild(pStats);
                    tlList.appendChild(row);
                });
            }

            paintHeatmap(curYear);
            colMain.appendChild(heatSec);
            colMain.appendChild(tlSec);

            statsLayout.appendChild(colMain);
            viewContainer.appendChild(statsLayout);
        }

        function showUserGridTab(title, count, users, listUrl) {
            var gridSec = el('div', 'x-dash-sec');
            gridSec.appendChild(el('div', 'x-sec-title', title.toUpperCase() + ' (' + fmt(count) + ')'));
            viewContainer.appendChild(gridSec);

            if (!users || !users.length) {
                viewContainer.appendChild(el('div', 'x-empty-box', 'No ' + title.toLowerCase() + ' found.'));
                return;
            }

            var grid = el('div', 'x-user-grid');
            users.forEach(function (u) {
                var card = el('div', 'x-user-card');
                card.appendChild(avatarNode(u.username, 'x-user-av'));
                var meta = el('div', 'x-user-meta');
                meta.appendChild(el('b', 'x-user-name', u.username));
                meta.appendChild(el('span', 'x-user-sub', (u.profile && u.profile.country) ? u.profile.country : 'Scratcher'));
                card.appendChild(meta);

                var viewBtn = el('button', 'x-user-btn', 'Profile');
                viewBtn.type = 'button';
                viewBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openProfile(u.username);
                });
                card.appendChild(viewBtn);
                card.addEventListener('click', function () {
                    openProfile(u.username);
                });
                grid.appendChild(card);
            });
            viewContainer.appendChild(grid);

            if (count > users.length) {
                var foot = el('div', 'x-user-more');
                var moreLink = a('x-prof-link', listUrl, 'View all ' + fmt(count) + ' on Scratch ↗');
                moreLink.target = '_blank';
                foot.appendChild(moreLink);
                viewContainer.appendChild(foot);
            }
        }

        function showProjectsTab() {
            setActiveTab(tabProjects);

            var pGrid = el('div', 'x-pgrid');
            if (!projects.length) {
                pGrid.appendChild(el('div', 'x-empty-box', 'No projects shared yet.'));
                viewContainer.appendChild(pGrid);
                return;
            }

            projects.forEach(function (p) {
                var item = a('x-pcard', 'https://scratch.mit.edu/projects/' + p.id + '/');
                item.target = '_blank';
                var img = el('img', 'x-pthumb');
                img.src = p.image || ('https://cdn2.scratch.mit.edu/get_image/project/' + p.id + '_100x80.png');
                item.appendChild(img);

                var pBody = el('div', 'x-pcard-body');
                pBody.appendChild(el('b', 'x-pcard-title', p.title));
                var mRow = el('div', 'x-pcard-meta');
                mRow.appendChild(el('span', null, ((p.stats && p.stats.views) || 0) + ' views'));
                mRow.appendChild(el('span', null, '·'));
                mRow.appendChild(el('span', null, ((p.stats && p.stats.loves) || 0) + ' loves'));
                pBody.appendChild(mRow);
                item.appendChild(pBody);
                pGrid.appendChild(item);
            });
            viewContainer.appendChild(pGrid);
        }

        function showForumTab() {
            setActiveTab(tabForum);
            var fWrap = el('div', 'x-dash-sec');
            var fHead = el('div', 'x-sec-title', (CUR_LANG === 'tr' ? '@' + username + ' FORUM KONULARI' : 'FORUM TOPICS & QUESTIONS BY @' + username));
            fWrap.appendChild(fHead);
            fWrap.appendChild(skeleton(3));
            viewContainer.appendChild(fWrap);

            searchForumFind(username, function (allTopics) {
                fWrap.innerHTML = '';
                var userTopics = (allTopics || []).filter(function (item) {
                    return (item[2] || '').toLowerCase() === username.toLowerCase();
                });
                var titleTxt = (CUR_LANG === 'tr' ? '@' + username + ' Forum Konuları (' : 'Topics by @' + username + ' (') + userTopics.length + ')';
                fWrap.appendChild(el('div', 'x-sec-title', titleTxt));

                if (!userTopics.length) {
                    var emptyBox = el('div', 'x-note');
                    emptyBox.appendChild(el('p', null, CUR_LANG === 'tr' ? '@' + username + ' tarafından açılmış forum konusu bulunamadı.' : 'No forum topics found started by @' + username + '.'));
                    var searchMention = a('x-cta', '/discuss/search/?q=' + encodeURIComponent(username), CUR_LANG === 'tr' ? '@' + username + ' geçen konuları ara' : 'Search topics mentioning @' + username);
                    searchMention.style.display = 'inline-block';
                    searchMention.style.marginTop = '12px';
                    emptyBox.appendChild(searchMention);
                    fWrap.appendChild(emptyBox);
                    return;
                }

                userTopics.forEach(function (item) {
                    var topicObj = {
                        id: String(item[0]),
                        title: item[1] || 'Untitled',
                        author: item[2] || username,
                        catId: String(item[3]),
                        catName: FF_FORUM_NAMES[item[3]] || 'Discuss',
                        replies: 0,
                        views: 0,
                        ms: null
                    };
                    fWrap.appendChild(topicCard(topicObj));
                });
            });
        }

        tabStats.addEventListener('click', showStatsTab);
        tabProjects.addEventListener('click', showProjectsTab);
        tabForum.addEventListener('click', showForumTab);
        tabFollowers.addEventListener('click', function () {
            setActiveTab(tabFollowers);
            showUserGridTab('Followers', exactFollowers, followers, 'https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/followers/');
        });
        tabFollowing.addEventListener('click', function () {
            setActiveTab(tabFollowing);
            showUserGridTab('Following', exactFollowing, following, 'https://scratch.mit.edu/users/' + encodeURIComponent(username) + '/following/');
        });

        showStatsTab();
    }

    function cookie(name) {
        var m = new RegExp('(?:^|; )' + name + '=([^;]*)').exec(document.cookie);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function attachSearchCombobox(form, input, drop, clearBtn) {
        var timer = null;
        var activeIndex = -1;

        function closeDrop() {
            drop.classList.remove('open');
            drop.innerHTML = '';
            activeIndex = -1;
        }

        clearBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            input.value = '';
            clearBtn.classList.remove('on');
            closeDrop();
            input.focus();
        });

        input.addEventListener('input', function () {
            var val = (input.value || '').trim();
            clearBtn.classList.toggle('on', input.value.length > 0);
            clearTimeout(timer);
            if (!val) {
                closeDrop();
                return;
            }

            timer = setTimeout(function () {
                renderDropdown(val);
            }, 180);
        });

        input.addEventListener('focus', function () {
            var val = (input.value || '').trim();
            if (val) renderDropdown(val);
        });

        document.addEventListener('click', function (e) {
            if (!form.contains(e.target)) {
                closeDrop();
            }
        });

        input.addEventListener('keydown', function (e) {
            var items = drop.querySelectorAll('.x-sdrop-item');
            if (!items.length || !drop.classList.contains('open')) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                updateSelection(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateSelection(items);
            } else if (e.key === 'Enter') {
                if (activeIndex >= 0 && items[activeIndex]) {
                    e.preventDefault();
                    items[activeIndex].click();
                }
            } else if (e.key === 'Escape') {
                closeDrop();
            }
        });

        function updateSelection(items) {
            items.forEach(function (it, idx) {
                it.classList.toggle('selected', idx === activeIndex);
            });
            if (items[activeIndex]) {
                items[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        function renderDropdown(query) {
            drop.innerHTML = '';
            drop.classList.add('open');
            activeIndex = -1;

            // 1. Search Query Section (X style)
            var secQuery = el('div', 'x-sdrop-sec');
            var rowQuery = el('div', 'x-sdrop-item');
            rowQuery.appendChild(icon('search'));
            var tBox = el('div', 'x-sdrop-t');
            tBox.innerHTML = '<strong>' + escapeHtml(query) + '</strong> <span style="color:var(--x-mut);font-weight:400">için forumda ara</span>';
            rowQuery.appendChild(tBox);
            rowQuery.addEventListener('click', function () {
                closeDrop();
                navigate('/discuss/search/?q=' + encodeURIComponent(query));
            });
            secQuery.appendChild(rowQuery);
            drop.appendChild(secQuery);

            // 2. User Suggestion (X style) if single word & valid username characters
            var cleanUser = query.trim();
            if (/^[a-zA-Z0-9_-]{2,20}$/.test(cleanUser)) {
                var secUser = el('div', 'x-sdrop-sec');
                var uItem = el('div', 'x-sdrop-item x-sdrop-user');
                uItem.appendChild(avatarNode(cleanUser, 'x-av-xs'));
                var uMeta = el('div', 'x-sdrop-t');
                uMeta.innerHTML = '<b>' + escapeHtml(cleanUser) + '</b> <span class="x-sdrop-sub">@' + escapeHtml(cleanUser.toLowerCase()) + '</span>';
                uItem.appendChild(uMeta);
                var uBadge = el('span', 'x-sdrop-badge', 'Kullanıcı');
                uItem.appendChild(uBadge);
                uItem.addEventListener('click', function () {
                    closeDrop();
                    openProfile(cleanUser);
                });
                secUser.appendChild(uItem);
                drop.appendChild(secUser);
            }

            // 3. ForumFind Topic Results (gem1001)
            var secTopics = el('div', 'x-sdrop-sec');
            var topLbl = el('div', 'x-sdrop-lbl', 'Konular · ForumFind');
            secTopics.appendChild(topLbl);

            var loadingItem = el('div', 'x-sdrop-empty', 'Konular aranıyor…');
            secTopics.appendChild(loadingItem);
            drop.appendChild(secTopics);

            searchForumFind(query, function (topics) {
                if (input.value.trim() !== query) return;
                secTopics.innerHTML = '';
                secTopics.appendChild(topLbl);

                if (!topics || !topics.length) {
                    secTopics.appendChild(el('div', 'x-sdrop-empty', 'Eşleşen konu bulunamadı.'));
                } else {
                    topics.slice(0, 6).forEach(function (item) {
                        var topicId = item[0];
                        var title = item[1];
                        var author = item[2];
                        var subforumId = item[3];
                        var subforumName = FF_FORUM_NAMES[subforumId] || 'Discuss';

                        var tItem = el('div', 'x-sdrop-item');
                        tItem.appendChild(icon('chat'));
                        var info = el('div', 'x-sdrop-t');
                        info.innerHTML = '<div>' + highlightMatch(title, query) + '</div><div class="x-sdrop-sub">yazan: <b>' + escapeHtml(author) + '</b> · ' + escapeHtml(subforumName) + '</div>';
                        tItem.appendChild(info);

                        tItem.addEventListener('click', function () {
                            closeDrop();
                            navigate('/discuss/topic/' + topicId + '/');
                        });
                        secTopics.appendChild(tItem);
                    });
                }

                // Footer badge
                var foot = el('div', 'x-sdrop-foot');
                foot.innerHTML = '<span>⚡ <strong>ForumFind</strong> arama motoru</span><a href="https://forumfind.evof.cc/" target="_blank">gem1001 ↗</a>';
                drop.appendChild(foot);
            });
        }
    }

    // ---------------------------------------------------------------- rail
    function paintRail() {
        var rail = document.querySelector('.x-rail');
        if (!rail) return;
        rail.innerHTML = '';

        var form = el('form', 'x-search');
        form.method = 'get';
        form.action = '/discuss/search/';
        form.appendChild(icon('search', 'x-search-icon'));
        var q = el('input');
        q.type = 'search';
        q.name = 'q';
        q.placeholder = L.searchPh;
        q.autocomplete = 'off';
        q.spellcheck = false;
        form.appendChild(q);

        var clearBtn = el('button', 'x-search-clear');
        clearBtn.type = 'button';
        clearBtn.title = 'Temizle';
        clearBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        form.appendChild(clearBtn);

        var drop = el('div', 'x-search-drop');
        form.appendChild(drop);

        attachSearchCombobox(form, q, drop, clearBtn);
        rail.appendChild(form);

        var active = el('section', 'x-card');
        active.appendChild(el('h3', null, L.active));
        var cats = state.cats.slice().sort(function (x, y) {
            return (y.ms || 0) - (x.ms || 0);
        }).slice(0, 8);
        if (!cats.length) {
            active.appendChild(el('p', 'x-card-note', L.loading));
        } else {
            var activeScroll = el('div', 'x-card-scroll');
            cats.forEach(function (cat) {
                var row = a('x-row', '/discuss/' + cat.id + '/');
                row.href = '/discuss/' + cat.id + '/';
                var top = el('div', 'x-row-top');
                top.appendChild(el('b', null, cat.name));
                top.appendChild(el('span', null, ago(cat.ms)));
                row.appendChild(top);
                row.appendChild(el('span', 'x-row-sub', fmt(cat.topics) + ' ' + L.topics + ' · ' + fmt(cat.posts) + ' ' + L.posts));
                activeScroll.appendChild(row);
            });
            active.appendChild(activeScroll);
        }
        var activeMore = a('x-card-more', '/discuss/?view=forums', L.allForums + ' →');
        activeMore.addEventListener('click', function (e) {
            e.preventDefault();
            setView('forums');
        });
        active.appendChild(activeMore);
        rail.appendChild(active);

        var help = el('section', 'x-card');
        help.appendChild(el('h3', null, L.help));
        help.appendChild(el('p', 'x-card-note', L.helpNote));
        var helpBox = el('div', 'x-card-scroll');
        help.appendChild(helpBox);
        var helpMore = a('x-card-more', '/discuss/?view=help', L.more + ' →');
        helpMore.addEventListener('click', function (e) {
            e.preventDefault();
            setView('help');
        });
        help.appendChild(helpMore);
        rail.appendChild(help);
        paintHelpBox(helpBox);

        rail.appendChild(el('p', 'x-foot', L.foot));
    }

    // the unanswered list is fetched once at boot and painted from state: a second fetch per
    // repaint used to fill a box that had already been replaced
    function paintHelpBox(box) {
        box.innerHTML = '';
        if (state.unanswered === null) {
            box.appendChild(el('p', 'x-card-note', L.loading));
            return;
        }
        // the rail is a "can I help with a question" prompt, so Show and Tell and other showcase
        // forums stay out of it; the Unanswered tab still carries the whole list
        var asks = state.unanswered.filter(function (topic) {
            return !topic.catId || topic.catId === '4' || topic.catId === '7' ||
                topic.catId === '25' || topic.catId === '6';
        });
        if (!asks.length) {
            box.appendChild(el('p', 'x-card-note', L.helpEmpty));
            return;
        }
        asks.slice(0, 8).forEach(function (topic) {
            var row = a('x-row', '/discuss/topic/' + topic.id + '/');
            var top = el('div', 'x-row-top');
            if (topic.author) {
                var av = avatarNode(topic.author, 'x-av-xs');
                top.appendChild(av);
                top.appendChild(el('b', null, topic.author));
            } else {
                top.appendChild(el('b', null, L.thread));
            }
            top.appendChild(el('span', null, ago(topic.ms)));
            row.appendChild(top);
            row.appendChild(el('span', 'x-row-title', topic.title));
            box.appendChild(row);
        });
    }

    // ---------------------------------------------------------------- toast
    var toastTimer = 0;

    function toast(text) {
        var old = document.querySelector('.x-toast');
        if (old) old.remove();
        var t = el('div', 'x-toast', text);
        document.body.appendChild(t);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            t.remove();
        }, 1800);
    }


    var PAGE_CACHE = {};
    function fetchDoc(url) {
        if (PAGE_CACHE[url]) return Promise.resolve(PAGE_CACHE[url]);
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.text();
        }).then(function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            PAGE_CACHE[url] = doc;
            return doc;
        });
    }

    function navigate(url) {
        if (!url) return;
        try {
            var u = new URL(url, location.origin);
            if (u.pathname === location.pathname && u.search === location.search) return;
            history.pushState(null, '', u.pathname + u.search);
            route();
        } catch (e) {
            location.href = url;
        }
    }

    function route() {
        PATH = location.pathname;
        M_HOME = /^\/discuss\/?$/.test(PATH);
        M_CAT = /^\/discuss\/(\d+)\/?$/.exec(PATH);
        M_TOPIC = /^\/discuss\/topic\/(\d+)\//.exec(PATH);
        M_SEARCH = /^\/discuss\/search\/?$/.test(PATH);
        KIND = M_HOME ? 'home' : M_CAT ? 'cat' : M_TOPIC ? 'topic' : M_SEARCH ? 'search' : 'home';
        if (KIND === 'home') {
            var params = new URLSearchParams(location.search);
            var u = params.get('user') || params.get('u');
            if (u) {
                state.tab = 'profile';
                state.profileUser = u;
            } else {
                var view = params.get('view');
                if (view === 'forums' || view === 'saved' || view === 'help') state.tab = view;
                else if (!location.search) state.tab = 'trend';
            }
        }
        paintSidebar();
        if (KIND === 'home') {
            if (state.tab === 'profile' && state.profileUser) viewProfile(state.profileUser);
            else viewHome();
        }
        else if (KIND === 'cat') viewCategory(M_CAT[1]);
        else if (KIND === 'topic') viewTopic(M_TOPIC[1]);
        else viewSearch();
        window.scrollTo(0, 0);
    }

    // ---------------------------------------------------------------- boot
    function boot() {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', boot, {once: true});
            return;
        }
        try {
            injectStyle();
            var saved = localStorage.getItem('sd-x-theme');
            if (!saved) {
                saved = 'light';
            }
            document.documentElement.classList.toggle('sd-x-light', saved === 'light');
            document.documentElement.classList.toggle('sd-x-dark', saved !== 'light');
            document.documentElement.classList.add('sd-x-on');
            // SPA navigation interception: 0ms instant transition, zero page flicker
            window.addEventListener('popstate', route);
            document.addEventListener('click', function (e) {
                var a = e.target.closest('a');
                if (!a) return;
                var href = a.getAttribute('href');
                if (!href || href.charAt(0) === '#' || a.target === '_blank') return;

                var userMatch = /^\/users\/([^/]+)\/?$/.exec(href);
                if (userMatch && !/^(edit|search|add|login|join|terms_of_use)$/i.test(userMatch[1])) {
                    e.preventDefault();
                    e.stopPropagation();
                    openProfile(decodeURIComponent(userMatch[1]));
                    return;
                }

                if (href.startsWith('http') && !href.startsWith(location.origin)) return;
                if (/^\/discuss(\/|$)/.test(href) &&
                    !/^\/discuss\/(post|misc|settings|subscription)\//.test(href) &&
                    !/\/topic\/add\/?$|\/edit\/?$/.test(href)) {
                    e.preventDefault();
                    navigate(href);
                }
            });

            if (KIND === 'home') {
                var params = new URLSearchParams(location.search);
                var u = params.get('user') || params.get('u');
                if (u) {
                    state.tab = 'profile';
                    state.profileUser = u;
                } else {
                    var view = params.get('view');
                    if (view === 'forums' || view === 'saved' || view === 'help') state.tab = view;
                }
            }

            capture();

            // the account nav in the hidden native header already knows who is signed in, so the
            // sidebar and the reply box never ask a signed-in user to sign in again
            var domLink = document.querySelector('#topnav .user-nav a[href^="/users/"], #topnav a[href^="/users/"]');
            var domName = domLink ? (/\/users\/([^/]+)/.exec(domLink.getAttribute('href')) || [])[1] : '';
            if (domName) state.me = decodeURIComponent(domName);

            shell();

            if (KIND === 'home') {
                if (state.tab === 'profile' && state.profileUser) viewProfile(state.profileUser);
                else viewHome();
            }
            else if (KIND === 'cat') viewCategory(M_CAT[1]);
            else if (KIND === 'topic') viewTopic(M_TOPIC[1]);
            else viewSearch();

            loadIndex(function (cats) {
                state.cats = cats;
                paintRail();
                if (KIND === 'home' && state.tab === 'forums') paintForums();
            });

            setTimeout(function () {
                loadUnanswered(function (list) {
                    state.unanswered = list || [];
                    paintRail();
                });
            }, 1200);

            fetch('/session/', {credentials: 'include', headers: {'x-requested-with': 'XMLHttpRequest'}}).then(function (r) {
                return r.json();
            }).then(function (session) {
                var user = session && session.user;
                state.me = user ? user.username : (state.me || null);
                if (user && user.id) {
                    document.documentElement.dataset.sduid = user.id;
                    UIDMAP[user.username] = 'https://cdn2.scratch.mit.edu/get_image/user/' + user.id + '_50x50.png';
                    applyKnownAvatars();
                    refreshSelf();
                    fetch('https://api.scratch.mit.edu/users/' + encodeURIComponent(user.username) + '/messages/count')
                        .then(function (r) { return r.json(); })
                        .then(function (count) {
                            state.messages = (count && count.count) || 0;
                        }).catch(function () { /* the badge is optional */ });
                }
                paintSidebar();
                refreshSelf();
                if (KIND === 'topic' && mainFeed && state.me && M_TOPIC) {
                    var oldBar = mainFeed.querySelector('.x-replytop');
                    if (oldBar && oldBar.querySelector('.x-loginbar')) {
                        oldBar.replaceWith(replyComposer(M_TOPIC[1]));
                    }
                }
            }).catch(function () { /* signed out: the sidebar keeps its sign-in links */ });

            document.addEventListener('keydown', function (event) {
                if (event.target.matches('input,textarea,select')) return;
                if (event.key === '/') {
                    event.preventDefault();
                    var input = document.querySelector('.x-search input');
                    if (input) input.focus();
                }
                if (event.key === 'n') {
                    event.preventDefault();
                    openCompose(M_CAT ? M_CAT[1] : '');
                }
            });
        } catch (error) {
            console.error('ScratchDream forum boot error:', error && error.stack ? error.stack : error);
            document.documentElement.classList.remove('sd-x-on');
            var broken = document.getElementById('sd-x');
            if (broken) broken.remove();
        }
    }

    // ---------------------------------------------------------------- styles
    var style = document.createElement('style');
    style.textContent = [
        "@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700;800&family=JetBrains+Mono:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');",
        "html.sd-x-dark{",
        "--x-bg:#000000;--x-bg2:#000000;--x-surf:#000000;--x-surf2:#16181C;--x-line:#2F3336;",
        "--x-ink:#E7E9EA;--x-body:#71767B;--x-mut:#71767B;--x-acc:#1D9BF0;--x-acc-hover:#1A8CD8;--x-acc-ink:#FFFFFF;",
        "--x-brand-700:#1D9BF0;--x-brand-500:#1D9BF0;--x-brand-100:rgba(29,155,240,.12);",
        "--x-glass:rgba(0,0,0,.88);--x-soft:rgba(231,233,234,.04);--x-soft-blue:rgba(29,155,240,.1);",
        "--x-warn:#FFD400;--x-shadow-1:none;--x-shadow-2:none}",
        "html.sd-x-light{",
        "--x-bg:#F3F6FB;--x-bg2:#FFFFFF;--x-surf:#FFFFFF;--x-surf2:#EDF3FA;--x-line:rgba(0,0,0,.06);",
        "--x-ink:#1E293B;--x-body:#475569;--x-mut:#858CA2;--x-acc:#3B82F6;--x-acc-hover:#2563EB;--x-acc-ink:#FFFFFF;",
        "--x-brand-700:#2563EB;--x-brand-500:#3B82F6;--x-brand-100:#EBF3FE;",
        "--x-glass:rgba(255,255,255,.98);--x-soft:#F8FAFD;--x-soft-blue:#EFF6FF;",
        "--x-warn:#F59E0B;--x-shadow-1:none;--x-shadow-2:none}",

        "html.sd-x-dark,html.sd-x-dark *,html.sd-x-on,html.sd-x-on *,.x-app,.x-app *{text-shadow:none!important;-webkit-text-stroke:0!important}",
        "html.sd-x-on{background:var(--x-bg)!important}",
        "html.sd-x-on body{margin:0!important;height:auto!important;min-height:100vh;background:var(--x-bg)!important;color:var(--x-body);",
        "font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif!important;font-size:14.5px;-webkit-font-smoothing:antialiased!important;-moz-osx-font-smoothing:grayscale!important;text-rendering:optimizeLegibility!important}",
        "html.sd-x-on #pagewrapper,html.sd-x-on #topnav,html.sd-x-on #content,html.sd-x-on #footer,html.sd-x-on #alert-view{display:none!important}",
        "html.sd-x-on #account-nav,html.sd-x-on .dropdown,html.sd-x-on #login-dialog,html.sd-x-on #password,html.sd-x-on #registration{display:none!important}",
        ".x-app{display:grid;grid-template-columns:250px minmax(0,640px) 330px;max-width:1260px;margin:0 auto;align-items:start;min-height:100vh;background:var(--x-bg);gap:16px;padding:0 12px}",
        ".x-app *{box-sizing:border-box}",
        ".x-app a{color:inherit;text-decoration:none}",
        ".x-app a:hover{text-decoration:none}",
        ".x-app button{height:auto;line-height:1.2;font-family:inherit}",
        ".x-input,.x-textarea,.x-select{height:auto}",
        ".x-app h1,.x-app h2,.x-app h3,.x-app h4,.x-title,.x-tweet-title,.x-tweet-name,.x-name,.x-sec-title,.x-prof-name,.x-box-num,.x-box-text,.x-box-mid,.x-nav,.x-cta,.x-tab,.x-prof-tab,.x-f-pill,.x-user-name,.x-user-btn,.x-ys-lbl,.x-tl-title,.x-tweet-handle,.x-tweet-time{font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif!important;letter-spacing:-0.015em;text-shadow:none!important;-webkit-text-stroke:0!important}",
        ".x-app svg{display:block}",

        // left rail (Sidebar)
        ".x-side{position:sticky;top:0;height:100vh;max-height:100vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;display:flex;flex-direction:column;gap:3px;padding:12px 6px 14px;box-sizing:border-box}",
        ".x-side::-webkit-scrollbar{display:none}",
        ".x-logo{display:flex;align-items:center;padding:10px 12px 14px;text-decoration:none!important}",
        ".x-brand-title{font-family:'Fredoka',cursive,sans-serif!important;font-size:26px!important;font-weight:700!important;line-height:1!important;display:inline-flex!important;align-items:baseline!important;gap:5px!important;letter-spacing:-0.02em!important;user-select:none!important;text-shadow:none!important;-webkit-text-stroke:0!important}",
        "html.sd-x-light .x-brand-scratch{color:#FFAB19!important}",
        "html.sd-x-light .x-brand-forum{color:#1D9BF0!important}",
        "html.sd-x-dark .x-brand-scratch{color:#FFFFFF!important;text-shadow:none!important;-webkit-text-stroke:0!important}",
        "html.sd-x-dark .x-brand-forum{color:#1D9BF0!important;text-shadow:none!important;-webkit-text-stroke:0!important}",
        ".x-logo-banner{width:100%;max-width:185px;height:auto;max-height:44px;display:block;object-fit:contain;filter:none!important}",
        ".x-stack-head,.x-b-comment,.x-pill,.x-live-badge,code,pre,.x-catcount,.x-stat-chip,.x-b-code{font-family:'JetBrains Mono',monospace!important;text-shadow:none!important;-webkit-text-stroke:0!important}",
        ".x-nav{display:flex;align-items:center;gap:12px;padding:9.5px 14px;border-radius:999px;color:var(--x-body);",
        "text-decoration:none;font-size:14.5px;font-weight:700;line-height:1.2;transition:background .12s,color .12s;box-sizing:border-box;max-width:100%}",
        ".x-nav:hover{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-nav svg{width:19px;height:19px;flex:0 0 auto;transition:stroke .12s}",
        ".x-nav.on{background:var(--x-brand-100);color:var(--x-acc);font-weight:700}",
        ".x-nav.on svg{stroke:var(--x-acc);stroke-width:2.4}",
        ".x-cta{margin:10px 2px 0;padding:11px 16px;border:0;border-radius:999px;background:var(--x-acc);color:var(--x-acc-ink);",
        "font:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:background .12s,transform .1s}",
        ".x-cta:hover{background:var(--x-acc-hover);transform:translateY(-1px)}",
        ".x-cta:active{transform:scale(0.98)}",
        ".x-me{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding:10px 4px 6px;border-top:1px solid var(--x-line);width:100%;box-sizing:border-box}",
        ".x-me-link{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:10px;text-decoration:none;color:inherit;transition:background .12s}",
        ".x-me-link:hover{background:var(--x-soft-blue)}",
        ".x-metools{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;padding:0}",
        ".x-metools-top{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;box-sizing:border-box}",
        ".x-av{width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;",
        "font-weight:700;font-size:14px;flex:0 0 auto;user-select:none;overflow:hidden;background:var(--x-surf2)}",
        ".x-av-sm{width:32px;height:32px;border-radius:6px;font-size:12px}",
        ".x-av-photo{background:transparent!important}",
        ".x-av img,.x-av-img{width:100%!important;height:100%!important;object-fit:cover!important;border-radius:8px!important;display:block!important}",
        ".x-sk-av{width:38px;height:38px;border-radius:8px;background:var(--x-surf2);flex:0 0 auto}",
        ".x-loginbar{display:flex;align-items:center;gap:10px;margin:0;padding:6px 0;font-size:13.5px;color:var(--x-mut)}",
        ".x-loginbar .x-join{padding:6px 14px;font-size:13px}",
        ".x-hint{margin:2px 0 0;font-size:11px;color:var(--x-mut);line-height:1.4}",
        ".x-me-t{display:flex;flex-direction:column;min-width:0;font-size:13px;line-height:1.3}",
        ".x-me-t b{font-size:13.5px;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-me-t span{color:var(--x-mut);font-size:11.5px}",
        ".x-themebtn{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--x-surf);",
        "border:1px solid var(--x-line);color:var(--x-body);cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 10px;height:32px;border-radius:999px;transition:all .12s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".x-themebtn:hover{background:var(--x-soft-blue);color:var(--x-acc);border-color:var(--x-acc)}",
        ".x-themebtn svg{width:15px;height:15px;flex-shrink:0}",
        ".x-site{display:flex;align-items:center;justify-content:center;width:100%;height:29px;padding:0 12px;border-radius:999px;background:var(--x-surf2);border:1px solid var(--x-line);color:var(--x-mut);font-size:12px;font-weight:600;text-decoration:none;transition:all .12s;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}",
        ".x-site:hover{background:var(--x-soft-blue);color:var(--x-acc);border-color:var(--x-acc)}",
        ".x-me-links{display:flex;gap:8px}",
        ".x-login,.x-join{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 16px;border-radius:999px;",
        "text-decoration:none;font-weight:700;font-size:13px;white-space:nowrap;transition:all .12s}",
        ".x-login{border:1px solid var(--x-line);color:var(--x-body);background:var(--x-surf)}",
        ".x-login:hover{border-color:var(--x-acc);color:var(--x-acc)}",
        ".x-join{background:var(--x-acc);color:var(--x-acc-ink)}",
        ".x-join:hover{background:var(--x-acc-hover)}",

        // main column
        ".x-main{background:var(--x-surf);border:1px solid var(--x-line);border-radius:12px;min-height:100vh;padding-bottom:32px;margin:12px 0;overflow:hidden}",
        ".x-top{position:sticky;top:0;z-index:6;background:var(--x-glass);border-bottom:1px solid var(--x-line)}",
        ".x-top-inner{display:flex;align-items:center;gap:12px;padding:10px 16px;min-height:52px}",
        ".x-top-t{flex:1;min-width:0}",
        ".x-title{margin:0;font-size:18px;font-weight:700;line-height:1.25;letter-spacing:-.2px;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-sub{margin:2px 0 0;font-size:12px;color:var(--x-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-iconbtn{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;",
        "border:0;background:none;color:var(--x-body);cursor:pointer;text-decoration:none;flex:0 0 auto;transition:background .12s}",
        ".x-iconbtn:hover{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-iconbtn svg{width:19px;height:19px}",
        ".x-back{display:none}",
        ".x-top .x-home-tabs{display:none}",
        ".x-tabs{display:flex;align-items:center;gap:8px;padding:0 16px;height:52px;border-top:1px solid var(--x-line);background:var(--x-surf);box-sizing:border-box}",
        ".x-home-tabs .x-tab{flex:1;position:relative;display:flex;align-items:center;justify-content:center;height:46px;padding:0 8px;",
        "margin:0;border:0;background:none;color:var(--x-mut);font:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:color .12s}",
        ".x-home-tabs .x-tab:hover{background:var(--x-soft);color:var(--x-ink)}",
        ".x-home-tabs .x-tab.on{color:var(--x-acc);font-weight:700}",
        ".x-home-tabs .x-tab.on::after{content:'';position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:42px;height:3px;",
        "border-radius:3px;background:var(--x-acc)}",
        ".x-cat-tabs .x-tab{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 16px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);color:var(--x-body);font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s ease}",
        ".x-cat-tabs .x-tab:hover{background:var(--x-soft);color:var(--x-ink);border-color:var(--x-mut)}",
        ".x-cat-tabs .x-tab.on{background:var(--x-acc);color:#fff!important;border-color:var(--x-acc);font-weight:800}",
        ".x-cat-tabs .x-tab.on::after{display:none}",
        ".x-tab-right{margin-left:auto}",
        ".x-cat-new{height:34px;padding:0 18px;border-radius:999px;font-size:13px;font-weight:700;background:var(--x-acc);color:#fff!important;border:none;cursor:pointer;transition:all .15s ease;margin-left:auto;display:inline-flex;align-items:center;gap:6px}",
        ".x-cat-new:hover{background:var(--x-acc-hover);transform:translateY(-1px)}",

        ".x-cat-icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 42px;transition:transform .15s ease}",
        ".x-cat-icon svg{width:22px;height:22px}",
        ".x-forumcard:hover .x-cat-icon{transform:scale(1.04)}",
        ".x-stat-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 20px;border-bottom:1px solid var(--x-line);background:var(--x-soft)}",
        ".x-stat-chip{display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 10px;border-radius:999px;background:var(--x-surf);border:1px solid var(--x-line);font-size:12px;font-weight:700;color:var(--x-body);text-align:center;white-space:nowrap}",
        ".x-stat-chip svg{width:15px;height:15px;color:var(--x-acc);flex-shrink:0}",
        ".x-av-xs{width:22px;height:22px;border-radius:6px;font-size:10px;margin-right:6px;flex:0 0 22px;overflow:hidden}",

        // feed items (Topic Card)
        ".x-tweet-card{display:flex;gap:12px;padding:14px 18px;border-bottom:1px solid var(--x-line);cursor:pointer;transition:background .12s ease;align-items:flex-start}",
        ".x-tweet-card:hover{background:var(--x-soft)}",
        ".x-tweet-content{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}",
        ".x-tweet-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;line-height:1.3}",
        ".x-tweet-name{font-size:14.5px;font-weight:750;color:var(--x-ink);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-tweet-name:hover{text-decoration:underline}",
        ".x-verified-badge{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;flex:0 0 15px}",
        ".x-verified-badge svg{width:15px!important;height:15px!important;display:block}",
        ".x-tweet-handle{font-size:13px;color:var(--x-mut);font-weight:500}",
        ".x-tweet-time{font-size:13px;color:var(--x-mut);font-weight:500}",
        ".x-tweet-title{font-size:15px;font-weight:700;color:var(--x-ink);line-height:1.35;margin:2px 0;text-decoration:none;display:block;word-break:break-word}",
        ".x-tweet-card:hover .x-tweet-title{color:var(--x-acc)}",
        ".x-tweet-snippet{font-size:13.5px;color:var(--x-body);line-height:1.45;margin:2px 0 6px;word-break:break-word}",
        ".x-tweet-media{margin:8px 0;border-radius:12px;background:var(--x-surf2);display:flex;justify-content:center;align-items:center;overflow:hidden;max-width:100%;border:1px solid var(--x-line);box-sizing:border-box;padding:0}",
        ".x-tweet-img{display:block;width:100%;max-width:100%;height:auto;max-height:380px;object-fit:contain;border-radius:8px;margin:0 auto}",
        ".x-block-stack{background:var(--x-surf2);border-radius:12px;padding:12px 14px;margin:6px 0;display:flex;flex-direction:column;gap:4px;box-sizing:border-box;overflow-x:auto;scrollbar-width:none;border:1px solid var(--x-line)}",
        ".x-block-stack::-webkit-scrollbar{display:none}",
        ".x-stack-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:var(--x-mut);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}",
        ".x-stack-head svg{width:14px!important;height:14px!important;color:var(--x-acc);flex-shrink:0}",
        ".x-stack-body{display:flex;flex-direction:column;align-items:flex-start;gap:3px}",
        ".x-b-wrap{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%}",
        ".x-sblock{display:inline-flex;align-items:center;flex-wrap:wrap;gap:5px;padding:6px 12px;border-radius:6px;font-size:12.5px;font-weight:700;color:#FFFFFF!important;line-height:1.3;user-select:none;box-sizing:border-box;max-width:100%;word-break:break-word}",
        ".x-sblock-hat{border-radius:16px 16px 6px 6px;padding-top:8px}",
        ".x-sb-events{background:#FFBF00!important;color:#573E00!important}",
        ".x-sb-events .x-b-flag{color:#0FBD8C;font-size:14px}",
        ".x-sb-motion{background:#4C97FF!important}",
        ".x-sb-looks{background:#9966FF!important}",
        ".x-sb-sound{background:#CF63CF!important}",
        ".x-sb-control{background:#FFAB19!important}",
        ".x-sb-sensing{background:#5CB1D6!important}",
        ".x-sb-operators{background:#59C059!important}",
        ".x-sb-data{background:#FF8C1A!important}",
        ".x-sb-custom{background:#FF6680!important}",
        ".x-sb-extension{background:#0FBD8C!important}",
        ".x-sb-grey{background:#6B7280!important}",
        ".x-b-in{background:#FFFFFF!important;color:#333333!important;padding:1.5px 8px;border-radius:999px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center}",
        ".x-b-drop{background:rgba(0,0,0,.2)!important;color:#FFFFFF!important;padding:1.5px 8px;border-radius:4px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center}",
        ".x-sb-events .x-b-drop{color:#573E00!important;background:rgba(0,0,0,.1)!important}",
        ".x-b-flag{font-size:13px;margin-right:2px}",
        ".x-b-comment{font-size:11.5px;color:var(--x-mut);font-style:italic;background:var(--x-soft);padding:3px 8px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}",
        ".x-tweet-proj-card{display:flex;flex-direction:column;text-decoration:none;color:inherit;border-radius:14px;overflow:hidden;background:var(--x-surf);transition:transform .12s}",
        ".x-tweet-proj-card:hover{transform:translateY(-1px)}",
        ".x-proj-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}",
        ".x-proj-info{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;background:var(--x-surf);border-top:1px solid var(--x-line)}",
        ".x-proj-title{font-size:13.5px;font-weight:700;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-proj-btn{font-size:12px;font-weight:700;color:var(--x-acc);padding:4px 10px;border-radius:999px;background:var(--x-soft-blue);flex-shrink:0}",
        ".x-tweet-actions{display:flex;align-items:center;justify-content:space-between;max-width:100%;margin-top:6px;color:var(--x-mut);flex-wrap:wrap;gap:4px}",
        ".x-tw-act{display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:5px 8px;border-radius:999px;font:inherit;font-size:12.5px;font-weight:600;color:var(--x-mut);cursor:pointer;transition:color .12s ease,background .12s ease}",
        ".x-tw-act svg{width:16px!important;height:16px!important;flex-shrink:0;display:block}",
        ".x-tw-reply:hover{color:var(--x-acc);background:var(--x-soft-blue)}",
        ".x-tw-repost:hover{color:#10B981;background:rgba(16,185,129,.12)}",
        ".x-tw-like:hover{color:#F43F5E;background:rgba(244,63,94,.12)}",
        ".x-tw-like.on{color:#F43F5E}",
        ".x-tw-like.on svg{fill:#F43F5E;stroke:#F43F5E}",
        ".x-tw-views{cursor:default}",
        ".x-tw-views:hover{color:var(--x-acc)}",
        ".x-tw-share:hover{color:var(--x-acc);background:var(--x-soft-blue)}",
        ".x-item{display:flex;gap:14px;padding:15px 20px;border-bottom:1px solid var(--x-line);color:inherit;text-decoration:none;cursor:pointer;transition:background .12s}",
        ".x-item:hover{background:var(--x-soft)}",
        ".x-body{flex:1;min-width:0}",
        ".x-line1{display:flex;align-items:center;gap:8px;font-size:13px;min-width:0;line-height:1.35;flex-wrap:wrap}",
        ".x-name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--x-ink);text-decoration:none}",
        "a.x-name:hover{color:var(--x-acc)}",
        ".x-time{color:var(--x-mut);font-weight:500;font-size:12px;white-space:nowrap}",
        ".x-cat{display:inline-flex;align-items:center;font-size:11.5px;font-weight:700;color:var(--x-acc);background:var(--x-soft-blue);padding:2px 8px;border-radius:999px;text-decoration:none;transition:all .12s}",
        ".x-cat:hover{background:var(--x-acc);color:var(--x-acc-ink)}",
        ".x-text{display:block;font-size:15px;font-weight:700;line-height:1.4;margin:5px 0 7px;overflow-wrap:anywhere;color:var(--x-ink)}",
        ".x-text:hover span{color:var(--x-acc)}",
        ".x-desc{margin:4px 0 8px;font-size:13.5px;color:var(--x-body);line-height:1.5}",
        ".x-meta-row{display:flex;align-items:center;gap:10px;margin-top:4px}",
        ".x-badges{display:flex;align-items:center;gap:6px}",
        ".x-pill{font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--x-surf2);color:var(--x-mut)}",
        ".x-pill-wait{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-pill-sticky{background:rgba(255,171,25,.18);color:#C87B00}",
        ".x-pill-new{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-actions{display:flex;gap:14px;color:var(--x-mut);font-size:12px;font-weight:600;align-items:center}",
        ".x-act{display:inline-flex;align-items:center;gap:5px;background:none;border:0;color:inherit;cursor:default;",
        "font:inherit;font-size:inherit;padding:0;text-decoration:none}",
        "button.x-act:hover,a.x-act:hover{color:var(--x-acc)}",
        ".x-app button.x-act{cursor:pointer}",
        ".x-act svg{width:15px;height:15px}",
        ".x-save{margin-left:auto;padding:5px;border-radius:50%;color:var(--x-mut);transition:all .12s}",
        ".x-save:hover{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-save.on{color:var(--x-acc)}",
        ".x-save.on svg{fill:currentColor;fill-opacity:.2}",
        ".x-open{margin-left:auto;font-size:12px;font-weight:700;color:var(--x-acc)}",
        ".x-forumcard{align-items:flex-start;padding:16px 20px}",
        ".x-forumcard .x-line1{margin-bottom:3px}",
        ".x-forumcard .x-name{font-size:15.5px;color:var(--x-ink);letter-spacing:-.01em}",
        ".x-forumcard .x-desc{margin:4px 0 10px;font-size:13px;color:var(--x-body);line-height:1.45}",
        ".x-forumcard .x-actions{gap:16px}",
        ".x-forumdot{width:10px;height:10px;border-radius:50%;margin:7px 4px 0}",
        ".x-prompt{display:flex;align-items:center;gap:12px;width:100%;padding:13px 16px;border:0;border-bottom:1px solid var(--x-line);",
        "background:none;color:var(--x-mut);font:inherit;font-size:14px;font-weight:600;text-align:left;cursor:pointer;transition:background .12s}",
        ".x-prompt:hover{background:var(--x-soft)}",
        ".x-prompt-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-prompt-go{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:1px solid var(--x-line);color:var(--x-acc);flex:0 0 auto}",
        ".x-prompt-go svg{width:16px;height:16px}",
        ".x-newdot{width:7px;height:7px;border-radius:50%;background:var(--x-acc);margin-left:auto}",
        ".x-site{font-size:12px;color:var(--x-mut);text-decoration:none;white-space:nowrap}",
        ".x-site:hover{color:var(--x-acc)}",
        ".x-metools .x-themebtn{margin-left:0}",
        ".x-more{display:block;padding:14px;text-align:center;color:var(--x-acc);text-decoration:none;font-weight:700;border-bottom:1px solid var(--x-line);transition:background .12s}",
        ".x-more:hover{background:var(--x-soft)}",
        ".x-strip{display:flex;gap:8px;overflow-x:auto;padding:12px 16px;border-bottom:1px solid var(--x-line);scrollbar-width:none}",
        ".x-strip::-webkit-scrollbar{display:none}",
        ".x-chip{flex:0 0 auto;max-width:260px;padding:6px 12px;border-radius:999px;background:var(--x-surf2);border:1px solid var(--x-line);",
        "color:var(--x-body);text-decoration:none;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:all .12s}",
        ".x-chip:hover{border-color:var(--x-acc);color:var(--x-acc);background:var(--x-brand-100)}",
        ".x-summary{margin:0;padding:12px 16px;border-bottom:1px solid var(--x-line);font-size:13px;color:var(--x-mut)}",
        ".x-summary b{color:var(--x-ink);font-weight:700}",
        ".x-sk{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--x-line)}",
        ".x-sk-av{width:36px;height:36px;border-radius:50%;background:var(--x-surf2);flex:0 0 auto}",
        ".x-sk-b{flex:1;min-width:0}",
        ".x-sk-l{display:block;height:11px;border-radius:6px;background:var(--x-surf2);margin:7px 0}",
        ".x-w60{width:60%}.x-w90{width:92%}.x-w40{width:38%}",
        "@media (prefers-reduced-motion:no-preference){.x-sk-l,.x-sk-av{animation:xsk 1.3s ease-in-out infinite}}",
        "@keyframes xsk{0%,100%{opacity:.55}50%{opacity:1}}",
        ".x-stat{flex:1;padding:12px 6px;text-align:center;border-right:1px solid var(--x-line)}",
        ".x-stat:last-child{border-right:0}",
        ".x-stat b{display:block;font-size:18px;line-height:1.1;color:var(--x-ink)}",
        ".x-stat span{display:block;margin-top:3px;font-size:11px;color:var(--x-mut)}",
        ".x-cathead{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--x-line)}",
        ".x-catcount{font-size:12px;color:var(--x-mut);margin-left:auto}",
        ".x-note{padding:30px 18px;color:var(--x-mut);text-align:center;font-size:14px}",
        ".x-note p{margin:0 0 10px}",
        ".x-fail{color:var(--x-warn)}",
        ".x-rescount{margin:0;padding:12px 16px;font-size:12.5px;color:var(--x-mut);border-bottom:1px solid var(--x-line)}",
        // topic view & thread
        ".x-hero{padding:18px 18px 14px;border-bottom:1px solid var(--x-line)}",
        ".x-hero h1{margin:0 0 8px;font-size:20px;font-weight:700;line-height:1.3;letter-spacing:-.2px;color:var(--x-ink)}",
        ".x-hero-meta{display:flex;align-items:center;gap:12px;font-size:12.5px;color:var(--x-mut);flex-wrap:wrap}",
        ".x-follow{margin-left:auto;padding:6px 16px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);",
        "color:var(--x-body);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .12s}",
        ".x-follow.on{border-color:var(--x-acc);background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-post{display:flex;gap:12px;padding:14px 18px 12px;border-bottom:1px solid var(--x-line)}",
        ".x-first{background:var(--x-soft)}",
        ".x-av-img{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:var(--x-surf2)}",
        ".x-msg{font-size:14.5px;line-height:1.6;overflow-wrap:anywhere;margin-top:2px;color:var(--x-body)}",
        ".x-msg a{color:var(--x-acc);font-weight:600}",
        ".x-msg a:hover{text-decoration:underline}",
        ".x-msg img{max-width:100%;height:auto;border-radius:8px;margin:6px 0}",
        ".x-msg .post_body_html{display:block}",
        ".x-msg p{margin:0 0 8px}",
        ".x-msg .code,.x-msg pre{background:var(--x-surf2);border:1px solid var(--x-line);border-radius:10px;padding:10px 12px;",
        "overflow-x:auto;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.5}",
        ".x-msg blockquote,.x-msg .bb-quote{margin:10px 0;padding:10px 14px;border-radius:0 10px 10px 0;background:var(--x-soft-blue);border-left:4px solid var(--x-acc);color:var(--x-body)}",
        ".x-msg .scratchblocks{overflow-x:auto;max-width:100%}",
        ".x-msg .scratchblocks svg{max-width:100%;height:auto}",
        ".x-msg a.x-ext::after{content:'\\2197\\FE0E';font-size:10px;margin-left:2px;color:var(--x-mut)}",
        ".x-edited{margin:6px 0 0;font-size:11.5px;color:var(--x-mut)}",
        ".x-post .x-actions{margin-top:8px;gap:22px}",
        ".x-composer{display:flex;gap:12px;padding:14px 18px;border-bottom:1px solid var(--x-line);background:var(--x-bg)}",
        ".x-replytop{border-bottom:1px solid var(--x-line);background:var(--x-surf)}",
        ".x-ta::placeholder{color:var(--x-mut);opacity:.85}",
        ".x-ta{width:100%;min-height:50px;max-height:300px;padding:8px 0;border:0;background:none;color:var(--x-ink);",
        "font:inherit;font-size:15px;resize:none;outline:none;display:block}",
        ".x-comp-row{display:flex;align-items:center;gap:12px;margin-top:6px}",
        ".x-check{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--x-mut);cursor:pointer}",
        ".x-check input{accent-color:var(--x-acc);width:15px;height:15px}",
        ".x-send{margin-left:auto;padding:8px 20px;border:0;border-radius:999px;background:var(--x-acc);color:var(--x-acc-ink);",
        "font:inherit;font-weight:700;font-size:13.5px;cursor:pointer;transition:all .12s}",
        ".x-send:disabled{background:var(--x-surf2);color:var(--x-mut);cursor:default}",
        ".x-app .x-send:not(:disabled):hover{background:var(--x-acc-hover)}",
        ".x-count{font-size:11.5px;color:var(--x-mut)}",
        ".x-ghost{padding:8px 16px;border:1px solid var(--x-line);border-radius:999px;background:none;color:var(--x-body);",
        "font:inherit;font-weight:700;font-size:13.5px;cursor:pointer;transition:all .12s}",
        ".x-ghost:hover{border-color:var(--x-acc);color:var(--x-acc)}",

        // right rail
        ".x-rail{position:sticky;top:0;height:100vh;max-height:100vh;overflow-y:auto;overflow-x:hidden;padding:14px 0 32px;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin;box-sizing:border-box}",
        ".x-search{position:relative;display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border-radius:999px;background:var(--x-surf)!important;border:1px solid var(--x-line)!important;box-shadow:none!important;transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;width:100%}",
        ".x-search:focus-within{border-color:var(--x-acc)!important;background:var(--x-surf)!important;box-shadow:0 0 0 1px var(--x-acc)!important}",
        ".x-search svg.x-search-icon,.x-search svg{width:16px!important;height:16px!important;color:var(--x-mut)!important;flex-shrink:0!important;display:block!important}",
        ".x-search input,.x-search input[type='search'],.x-search input[type='text']{flex:1 1 auto!important;min-width:0!important;height:36px!important;line-height:36px!important;border:none!important;outline:none!important;background:transparent!important;background-color:transparent!important;box-shadow:none!important;-webkit-box-shadow:none!important;border-radius:0!important;color:var(--x-ink)!important;font-family:inherit!important;font-size:13.5px!important;padding:0!important;margin:0!important;-webkit-appearance:none!important;appearance:none!important}",
        ".x-search input::placeholder{color:var(--x-mut)!important;opacity:.85!important}",
        ".x-search-clear{display:none;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--x-surf2);border:none;color:var(--x-mut);cursor:pointer;padding:0;margin-left:4px;flex-shrink:0;transition:all .12s ease}",
        ".x-search-clear:hover{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-search-clear.on{display:inline-flex}",
        ".x-search-clear svg{width:12px!important;height:12px!important}",
        ".x-search-drop{position:absolute;top:calc(100% + 8px);left:0;right:0;z-index:100;background:var(--x-surf);border:1px solid var(--x-line);border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.18);overflow:hidden;max-height:480px;overflow-y:auto;scrollbar-width:thin;display:none;flex-direction:column;box-sizing:border-box}",
        ".x-search-drop.open{display:flex}",
        ".x-sdrop-sec{padding:4px 0;border-bottom:1px solid var(--x-line)}",
        ".x-sdrop-sec:last-child{border-bottom:none}",
        ".x-sdrop-lbl{padding:6px 14px 4px;font-size:11px;font-weight:800;color:var(--x-mut);text-transform:uppercase;letter-spacing:.6px}",
        ".x-sdrop-item{display:flex;align-items:center;gap:12px;padding:9px 14px;text-decoration:none;color:var(--x-ink);cursor:pointer;transition:background .12s ease;font-size:13.5px;user-select:none}",
        ".x-sdrop-item:hover,.x-sdrop-item.selected{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-sdrop-item svg{width:16px!important;height:16px!important;color:var(--x-mut);flex-shrink:0}",
        ".x-sdrop-item:hover svg,.x-sdrop-item.selected svg{color:var(--x-acc)}",
        ".x-sdrop-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}",
        ".x-sdrop-sub{font-size:11.5px;color:var(--x-mut);font-weight:500;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-sdrop-user{display:flex;align-items:center;gap:10px}",
        ".x-sdrop-badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--x-soft-blue);color:var(--x-acc);margin-left:auto;flex-shrink:0}",
        ".x-sdrop-foot{padding:8px 14px;font-size:11px;color:var(--x-mut);background:var(--x-surf2);display:flex;align-items:center;justify-content:space-between}",
        ".x-sdrop-foot a{color:var(--x-acc);font-weight:700;text-decoration:none}",
        ".x-sdrop-foot a:hover{text-decoration:underline}",
        ".x-sdrop-empty{padding:14px;text-align:center;color:var(--x-mut);font-size:12.5px}",
        ".x-card{background:var(--x-surf);border:1px solid var(--x-line);border-radius:14px;box-shadow:var(--x-shadow-1);padding:16px 18px;overflow:hidden}",
        ".x-card h3{margin:0 0 10px;padding:0;font-size:15px;font-weight:700;color:var(--x-ink);letter-spacing:-.01em}",
        ".x-card-note{margin:-4px 0 10px;padding:0;font-size:12px;color:var(--x-mut);line-height:1.4}",
        ".x-row{display:block;padding:8px 10px;margin:2px -6px;border-radius:8px;text-decoration:none;color:inherit;transition:background .12s}",
        ".x-row:hover{background:var(--x-soft-blue)}",
        ".x-row-top{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13.5px}",
        ".x-row-top b{font-weight:700;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}",
        ".x-row-top span{font-size:11.5px;color:var(--x-mut);white-space:nowrap;flex-shrink:0}",
        ".x-row-sub{display:block;margin-top:3px;font-size:11.5px;color:var(--x-mut);line-height:1.35}",
        ".x-row-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;font-weight:700;line-height:1.4;color:var(--x-ink);margin:4px 0 2px}",
        ".x-foot{margin:4px 6px 16px;padding:4px 6px 12px;font-size:11.5px;color:var(--x-mut);line-height:1.5}",

        // modal + menu + toast
        ".x-modal{position:fixed;inset:0;z-index:70;background:rgba(27,34,50,.6);display:flex;align-items:flex-start;",
        "justify-content:center;padding:50px 16px;overflow-y:auto}",
        ".x-dialog{width:min(580px,100%);background:var(--x-surf);border:1px solid var(--x-line);border-radius:14px;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,.15)}",
        ".x-dialog-head{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--x-line)}",
        ".x-dialog-head h2{margin:0;font-size:17px;font-weight:700;color:var(--x-ink)}",
        ".x-dialog-head .x-iconbtn{margin-left:auto}",
        ".x-dialog-body{padding:16px;display:flex;flex-direction:column;gap:10px}",
        ".x-label{font-size:12px;font-weight:700;color:var(--x-mut);margin-top:4px}",
        ".x-select,.x-input,.x-textarea{width:100%;padding:10px 12px;border:1px solid var(--x-line);border-radius:10px;",
        "background:var(--x-bg2);color:var(--x-ink);font:inherit;font-size:14px;outline:none;transition:border-color .12s}",
        ".x-select:focus,.x-input:focus,.x-textarea:focus{border-color:var(--x-acc)}",
        ".x-textarea{resize:vertical;min-height:150px;line-height:1.5}",
        ".x-dialog-foot{display:flex;align-items:center;gap:10px;margin-top:6px}",
        ".x-dialog-foot .x-send{margin-left:auto}",
        ".x-menu{position:fixed;z-index:80;right:calc(50% - 300px);margin-top:-10px;background:var(--x-surf);border:1px solid var(--x-line);",
        "border-radius:12px;padding:6px;min-width:180px;box-shadow:var(--x-shadow-2)}",
        ".x-menu-i{display:block;width:100%;text-align:left;padding:9px 12px;border:0;background:none;color:var(--x-body);",
        "font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border-radius:8px;text-decoration:none;transition:background .12s}",
        ".x-menu-i:hover{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:90;background:var(--x-acc);",
        "color:var(--x-acc-ink);padding:9px 20px;border-radius:999px;font-weight:700;font-size:13px;box-shadow:0 4px 16px rgba(77,151,254,.3)}",
        ".x-f-refresh-btn{display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding:6px 14px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);color:var(--x-ink);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .15s ease}",
        ".x-f-refresh-btn:hover{background:var(--x-soft-blue);border-color:var(--x-acc);color:var(--x-acc)}",
        ".x-f-refresh-btn svg{width:14px;height:14px;transition:transform .2s ease}",
        ".x-f-refresh-btn.spin svg{animation:xspin .7s linear infinite}",
        "@keyframes xspin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}",

        // search page UI
        ".x-search-page-box{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--x-line);background:var(--x-surf);position:sticky;top:54px;z-index:15}",
        ".x-search-page-box svg{width:18px;height:18px;color:var(--x-mut);flex-shrink:0}",
        ".x-search-page-input{flex:1;min-width:0;border:none;background:transparent;outline:none;font:inherit;font-size:15px;color:var(--x-ink);padding:6px 0}",
        ".x-search-empty-prompt{padding:40px 24px;text-align:center}",
        ".x-search-empty-prompt h3{margin:0 0 8px;font-size:18px;color:var(--x-ink)}",
        ".x-search-empty-prompt p{margin:0 0 20px;font-size:13.5px;color:var(--x-mut)}",
        ".x-search-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}",
        ".x-search-chip{padding:8px 16px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf2);color:var(--x-ink);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease}",
        ".x-search-chip:hover{background:var(--x-soft-blue);border-color:var(--x-acc);color:var(--x-acc)}",
        ".x-search-user-hero{display:flex;align-items:center;gap:16px;padding:16px 20px;border-bottom:1px solid var(--x-line);background:var(--x-surf2);transition:background .15s ease}",
        ".x-search-user-details{flex:1;min-width:0}",
        ".x-search-user-nrow{display:flex;align-items:center;gap:8px}",
        ".x-search-user-nrow strong{font-size:16px;color:var(--x-ink)}",
        ".x-search-user-handle{font-size:13px;color:var(--x-mut)}",
        ".x-search-user-bio{margin:4px 0 0;font-size:12.5px;color:var(--x-body);line-height:1.4}",

        // premium mobile bottom navigation & fab
        ".x-mobnav{display:none;position:fixed;left:0;right:0;bottom:0;z-index:1000;height:62px;padding:0 8px max(6px,env(safe-area-inset-bottom));background:rgba(255,255,255,.94);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border-top:1px solid var(--x-line);box-shadow:0 -4px 20px rgba(0,0,0,.06);align-items:center;justify-content:space-around;box-sizing:border-box}",
        "html.sd-x-dark .x-mobnav{background:rgba(18,20,24,.94);border-top-color:rgba(255,255,255,.08);box-shadow:0 -4px 24px rgba(0,0,0,.5)}",
        ".x-mob{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:5px 8px;border-radius:12px;color:var(--x-mut);text-decoration:none;transition:all .15s ease;flex:1;max-width:72px}",
        ".x-mob svg{width:22px;height:22px;transition:transform .15s ease}",
        ".x-mob-lbl{font-size:10px;font-weight:700;letter-spacing:-.1px}",
        ".x-mob.on{color:var(--x-acc)}",
        ".x-mob.on svg{transform:scale(1.12)}",
        ".x-mob:active{transform:scale(.92)}",
        ".x-mob-fab{position:fixed;bottom:76px;right:18px;width:52px;height:52px;border-radius:999px;background:linear-gradient(135deg,var(--x-acc) 0%,#2472E8 100%);color:#fff;border:none;box-shadow:0 8px 24px rgba(77,151,254,.45);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1001;transition:transform .15s ease,box-shadow .15s ease}",
        ".x-mob-fab svg{width:24px;height:24px}",
        ".x-mob-fab:active{transform:scale(.9)}",

        // responsive layout
        "@media (max-width:1279px){.x-app{grid-template-columns:250px minmax(0,640px);justify-content:center}.x-rail{display:none}}",
        "@media (max-width:899px){.x-app{grid-template-columns:70px minmax(0,1fr)}.x-nav{justify-content:center;padding:11px}",
        ".x-nav span{display:none}.x-logo b{display:none}.x-logo{justify-content:center;padding:10px 0 16px}",
        ".x-cta{font-size:0;padding:12px 0}.x-cta::after{content:'+';font-size:22px;line-height:1}",
        ".x-me-t,.x-themebtn span{display:none}.x-me{justify-content:center;padding:8px 0}.x-themebtn{margin:8px auto 0}}",
        "@media (max-width:639px){.x-app{grid-template-columns:minmax(0,1fr);padding:0 0 72px 0}.x-main{margin:0;border-radius:0;border:0;min-height:100vh}.x-side{display:none!important}.x-rail{display:none!important}.x-mobnav{display:flex!important}",
        ".x-top{position:sticky;top:0;z-index:90;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);background:rgba(255,255,255,.9)}",
        "html.sd-x-dark .x-top{background:rgba(0,0,0,.9)}",
        ".x-tweet-card{padding:14px 16px}",
        ".x-tweet-title{font-size:15px}",
        ".x-tweet-actions{gap:4px;justify-content:space-between}",
        ".x-tw-act{padding:4px 6px;font-size:12px}",
        ".x-feed-subnav{padding:10px 14px}",
        ".x-prof-navtabs{overflow-x:auto;padding-bottom:4px;scrollbar-width:none}",
        ".x-prof-navtabs::-webkit-scrollbar{display:none}}",

        // profile & ScratchStats dashboard
        ".x-app.sd-profile-view{grid-template-columns:250px minmax(0,1fr)!important;max-width:1440px!important}",
        ".x-app.sd-profile-view .x-rail{display:none!important}",
        ".x-app.sd-profile-view .x-main{max-width:none!important;width:100%!important;background:transparent;border:none;box-shadow:none}",
        ".x-prof-wrap{display:flex;gap:24px;padding:16px 20px;align-items:flex-start;width:100%;box-sizing:border-box}",
        "@media (max-width:1000px){.x-prof-wrap{flex-direction:column;padding:12px}}",
        ".x-prof-side{width:260px;flex:0 0 260px;display:flex;flex-direction:column;gap:16px}",
        "@media (max-width:1000px){.x-prof-side{width:100%;flex:1}}",
        ".x-prof-card{background:var(--x-surf);border:1px solid var(--x-line);border-radius:16px;padding:22px}",
        ".x-prof-av{width:96px;height:96px;border-radius:18px;overflow:hidden;margin-bottom:14px}",
        ".x-prof-av img{width:100%;height:100%;object-fit:cover;display:block}",
        ".x-prof-name{font-size:24px;font-weight:800;color:var(--x-ink);margin:0 0 4px;word-break:break-all}",
        ".x-prof-role{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;background:var(--x-soft-blue);color:var(--x-acc);margin-bottom:16px}",
        ".x-prof-meta{display:flex;flex-direction:column;gap:10px;padding-bottom:16px;border-bottom:1px solid var(--x-line);font-size:13px;color:var(--x-body)}",
        ".x-prof-meta-row{display:flex;align-items:center;gap:8px}",
        ".x-prof-meta-row svg{width:16px;height:16px;color:var(--x-mut);flex-shrink:0}",
        ".x-prof-sec{margin-top:16px;padding-top:16px;border-top:1px solid var(--x-line)}",
        ".x-prof-sec h4{margin:0 0 8px;font-size:11.5px;font-weight:800;color:var(--x-mut);text-transform:uppercase;letter-spacing:.6px}",
        ".x-prof-sec p{margin:0;font-size:13px;color:var(--x-body);line-height:1.5;word-break:break-word;white-space:pre-wrap}",
        ".x-prof-links{display:flex;flex-direction:column;gap:8px}",
        ".x-prof-link{font-size:13px;font-weight:700;color:var(--x-acc);text-decoration:none;transition:color .12s}",
        ".x-prof-link:hover{color:var(--x-acc-hover);text-decoration:underline}",
        ".x-prof-content{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px}",
        ".x-prof-navtabs{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap}",
        ".x-prof-tab{padding:8px 20px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);font:inherit;font-size:13.5px;font-weight:700;color:var(--x-body);cursor:pointer;transition:all .15s ease}",
        ".x-prof-tab:hover{background:var(--x-soft);color:var(--x-ink)}",
        ".x-prof-tab.on{background:var(--x-acc);border-color:var(--x-acc);color:#fff!important}",
        ".x-prof-stats-layout{display:flex;gap:20px;align-items:flex-start;width:100%}",
        ".x-prof-col-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:18px}",
        ".x-dash-sec{display:flex;flex-direction:column;gap:10px}",
        ".x-sec-title{font-size:11.5px;font-weight:800;color:var(--x-mut);text-transform:uppercase;letter-spacing:.8px}",
        ".x-stat-grid-2x2{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
        "@media (max-width:650px){.x-stat-grid-2x2{grid-template-columns:1fr}}",
        ".x-stat-box{background:var(--x-surf);border:1px solid var(--x-line);border-radius:14px;padding:18px 20px;position:relative;overflow:hidden;display:flex;flex-direction:column;gap:6px;min-width:0;box-sizing:border-box}",
        ".x-box-views .x-box-lbl svg{color:#855CD6}",
        ".x-box-loves .x-box-lbl svg{color:#FF6680}",
        ".x-box-favs .x-box-lbl svg{color:#FFAB19}",
        ".x-box-remixes .x-box-lbl svg{color:#59C059}",
        ".x-box-lbl{font-size:11.5px;font-weight:800;color:var(--x-mut);text-transform:uppercase;letter-spacing:.6px;display:flex;align-items:center;gap:6px}",
        ".x-box-lbl svg{width:15px;height:15px;color:var(--x-mut)}",
        ".x-box-num{font-size:28px;font-weight:800;color:var(--x-ink);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".x-box-text{font-size:20px!important;font-weight:800;color:var(--x-ink);white-space:normal!important;line-height:1.25}",
        ".x-box-mid{font-size:20px;font-weight:800;color:var(--x-ink);line-height:1.2;margin:2px 0}",
        ".x-box-sub{font-size:12px;color:var(--x-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".x-last-card{display:flex!important;flex-direction:row!important;align-items:center;justify-content:space-between;padding:18px 22px}",
        ".x-last-info{flex:1;min-width:0}",
        ".x-last-sub{font-size:13px;color:var(--x-mut);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-last-link{color:var(--x-acc);font-weight:700;text-decoration:none}",
        ".x-last-link:hover{text-decoration:underline}",
        ".x-last-thumb{width:80px;height:60px;border-radius:10px;object-fit:cover;border:1px solid var(--x-line);flex-shrink:0;margin-left:16px}",
        ".x-act-subgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
        ".x-act-tri{grid-template-columns:repeat(3,1fr)}",
        "@media (max-width:850px){.x-act-tri{grid-template-columns:1fr}}",
        ".x-user-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:10px}",
        ".x-user-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;border:1px solid var(--x-line);background:var(--x-surf);cursor:pointer;transition:all .12s}",
        ".x-user-card:hover{background:var(--x-soft);border-color:var(--x-acc)}",
        ".x-user-av{width:44px;height:44px;border-radius:10px;overflow:hidden;flex:0 0 44px}",
        ".x-user-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
        ".x-user-name{font-size:14px;font-weight:750;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-user-sub{font-size:12px;color:var(--x-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-user-btn{padding:6px 14px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf2);color:var(--x-ink);font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .12s;flex-shrink:0}",
        ".x-user-btn:hover{background:var(--x-acc);color:#fff!important;border-color:var(--x-acc)}",
        ".x-user-more{margin-top:16px;text-align:center;padding:12px}",
        ".x-forum-filter-bar{padding:12px 18px;border-bottom:1px solid var(--x-line);display:flex;flex-direction:column;gap:10px;background:var(--x-surf)}",
        ".x-forum-search-wrap{display:flex;align-items:center;gap:10px;background:var(--x-surf2);border:1px solid var(--x-line);border-radius:999px;padding:8px 14px;transition:border-color .15s}",
        ".x-forum-search-wrap:focus-within{border-color:var(--x-acc)}",
        ".x-forum-search-wrap svg{width:16px!important;height:16px!important;color:var(--x-mut);flex-shrink:0}",
        ".x-forum-search-input{border:none;background:transparent;outline:none;font:inherit;font-size:13.5px;color:var(--x-ink);width:100%}",
        ".x-forum-search-input::placeholder{color:var(--x-mut)}",
        ".x-forum-pills{display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}",
        ".x-forum-pills::-webkit-scrollbar{display:none}",
        ".x-f-pill{padding:5px 14px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);color:var(--x-body);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .12s;flex-shrink:0}",
        ".x-f-pill:hover{background:var(--x-soft);color:var(--x-ink)}",
        ".x-f-pill.on{background:var(--x-acc);border-color:var(--x-acc);color:#fff!important}",
        ".x-pill-tr{background:rgba(227,10,23,.14)!important;color:#E30A17!important;font-weight:800}",
        ".x-heat-sec{background:var(--x-surf);border:1px solid var(--x-line);border-radius:16px;padding:20px 22px}",
        ".x-heat-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}",
        ".x-year-sel{display:flex;align-items:center;gap:8px;background:var(--x-surf2);border:1px solid var(--x-line);padding:3px 10px;border-radius:999px}",
        ".x-ys-btn{display:flex;align-items:center;justify-content:center;background:none;border:0;cursor:pointer;color:var(--x-body);padding:2px}",
        ".x-ys-btn:hover{color:var(--x-acc)}",
        ".x-ys-btn svg{width:14px;height:14px}",
        ".x-ys-lbl{font-size:12.5px;font-weight:700;color:var(--x-ink)}",
        ".x-heat-sub{font-size:12px;color:var(--x-mut);margin-bottom:14px}",
        ".x-heat-body{overflow-x:auto;padding-bottom:4px;scrollbar-width:none;-ms-overflow-style:none}",
        ".x-heat-body::-webkit-scrollbar{display:none}",
        ".x-heat-months{display:flex;justify-content:space-between;padding-left:32px;font-size:11px;color:var(--x-mut);margin-bottom:8px;min-width:610px}",
        ".x-heat-grid-wrap{display:flex;gap:6px;min-width:610px}",
        ".x-heat-days{display:grid;grid-template-rows:repeat(7,10px);gap:3px;font-size:9.5px;color:var(--x-mut);line-height:10px;width:24px;text-align:right}",
        ".x-heat-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,10px);gap:3px}",
        ".x-heat-cell{width:10px;height:10px;border-radius:2.5px;transition:transform .1s}",
        ".x-heat-cell:hover{transform:scale(1.25)}",
        ".x-heat-sp{visibility:hidden}",
        ".x-hl-0{background:var(--x-line)}",
        ".x-hl-1{background:#BAE6FD}",
        ".x-hl-2{background:#60A5FA}",
        ".x-hl-3{background:#3B82F6}",
        ".x-hl-4{background:#1D4ED8}",
        "html.sd-x-dark .x-hl-0{background:#1E2636}",
        "html.sd-x-dark .x-hl-1{background:#0C4A6E}",
        "html.sd-x-dark .x-hl-2{background:#0284C7}",
        "html.sd-x-dark .x-hl-3{background:#38BDF8}",
        "html.sd-x-dark .x-hl-4{background:#7DD3FC}",
        ".x-heat-legend{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-top:12px;font-size:11px;color:var(--x-mut)}",
        ".x-tl-sec{background:var(--x-surf);border:1px solid var(--x-line);border-radius:16px;padding:20px 22px}",
        ".x-tl-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}",
        ".x-tl-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:12px;border:1px solid var(--x-line);text-decoration:none;color:inherit;transition:all .12s ease;background:var(--x-surf2)}",
        ".x-tl-row:hover{background:var(--x-soft);border-color:var(--x-acc);transform:translateY(-1px)}",
        ".x-tl-thumb{width:64px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid var(--x-line)}",
        ".x-tl-info{flex:1;min-width:0}",
        ".x-tl-title{display:block;font-size:14px;font-weight:700;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".x-tl-row:hover .x-tl-title{color:var(--x-acc)}",
        ".x-tl-date{font-size:11.5px;color:var(--x-mut);margin-top:3px}",
        ".x-tl-stats{display:flex;gap:8px}",
        ".x-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}",
        ".x-pcard{background:var(--x-surf);border:1px solid var(--x-line);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s}",
        ".x-pcard:hover{transform:translateY(-2px)}",
        ".x-pthumb{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}",
        ".x-pcard-body{padding:10px 12px}",
        ".x-pcard-title{display:block;font-size:13px;color:var(--x-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px}",
        ".x-pcard-meta{display:flex;gap:6px;font-size:11.5px;color:var(--x-mut)}",
        ".x-empty-box{padding:24px;text-align:center;font-size:13px;color:var(--x-mut)}",
        ".x-card-scroll{max-height:275px;overflow-y:auto;overflow-x:hidden;padding-right:4px;margin-right:-4px;scrollbar-width:thin;scrollbar-color:var(--x-line) transparent}",
        ".x-card-scroll::-webkit-scrollbar{width:4px}",
        ".x-card-scroll::-webkit-scrollbar-thumb{background:var(--x-line);border-radius:999px}",
        ".x-card-more{display:block;margin-top:10px;padding-top:8px;border-top:1px solid var(--x-line);font-size:13px;font-weight:700;color:var(--x-acc);text-decoration:none;transition:color .12s}",
        ".x-card-more:hover{text-decoration:underline}",
        ".x-langbtn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 10px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);color:var(--x-body);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .12s}",
        ".x-langbtn:hover{background:var(--x-soft-blue);color:var(--x-acc);border-color:var(--x-acc)}",
        ".x-feed-subnav{display:flex;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid var(--x-line);background:var(--x-bg);overflow-x:auto;scrollbar-width:none}",
        ".x-feed-subnav::-webkit-scrollbar{display:none}",
        ".x-f-subpill{padding:6px 14px;border-radius:999px;border:1px solid var(--x-line);background:var(--x-surf);color:var(--x-mut);font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:all .12s;white-space:nowrap}",
        ".x-f-subpill:hover{background:var(--x-soft-blue);color:var(--x-ink)}",
        ".x-f-subpill.on{background:var(--x-acc);color:#FFFFFF!important;border-color:var(--x-acc)}",
        ".x-feed-refresh-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:0;background:none;color:var(--x-mut);cursor:pointer;transition:all .15s}",
        ".x-feed-refresh-btn:hover{background:var(--x-soft-blue);color:var(--x-acc)}",
        ".x-feed-refresh-btn.spin svg{transform:rotate(360deg);transition:transform .6s ease}",
        ".x-format-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--x-line);border-radius:8px;background:var(--x-surf2);margin-bottom:8px;flex-wrap:wrap}",
        ".x-fbtn{padding:4px 8px;border-radius:5px;border:1px solid var(--x-line);background:var(--x-surf);color:var(--x-body);font:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:all .12s}",
        ".x-fbtn:hover{background:var(--x-soft-blue);color:var(--x-acc);border-color:var(--x-acc)}",
        "html.sd-x-dark .x-format-bar{background:#16181C!important;border-color:#2F3336!important}",
        "html.sd-x-dark .x-fbtn{background:#000000!important;border-color:#2F3336!important;color:#E7E9EA!important}",
        "html.sd-x-dark .x-fbtn:hover{background:rgba(29,155,240,.15)!important;color:#1D9BF0!important;border-color:#1D9BF0!important}",
        "html.sd-x-dark .x-langbtn{background:#000000!important;border-color:#2F3336!important;color:#E7E9EA!important}",
        "html.sd-x-dark .x-themebtn,html.sd-x-dark .x-site{background:#16181C!important;border-color:#2F3336!important;color:#E7E9EA!important}",
        "html.sd-x-dark .x-themebtn:hover,html.sd-x-dark .x-site:hover{background:rgba(29,155,240,.15)!important;color:#1D9BF0!important;border-color:#1D9BF0!important}",
        "html.sd-x-dark .x-f-subpill{background:#16181C!important;border-color:#2F3336!important;color:#71767B!important}",
        "html.sd-x-dark .x-f-subpill:hover{color:#E7E9EA!important;border-color:#71767B!important}",
        "html.sd-x-dark .x-f-subpill.on{background:#1D9BF0!important;border-color:#1D9BF0!important;color:#FFFFFF!important}",
        "html.sd-x-dark .x-rail-card,html.sd-x-dark .x-search-box{background:#16181C!important;border:1px solid #2F3336!important}",
        "html.sd-x-dark .x-search{background:#16181C!important;border-color:#2F3336!important}",
        "html.sd-x-dark .x-search input{background:transparent!important;color:#E7E9EA!important}",
        "html.sd-x-dark .x-search-drop{background:#000000!important;border-color:#2F3336!important;box-shadow:0 12px 32px rgba(0,0,0,.8)!important}",
        "html.sd-x-dark .x-sdrop-item:hover,html.sd-x-dark .x-sdrop-item.selected{background:rgba(255,255,255,.06)!important}",
        "html.sd-x-dark .x-sdrop-foot{background:#16181C!important;border-top:1px solid #2F3336!important}",
        "html.sd-x-dark .x-search-clear{background:#2F3336!important;color:#71767B!important}",
        "html.sd-x-dark .x-app,html.sd-x-dark .x-main{background:#000000!important}",
        "html.sd-x-dark .x-main{border-color:#2F3336!important}",
        "html.sd-x-dark .x-tweet-card{background:#000000;border-bottom:1px solid #2F3336!important}",
        "html.sd-x-dark .x-tweet-card:hover{background:rgba(255,255,255,.03)!important}",
        "html.sd-x-dark .x-stat-box,html.sd-x-dark .x-prof-card,html.sd-x-dark .x-heat-sec,html.sd-x-dark .x-tl-sec,html.sd-x-dark .x-user-card{background:#000000!important;border:1px solid #2F3336!important}",
        "html.sd-x-dark .x-tweet-media,html.sd-x-dark .x-block-stack{background:#16181C!important;border:1px solid #2F3336!important}",
        "html.sd-x-dark .x-nav.on{background:rgba(231,233,234,.1)!important;color:#E7E9EA!important}",
        "html.sd-x-dark .x-nav.on svg{stroke:#E7E9EA!important}",
        "html.sd-x-dark *{text-shadow:none!important;-webkit-text-stroke:0!important}",
        "html.sd-x-dark .x-b-comment{background:#16181C!important;border:1px solid #2F3336!important;color:#71767B!important}"
    ].join('');
    function injectStyle() {
        injectGoogleFonts();
        if (style.parentNode) return;
        var target = document.head || document.documentElement;
        if (target) target.appendChild(style);
    }
    try {
        injectStyle();
    } catch (e) {}

    function start() {
        injectStyle();
        try {
            chrome.storage.local.get('features', function (saved) {
                if (saved && saved.features && saved.features.forumskin === false) return;
                boot();
            });
        } catch (error) {
            // the extension was reloaded under an open tab; the skin still belongs to the page
            boot();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
