// Scratch's Explore stops after 16 projects and shows no numbers. This keeps the exact native
// card markup but feeds it from search/projects: 40 per request, five pages at once for the
// scored modes, cached, endless on scroll, with views, loves, favorites and remixes the API
// already sends. Trending and Rising use the Explore 2.0 engagement/age curves.
(function () {
    'use strict';

    if (!/^\/explore\/projects\/[^/]+\/?$/.test(location.pathname)) return;

    // labels for every language the selector offers; the API language and the number format
    // travel with them so a saved choice also changes which projects come back
    var LANGS = [
        {code: 'en', api: 'en', num: 'en-US', name: 'English', t: {trending: 'Trending', rising: 'Rising', popular: 'Popular', newest: 'Newest', views: 'Most viewed', searchIn: 'Search Explore', sortBy: 'Sort', end: 'End of feed.', fail: 'Explore could not load.', retry: 'Retry', viewsLabel: 'Views', loves: 'Loves', favorites: 'Favorites', remixes: 'Remixes', remix: 'Remix'}},
        {code: 'tr', api: 'tr', num: 'tr-TR', name: 'Türkçe', t: {trending: 'Trend', rising: 'Yükselen', popular: 'Popüler', newest: 'En yeni', views: 'En çok izlenen', searchIn: 'Keşfette ara', sortBy: 'Sırala', end: 'Akışın sonu.', fail: 'Keşfet yüklenemedi.', retry: 'Tekrar dene', viewsLabel: 'Görüntüleme', loves: 'Kalp', favorites: 'Favori', remixes: 'Remix', remix: 'Remiks'}},
        {code: 'de', api: 'de', num: 'de-DE', name: 'Deutsch', t: {trending: 'Angesagt', rising: 'Aufsteigend', popular: 'Beliebt', newest: 'Neueste', views: 'Meistgesehen', searchIn: 'Explore durchsuchen', sortBy: 'Sortieren', end: 'Ende des Feeds.', fail: 'Explore konnte nicht geladen werden.', retry: 'Erneut versuchen', viewsLabel: 'Aufrufe', loves: 'Likes', favorites: 'Favoriten', remixes: 'Remixe', remix: 'Remix'}},
        {code: 'fr', api: 'fr', num: 'fr-FR', name: 'Français', t: {trending: 'Tendances', rising: 'En hausse', popular: 'Populaires', newest: 'Plus récents', views: 'Les plus vus', searchIn: 'Rechercher dans Explore', sortBy: 'Trier', end: 'Fin du flux.', fail: 'Impossible de charger Explore.', retry: 'Réessayer', viewsLabel: 'Vues', loves: "J'aime", favorites: 'Favoris', remixes: 'Remix', remix: 'Remix'}},
        {code: 'es', api: 'es', num: 'es-ES', name: 'Español', t: {trending: 'Tendencias', rising: 'En ascenso', popular: 'Populares', newest: 'Más recientes', views: 'Más vistos', searchIn: 'Buscar en Explorar', sortBy: 'Ordenar', end: 'Fin del feed.', fail: 'No se pudo cargar Explorar.', retry: 'Reintentar', viewsLabel: 'Vistas', loves: 'Me gusta', favorites: 'Favoritos', remixes: 'Remixes', remix: 'Remix'}},
        {code: 'it', api: 'it', num: 'it-IT', name: 'Italiano', t: {trending: 'Di tendenza', rising: 'In crescita', popular: 'Popolari', newest: 'Più recenti', views: 'Più visti', searchIn: 'Cerca in Esplora', sortBy: 'Ordina', end: 'Fine del feed.', fail: 'Impossibile caricare Esplora.', retry: 'Riprova', viewsLabel: 'Visualizzazioni', loves: 'Mi piace', favorites: 'Preferiti', remixes: 'Remix', remix: 'Remix'}},
        {code: 'pt', api: 'pt', num: 'pt-BR', name: 'Português', t: {trending: 'Em alta', rising: 'Crescendo', popular: 'Populares', newest: 'Mais recentes', views: 'Mais vistos', searchIn: 'Pesquisar no Explorar', sortBy: 'Ordenar', end: 'Fim do feed.', fail: 'Não foi possível carregar o Explorar.', retry: 'Tentar novamente', viewsLabel: 'Visualizações', loves: 'Curtidas', favorites: 'Favoritos', remixes: 'Remixes', remix: 'Remix'}},
        {code: 'ru', api: 'ru', num: 'ru-RU', name: 'Русский', t: {trending: 'В тренде', rising: 'Растущие', popular: 'Популярные', newest: 'Новые', views: 'Самые просматриваемые', searchIn: 'Поиск', sortBy: 'Сортировка', end: 'Конец ленты.', fail: 'Не удалось загрузить.', retry: 'Повторить', viewsLabel: 'Просмотры', loves: 'Нравится', favorites: 'Избранное', remixes: 'Ремиксы', remix: 'Ремикс'}},
        {code: 'ja', api: 'ja', num: 'ja-JP', name: '日本語', t: {trending: 'トレンド', rising: '急上昇', popular: '人気', newest: '新着', views: '最多閲覧', searchIn: '作品を検索', sortBy: '並び替え', end: 'フィードの最後です。', fail: '読み込めませんでした。', retry: '再試行', viewsLabel: '閲覧数', loves: 'ハート', favorites: 'お気に入り', remixes: 'リミックス', remix: 'リミックス'}},
        {code: 'ko', api: 'ko', num: 'ko-KR', name: '한국어', t: {trending: '인기', rising: '급상승', popular: '인기순', newest: '최신', views: '조회수 순', searchIn: '작품 검색', sortBy: '정렬', end: '피드의 끝입니다.', fail: '작품을 불러오지 못했습니다.', retry: '다시 시도', viewsLabel: '조회수', loves: '좋아요', favorites: '즐겨찾기', remixes: '리믹스', remix: '리믹스'}},
        {code: 'zh', api: 'zh-cn', num: 'zh-CN', name: '中文', t: {trending: '热门', rising: '上升中', popular: '受欢迎', newest: '最新', views: '最多浏览', searchIn: '搜索作品', sortBy: '排序', end: '内容已到底。', fail: '无法加载作品。', retry: '重试', viewsLabel: '浏览', loves: '喜欢', favorites: '收藏', remixes: '改编', remix: '改编'}},
        {code: 'pl', api: 'pl', num: 'pl-PL', name: 'Polski', t: {trending: 'Na czasie', rising: 'Rosnące', popular: 'Popularne', newest: 'Najnowsze', views: 'Najczęściej oglądane', searchIn: 'Szukaj', sortBy: 'Sortuj', end: 'Koniec kanału.', fail: 'Nie udało się załadować.', retry: 'Spróbuj ponownie', viewsLabel: 'Wyświetlenia', loves: 'Polubienia', favorites: 'Ulubione', remixes: 'Remiksy', remix: 'Remiks'}}
    ];
    var T = null;
    var EMPTY = {en: 'No projects found.', tr: 'Proje bulunamadı.', de: 'Keine Projekte gefunden.', fr: 'Aucun projet trouvé.', es: 'No se encontraron proyectos.', it: 'Nessun progetto trovato.', pt: 'Nenhum projeto encontrado.', ru: 'Проекты не найдены.', ja: '作品が見つかりません。', ko: '작품을 찾지 못했습니다.', zh: '没有找到作品。', pl: 'Nie znaleziono projektów.'};
    var langData = null;
    var lang = 'en';
    var LABELS = null;

    function setLang(code) {
        langData = LANGS[0];
        for (var i = 0; i < LANGS.length; i++) {
            if (LANGS[i].code === code) langData = LANGS[i];
        }
        T = langData.t;
        lang = langData.api;
        LABELS = {views: T.viewsLabel, loves: T.loves, favorites: T.favorites, remixes: T.remixes};
        T.empty = EMPTY[langData.code] || EMPTY.en;
    }

    function pageLang() {
        var raw = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
        if (raw.indexOf('zh') === 0) return 'zh';
        var two = raw.slice(0, 2);
        for (var i = 0; i < LANGS.length; i++) {
            if (LANGS[i].code === two) return two;
        }
        return 'en';
    }

    setLang(pageLang());
    // the local scores are the Explore 2.0 formula: engagement divided by an age curve, so a
    // three-day-old project with 200 loves outranks an old one with 20k
    var SORTS = [
        {id: 'trending', mode: 'trending', score: 'trending'},
        {id: 'rising', mode: 'recent', score: 'rising'},
        {id: 'popular', mode: 'popular'},
        {id: 'newest', mode: 'recent'},
        {id: 'views', mode: 'popular', score: 'views'}
    ];
    var GLYPH = {
        views: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
        loves: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z',
        favorites: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
        remixes: 'M7 7h11v3l4-4-4-4v3H5v6h2V7zm10 10H6v-3l-4 4 4 4v-3h12v-6h-2v4z'
    };
    var LIMIT = 40;
    var POOL = 5;
    var TTL = 5 * 60 * 1000;
    var RANK = ['views', 'loves', 'favorites', 'remixes'];
    // a fresh seed per page load: the same pool is ranked with slightly different weights and
    // sampled from a different window, so a refresh shows a different but still good feed
    var seed = (Math.random() * 4294967296) >>> 0;

    function rand01(n) {
        var h = (seed ^ Math.imul(n | 0, 2654435761)) >>> 0;
        h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    function idRand(id) {
        return rand01(Number(id) || 0);
    }

    var enabled = true;
    var sort = SORTS[0];
    var category = '*';
    var term = '';
    var path = location.pathname;
    var bar = null;
    var box = null;
    var foot = null;
    var footText = null;
    var retry = null;
    var sentinel = null;
    var nativeRow = null;
    var seen = {};
    var offset = 0;
    var done = false;
    var loading = false;
    var gen = 0;
    var observer = null;

    function compact(n) {
        // the decimal separator follows the chosen language (1.2K / 1,2K)
        function dec(value) {
            return value.toLocaleString(langData.num, {maximumFractionDigits: 1});
        }
        if (n < 1000) return String(n);
        if (n < 1e6) return dec(Math.round(n / 100) / 10) + 'K';
        if (n < 1e9) return dec(Math.round(n / 1e5) / 10) + 'M';
        return dec(Math.round(n / 1e8) / 10) + 'B';
    }

    function slim(p) {
        var stats = p.stats || {};
        var author = p.author || {};
        return {
            id: p.id, title: p.title || '',
            user: author.username || '', uid: author.id || '',
            views: Number(stats.views) || 0, loves: Number(stats.loves) || 0,
            favorites: Number(stats.favorites) || 0, remixes: Number(stats.remixes) || 0,
            remix: !!(p.remix && p.remix.parent),
            shared: Date.parse((p.history && p.history.shared) || '') || 0,
            img: (p.images && (p.images['282x218'] || p.images['216x163'])) || ''
        };
    }

    // Explore 2.0's score curves: loves and favorites dominate, views only nudge, and the
    // denominator grows fast with age so the feed cannot be held by projects from years ago
    function scoreOf(project) {
        if (sort.score === 'views') return project.views;
        if (!project.shared) return 0;
        var days = Math.max(0, (Date.now() - project.shared) / 86400000);
        if (sort.score === 'rising') {
            return (project.loves + 0.6 * project.favorites) /
                Math.max(Math.pow(4, days - 2) + 6 * days - 0.25, 3);
        }
        return (project.loves + 0.4 * project.favorites + 0.003 * project.views) /
            Math.max(Math.pow(2, days - 7) + 0.85 * (days - 7) + 5.95, 1);
    }

    // score gaps are enormous (one hot project can outscore the rest by millions), so the seed
    // moves projects in rank space instead: anything within a dozen places may swap, which a
    // refresh visibly reshuffles without ever lowering the shelf the cards come from
    function seededOrder(list, window) {
        return list.map(function (project, index) {
            return {p: project, k: index + idRand(project.id) * window};
        }).sort(function (a, b) {
            return a.k - b.k;
        }).map(function (entry) { return entry.p; });
    }

    function byScore(a, b) {
        return scoreOf(b) - scoreOf(a) || Number(b.id) - Number(a.id);
    }

    function cacheGet(key) {
        try {
            var hit = JSON.parse(localStorage.getItem(key) || 'null');
            return hit && Date.now() - hit.t < TTL ? hit.v : null;
        } catch (error) {
            return null;
        }
    }

    function cacheSet(key, value) {
        try {
            // every search term writes five keys; left alone they fill the 5 MB quota and
            // then no cache works at all, so the oldest entries go first
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('sd-explore:') === 0) keys.push(k);
            }
            if (keys.length > 60) {
                var entries = keys.map(function (k) {
                    var t = 0;
                    try { t = (JSON.parse(localStorage.getItem(k)) || {}).t || 0; } catch (error) { t = 0; }
                    return {k: k, t: t};
                }).sort(function (a, b) { return a.t - b.t; });
                for (var j = 0; j < entries.length - 50; j++) localStorage.removeItem(entries[j].k);
            }
            localStorage.setItem(key, JSON.stringify({v: value, t: Date.now()}));
        } catch (error) { /* storage full: the feed still works, only the next visit is slower */ }
    }

    function searchUrl(offset) {
        return 'https://api.scratch.mit.edu/search/projects?q=' + encodeURIComponent(term || category) +
            '&mode=' + sort.mode + '&limit=' + LIMIT + '&offset=' + offset + '&language=' + lang;
    }

    function fetchPage(offset) {
        var key = 'sd-explore:' + sort.mode + ':' + (sort.score || 'api') + ':' +
            (term || category) + ':' + offset + ':' + lang;
        var cached = cacheGet(key);
        if (cached) return Promise.resolve(cached);
        return fetch(searchUrl(offset), {credentials: 'omit'})
            .then(function (response) { return response.json(); })
            .then(function (list) {
                if (!Array.isArray(list)) throw new Error('unexpected response');
                var slimList = list.map(slim);
                // the first five pages are cached: enough for an instant first screen in
                // the locally ranked modes, which read five pages at once
                if (offset <= (POOL - 1) * LIMIT) cacheSet(key, slimList);
                return slimList;
            });
    }

    function statIcon(name) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + GLYPH[name] + '"/></svg>';
    }

    function makeCard(project) {
        var card = document.createElement('div');
        card.className = 'thumbnail project sd-explore-card';
        var link = document.createElement('a');
        link.className = 'thumbnail-image';
        link.href = '/projects/' + project.id + '/';
        var img = document.createElement('img');
        var fallback = 'https://cdn2.scratch.mit.edu/get_image/project/' + project.id + '_282x218.png';
        img.src = project.img || fallback;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        // a dead thumbnail must not leave an empty card; the project endpoint still answers
        img.addEventListener('error', function () {
            if (img.src === fallback) return;
            img.src = fallback;
        });
        link.appendChild(img);
        if (project.remix) {
            var tag = document.createElement('span');
            tag.className = 'sd-remix';
            tag.textContent = T.remix;
            link.appendChild(tag);
        }
        card.appendChild(link);

        var info = document.createElement('div');
        info.className = 'thumbnail-info';
        var creator = document.createElement('a');
        creator.className = 'creator-image';
        creator.href = '/users/' + encodeURIComponent(project.user) + '/';
        if (project.uid) {
            creator.innerHTML = '<div class="avatar-wrapper"><img class="avatar" alt="" loading="lazy" ' +
                'src="https://cdn2.scratch.mit.edu/get_image/user/' + project.uid + '_32x32.png"></div>';
        }
        info.appendChild(creator);

        var titles = document.createElement('div');
        titles.className = 'thumbnail-title';
        var title = document.createElement('a');
        title.href = '/projects/' + project.id + '/';
        title.title = project.title;
        title.textContent = project.title;
        var owner = document.createElement('div');
        owner.className = 'thumbnail-creator';
        var ownerLink = document.createElement('a');
        ownerLink.href = '/users/' + encodeURIComponent(project.user) + '/';
        ownerLink.textContent = project.user;
        owner.appendChild(ownerLink);
        titles.appendChild(title);
        titles.appendChild(owner);
        info.appendChild(titles);
        card.appendChild(info);

        var meta = document.createElement('div');
        meta.className = 'sd-meta';
        RANK.forEach(function (name) {
            var item = document.createElement('span');
            item.className = 'sd-meta-item';
            var full = LABELS[name] + ': ' + project[name].toLocaleString(langData.num);
            item.title = full;
            item.setAttribute('aria-label', full);
            item.innerHTML = statIcon(name);
            item.appendChild(document.createTextNode(compact(project[name])));
            meta.appendChild(item);
        });
        card.appendChild(meta);
        return card;
    }

    // project id -> card element. Reused across a re-render, so a sort or language swap moves
    // the same nodes instead of rebuilding them: the thumbnails never blank out and repaint
    var nodeCache = {};

    function render(list, reset, fresh) {
        if (!box) return 0;
        if (reset) seen = {};
        var fragment = document.createDocumentFragment();
        var added = 0;
        list.forEach(function (project) {
            if (!project.id || seen[project.id]) return;
            seen[project.id] = true;
            added++;
            var card = nodeCache[project.id];
            if (!card) {
                card = makeCard(project);
                if (fresh) card.classList.add('sd-anim');
                nodeCache[project.id] = card;
            }
            fragment.appendChild(card);
        });
        // filling the fragment first detaches the reused nodes, so the grid is only ever empty
        // inside this block and the browser paints once, with everything already in place
        if (reset) box.innerHTML = '';
        box.appendChild(fragment);
        updateStatus();
        return added;
    }

    function renderEmpty() {
        if (!box) return;
        var note = document.createElement('div');
        note.className = 'sd-explore-empty';
        note.textContent = T.empty;
        box.innerHTML = '';
        box.appendChild(note);
        setBusy(false);
        if (foot) foot.hidden = true;
    }

    function updateStatus() {
        if (!foot) return;
        foot.hidden = !done;
        if (done && footText) footText.textContent = T.end;
        if (retry) retry.hidden = true;
    }

    function skeletons() {
        if (!box) return;
        box.innerHTML = '';
        for (var i = 0; i < 8; i++) {
            var card = document.createElement('div');
            card.className = 'sd-skel';
            box.appendChild(card);
        }
    }

    function fail() {
        loading = false;
        setBusy(false);
        if (box && !box.querySelector('.sd-explore-card')) box.innerHTML = '';
        if (foot) foot.hidden = false;
        if (footText) footText.textContent = T.fail;
        if (retry) retry.hidden = false;
    }

    function setBusy(on) {
        if (box) box.classList.toggle('sd-busy', !!on);
    }

    function order(list) {
        if (sort.score) list.sort(byScore);
        // a refresh shuffles the shelf; a text search must not, or the best hit moves
        if (!term) list = seededOrder(list, sort.score ? 14 : 10);
        return list;
    }

    function load() {
        if (!enabled) return;
        var my = ++gen;
        loading = true;
        done = false;
        offset = 0;
        // whatever is on screen stays there until the new feed arrives, dimmed a touch so the
        // wait reads as work instead of a broken page: no blank frame on a sort or search change
        var stale = !!(box && box.querySelector('.sd-explore-card'));
        if (stale) setBusy(true); else skeletons();
        if (foot) foot.hidden = true;
        if (retry) retry.hidden = true;
        // the scored modes rank a pool, so they read five pages at once instead of two
        var pages = sort.score ? POOL : 2;
        // half the loads start one page in: same quality window, different projects; a text
        // search keeps its own best hits
        var startPage = !term && sort.score && rand01(404) < 0.5 ? 1 : 0;
        var jobs = [];
        for (var i = 0; i < pages; i++) jobs.push(fetchPage((startPage + i) * LIMIT));
        Promise.all(jobs).then(function (chunks) {
            if (my !== gen) return;
            loading = false;
            setBusy(false);
            var local = {};
            var merged = [];
            var short = false;
            chunks.forEach(function (chunk) {
                if (chunk.length < LIMIT) short = true;
                chunk.forEach(function (project) {
                    if (local[project.id]) return;
                    local[project.id] = true;
                    merged.push(project);
                });
            });
            if (!merged.length) { done = true; renderEmpty(); return; }
            if (nativeRow) nativeRow.style.display = 'none';
            // measured: the five parallel pages come back together, so the feed is painted once
            render(order(merged), true, true);
            offset = (startPage + pages) * LIMIT;
            if (short) { done = true; updateStatus(); }
        }).catch(function () { if (my === gen) fail(); });
    }

    function loadMore() {
        if (!enabled || loading || done) return;
        var my = gen;
        loading = true;
        updateStatus();
        fetchPage(offset).then(function (list) {
            if (my !== gen) return;
            loading = false;
            if (!list.length) { done = true; updateStatus(); return; }
            var fresh = order(list.filter(function (project) { return !seen[project.id]; }));
            var added = render(fresh, false, true);
            offset += LIMIT;
            // an API that repeats a page instead of respecting offset would otherwise be
            // fetched forever without ever showing anything new
            if (added === 0 || list.length < LIMIT) { done = true; updateStatus(); }
        }).catch(function () {
            if (my === gen) { loading = false; fail(); }
        });
    }

    function currentCategory() {
        var parts = location.pathname.split('/');
        var slug = parts[3] || '';
        return slug && slug !== 'all' ? slug : '*';
    }

    function saveSort(id) {
        try { localStorage.setItem('sd-explore-sort', id); } catch (error) { /* private mode */ }
    }

    function reflectSort() {
        if (!bar) return;
        var select = bar.querySelector('.sd-explore-sort');
        if (select) select.value = sort.id;
    }

    function savedSort() {
        try {
            var id = localStorage.getItem('sd-explore-sort');
            for (var i = 0; i < SORTS.length; i++) {
                if (SORTS[i].id === id) return SORTS[i];
            }
        } catch (error) { /* private mode */ }
        return SORTS[0];
    }

    function buildBar(parent, before) {
        bar = document.createElement('div');
        bar.className = 'sd-explore-bar';

        var search = document.createElement('input');
        search.type = 'search';
        search.autocomplete = 'off';
        search.spellcheck = false;
        search.className = 'sd-explore-search';
        search.placeholder = T.searchIn;
        search.setAttribute('aria-label', T.searchIn);
        search.value = term;
        var timer = null;
        function setTerm(value) {
            var wasEmpty = !term;
            term = String(value || '').trim();
            // a text search over trending heads only finds minute-old uploads; popular is the
            // source that actually answers a query, so a fresh search starts there
            if (term && wasEmpty) sort = SORTS[2];
            else if (!term) sort = savedSort();
            search.value = term;
            reflectSort();
            load();
        }
        search.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () { setTerm(search.value); }, 220);
        });
        search.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { setTerm(''); return; }
            if (event.key === 'Enter') { clearTimeout(timer); setTerm(search.value); }
        });
        bar.appendChild(search);

        var sortBox = document.createElement('div');
        sortBox.className = 'sd-explore-sortbox';
        var sortLabel = document.createElement('span');
        sortLabel.className = 'sd-explore-sort-label';
        sortLabel.textContent = T.sortBy;
        sortBox.appendChild(sortLabel);
        var select = document.createElement('select');
        select.className = 'sd-explore-sort';
        select.setAttribute('aria-label', T.sortBy);
        SORTS.forEach(function (option) {
            var item = document.createElement('option');
            item.value = option.id;
            item.textContent = T[option.id];
            select.appendChild(item);
        });
        select.value = sort.id;
        select.addEventListener('change', function () {
            for (var i = 0; i < SORTS.length; i++) {
                if (SORTS[i].id === select.value) sort = SORTS[i];
            }
            saveSort(sort.id);
            load();
        });
        sortBox.appendChild(select);

        var right = document.createElement('div');
        right.className = 'sd-explore-right';
        right.appendChild(sortBox);

        var langSelect = document.createElement('select');
        langSelect.className = 'sd-explore-lang';
        langSelect.setAttribute('aria-label', 'Language');
        LANGS.forEach(function (entry) {
            var item = document.createElement('option');
            item.value = entry.code;
            item.textContent = entry.name;
            langSelect.appendChild(item);
        });
        langSelect.value = langData.code;
        langSelect.addEventListener('change', function () { applyLang(langSelect.value); });
        right.appendChild(langSelect);

        bar.appendChild(right);
        parent.insertBefore(bar, before && before.parentNode === parent ? before : parent.firstChild);
    }

    // the toolbar text lives in T; a language change rewrites it in place rather than
    // rebuilding the page, which is what used to cost the flash and the scroll jump
    function refreshChrome() {
        if (!bar) return;
        var search = bar.querySelector('.sd-explore-search');
        if (search) {
            search.placeholder = T.searchIn;
            search.setAttribute('aria-label', T.searchIn);
        }
        var label = bar.querySelector('.sd-explore-sort-label');
        if (label) label.textContent = T.sortBy;
        var options = bar.querySelectorAll('.sd-explore-sort option');
        for (var i = 0; i < options.length; i++) options[i].textContent = T[SORTS[i].id];
        var picker = bar.querySelector('.sd-explore-lang');
        if (picker) picker.value = langData.code;
        if (retry) retry.textContent = T.retry;
    }

    function applyLang(code) {
        if (code === langData.code) return;
        setLang(code);
        try { chrome.storage.local.set({sdLang: code}); } catch (error) { /* extension reloaded */ }
        if (!box) return; // nothing is built yet: start() will use the new labels
        // the counts and stat names are baked into the cards, so those nodes are dropped
        nodeCache = {};
        refreshChrome();
        load();
        var picker = bar && bar.querySelector('.sd-explore-lang');
        if (picker) picker.focus();
    }

    function buildGrid(grid) {
        box = document.createElement('div');
        box.className = 'sd-explore-grid';
        grid.appendChild(box);
        sentinel = document.createElement('div');
        sentinel.className = 'sd-explore-sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        grid.appendChild(sentinel);
        foot = document.createElement('div');
        foot.className = 'sd-explore-foot';
        foot.hidden = true;
        footText = document.createElement('span');
        foot.appendChild(footText);
        retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sd-explore-retry';
        retry.textContent = T.retry;
        retry.hidden = true;
        retry.addEventListener('click', function () {
            retry.hidden = true;
            load();
        });
        foot.appendChild(retry);
        grid.appendChild(foot);
        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver(function (entries) {
                if (entries[0].isIntersecting) loadMore();
            }, {rootMargin: '1400px 0px'});
            observer.observe(sentinel);
        }
    }

    function teardown() {
        gen++;
        if (observer) { observer.disconnect(); observer = null; }
        if (nativeRow) nativeRow.style.display = '';
        [bar, box, sentinel, foot].forEach(function (node) {
            if (node && node.parentNode) node.parentNode.removeChild(node);
        });
        bar = box = foot = footText = sentinel = nativeRow = retry = null;
        seen = {};
        nodeCache = {};
    }

    function tidyCats() {
        var row = document.querySelector('.sub-nav.categories');
        if (row) row.classList.add('sd-explore-cats');
    }

    function start() {
        var row = document.querySelector('.grid .flex-row');
        if (!row) return false;
        nativeRow = row;
        var grid = row.parentElement;
        if (!grid) return false;
        grid.parentElement.classList.add('sd-explore-wrap');
        tidyCats();
        var nextPath = location.pathname;
        if (nextPath !== path) term = '';
        path = nextPath;
        category = currentCategory();
        if (!term) sort = savedSort();
        var catBlock = document.querySelector('.sort-controls');
        buildBar(catBlock ? catBlock.parentElement : grid.parentElement, catBlock);
        buildGrid(grid);
        if (nativeRow) nativeRow.style.display = 'none';
        load();
        return true;
    }

    function setEnabled(on) {
        enabled = on;
        if (on) { if (!box) start(); } else teardown();
    }

    // the page is a single-page app: a category click swaps the grid without a reload
    setInterval(function () {
        if (!enabled) return;
        if (location.pathname !== path) { teardown(); start(); return; }
        if (!box) { start(); return; }
        if (!box || !bar || !document.contains(box) || !document.contains(bar)) { teardown(); start(); return; }
        tidyCats();
        var row = document.querySelector('.grid .flex-row');
        if (row) { nativeRow = row; row.style.display = 'none'; }
    }, 1200);

    // the grid can still be missing when this script lands, and waiting for the slow tick above
    // would leave the sixteen native cards on screen for up to a second before the swap
    var bootTries = 0;
    var bootTimer = setInterval(function () {
        if (!enabled || box || ++bootTries > 50) { clearInterval(bootTimer); return; }
        start();
    }, 60);

    var style = document.createElement('style');
    style.textContent =
        // one toolbar on the grid's own edges: search left, sort right. The categories below
        // are a quiet chip strip, not a third boxed bar
        '.sd-explore-bar{width:940px;max-width:calc(100vw - 24px);margin:0 auto;padding:10px 0 8px;' +
            'display:flex;align-items:center;justify-content:space-between;gap:16px;box-sizing:border-box}' +
        '.sd-explore-search{width:420px;max-width:100%;height:36px;border:1.5px solid #d9d9e3;' +
            'border-radius:999px;padding:0 16px 0 38px;font:inherit;font-size:13px;color:#575e75;' +
            'background:#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' ' +
            'viewBox=\'0 0 20 20\' fill=\'none\' stroke=\'%238a8a99\' stroke-width=\'1.8\' ' +
            'stroke-linecap=\'round\'%3E%3Ccircle cx=\'8.5\' cy=\'8.5\' r=\'5.4\'/%3E' +
            '%3Cpath d=\'M12.7 12.7L17 17\'/%3E%3C/svg%3E") 14px center/15px no-repeat;' +
            'box-sizing:border-box!important;text-align:left}' +
        '.sd-explore-search:focus{outline:0;border-color:#855cd6;box-shadow:0 0 0 3px rgba(133,92,214,.12)}' +
        '.sd-explore-sortbox{display:flex;align-items:center;gap:8px}' +
        '.sd-explore-sort-label{font-size:12px;color:#7d7d8c}' +
        '.sd-explore-sort{appearance:none;-webkit-appearance:none;height:36px;border:1.5px solid #d9d9e3;' +
            'border-radius:999px;background:#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' ' +
            'viewBox=\'0 0 10 6\' fill=\'none\' stroke=\'%238a8a99\' stroke-width=\'1.6\' ' +
            'stroke-linecap=\'round\'%3E%3Cpath d=\'M1 1l4 4 4-4\'/%3E%3C/svg%3E") ' +
            'right 15px center/10px 6px no-repeat;padding:0 34px 0 16px;font:inherit;font-size:13px;' +
            'font-weight:700;color:#575e75;cursor:pointer;box-sizing:border-box}' +
        '.sd-explore-sort:hover{border-color:#855cd6;color:#855cd6}' +
        '.sd-explore-sort:focus{outline:0;border-color:#855cd6;box-shadow:0 0 0 3px rgba(133,92,214,.12)}' +
        '.sd-explore-right{display:flex;align-items:center;gap:10px}' +
        '.sd-explore-lang{appearance:none;-webkit-appearance:none;height:36px;border:1.5px solid #d9d9e3;' +
            'border-radius:999px;background:#fff url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' ' +
            'viewBox=\'0 0 20 20\' fill=\'none\' stroke=\'%238a8a99\' stroke-width=\'1.5\'%3E' +
            '%3Ccircle cx=\'10\' cy=\'10\' r=\'7.3\'/%3E%3Cpath d=\'M2.7 10h14.6M10 2.7c2.4 2.6 2.4 12 0 14.6' +
            '-2.4-2.6-2.4-12 0-14.6z\'/%3E%3C/svg%3E") 13px center/15px no-repeat;' +
            'padding:0 14px 0 34px;font:inherit;font-size:13px;color:#575e75;cursor:pointer;' +
            'box-sizing:border-box;max-width:170px}' +
        '.sd-explore-lang:hover{border-color:#855cd6;color:#855cd6}' +
        '.sd-explore-lang:focus{outline:0;border-color:#855cd6;box-shadow:0 0 0 3px rgba(133,92,214,.12)}' +
        // Scratch's own category row is left-aligned with unequal pills; content-width chips
        // in a single strip keep the labels readable without stretching them thin
        '.sort-controls{width:940px!important;margin:0 auto!important;padding:0!important;display:block!important;' +
            'max-width:calc(100vw - 24px)!important;border:0!important}' +
        // the grid's wrapper carries 16px of its own top padding, which doubled the gap under
        // the category row; the bar sets that spacing itself
        '.sd-explore-wrap{padding-top:0!important;padding-bottom:0!important}' +
        '.sd-explore-cats{width:940px!important;max-width:calc(100vw - 24px)!important;' +
            'display:flex!important;justify-content:flex-start!important;' +
            'flex-wrap:wrap!important;gap:8px!important;margin:0 auto!important;padding:0!important;' +
            'height:auto!important;border:0!important;background:none!important}' +
        '.sd-explore-cats > a{width:auto!important;flex:0 0 auto!important;display:block!important;margin:0!important}' +
        '.sd-explore-cats > a > li{height:32px!important;box-sizing:border-box!important;' +
            'display:flex!important;align-items:center!important;justify-content:center!important;' +
            'margin:0!important;padding:0 16px!important;border:0!important;border-radius:999px!important;' +
            'background:#f2f2f7!important;color:#575e75!important;font-size:13px!important;' +
            'font-weight:700;box-shadow:none!important}' +
        '.sd-explore-cats > a:hover > li{background:#e8e8f0!important}' +
        '.sd-explore-cats > a > li.active{background:#855cd6!important;color:#fff!important}' +
        '.sd-explore-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px 14px;' +
            'width:940px;max-width:calc(100vw - 24px);margin:0 auto;padding:14px 0 4px;' +
            'box-sizing:border-box;transition:opacity .16s ease}' +
        // the feed that is already readable stays readable while the next one is fetched
        '.sd-explore-grid.sd-busy{opacity:.55}' +
        '.sd-explore-card.sd-anim{animation:sd-in .2s ease-out both}' +
        '@keyframes sd-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
        '.sd-explore-grid .sd-explore-card{width:auto;margin:0;display:flex;flex-direction:column;' +
            'box-sizing:border-box;padding-bottom:6px;height:auto!important}' +
        '.sd-explore-grid .thumbnail-image{position:relative;display:block}' +
        '.sd-explore-grid .thumbnail-image img{display:block;width:100%;height:auto;aspect-ratio:4/3;' +
            'object-fit:cover;background:#f2f2f5}' +
        '.sd-explore-grid .thumbnail-title{min-width:0}' +
        '.sd-explore-grid .thumbnail-title a{display:block;overflow:hidden;text-overflow:ellipsis;' +
            'white-space:nowrap}' +
        '.sd-meta{display:grid;grid-template-columns:repeat(4,1fr);align-items:center;' +
            'margin:6px 2px 0;font-size:11px;line-height:1.4;height:auto!important;min-height:14px;' +
            'color:#7d7d8c;white-space:nowrap;overflow:hidden}' +
        '.sd-meta-item{display:inline-flex;align-items:center;justify-content:center;gap:2px}' +
        '.sd-meta-item svg{width:11px;height:11px;fill:currentColor;opacity:.8}' +
        '.sd-explore-card .sd-remix{position:absolute;top:0;right:0;padding:3px 7px 4px;' +
            'background:#4d97ff;color:#fff;font-size:10px;font-weight:700;line-height:1;' +
            'border-radius:0 0 0 8px}' +
        '.sd-explore-foot{width:940px;max-width:calc(100vw - 24px);margin:6px auto 14px;display:flex;' +
            'align-items:center;justify-content:center;gap:10px;font-size:12px;color:#7d7d8c}' +
        '.sd-explore-foot[hidden]{display:none}' +
        // an empty query must not leave eight shimmering skeletons behind
        '.sd-explore-empty{grid-column:1/-1;padding:56px 0 40px;text-align:center;' +
            'font-size:13px;color:#7d7d8c}' +
        // Scratch's own pager sits inside our wrapper; the endless feed replaces it
        '.sd-explore-wrap > button.button{display:none!important}' +
        '.sd-explore-retry{border:1.5px solid #855cd6;background:#fff;color:#855cd6;border-radius:999px;' +
            'padding:3px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}' +
        '.sd-explore-sentinel{height:1px}' +
        '.sd-skel{border-radius:6px;height:210px;' +
            'background:linear-gradient(90deg,#f2f2f5 25%,#e9e9ef 37%,#f2f2f5 63%);' +
            'background-size:400% 100%;animation:sd-shimmer 1.2s ease-in-out infinite}' +
        '@keyframes sd-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}' +
        '@media (prefers-reduced-motion:reduce){.sd-skel,.sd-explore-card.sd-anim{animation:none}' +
            '.sd-explore-grid{transition:none}}' +
        // narrower screens: fewer columns, then a stacked toolbar, so nothing is cut off
        '@media (max-width:1080px){.sd-explore-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
        '@media (max-width:780px){' +
            '.sd-explore-grid{grid-template-columns:repeat(2,minmax(0,1fr))}' +
            '.sd-explore-bar{flex-wrap:wrap;gap:10px}' +
            '.sd-explore-search{flex:1 1 100%;width:100%}' +
            '.sd-explore-right{flex:1 1 100%;justify-content:space-between}}' +
        '@media (max-width:520px){.sd-explore-grid{grid-template-columns:minmax(0,1fr)}}';
    document.head.appendChild(style);

    try {
        chrome.storage.local.get(['features', 'sdLang'], function (saved) {
            if (saved && saved.sdLang) applyLang(saved.sdLang);
            setEnabled(!saved || !saved.features || saved.features.explore !== false);
        });
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes.sdLang && changes.sdLang.newValue) {
                applyLang(changes.sdLang.newValue);
            }
            if (area === 'local' && changes.features) {
                setEnabled(!changes.features.newValue || changes.features.newValue.explore !== false);
            }
        });
    } catch (error) {
        /* extension reloaded while the tab was open: keep the feed on */
    }
})();
