// Scratch's home puts two boxes over the featured projects: a personal activity list and three
// news teasers. Both stop changing within an hour and neither carries a single number. This hides
// them and puts two live panels in their place.
// Left: when the page knows who is looking, that person's own numbers — the hearts, views and
// remixes their projects gained since the last visit, a figure Scratch itself never shows. When
// nobody is signed in, the same slot fills with what the community is doing right now: the moves
// made in the ten studios whose pages were touched last, plus the ones Scratch features, shown as
// cards led by the project picture and grouped by how long ago they happened.
// Right: the forums in one column — the topics that moved today and how much each forum grew
// between two visits.
// Nothing here is ever "the newest five", which is the same five tomorrow. Both faces pick their
// rows out of a rank window with a per-visit seed, and the list can be turned over again without
// asking the network.
// Speed rules, because both halves read HTML or many small JSON files: public reads stay
// anonymous so the cache in front of Django answers instead of Django, nothing waits on one answer
// to know what to ask for next, each reply paints as it lands, and the last read is shown at once
// and refreshed behind it.
(function () {
    'use strict';

    if (location.pathname !== '/') return;

    var TR = /^tr\b/i.test(document.documentElement.lang || navigator.language || '');
    // English changes the noun after a count, Turkish does not, so every countable label carries
    // both forms and the Turkish table simply repeats the one form it has
    var L = TR ? {
        me: 'Hesabım', meAll: 'Profilim',
        meFirst: 'ilk okuma — değişimi görmek için geri gel',
        meNew: ['yeni proje', 'yeni proje'],
        meTop: 'en yeni 40 projen', meNote: 'son ziyaretinden bu yana',
        hearts: ['kalp', 'kalp'], viewsW: ['okunma', 'okunma'],
        remixW: ['remiks', 'remiks'],
        act: 'Topluluktan canlı', actAll: 'Tüm stüdyolar',
        actNote: 'okunan: {s} stüdyonun son {n} hareketi',
        added: 'ekledi', removed: 'çıkardı', joined: 'küratör oldu',
        moves: ['hareket', 'hareket'], another: 'Başka bir bak', newestIn: 'en yenisi',
        bNow: 'şimdi', bHour: 'son bir saat', bToday: 'bugün', bYest: 'dün', bWeek: 'bu hafta',
        studiosWord: ['stüdyo', 'stüdyo'], scrach: ['Scratcher', 'Scratcher'],
        forums: 'Forum nabzı', all: 'Tüm forumlar', refresh: 'Yenile',
        replies: ['yanıt', 'yanıt'], fresh: 'bugün hareketli', forumsWord: 'forum',
        messages: 'toplam mesaj', newPosts: 'yeni mesaj',
        change: 'son {t} içindeki değişim',
        loading: 'Okunuyor…', fail: 'Okunamadı.',
        retry: 'Tekrar dene', sticky: 'Sabit', empty: 'Şimdilik hareket yok.',
        topicWord: ['konu', 'konu'], postWord: ['mesaj', 'mesaj'], now: 'şimdi',
        m: 'dk', h: 'sa', d: 'g',
        bar: 'Çubuk: mesaj payı', ago: 'önce', by: 'yazan', read: 'Okunan forumlar'
    } : {
        me: 'My Scratch', meAll: 'My profile',
        meFirst: 'first read — come back to see the change',
        meNew: ['new project', 'new projects'],
        meTop: 'your 40 newest projects', meNote: 'since your last visit',
        hearts: ['heart', 'hearts'], viewsW: ['view', 'views'],
        remixW: ['remix', 'remixes'],
        act: 'Live from the community', actAll: 'All studios',
        actNote: 'read: the last {n} moves of {s} studios',
        added: 'added', removed: 'removed', joined: 'became a curator',
        moves: ['move', 'moves'], another: 'Another look', newestIn: 'newest',
        bNow: 'just now', bHour: 'the last hour', bToday: 'today', bYest: 'yesterday',
        bWeek: 'this week',
        studiosWord: ['studio', 'studios'], scrach: ['Scratcher', 'Scratchers'],
        forums: 'Forum pulse', all: 'All forums', refresh: 'Refresh',
        replies: ['reply', 'replies'], fresh: 'active today', forumsWord: 'forums',
        messages: 'posts total', newPosts: 'new posts',
        change: 'change over the last {t}',
        loading: 'Reading…', fail: 'Could not be read.',
        retry: 'Retry', sticky: 'Sticky', empty: 'No one is moving right now.',
        topicWord: ['topic', 'topics'], postWord: ['post', 'posts'], now: 'now',
        m: 'm', h: 'h', d: 'd',
        bar: 'Bar: share of posts', ago: 'ago', by: 'by', read: 'Forums read'
    };
    var NUM = TR ? 'tr-TR' : 'en-US';
    var TTL = 5 * 60 * 1000;          // inside this the last read is simply reused
    var KEEP = 24 * 60 * 60 * 1000;   // older than TTL but inside this still paints at once
    var PKEY = 'sd-pulse:v3';
    var AKEY = 'sd-act:v2';
    var MKEY = 'sd-me:v1';
    var SNAP = 'sd-mine:v1';
    var SHOW = 5;       // topic rows in the forum column
    var PER_CAT = 2;    // slots one forum may take, so the list is not one forum's megathreads
    var PER_STICKY = 1; // one sticky megathread is enough; the rest should be new discussion
    var FRESH = 16 * 36e5; // a topic counts as moving when it was answered inside this
    var BARS = 3;       // forum rows carrying the post-share bar
    var ACT = 4;        // stream rows
    var ROWS = 6;       // digest rows
    var PER_ACTOR = 2;  // one curator cannot fill the stream with their own batch
    var PER_STU = 2;    // nor can one studio take every slot
    var POOL = 40;      // events read per studio; 40 is the ceiling the API answers with
    var STU = 8;        // studios read per visit
    var WINDOW = 12;    // ranks a pick may move inside, so a visit shows a different list
    var WAIT = 15000;   // per-request ceiling

    // the four forums that open the most topics every day; baked so their pages are already in
    // flight while the index is still answering
    var HOT_FORUMS = [['8', 'Show and Tell'], ['7', 'Help with Scripts'],
        ['4', 'Questions about Scratch'], ['1', 'Suggestions']];

    // the studio log holds these; the ones with no project in them are a Scratcher joining a
    // studio, which is community activity of a different shape and gets a studio tile instead
    var KINDS = {addprojecttostudio: 'add', removeprojectstudio: 'out', becomecurator: 'join'};
    var ACT_FRESH = 3 * 864e5; // a move is offered while it is inside this

    var enabled = true;
    var forum = null;    // {at, cats:[], pool:[topics], delta:{at, byId:{}, sum:n}|null}
    var stream = null;   // {at, events:[], studios:n}
    var mine = null;     // {at, who, items:[], gain:{}, added:n, had:bool, since:ms}
    var who = '';        // the signed-in username, read from the nav
    var forumFail = false;
    var leftFail = false;
    var leftMode = '';   // 'me' | 'act', decided by the session
    var mounted = false;
    // every visit draws its own list out of the same recent moves: the newest five would
    // otherwise be the same page whatever the day, which reads as a broken panel
    var seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;

    function fmt(n) {
        return (n || 0).toLocaleString(NUM);
    }

    function noun(n, pair) {
        return pair[n === 1 ? 0 : 1];
    }

    function wn(n, pair) {
        return fmt(n) + ' ' + noun(n, pair);
    }

    // a row is narrow, so a big count loses its last digits instead of its line
    function short(n) {
        n = n || 0;
        if (n < 10000) return fmt(n);
        if (n < 1e6) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    }

    function ago(ms) {
        if (!ms) return '—';
        var s = (Date.now() - ms) / 1000;
        if (s < 90) return L.now;
        if (s < 3600) return Math.round(s / 60) + ' ' + L.m;
        if (s < 172800) return Math.round(s / 3600) + ' ' + L.h;
        return Math.round(s / 86400) + ' ' + L.d;
    }

    // "18 m ago" reads whole, "now ago" does not, so the suffix only comes with a number
    function agoAt(ms) {
        var t = ago(ms);
        return t === L.now ? t : t + ' ' + L.ago;
    }

    // the forum prints "Today 12:31:04", "Yesterday 15:53:08" and "Nov. 3, 2026 23:39:27";
    // the clock is always local, only the day part changes, so one Date covers all three
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function whenMs(text) {
        var t = (text || '').replace(/\s+/g, ' ').trim();
        var clock = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
        if (!clock) return null;
        var d = new Date();
        d.setHours(+clock[1], +clock[2], +(clock[3] || 0), 0);
        if (/^(today|bugün|heute)/i.test(t)) return d.getTime();
        if (/^(yesterday|dün|gestern)/i.test(t)) {
            d.setDate(d.getDate() - 1);
            return d.getTime();
        }
        var m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
        if (!m) return null;
        var name = m[1].slice(0, 3);
        var idx = MON.indexOf(name.charAt(0).toUpperCase() + name.slice(1).toLowerCase());
        if (idx < 0) return null;
        d.setFullYear(+m[3], idx, +m[2]);
        return d.getTime();
    }

    function count(cell) {
        return cell ? parseInt(cell.textContent.replace(/[^\d]/g, ''), 10) || 0 : 0;
    }

    function lastOf(row) {
        var link = row.querySelector('td.tcr a');
        var user = row.querySelector('td.tcr .byuser');
        return {
            ms: link ? whenMs(link.textContent) : null,
            // the label in front of the name is translated ("by", "yazan", "von"), the
            // username never contains a space, so the last word is the only safe read
            user: user ? user.textContent.trim().split(/\s+/).pop() : ''
        };
    }

    // public reads stay anonymous: a logged-in cookie forces Django to build every forum page
    // from scratch, while the same page without it is served from the cache in front of it
    function get(url, asJson) {
        var ac = new AbortController();
        var timer = setTimeout(function () { ac.abort(); }, WAIT);
        return fetch(url, {credentials: 'omit', signal: ac.signal}).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return asJson ? r.json() : r.text();
        }).then(function (v) {
            clearTimeout(timer);
            return v;
        }, function (error) {
            clearTimeout(timer);
            throw error;
        });
    }

    // the chrome around a forum table — nav, footer, scripts — is about half the page and carries
    // nothing, so only the tables between the first and the last are handed to the parser
    function parse(html) {
        var a = html.indexOf('<table');
        var b = html.lastIndexOf('</table>');
        if (a > 0 && b > a) html = html.slice(a, b + 8);
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function readCats(d) {
        var out = [];
        Array.prototype.forEach.call(d.querySelectorAll('td.tcl'), function (cell) {
            var link = cell.querySelector('h3 > a[href^="/discuss/"]');
            if (!link) return;
            var m = /^\/discuss\/(\d+)\/?$/.exec(link.getAttribute('href'));
            if (!m) return;
            var row = link.closest('tr');
            var last = lastOf(row);
            out.push({
                id: m[1], name: link.textContent.trim(),
                topics: count(row.querySelector('td.tc2')),
                posts: count(row.querySelector('td.tc3')),
                ms: last.ms
            });
        });
        return out;
    }

    function readTopics(d, cat) {
        var out = [];
        Array.prototype.forEach.call(d.querySelectorAll('td.tcl'), function (cell) {
            var link = cell.querySelector('h3 > a[href^="/discuss/topic/"]');
            if (!link) return;
            var row = link.closest('tr');
            var last = lastOf(row);
            out.push({
                id: /\/discuss\/topic\/(\d+)/.exec(link.getAttribute('href'))[1],
                title: link.textContent.trim(),
                replies: count(row.querySelector('td.tc2')),
                views: count(row.querySelector('td.tc3')),
                ms: last.ms, user: last.user,
                sticky: !!cell.querySelector('.isticky'),
                catId: cat[0], catName: cat[1]
            });
        });
        return out;
    }

    // reply mass against an age curve: a thread answered two hours ago outranks a
    // hundred-thousand-reply megathread that went quiet last month
    function heat(t) {
        if (!t.ms) return 0;
        var hours = Math.max(0, (Date.now() - t.ms) / 36e5);
        return (Math.log10(t.replies + 1) + Math.log10(t.views + 1) * .35) / Math.pow(2, hours / 6);
    }

    // ranked when the panel is drawn rather than when the pages were read, so a list cached an
    // hour ago still sorts as if it had been read now. Sticky megathreads would otherwise own
    // every slot, so they are capped and the list keeps room for discussion that is actually new
    function pickTopics(list) {
        var now = Date.now();
        var ranked = list.filter(function (t) {
            return t.ms && now - t.ms < FRESH;
        }).sort(function (a, b) {
            return heat(b) - heat(a);
        });
        var per = {};
        var sticky = 0;
        var out = [];
        function take(t) {
            out.push(t);
            per[t.catId] = (per[t.catId] || 0) + 1;
            if (t.sticky) sticky++;
        }
        ranked.forEach(function (t) {
            if (out.length >= SHOW) return;
            if (per[t.catId] >= PER_CAT) return;
            if (t.sticky && sticky >= PER_STICKY) return;
            take(t);
        });
        // a quiet night is still shown rather than left empty: first the same caps without the
        // freshness window, then simply the most recently answered topics
        if (out.length < SHOW) {
            list.filter(function (t) {
                return t.ms && !t.sticky && per[t.catId] < PER_CAT;
            }).sort(function (a, b) {
                return heat(b) - heat(a);
            }).forEach(function (t) {
                if (out.length < SHOW && out.indexOf(t) < 0) take(t);
            });
        }
        if (out.length < SHOW) {
            list.filter(function (t) {
                return t.ms;
            }).sort(function (a, b) {
                return b.ms - a.ms;
            }).forEach(function (t) {
                if (out.length < SHOW && out.indexOf(t) < 0) take(t);
            });
        }
        return out;
    }

    function hue(id) {
        var n = parseInt(id, 10) || 0;
        return (n * 47 + 262) % 360;
    }

    function store(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) { /* private mode keeps the panels uncached */ }
    }
    function recall(key) {
        try {
            var hit = JSON.parse(localStorage.getItem(key) || 'null');
            return hit && hit.at && Date.now() - hit.at < KEEP ? hit : null;
        } catch (error) {
            return null;
        }
    }

    function loadForums(force) {
        if (!force) {
            var cached = recall(PKEY);
            if (cached) {
                forum = {at: cached.at, cats: cached.cats || [], pool: cached.pool || [],
                    delta: cached.delta || null};
                paint();
                if (Date.now() - cached.at < TTL) return;
            }
        }
        if (!forum) {
            forum = {at: Date.now(), cats: [], pool: [], delta: null};
            paint();
        }
        forumFail = false;
        // the window a later delta is measured from has to be captured now: the topic pages
        // arrive in parallel and each one stamps the read time forward
        var prevAt = forum.at;

        get('/discuss/').then(function (text) {
            var cats = readCats(parse(text));
            if (!cats.length) throw new Error('no categories');
            // the totals read a moment ago are the baseline the next visit is measured against
            if (forum.cats.length) {
                var byId = {};
                var sum = 0;
                forum.cats.forEach(function (old) { byId[old.id] = old.posts; });
                cats.forEach(function (c) {
                    if (byId[c.id] === undefined) return;
                    var d = Math.max(0, c.posts - byId[c.id]);
                    byId[c.id] = d;
                    sum += d;
                });
                forum.delta = {at: prevAt, byId: byId, sum: sum};
            }
            forum.cats = cats;
            forum.at = Date.now();
            save();
            paint();
        }).catch(function () {
            forumFail = !forum.cats.length;
            paint();
        });

        HOT_FORUMS.forEach(function (cat) {
            get('/discuss/' + cat[0] + '/').then(function (text) {
                var seen = {};
                forum.pool.forEach(function (t) { seen[t.id] = 1; });
                readTopics(parse(text), cat).forEach(function (t) {
                    if (!seen[t.id]) forum.pool.push(t);
                });
                // the pool is what the next visit ranks, so it keeps the freshest rows only
                forum.pool.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
                if (forum.pool.length > 80) forum.pool.length = 80;
                forum.at = Date.now();
                save();
                paint();
            }).catch(function () { /* a forum that does not answer simply is not read */ });
        });
    }

    function save() {
        store(PKEY, {at: forum.at, cats: forum.cats, pool: forum.pool, delta: forum.delta});
    }

    // the nav account menu is the only honest answer to "who is looking": it is drawn from the
    // session. A /users/ link anywhere else on the page belongs to some featured author.
    function readWho() {
        var links = document.querySelectorAll('#account-nav a[href^="/users/"], ' +
            'a.header-dropdown-toggle[href^="/users/"], #topnav .avatar a[href^="/users/"], ' +
            '#topnav a[href^="/users/"]');
        for (var i = 0; i < links.length; i++) {
            var m = /^\/users\/([^/?#]+)\/?$/.exec(links[i].getAttribute('href'));
            if (m && !/^(projects|studios|search|explore|about|info|help|terms|privacy|parents|teachers|ideas|credits|download|login|join|messages)$/i.test(m[1])) {
                return m[1];
            }
        }
        return '';
    }

    // /session/ answers the same question before React has drawn anything, in a few hundred
    // bytes, and is the only request here that is sent with the session cookie
    function whoAmI() {
        return fetch('/session/', {credentials: 'include'}).then(function (r) {
            return r.ok ? r.json() : null;
        }).then(function (j) {
            return (j && j.user && j.user.username) || readWho();
        }).catch(readWho);
    }

    // the left half has two faces: the visitor's own numbers when the session says who they are,
    // the community stream when it does not
    function startLeft(force) {
        return whoAmI().then(function (name) {
            who = name || '';
            leftMode = who ? 'me' : 'act';
            paint();
            if (who) loadMine(force); else loadStream(force);
        });
    }

    function norm(p) {
        var stats = p.stats || {};
        return {
            id: p.id, title: p.title || '',
            views: Number(stats.views) || 0, loves: Number(stats.loves) || 0,
            favorites: Number(stats.favorites) || 0, remixes: Number(stats.remixes) || 0,
            shared: Date.parse((p.history && p.history.shared) || '') || 0,
            img: (p.images && (p.images['100x80'] || p.images['282x218'])) || ''
        };
    }

    // Scratch shows a project's totals and nothing else. The difference between two visits is the
    // number an author actually wants, and only remembering the last one can produce it.
    function loadMine(force) {
        if (!force) {
            var cached = recall(MKEY);
            if (cached && cached.who === who) {
                mine = cached;
                paint();
                if (Date.now() - cached.at < TTL) return;
            }
        }
        leftFail = false;
        get('https://api.scratch.mit.edu/users/' + encodeURIComponent(who) +
            '/projects?limit=40&offset=0', true).then(function (list) {
            if (!Array.isArray(list)) throw new Error('unexpected response');
            var items = list.filter(function (p) {
                return p.is_published;
            }).map(norm);
            var last = recall(SNAP);
            var gain = {l: 0, v: 0, r: 0};
            var added = 0;
            items.forEach(function (p) {
                var old = last && last.byId ? last.byId[p.id] : null;
                if (!old) {
                    added++;
                    return;
                }
                p.up = {
                    l: Math.max(0, p.loves - old.l),
                    v: Math.max(0, p.views - old.v),
                    r: Math.max(0, p.remixes - old.r)
                };
                gain.l += p.up.l;
                gain.v += p.up.v;
                gain.r += p.up.r;
            });
            var by = {};
            items.forEach(function (p) {
                by[p.id] = {l: p.loves, v: p.views, f: p.favorites, r: p.remixes};
            });
            items.sort(function (a, b) {
                if (a.up && b.up) return b.up.l - a.up.l || b.up.v - a.up.v || b.loves - a.loves;
                if (a.up) return -1;
                if (b.up) return 1;
                return b.loves - a.loves || b.views - a.views;
            });
            mine = {at: Date.now(), who: who, items: items, gain: gain, added: added,
                had: !!(last && last.byId), since: last ? last.at : 0};
            store(SNAP, {at: Date.now(), who: who, byId: by});
            store(MKEY, mine);
            paint();
        }).catch(function () {
            // a name the site does not answer for is not the visitor: show the public stream
            if (!mine) {
                leftMode = 'act';
                loadStream(true);
            } else {
                leftFail = true;
            }
            paint();
        });
    }

    // Scratch's home asks this one URL for everything below its boxes, so it is already warm.
    // Its six studios, though, are a weekly list: read alone they give the same moves every
    // visit. explore/studios answers anonymously with thirty studios and tells when each page was
    // last touched, so the most recently touched ones are a pool that actually moves.
    function studioPool() {
        return Promise.all([
            get('https://api.scratch.mit.edu/proxy/featured?language=' + (TR ? 'tr' : 'en'), true)
                .catch(function () { return null; }),
            get('https://api.scratch.mit.edu/explore/studios?limit=40', true)
                .catch(function () { return null; })
        ]).then(function (pair) {
            var out = [];
            var seen = {};
            function add(id, title) {
                id = String(id || '');
                if (!id || seen[id]) return;
                seen[id] = 1;
                out.push({id: id, title: (title || '').trim() || ('#' + id)});
            }
            var feat = pair[0] || {};
            (feat.community_featured_studios || []).forEach(function (g) {
                add(g && g.id, g && g.title);
            });
            var sds = feat.scratch_design_studio || [];
            if (sds.length) add(sds[0].gallery_id, sds[0].gallery_title);
            (Array.isArray(pair[1]) ? pair[1] : []).map(function (g) {
                return {g: g, ms: Date.parse((g.history || {}).modified || '') || 0};
            }).sort(function (a, b) {
                return b.ms - a.ms;
            }).slice(0, Math.max(0, STU - out.length)).forEach(function (row) {
                add(row.g.id, row.g.title);
            });
            if (!out.length) throw new Error('no studios');
            return out;
        });
    }

    function loadStream(force) {
        if (!force) {
            var cached = recall(AKEY);
            if (cached) {
                stream = cached;
                paint();
                if (Date.now() - cached.at < TTL) return;
            }
        }
        leftFail = false;
        studioPool().then(function (pool) {
            if (!stream) stream = {at: Date.now(), events: [], studios: 0, names: {}};
            pool.forEach(function (g) { stream.names[g.id] = g.title; });
            stream.studios = pool.length;
            paint();
            pool.forEach(function (g) {
                get('https://api.scratch.mit.edu/studios/' + g.id + '/activity?limit=' + POOL +
                    '&offset=0', true).then(function (list) {
                    var seen = {};
                    stream.events.forEach(function (e) { seen[e.id] = 1; });
                    (Array.isArray(list) ? list : []).forEach(function (e) {
                        var kind = e && KINDS[e.type];
                        if (!kind || !e.id || seen[e.id]) return;
                        var ms = Date.parse(e.datetime_created) || 0;
                        if (!ms) return;
                        seen[e.id] = 1;
                        stream.events.push({
                            id: e.id, studio: g.id, actor: e.actor_username || '',
                            uid: e.actor_id || '', kind: kind, ms: ms,
                            project: kind === 'join' ? 0 : (e.project_id || 0),
                            title: (e.project_title || stream.names[g.id] || '').trim(),
                            img: kind === 'join' ?
                                'https://cdn2.scratch.mit.edu/get_image/gallery/' + g.id + '_100x80.png' :
                                'https://cdn2.scratch.mit.edu/get_image/project/' + e.project_id + '_100x80.png'
                        });
                    });
                    stream.events.sort(byTime);
                    if (stream.events.length > 400) stream.events.length = 400;
                    stream.at = Date.now();
                    paint();
                    store(AKEY, stream);
                }).catch(function () { /* a silent studio simply is not read */ });
            });
        }).catch(function () {
            leftFail = !stream && !mine;
            paint();
        });
    }

    function byTime(a, b) {
        return b.ms - a.ms || b.id - a.id;
    }

    // a deterministic shuffle: the same seed always gives the same list, so a repaint while the
    // studios are still answering cannot visibly reshuffle what is already on screen
    function rng(s) {
        var x = s >>> 0;
        return function () {
            x = (x + 0x6D2B79F5) >>> 0;
            var t = Math.imul(x ^ (x >>> 15), 1 | x);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // swapping inside windows of WINDOW ranks lets a tenth-place move rise and the newest one
    // wait for the next visit, so the list changes while every row stays genuinely recent
    function rotate(list, s) {
        var r = rng(s);
        var out = list.slice();
        for (var i = 0; i < out.length - 1; i++) {
            var j = i + Math.floor(r() * Math.min(WINDOW, out.length - i));
            var t = out[i];
            out[i] = out[j];
            out[j] = t;
        }
        return out;
    }

    // the same project in two studios is one move, not two — that pair test is what used to leak
    // through the backfill and print the identical row twice, so every pass now runs through it
    function pickEvents(list) {
        var now = Date.now();
        var ranked = list.slice().sort(byTime).filter(function (e) {
            return now - e.ms < ACT_FRESH;
        }).slice(0, 60);
        var order = rotate(ranked, seed);
        var per = {};
        var perStu = {};
        var pair = {};
        var out = [];
        function key(e) {
            return e.actor + ':' + (e.project || ('s' + e.studio));
        }
        function fits(e, actorCap, studioCap) {
            return out.indexOf(e) < 0 && !pair[key(e)] &&
                (per[e.actor] || 0) < actorCap && (perStu[e.studio] || 0) < studioCap;
        }
        function take(e) {
            out.push(e);
            per[e.actor] = (per[e.actor] || 0) + 1;
            perStu[e.studio] = (perStu[e.studio] || 0) + 1;
            pair[key(e)] = 1;
        }
        order.forEach(function (e) {
            if (out.length < ACT && fits(e, PER_ACTOR, PER_STU)) take(e);
        });
        // a batch week from one curator is still worth showing rather than an empty panel
        if (out.length < ACT) {
            order.forEach(function (e) {
                if (out.length < ACT && fits(e, 9, 9)) take(e);
            });
        }
        if (out.length < ACT) {
            list.slice().sort(byTime).forEach(function (e) {
                if (out.length < ACT && fits(e, 9, 9)) take(e);
            });
        }
        // the seed decides which moves get a slot, not what order they are read in: an unordered
        // list makes the day markers below the rows jump back and forth and repeat
        out.sort(byTime);
        return out;
    }

    var raf = 0;
    function paint() {
        if (raf) return;
        raf = requestAnimationFrame(function () {
            raf = 0;
            draw();
        });
    }

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function head(titleCls, linkCls, linkHref) {
        var box = el('div', 'box-header');
        var h = el('h4', titleCls);
        box.appendChild(h);
        var p = el('p');
        var b = el('button', 'sd-plink', L.refresh);
        b.type = 'button';
        b.addEventListener('click', reload);
        p.appendChild(b);
        p.appendChild(document.createTextNode(' · '));
        var a = el('a', linkCls, '');
        a.href = linkHref;
        p.appendChild(a);
        box.appendChild(p);
        return box;
    }

    function reload() {
        forumFail = false;
        loadForums(true);
        startLeft(true);
    }

    function note(box, text, failed) {
        box.innerHTML = '';
        var p = el('p', 'sd-pnote' + (failed ? ' sd-pfail' : ''), text);
        if (failed) {
            var b = el('button', 'sd-plink', L.retry);
            b.type = 'button';
            b.addEventListener('click', reload);
            p.appendChild(b);
        }
        box.appendChild(p);
    }

    // a project can be deleted between the studio log and this paint, and then the CDN answers
    // with a placeholder the row cannot size; a letter tile in the studio colour keeps the box
    // exactly as big as the image it replaced
    function pic(cls, src, letter, h) {
        var img = el('img', cls);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.addEventListener('error', function () {
            var tile = el('span', cls + ' sd-tile', (letter || '?').trim().charAt(0).toUpperCase());
            tile.style.background = 'hsl(' + h + ' 62% 93%)';
            tile.style.color = 'hsl(' + h + ' 40% 34%)';
            if (img.parentNode) img.parentNode.replaceChild(tile, img);
        });
        img.src = src;
        return img;
    }

    // the reads behind this are minutes old at best and the CDN holds them for an hour, so the
    // honest answer to "show me something else" is a different list out of what is already here
    function lookBtn() {
        var b = el('button', 'sd-plink', L.another);
        b.type = 'button';
        b.addEventListener('click', function () {
            seed = (seed + 0x9E3779B9) >>> 0;
            paint();
        });
        return b;
    }

    function bucket(ms) {
        var s = (Date.now() - ms) / 1000;
        if (s < 600) return L.bNow;
        if (s < 3600) return L.bHour;
        if (s < 86400) return L.bToday;
        if (s < 172800) return L.bYest;
        return L.bWeek;
    }

    // one row shape for both faces: a header line that says who or how much, a body line led by
    // the picture. The studio colour rides on the left rail so the row belongs to a studio
    function card(e) {
        var h = hue(e.studio || 0);
        var li = el('li', 'sd-rv');
        li.style.borderLeftColor = e.rail || 'hsl(' + h + ' 55% 58%)';
        var top = el('div', 'sd-rv-h');
        if (e.actor) {
            top.appendChild(pic('sd-rv-a', 'https://cdn2.scratch.mit.edu/get_image/user/' +
                (e.uid || 0) + '_40x40.png', e.actor, h));
            var name = el('a', 'sd-rv-u', e.actor);
            name.href = '/users/' + encodeURIComponent(e.actor) + '/';
            top.appendChild(name);
            top.appendChild(el('span', 'sd-rv-k sd-rv-' + e.kind,
                e.kind === 'out' ? L.removed : (e.kind === 'join' ? L.joined : L.added)));
        } else {
            (e.chips || []).forEach(function (c) {
                num(top, c[0], c[1], c[0], true);
            });
        }
        var x = e.x === undefined ? ago(e.ms) : e.x;
        if (x) top.appendChild(el('span', 'sd-rv-x', x));
        li.appendChild(top);

        var body = el('div', 'sd-rv-b');
        body.appendChild(pic('sd-rv-i', e.img, e.title, h));
        var what = el('div', 'sd-rv-w');
        var title = el('a', 'sd-rv-t', e.title);
        title.href = e.project ? '/projects/' + e.project + '/' : '/studios/' + e.studio + '/';
        what.appendChild(title);
        var sub = el('div', 'sd-rv-s');
        if (e.studioName) {
            var where = el('a', null, e.studioName);
            where.href = '/studios/' + e.studio + '/';
            sub.appendChild(where);
        }
        if (e.sub) sub.appendChild(el('span', 'sd-rv-n', e.sub));
        // a curator row is titled with its studio, so it has no second line to leave empty
        if (sub.childNodes.length) what.appendChild(sub);
        body.appendChild(what);
        li.appendChild(body);
        return li;
    }

    // a delta is the whole point of the digest, so it is signed; a total is not
    function num(box, n, pair, value, plus) {
        var s = el('span', 'sd-g');
        s.title = wn(value, pair);
        s.appendChild(el('b', null, (plus && n > 0 ? '+' : '') + fmt(n)));
        s.appendChild(document.createTextNode(' ' + noun(n, pair)));
        box.appendChild(s);
    }

    function drawMine(body) {
        if (!mine) {
            note(body, leftFail ? L.fail : L.loading, leftFail);
            return;
        }
        body.innerHTML = '';
        var sum = el('p', 'sd-asum');
        if (!mine.had) {
            sum.appendChild(el('span', 'sd-gfirst', L.meFirst));
        } else {
            num(sum, mine.gain.l, L.hearts, mine.gain.l, true);
            num(sum, mine.gain.v, L.viewsW, mine.gain.v, true);
            if (mine.gain.r) num(sum, mine.gain.r, L.remixW, mine.gain.r, true);
            if (mine.added) num(sum, mine.added, L.meNew, mine.added, true);
            // the gains mean nothing without the window they were measured across
            sum.appendChild(el('i', 'sd-gsince', L.meNote + ' ' + ago(mine.since)));
        }
        sum.appendChild(lookBtn());
        body.appendChild(sum);
        var ranked = mine.items.map(function (p, i) {
            return {p: p, rank: i};
        });
        // the six best projects are the same six tomorrow, so the window the list is picked out
        // of is rotated the same way the community stream rotates its moves
        var rows = rotate(ranked.slice(0, ROWS * 2), seed).slice(0, ROWS)
            .sort(function (a, b) {
                return a.rank - b.rank;
            }).map(function (row) {
                var p = row.p;
                var chips = p.up ? [[p.up.l, L.hearts], [p.up.v, L.viewsW], [p.up.r, L.remixW]]
                    .filter(function (c) { return c[0] > 0; }) : [];
                return {
                    ms: p.shared, project: p.id, title: p.title,
                    img: p.img || 'https://cdn2.scratch.mit.edu/get_image/project/' + p.id + '_100x80.png',
                    chips: chips,
                    // in the digest the rail answers the one question the panel is about: did
                    // this project move since the last visit
                    rail: chips.length ? '#2e8540' : '#dfe0e6',
                    // a project shared four years ago does not need that printed beside it
                    x: Date.now() - p.shared < 30 * 864e5 ? ago(p.shared) : '',
                    sub: wn(p.loves, L.hearts) + ' · ' + short(p.views) + ' ' + noun(p.views, L.viewsW)
                };
            });
        if (!rows.length) {
            note(body, TR ? 'yayınlanmış projen yok.' : 'no published project yet.', false);
            return;
        }
        var ul = el('ul', 'sd-rws');
        rows.forEach(function (r) {
            ul.appendChild(card(r));
        });
        body.appendChild(ul);
        body.appendChild(el('p', 'sd-pcap', L.meTop + ' · ' + agoAt(mine.at)));
    }

    function drawStream(body) {
        if (!stream) {
            note(body, leftFail ? L.fail : L.loading, leftFail);
            return;
        }
        body.innerHTML = '';
        var rows = pickEvents(stream.events);
        if (!rows.length) {
            note(body, L.empty, false);
            return;
        }
        var actors = {};
        stream.events.forEach(function (e) { actors[e.actor] = 1; });
        // the numbers describe the read, not the pick: how many moves were fetched, how many
        // Scratchers made them, how many studios were asked, and how fresh the newest one is
        var sum = el('p', 'sd-asum');
        sum.appendChild(el('b', null, fmt(stream.events.length)));
        sum.appendChild(document.createTextNode(' ' + noun(stream.events.length, L.moves) + ' · '));
        sum.appendChild(el('b', null, fmt(Object.keys(actors).length)));
        sum.appendChild(document.createTextNode(' ' + noun(Object.keys(actors).length, L.scrach) + ' · '));
        sum.appendChild(el('b', null, fmt(stream.studios)));
        sum.appendChild(document.createTextNode(' ' + noun(stream.studios, L.studiosWord) + ' · '));
        sum.appendChild(document.createTextNode(L.newestIn + ' '));
        sum.appendChild(el('b', null, ago(stream.events[0].ms)));
        sum.appendChild(lookBtn());
        body.appendChild(sum);

        var ul = el('ul', 'sd-rws');
        var last = '';
        rows.forEach(function (e) {
            var b = bucket(e.ms);
            if (b !== last) {
                last = b;
                ul.appendChild(el('li', 'sd-rvb', b));
            }
            ul.appendChild(card({
                ms: e.ms, studio: e.studio, kind: e.kind, actor: e.actor, uid: e.uid,
                title: e.title, project: e.project, img: e.img,
                studioName: e.kind === 'join' ? '' : stream.names[e.studio]
            }));
        });
        body.appendChild(ul);
        body.appendChild(el('p', 'sd-pcap', L.actNote.replace('{n}', POOL).replace('{s}', stream.studios) +
            ' · ' + agoAt(stream.at)));
    }

    function drawLeft(body) {
        if (!leftMode) {
            note(body, L.loading, false);
            return;
        }
        if (leftMode === 'me') drawMine(body); else drawStream(body);
    }

    function drawForums(body) {
        if (!forum) return;
        body.innerHTML = '';
        var topics = pickTopics(forum.pool);
        if (!forum.cats.length && !topics.length) {
            note(body, forumFail ? L.fail : L.loading, forumFail);
            return;
        }

        var day = Date.now() - 864e5;
        var posts = 0;
        var active = 0;
        forum.cats.forEach(function (c) {
            posts += c.posts;
            if (c.ms > day) active++;
        });
        // once a previous read exists the growth inside it is the interesting number; the
        // lifetime total of 8 million posts only fills the tile
        var stats = el('div', 'sd-pstats');
        var tiles = forum.delta
            ? [[forum.delta.sum, L.newPosts, true], [active, L.fresh, false], [forum.cats.length, L.forumsWord, false]]
            : [[posts, L.messages, false], [active, L.fresh, false], [forum.cats.length, L.forumsWord, false]];
        tiles.forEach(function (pair) {
            var s = el('div', 'sd-pstat');
            s.appendChild(el('b', null, (pair[2] ? '+' : '') + fmt(pair[0])));
            s.appendChild(el('span', null, pair[1]));
            stats.appendChild(s);
        });
        body.appendChild(stats);

        if (topics.length) {
            var ul = el('ul', 'sd-pts');
            ul.title = L.read + ': ' + HOT_FORUMS.map(function (f) { return f[1]; }).join(', ');
            topics.forEach(function (t) {
                var li = el('li', 'sd-pt');
                var title = el('a', 'sd-pt-t', t.title);
                title.href = '/discuss/topic/' + t.id + '/';
                li.appendChild(title);
                var meta = el('div', 'sd-pt-m');
                var chip = el('a', 'sd-pt-c', t.catName);
                chip.href = '/discuss/' + t.catId + '/';
                chip.style.background = 'hsl(' + hue(t.catId) + ' 72% 94%)';
                chip.style.color = 'hsl(' + hue(t.catId) + ' 48% 36%)';
                meta.appendChild(chip);
                if (t.sticky) meta.appendChild(el('span', 'sd-pt-k', L.sticky));
                meta.appendChild(el('span', null, wn(t.replies, L.replies)));
                // the column is one line wide, so the author lives in the tooltip instead of
                // pushing the reply count onto a second row
                var when = el('span', 'sd-pt-ago', ago(t.ms));
                if (t.user) when.title = L.by + ' ' + t.user;
                meta.appendChild(when);
                li.appendChild(meta);
                ul.appendChild(li);
            });
            body.appendChild(ul);
        } else {
            body.appendChild(el('p', 'sd-pnote', L.empty));
        }

        if (forum.cats.length) {
            var biggest = forum.cats.reduce(function (m, c) {
                return Math.max(m, c.posts);
            }, 1);
            var bars = el('ul', 'sd-pcats');
            forum.cats.slice().sort(function (a, b) {
                return (b.ms || 0) - (a.ms || 0);
            }).slice(0, BARS).forEach(function (c) {
                var li = el('li');
                var a = el('a', 'sd-pc-a', c.name);
                a.href = '/discuss/' + c.id + '/';
                li.appendChild(a);
                var bar = el('div', 'sd-pbar');
                var fill = el('i');
                // the row is ordered by the last answer, the bar carries the weight: the square
                // root keeps a million-post forum ahead without flattening everything else
                fill.style.width = Math.round(Math.sqrt(c.posts / biggest) * 100) + '%';
                fill.style.background = 'hsl(' + hue(c.id) + ' 58% 55%)';
                bar.appendChild(fill);
                li.appendChild(bar);
                li.appendChild(el('span', 'sd-pc-n', wn(c.topics, L.topicWord) + ' · ' + wn(c.posts, L.postWord)));
                // every busy forum answers within a minute, so "now" three times in a row says
                // nothing; growth since the last visit is the number that differs
                var d = forum.delta && forum.delta.byId[c.id] !== undefined ? forum.delta.byId[c.id] : null;
                li.appendChild(el('span', 'sd-pc-l' + (d ? ' sd-pc-up' : ''), d ? '+' + fmt(d) : ago(c.ms)));
                bars.appendChild(li);
            });
            body.appendChild(bars);
            body.appendChild(el('p', 'sd-pcap', (forum.delta
                ? L.change.replace('{t}', ago(forum.delta.at)) : L.bar) + ' · ' + agoAt(forum.at)));
        }
    }

    function draw() {
        var left = document.querySelector('.sd-left .sd-left-body');
        var leftTitle = document.querySelector('.sd-left h4');
        var leftLink = document.querySelector('.sd-left .box-header a');
        if (left && leftTitle && leftLink) {
            drawLeft(left);
            leftTitle.textContent = leftMode === 'me' ? L.me : L.act;
            leftLink.textContent = leftMode === 'me' ? L.meAll : L.actAll;
            leftLink.href = leftMode === 'me' && who ?
                '/users/' + encodeURIComponent(who) + '/' : '/explore/studios/trending/';
        }
        var forums = document.querySelector('.sd-forums .sd-forum-body');
        var forumTitle = document.querySelector('.sd-forums h4');
        var forumLink = document.querySelector('.sd-forums .box-header a');
        if (forumTitle) forumTitle.textContent = L.forums;
        if (forumLink) forumLink.textContent = L.all;
        if (forums) drawForums(forums);
    }

    function host() {
        var header = document.querySelector('.splash-header');
        if (header) return header;
        // logged out there is no header at all, and the row has to sit inside the 940px column
        var inner = document.querySelector('.inner.mod-splash');
        if (!inner) return null;
        header = el('div', 'splash-header');
        inner.insertBefore(header, inner.firstChild);
        return header;
    }

    function ensure() {
        if (!enabled) return;
        if (document.querySelector('.sd-pulse')) {
            if (!mounted) {
                mounted = true;
                paint();
            }
            return;
        }
        var header = host();
        if (!header) return;

        var left = el('div', 'box sd-pulse sd-left');
        left.appendChild(head(null, null, '/explore/studios/trending/'));
        left.appendChild(el('div', 'box-content sd-left-body'));

        var forums = el('div', 'box sd-pulse sd-forums');
        forums.appendChild(head(null, null, '/discuss/'));
        forums.appendChild(el('div', 'box-content sd-forum-body'));

        header.appendChild(left);
        header.appendChild(forums);
        mounted = true;
        paint();
    }

    function setEnabled(on) {
        enabled = on;
        // one class carries both halves: off shows the native boxes again and hides ours
        document.documentElement.classList.toggle('sd-forums-on', on);
        document.documentElement.classList.toggle('sd-forums-off', !on);
        if (on) ensure();
    }

    var style = document.createElement('style');
    style.textContent =
        // Scratch's own `.splash .splash-header .box` rule sets display, so switching off needs
        // a selector that outranks it rather than a bare class
        '.sd-forums-off .splash .splash-header>.box.sd-pulse{display:none}' +
        // the two native boxes stay in the tree so switching the feature back on gives them back
        '.sd-forums-on .splash-header>.box.activity,.sd-forums-on .splash-header>.box.news{display:none}' +
        '.splash-header{display:flex;align-items:flex-start;gap:20px;margin-bottom:20px}' +
        // Scratch sizes .box inside .splash-header with its own media queries, so the split here
        // is written with the same number of classes plus a child combinator to outlast them
        '.splash .splash-header>.box.sd-left{flex:1 1 56%;width:auto;min-width:0}' +
        '.splash .splash-header>.box.sd-forums{flex:0 0 37%;width:auto;min-width:0}' +
        '.sd-pulse .box-header{padding:12px 16px}' +
        '.sd-pulse .box-header p{margin:0}' +
        '.sd-pulse .box-content{padding:0}' +
        // Scratch's own sheet gives every li a 12px block margin and a 24px line box, which made
        // these columns twice as tall as the content; the reset is what makes the row heights real
        '.sd-pulse ul{list-style:none;margin:0;padding:0;line-height:1.3}' +
        '.sd-pulse li{margin:0;line-height:1.3}' +
        '.sd-pnote{margin:0;padding:16px;font-size:13px;color:#999}' +
        '.sd-pfail{color:#e64b4b}' +
        '.sd-plink{background:none;border:0;padding:0;font:inherit;color:#855cd6;cursor:pointer}' +
        '.sd-plink:hover{text-decoration:underline}' +
        '.sd-pcap{margin:0;padding:8px 16px;font-size:10px;color:#bbb;line-height:1.4}' +
        // left half: the digest and the community stream share one row shape
        '.sd-asum{margin:0;padding:10px 16px;font-size:11.5px;color:#999;border-bottom:1px solid #f2f2f2;' +
        'background:#fbfbfd;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}' +
        '.sd-asum b{font-size:13px;color:#575e75}' +
        '.sd-asum .sd-plink{margin-left:auto}' +
        '.sd-gfirst{font-size:11.5px;color:#999}' +
        '.sd-gsince{font-style:normal;font-size:10.5px;color:#bbb}' +
        '.sd-g{white-space:nowrap}' +
        '.sd-g b{color:#2e8540}' +
        // both faces of the left half draw the same card: a header line, a body line led by the
        // picture, and the studio colour on the rail so the row belongs to a studio
        '.sd-rws{list-style:none;margin:0;padding:0}' +
        '.sd-rv{display:block;padding:7px 14px 8px 12px;border-left:3px solid #ddd;' +
        'border-bottom:1px solid #f2f2f2}' +
        '.sd-rv:last-child{border-bottom:0}' +
        '.sd-rvb{padding:6px 14px 3px 12px;font-size:9.5px;font-weight:700;color:#bbb;' +
        'text-transform:uppercase;letter-spacing:.4px}' +
        '.sd-rv-h{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;color:#999}' +
        '.sd-rv-a{width:22px;height:22px;border-radius:4px;flex:0 0 auto;background:#f0f0f2;' +
        'object-fit:cover;display:block}' +
        '.sd-pulse .sd-rv-u{font-size:11.5px;font-weight:700;color:#575e75;text-decoration:none;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:40%}' +
        '.sd-pulse .sd-rv-u:hover{color:#855cd6;text-decoration:underline}' +
        '.sd-rv-k{font-size:9.5px;font-weight:600;color:#2e8540;background:#e3f3e8;' +
        'padding:1px 7px;border-radius:999px;flex:0 0 auto}' +
        '.sd-rv-out{color:#c0392b;background:#fbe7e6}' +
        '.sd-rv-join{color:#575e75;background:#eef0f6}' +
        '.sd-rv-x{margin-left:auto;flex:0 0 auto;font-size:10.5px;font-weight:600;color:#aaa}' +
        '.sd-rv-b{display:flex;align-items:center;gap:10px;margin-top:5px;min-width:0}' +
        '.sd-rv-i{width:62px;height:46px;border-radius:5px;object-fit:cover;flex:0 0 auto;' +
        'display:block;background:#f0f0f2}' +
        // the stand-in for a picture the CDN will not give back, sized exactly like it
        '.sd-tile{display:flex;align-items:center;justify-content:center;font-size:18px;' +
        'font-weight:700;line-height:1}' +
        '.sd-rv-w{min-width:0;flex:1 1 auto}' +
        '.sd-pulse .sd-rv-t{display:block;font-size:12.5px;font-weight:600;color:#855cd6;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}' +
        '.sd-pulse .sd-rv-t:hover{text-decoration:underline}' +
        '.sd-rv-s{display:flex;align-items:baseline;gap:7px;margin-top:3px;font-size:10.5px;' +
        'color:#999;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
        '.sd-pulse .sd-rv-s a{color:#999;text-decoration:none}' +
        '.sd-pulse .sd-rv-s a:hover{color:#855cd6;text-decoration:underline}' +
        '.sd-rv-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        // right half: one forum column
        '.sd-pstats{display:flex;border-bottom:1px solid #f2f2f2}' +
        '.sd-pstat{flex:1;padding:11px 6px;text-align:center;border-right:1px solid #f2f2f2}' +
        '.sd-pstat:last-child{border-right:0}' +
        '.sd-pstat b{display:block;font-size:17px;font-weight:700;color:#575e75;line-height:1.1}' +
        '.sd-pstat span{display:block;margin-top:3px;font-size:9.5px;color:#999;text-transform:uppercase;letter-spacing:.2px}' +
        '.sd-pt{padding:8px 16px;border-bottom:1px solid #f2f2f2}' +
        '.sd-pt:last-child{border-bottom:0}' +
        '.sd-pulse .sd-pt-t{display:block;font-size:12.5px;font-weight:600;line-height:1.35;color:#855cd6;' +
        'text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.sd-pulse .sd-pt-t:hover{text-decoration:underline}' +
        // one meta line per topic: a wrapped second line is what made this column twice as
        // tall as the feed beside it
        '.sd-pt-m{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;margin-top:4px;font-size:10.5px;color:#999;min-width:0}' +
        '.sd-pulse .sd-pt-m a{color:#999;text-decoration:none}' +
        '.sd-pulse .sd-pt-m a:hover{color:#855cd6;text-decoration:underline}' +
        '.sd-pt-m>span{white-space:nowrap}' +
        '.sd-pt-c{padding:2px 7px;border-radius:999px;font-weight:600;font-size:9.5px;letter-spacing:.2px;' +
        'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.sd-pt-k{padding:2px 6px;border-radius:4px;background:#fff3cd;color:#8a6d3b;font-weight:700;font-size:9.5px}' +
        '.sd-pt-ago{margin-left:auto;white-space:nowrap;color:#777;font-weight:600}' +
        '.sd-pcats li{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 16px;' +
        'border-bottom:1px solid #f2f2f2}' +
        '.sd-pcats li:last-child{border-bottom:0}' +
        '.sd-pc-a{grid-column:1;font-size:11.5px;font-weight:600;color:#855cd6;text-decoration:none;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.sd-pc-l{grid-column:2;grid-row:1;font-size:10.5px;color:#999;text-align:right;white-space:nowrap}' +
        '.sd-pc-up{color:#2e8540;font-weight:700;font-size:11.5px}' +
        '.sd-pbar{grid-column:1;grid-row:2;height:4px;border-radius:2px;background:#f0f0f0;overflow:hidden}' +
        '.sd-pbar i{display:block;height:100%;border-radius:2px}' +
        '.sd-pc-n{grid-column:2;grid-row:2;font-size:9.5px;color:#aaa;text-align:right;white-space:nowrap}' +
        '@media (max-width:700px){.splash-header{flex-wrap:wrap}' +
        '.splash .splash-header>.box.sd-left,.splash .splash-header>.box.sd-forums{flex:1 1 100%}}';
    document.head.appendChild(style);
    try {
        localStorage.removeItem('sd-pulse:v1');
        localStorage.removeItem('sd-pulse:v2');
        localStorage.removeItem('sd-hot:v1');
        localStorage.removeItem('sd-act:v1');
    } catch (error) { /* nothing to clean */ }

    document.documentElement.classList.add('sd-forums-on');

    // the network starts before React has drawn a single box: the panels are painted into
    // whatever exists by the time the answers arrive
    loadForums(false);
    startLeft(false);

    var queued = false;
    // React draws the nav whenever it feels like it, sometimes after /session/ has already
    // answered "nobody" — and a signed-in visitor left on the public list never sees their own
    // numbers. The nav is therefore watched for a while after the first answer.
    var whoDeadline = Date.now() + 20000;
    var whoTriedAt = 0;
    function recheckWho() {
        if (who || leftMode !== 'act' || Date.now() > whoDeadline) return;
        if (Date.now() - whoTriedAt < 500) return;
        whoTriedAt = Date.now();
        var name = readWho();
        if (!name) return;
        who = name;
        leftMode = 'me';
        loadMine(false);
    }
    new MutationObserver(function () {
        if (queued || !enabled) return;
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            ensure();
            recheckWho();
        });
    }).observe(document.documentElement, {childList: true, subtree: true});

    try {
        chrome.storage.local.get('features', function (saved) {
            setEnabled(!saved || !saved.features || saved.features.forums !== false);
        });
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes.features) {
                setEnabled(!changes.features.newValue || changes.features.newValue.forums !== false);
            }
        });
    } catch (error) {
        /* extension reloaded while the tab was open: the panels stay on */
    }

    ensure();
})();
