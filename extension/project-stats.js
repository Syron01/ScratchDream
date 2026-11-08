// The Shared Projects grid on a profile shows only a title and an owner. This adds the counts
// Scratch already publishes (views, loves, favorites, remixes, comments), lazy-loads the heavy
// comment totals for the cards near the viewport, caches all of it, and offers a few sort keys.
(function () {
    'use strict';

    // legacy profile pages ship no html lang, so the browser locale is the fallback
    var TR = /^tr\b/i.test(document.documentElement.lang || navigator.language || '');
    var T = TR ?
        {views: 'Görüntüleme', loves: 'Kalp', favorites: 'Favori', remixes: 'Remix', comments: 'Yorum'} :
        {views: 'Views', loves: 'Loves', favorites: 'Favorites', remixes: 'Remixes', comments: 'Comments'};
    var DAY = 24 * 60 * 60 * 1000;
    var STATS_MS = 10 * 60 * 1000;
    var GLYPH = {
        views: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
        loves: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z',
        favorites: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
        remixes: 'M7 7h11v3l4-4-4-4v3H5v6h2V7zm10 10H6v-3l-4 4 4 4v-3h12v-6h-2v4z',
        comments: 'M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z'
    };
    var ORDER = {views: 0, loves: 1, favorites: 2, remixes: 3, comments: 4};

    var projects = [];
    var groups = [];
    var grid = null;
    var spacers = [];
    var sort = null;
    var sortQueued = false;

    function cacheGet(key, ttl) {
        try {
            var hit = JSON.parse(localStorage.getItem(key) || 'null');
            return hit && Date.now() - hit.t < ttl ? hit.v : null;
        } catch (error) {
            return null;
        }
    }

    function cacheSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify({v: value, t: Date.now()}));
        } catch (error) { /* private mode: just fetch again next time */ }
    }

    function compact(n) {
        if (n < 1000) return String(n);
        if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
        if (n < 1e9) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    }

    function stat(name, value) {
        var item = document.createElement('span');
        item.className = 'sd-stat';
        item.dataset.stat = name;
        item.title = T[name] + ': ' + value.toLocaleString(TR ? 'tr-TR' : 'en-US');
        item.setAttribute('aria-label', item.title);
        item.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + GLYPH[name] + '"/></svg>';
        item.appendChild(document.createTextNode(compact(value)));
        return item;
    }

    // the numbers arrive in whatever order the server answers: keep views, loves, favorites,
    // remixes, comments in that order no matter which response lands first
    function addStat(project, name, value) {
        if (project.data[name] !== undefined) return;
        project.data[name] = value;
        var item = stat(name, value);
        var rank = ORDER[name];
        var after = Array.prototype.find.call(project.row.children, function (child) {
            return ORDER[child.dataset.stat] > rank;
        });
        project.row.insertBefore(item, after || null);
        queueSort();
    }

    // Scratch marks a remix with a corner tag on the project page and in search results, so a
    // remixed project is flagged the same way here instead of inventing a second visual language
    function markRemix(project) {
        var image = project.card.querySelector('a[href^="/projects/"] img');
        var thumb = image && image.parentElement;
        if (!thumb || thumb.querySelector('.sd-remix')) return;
        thumb.classList.add('sd-thumb');
        var tag = document.createElement('span');
        tag.className = 'sd-remix';
        tag.textContent = TR ? 'Remiks' : 'Remix';
        tag.title = TR ? 'Başka bir projeden remiks' : 'Remixed from another project';
        thumb.appendChild(tag);
    }

    function collect() {
        var cards = Array.prototype.slice.call(document.querySelectorAll('li.project.thumb.item'));
        if (!cards.length) return [];
        // the profile page holds several carousels, each with its own card list
        cards.forEach(function (card) {
            var container = card.parentElement;
            var group = groups.filter(function (list) { return list.container === container; })[0];
            if (!group) {
                group = {container: container, cards: []};
                groups.push(group);
            }
            group.cards.push(card);
        });
        groups.forEach(function (group) {
            group.spacers = Array.prototype.filter.call(group.container.children, function (child) {
                return !child.classList.contains('project');
            });
        });
        grid = groups[0].container;
        spacers = groups[0].spacers;
        return cards.map(function (card) {
            var link = card.querySelector('a[href^="/projects/"]');
            var id = link && (link.getAttribute('href').match(/\/projects\/(\d+)/) || [])[1];
            if (!id || card.querySelector('.sd-stats')) return null;
            var row = document.createElement('span');
            row.className = 'sd-stats';
            var anchor = card.querySelector('.owner') || card.querySelector('.title');
            anchor.insertAdjacentElement('afterend', row);
            return {id: id, card: card, row: row, data: {}};
        }).filter(Boolean);
    }

    // the carousels lock their viewport to the card height measured before our row existed,
    // so they are resized to fit the taller card instead of clipping the numbers
    function fitCarousels() {
        requestAnimationFrame(function () {
            groups.forEach(function (group) {
                var viewport = group.container.parentElement;
                var card = group.cards[0];
                if (!viewport || !card || !viewport.classList.contains('viewport')) return;
                var height = Math.ceil(card.getBoundingClientRect().height +
                    (parseFloat(getComputedStyle(card).marginBottom) || 0));
                viewport.style.height = height + 'px';
                var content = viewport.parentElement;
                if (content && content.classList.contains('box-content')) {
                    content.style.height = height + 10 + 'px';
                }
            });
        });
    }

    function applyStats(project, data) {
        ['views', 'loves', 'favorites', 'remixes'].forEach(function (name) {
            addStat(project, name, data[name] || 0);
        });
        if (data.remixParent) markRemix(project);
    }

    function projectStats(project) {
        var cached = cacheGet('sd-project-' + project.id, STATS_MS);
        if (cached) {
            applyStats(project, cached);
            return Promise.resolve();
        }
        return fetch('https://api.scratch.mit.edu/projects/' + project.id)
            .then(function (response) { return response.json(); })
            .then(function (data) {
                var stats = data.stats || {};
                var slim = {
                    views: Number(stats.views) || 0,
                    loves: Number(stats.loves) || 0,
                    favorites: Number(stats.favorites) || 0,
                    remixes: Number(stats.remixes) || 0,
                    remixParent: (data.remix && data.remix.parent) || null
                };
                cacheSet('sd-project-' + project.id, slim);
                applyStats(project, slim);
            })
            .catch(function () { /* offline: the card keeps whatever loaded */ });
    }

    function commentCount(project) {
        var cached = cacheGet('sd-comments-' + project.id, DAY);
        if (cached !== null) {
            addStat(project, 'comments', cached);
            return Promise.resolve();
        }
        return fetch('https://scratch.mit.edu/site-api/comments/project/' + project.id +
            '/?offset=0&limit=1', {credentials: 'include'})
            .then(function (response) { return response.text(); })
            .then(function (html) {
                // a page with commenting turned off still answers 200, just without the counter
                var hit = html.match(/data-control-comment-count="(\d+)"/);
                var count = hit ? Number(hit[1]) : 0;
                cacheSet('sd-comments-' + project.id, count);
                addStat(project, 'comments', count);
            })
            .catch(function () { /* a failed count leaves the other numbers in place */ });
    }

    // ---------------------------------------------------------------- requests
    var statsQueue = [];
    var statsActive = 0;
    function drainStats() {
        while (statsActive < 6 && statsQueue.length) {
            var next = statsQueue.shift();
            statsActive++;
            projectStats(next).then(function () { statsActive--; drainStats(); });
        }
    }

    var commentQueue = [];
    var commentActive = 0;
    function drainComments() {
        while (commentActive < 4 && commentQueue.length) {
            var next = commentQueue.shift();
            commentActive++;
            commentCount(next).then(function () { commentActive--; drainComments(); },
                function () { commentActive--; drainComments(); });
        }
    }
    function wantComments(project) {
        if (!project || project.commentsWanted) return;
        project.commentsWanted = true;
        commentQueue.push(project);
        drainComments();
    }

    // four projects at a time: each count response is a whole comment page, so a burst is rude
    function load() {
        statsQueue = projects.slice();
        projects.forEach(function (project) {
            if ('IntersectionObserver' in window) {
                observer.observe(project.card);
            } else {
                wantComments(project);
            }
        });
        drainStats();
    }

    var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            wantComments(entry.target.sdProject);
        });
    }, {rootMargin: '0px'}) : null;

    // ---------------------------------------------------------------- sorting
    function queueSort() {
        if (!sort || sortQueued) return;
        sortQueued = true;
        requestAnimationFrame(function () {
            sortQueued = false;
            applySort();
        });
    }

    function metric(project, key) {
        var data = project.data;
        if (key === 'popular') return (data.loves || 0) + (data.favorites || 0);
        if (key === 'views') return data.views || 0;
        if (key === 'first') return -Number(project.id);
        return Number(project.id);
    }

    function applySort() {
        if (!sort || !grid) return;
        var list = projects.slice().sort(function (a, b) {
            return metric(b, sort) - metric(a, sort) || Number(b.id) - Number(a.id);
        });
        // the legacy grid alternates zero-width spacer li elements between cards; rebuilding the
        // list with them keeps five cards on every row
        var fragment = document.createDocumentFragment();
        list.forEach(function (project, index) {
            if (spacers[index]) fragment.appendChild(spacers[index]);
            fragment.appendChild(project.card);
        });
        grid.appendChild(fragment);
    }

    function sortBar() {
        var head = document.querySelector('.box-head');
        if (!head || head.querySelector('.sd-sort')) return;
        var bar = document.createElement('div');
        bar.className = 'sd-sort';
        var label = document.createElement('span');
        label.className = 'sd-sort-label';
        label.textContent = TR ? 'Sırala:' : 'Sort:';
        bar.appendChild(label);
        [
            ['popular', TR ? 'Popüler' : 'Popular', TR ? 'Kalp + favori toplamı' : 'Loves plus favorites'],
            ['views', TR ? 'En çok izlenen' : 'Most viewed', ''],
            ['first', TR ? 'İlk proje' : 'First project', TR ? 'En eski proje' : 'Oldest project'],
            ['last', TR ? 'Son proje' : 'Last project', TR ? 'En yeni proje' : 'Newest project']
        ].forEach(function (option) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'sd-sort-btn';
            button.dataset.sort = option[0];
            button.textContent = option[1];
            if (option[2]) button.title = option[2];
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', function () {
                sort = option[0];
                Array.prototype.forEach.call(bar.querySelectorAll('.sd-sort-btn'), function (other) {
                    other.setAttribute('aria-pressed', String(other === button));
                });
                applySort();
            });
            bar.appendChild(button);
        });
        head.insertAdjacentElement('afterend', bar);
    }

    var style = document.createElement('style');
    style.textContent =
        // five counts need two rows inside a 146px card; three columns keep the rows aligned
        '.sd-stats{display:grid;grid-template-columns:repeat(3,auto);justify-content:start;' +
        'column-gap:6px;row-gap:1px;min-height:31px;margin-top:3px;color:#666;' +
        'font-size:11px;line-height:1.35;white-space:nowrap}' +
        '.sd-stat{display:inline-flex;align-items:center;gap:2px}' +
        '.sd-stat svg{width:11px;height:11px;fill:currentColor;opacity:.85}' +
        '.sd-thumb{position:relative;display:block}' +
        '.sd-remix{position:absolute;top:0;right:0;padding:3px 7px 4px;background:#4d97ff;' +
        'color:#fff;font-size:10px;font-weight:700;line-height:1;border-radius:0 0 0 8px}' +
        '.sd-sort{display:flex;flex-wrap:wrap;align-items:center;gap:2px 14px;padding:0 20px 8px;' +
        'font-size:12px;color:#666}' +
        '.sd-sort-btn{background:none;border:0;padding:0;font:inherit;color:#855cd6;' +
        'cursor:pointer;line-height:1.7}' +
        '.sd-sort-btn:hover{text-decoration:underline}' +
        '.sd-sort-btn[aria-pressed="true"]{color:#333;font-weight:700;text-decoration:none}';
    document.head.appendChild(style);

    projects = collect();
    projects.forEach(function (project) { project.card.sdProject = project; });
    if (projects.length) {
        fitCarousels();
        // sorting only makes sense on the full list: a carousel holds 20 of the 35 projects,
        // so "first project" there would answer a question nobody asked
        if (/^\/users\/[^/]+\/projects\/?$/.test(location.pathname)) sortBar();
        load();
    }
})();
