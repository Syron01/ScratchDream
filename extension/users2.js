// users2 — the boosted Scratch profile API.
//
// Scratch's own /users/{name} publishes an id, a bio and four avatar sizes. Everything else
// (projects, followers, studios, comments, engagement) lives behind a dozen endpoints with
// pagination, three different response shapes and one dead end per question. This file turns
// one request to /users2/{name} into the whole public footprint of an account, plus derived
// numbers Scratch never computes, and a ranked scan that finds the last place a user commented.
//
// There is no dashboard. The engine runs in the page's own world so the intercept works for any
// script on the page, and opening /users2/{name} in a tab prints the same JSON in a bare <pre>:
//     fetch('https://scratch.mit.edu/users2/griffpatch').then(r => r.json())
//     fetch('https://scratch.mit.edu/users2/griffpatch/projects?depth=deep')
//     fetch('https://scratch.mit.edu/users2/griffpatch/trace?scan=96')
//
// Nothing is invented. Every field is either copied from a Scratch endpoint or computed from
// those copies, and `coverage` names what Scratch does not publish at all.
(function () {
    'use strict';

    if (window.__sdUsers2) return;

    var VERSION = 1;
    var API = 'https://api.scratch.mit.edu';
    var SITE = 'https://scratch.mit.edu';
    var CACHE_PREFIX = 'sd-u2-';
    var CACHE_MS = 15 * 60 * 1000;
    var PAGE = 40;
    var MAX_PAGES = 50;
    var MAX_LIST = 2000;
    var DEFAULT_SCAN = 48;
    var CONCURRENCY = 6;
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    var enabled = true;

    // ---------------------------------------------------------------- basics

    function clamp(n, lo, hi) {
        return Math.max(lo, Math.min(hi, n));
    }

    function round(n, digits) {
        var k = Math.pow(10, digits == null ? 2 : digits);
        return Math.round(n * k) / k;
    }

    function daysSince(value) {
        var t = Date.parse(value || '');
        return isNaN(t) ? null : Math.round((Date.now() - t) / 86400000);
    }

    function median(values) {
        var list = values.filter(function (n) { return typeof n === 'number' && isFinite(n); });
        if (!list.length) return 0;
        list.sort(function (a, b) { return a - b; });
        var mid = Math.floor(list.length / 2);
        return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    }

    // FNV-1a over the identity fields: a stable short id for an account, handy as a cache key
    function fingerprint(text) {
        var h = 0x811c9dc5;
        for (var i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    function decode(text) {
        return String(text == null ? '' : text)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
    }

    function encodeUser(name) {
        return encodeURIComponent(name);
    }

    function userUrl(name) {
        return SITE + '/users/' + encodeUser(name) + '/';
    }

    function projectUrl(id) {
        return SITE + '/projects/' + id + '/';
    }

    function cacheRead(key) {
        try {
            var hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null');
            if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
        } catch (error) { /* private mode */ }
        return null;
    }

    function cacheWrite(key, value) {
        try {
            var text = JSON.stringify({t: Date.now(), v: value});
            // one huge account must not evict every other cached profile
            if (text.length < 1500000) localStorage.setItem(CACHE_PREFIX + key, text);
        } catch (error) { /* quota: fetching again is the fallback */ }
    }

    function canUseSiteApi() {
        return location.hostname === 'scratch.mit.edu';
    }

    // ---------------------------------------------------------------- network

    // Six requests in flight, globally. The list collectors each fan out four pages, so without
    // this the six collectors together opened two dozen sockets and Scratch started answering
    // 429 to the comment sweep.
    var activeRequests = 0;
    var requestQueue = [];

    function acquire() {
        if (activeRequests < CONCURRENCY) {
            activeRequests++;
            return Promise.resolve();
        }
        return new Promise(function (resolve) { requestQueue.push(resolve); });
    }

    function release() {
        var next = requestQueue.shift();
        if (next) next();
        else activeRequests--;
    }

    function request(url, asText, ctx) {
        var opts = {
            credentials: /^https:\/\/scratch\.mit\.edu\/site-api\//.test(url) ? 'include' : 'omit',
            headers: {'Accept': asText ? 'text/html' : 'application/json'}
        };
        ctx.requests++;
        return acquire().then(function () {
            function attempt() {
                return nativeFetch(url, opts).then(function (response) {
                    if (response.status === 429) {
                        return new Promise(function (resolve) { setTimeout(resolve, 900); }).then(attempt);
                    }
                    if (!response.ok) {
                        var error = new Error('HTTP ' + response.status + ' · ' + url);
                        error.status = response.status;
                        throw error;
                    }
                    return asText ? response.text() : response.json();
                });
            }
            return attempt();
        }).then(function (value) {
            release();
            return value;
        }, function (error) {
            release();
            ctx.errors++;
            throw error;
        });
    }

    function apiJson(path, ctx) {
        return request(API + path, false, ctx);
    }

    function siteHtml(path, ctx) {
        return request(SITE + path, true, ctx);
    }

    // A list endpoint only says "40 more?" through the page length, so pages are fetched four
    // at a time until a short page lands. That is one round trip cheaper than the serial crawl
    // and still stops the moment the account ends.
    function collectPages(path, cap, ctx) {
        var rows = [];
        var seen = {};
        var offset = 0;
        var finished = false;
        var limit = Math.min(cap, MAX_LIST);

        function batch() {
            if (finished || rows.length >= limit) return Promise.resolve(rows);
            var jobs = [];
            for (var i = 0; i < 4; i++) {
                jobs.push(apiJson(path + (path.indexOf('?') >= 0 ? '&' : '?') +
                    'limit=' + PAGE + '&offset=' + offset, ctx).catch(function () { return null; }));
                offset += PAGE;
            }
            return Promise.all(jobs).then(function (pages) {
                for (var p = 0; p < pages.length; p++) {
                    var page = pages[p];
                    if (!Array.isArray(page) || !page.length) { finished = true; break; }
                    for (var j = 0; j < page.length; j++) {
                        var row = page[j];
                        if (!row || seen[row.id]) continue;
                        seen[row.id] = true;
                        rows.push(row);
                    }
                    if (page.length < PAGE) { finished = true; break; }
                }
                return batch();
            });
        }

        return batch().then(function () {
            return rows.slice(0, limit);
        });
    }

    function pool(items, worker, limit, onStep) {
        return new Promise(function (resolve) {
            var index = 0;
            var active = 0;
            var finished = 0;
            var results = new Array(items.length);
            if (!items.length) { resolve(results); return; }

            function next() {
                if (finished === items.length) { resolve(results); return; }
                while (active < limit && index < items.length) {
                    (function (slot) {
                        active++;
                        var item = items[slot];
                        Promise.resolve().then(function () { return worker(item, slot); })
                            .then(function (value) { results[slot] = value; }, function () { results[slot] = null; })
                            .then(function () {
                                active--;
                                finished++;
                                if (onStep) onStep(finished, items.length);
                                next();
                            });
                    })(index++);
                }
            }
            next();
        });
    }

    // ---------------------------------------------------------------- parsers

    // The comment endpoint ignores offset and limit and always answers with the newest ~25
    // top-level threads plus every reply under them. That is a hard ceiling: anything older
    // than the last 25 conversations is not reachable from a browser, and coverage says so.
    function parseComments(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var counter = doc.querySelector('[data-control-comment-count]');
        var count = counter ? Number(counter.getAttribute('data-control-comment-count')) : null;
        var nodes = doc.querySelectorAll('.comment[data-comment-id]');
        var comments = [];

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var author = node.getAttribute('data-comment-user') || '';
            var nameLink = node.querySelector('.name a[href^="/users/"]') ||
                node.querySelector('a[href^="/users/"]');
            if (nameLink) {
                var hit = nameLink.getAttribute('href').match(/^\/users\/([^/]+)/);
                if (hit) author = decodeURIComponent(hit[1]);
            }
            var time = node.querySelector('.time[title]');
            var body = node.querySelector('.content');
            var thread = node.closest('ul.replies');
            comments.push({
                id: Number(node.getAttribute('data-comment-id')) || null,
                author: author,
                text: body ? body.textContent.replace(/\s+/g, ' ').trim() : '',
                timestamp: time ? time.getAttribute('title') : null,
                thread: thread ? Number(thread.getAttribute('data-thread')) || null : null
            });
        }

        var threads = [];
        var byId = {};
        comments.forEach(function (comment) {
            if (comment.thread) return;
            var row = {
                id: comment.id,
                author: comment.author,
                text: comment.text,
                timestamp: comment.timestamp,
                replies: []
            };
            byId[comment.id] = row;
            threads.push(row);
        });
        comments.forEach(function (comment) {
            if (comment.thread && byId[comment.thread]) byId[comment.thread].replies.push(comment);
        });

        return {count: count, comments: comments, threads: threads};
    }

    function parseStudios(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var map = {};
        var links = doc.querySelectorAll('a[href^="/studios/"]');
        for (var i = 0; i < links.length; i++) {
            var match = links[i].getAttribute('href').match(/^\/studios\/(\d+)/);
            if (!match) continue;
            var title = (links[i].textContent || '').trim();
            var id = Number(match[1]);
            if (!map[id]) map[id] = {id: id, title: '', url: SITE + '/studios/' + id + '/'};
            if (title.length > map[id].title.length) map[id].title = title;
        }
        return Object.keys(map).map(function (id) { return map[id]; });
    }

    // ---------------------------------------------------------------- shapes

    function slimPerson(user) {
        if (!user) return null;
        var profile = user.profile || {};
        var images = profile.images || {};
        return {
            id: user.id,
            username: user.username,
            scratchteam: !!user.scratchteam,
            joined: (user.history && user.history.joined) || null,
            country: profile.country || '',
            bio: profile.bio || '',
            status: profile.status || '',
            badge: profile.membership_avatar_badge || 0,
            avatar: images['90x90'] || images['60x60'] || null,
            url: userUrl(user.username)
        };
    }

    function slimProject(project, username, rank) {
        var stats = project.stats || {};
        var author = project.author || {};
        var history = project.history || {};
        var created = history.created || null;
        var views = Number(stats.views) || 0;
        var loves = Number(stats.loves) || 0;
        return {
            id: project.id,
            title: project.title || '',
            description: project.description || '',
            instructions: project.instructions || '',
            visibility: project.visibility || '',
            public: project.public !== false,
            commentsAllowed: project.comments_allowed !== false,
            isPublished: project.is_published !== false,
            created: created,
            modified: history.modified || null,
            shared: history.shared || null,
            author: {id: author.id || null, username: author.username || username},
            images: project.images || null,
            thumb: (project.images && (project.images['480x360'] || project.images['282x218'])) || null,
            stats: {
                views: views,
                loves: loves,
                favorites: Number(stats.favorites) || 0,
                remixes: Number(stats.remixes) || 0
            },
            remix: project.remix || null,
            url: projectUrl(project.id),
            ageDays: daysSince(created),
            modifiedDaysAgo: daysSince(history.modified),
            loveRate: views ? round(loves / views * 100, 2) : 0,
            rank: rank,
            commentCount: null,
            lastCommentByAccount: null
        };
    }

    function normaliseProjectList(list, username) {
        return (list || []).map(function (project, index) {
            return slimProject(project, username, index + 1);
        });
    }

    // ---------------------------------------------------------------- collectors

    function collectProfile(user, ctx) {
        return slimPerson(user);
    }

    function collectProjects(username, ctx) {
        return collectPages('/users/' + encodeUser(username) + '/projects', MAX_LIST, ctx)
            .then(function (rows) { return normaliseProjectList(rows, username); });
    }

    function collectFavorites(username, ctx) {
        return collectPages('/users/' + encodeUser(username) + '/favorites', MAX_LIST, ctx)
            .then(function (rows) {
                return rows.map(function (project) {
                    return slimProject(project, project.author && project.author.username, 0);
                });
            });
    }

    function collectPeople(username, kind, ctx) {
        return collectPages('/users/' + encodeUser(username) + '/' + kind, MAX_LIST, ctx)
            .then(function (rows) {
                return rows.map(slimPerson).filter(Boolean);
            });
    }

    function collectStudios(username, ctx) {
        var curated = collectPages('/users/' + encodeUser(username) + '/studios/curate', MAX_LIST, ctx)
            .then(function (rows) {
                return rows.map(function (studio) {
                    return {
                        id: studio.id,
                        title: studio.title || '',
                        host: studio.host || null,
                        description: studio.description || '',
                        visibility: studio.visibility || '',
                        openToAll: !!studio.open_to_all,
                        commentsAllowed: studio.comments_allowed !== false,
                        created: (studio.history && studio.history.created) || null,
                        modified: (studio.history && studio.history.modified) || null,
                        stats: studio.stats || null,
                        url: SITE + '/studios/' + studio.id + '/'
                    };
                });
            });
        var followed = canUseSiteApi() ?
            siteHtml('/users/' + encodeUser(username) + '/studios_following/', ctx)
                .then(parseStudios).catch(function () { return []; }) :
            Promise.resolve([]);
        return Promise.all([curated, followed]).then(function (both) {
            return {curated: both[0], following: both[1]};
        });
    }

    function collectProfileComments(username, ctx) {
        if (!canUseSiteApi()) return Promise.resolve(null);
        return siteHtml('/site-api/comments/user/' + encodeUser(username) + '/', ctx)
            .then(parseComments).catch(function () { return null; });
    }

    // One request per project buys both the comment total and every comment the account
    // itself wrote in the newest threads. Bounded so a 900-project account cannot turn the
    // page into a crawler; the cap is reported in coverage.
    function enrichProjectComments(username, projects, cap, ctx, onStep) {
        var targets = projects.slice(0, cap);
        if (!targets.length || !canUseSiteApi()) {
            return Promise.resolve({authored: [], commenters: [], threads: []});
        }
        var self = username.toLowerCase();
        var authored = [];
        var commenters = {};
        var threads = [];
        return pool(targets, function (project) {
            return siteHtml('/site-api/comments/project/' + project.id + '/', ctx).then(function (html) {
                var parsed = parseComments(html);
                project.commentCount = parsed.count;
                var latest = null;
                parsed.comments.forEach(function (comment) {
                    if (comment.author && comment.author.toLowerCase() !== self) {
                        commenters[comment.author.toLowerCase()] = comment.author;
                    }
                    if (String(comment.author).toLowerCase() !== self) return;
                    if (!latest || Date.parse(comment.timestamp || 0) > Date.parse(latest.timestamp || 0)) {
                        latest = comment;
                    }
                    authored.push({
                        id: comment.id,
                        text: comment.text,
                        timestamp: comment.timestamp,
                        thread: comment.thread,
                        source: 'own-project',
                        location: {kind: 'project', id: project.id, title: project.title, url: project.url}
                    });
                });
                parsed.threads.forEach(function (thread) {
                    threads.push({
                        id: thread.id,
                        author: thread.author,
                        text: thread.text,
                        timestamp: thread.timestamp,
                        replies: thread.replies,
                        surface: 'project',
                        project: {id: project.id, title: project.title, url: project.url}
                    });
                });
                project.lastCommentByAccount = latest;
                return parsed;
            }).catch(function () { return null; });
        }, 5, onStep).then(function () {
            return {
                authored: authored,
                threads: threads,
                commenters: Object.keys(commenters).map(function (key) {
                    return commenters[key];
                })
            };
        });
    }

    // ---------------------------------------------------------------- comment trace

    // Scratch publishes no "comments by user" endpoint and no way to search comments. The only
    // observable trace is the comment list of each surface (profile or project), and those lists
    // show the newest 25 threads only. So the trace is a ranked search over the surfaces this
    // account is most likely to have written on, plus an honest confidence number.
    //
    // Prior weights: a person the account replied to (or who replied to it) is the strongest
    // signal, then people it follows, then people who follow it, then authors/projects it
    // favourited. Scanned in that order, the budget stops when it is spent.
    var PRIOR = {
        'commented-or-replied': 0.95,
        'commented-your-project': 0.7,
        'you-follow': 0.55,
        'favorited-project': 0.5,
        'follows-you': 0.45
    };

    function buildCandidates(username, network, favorites, profileComments, projectCommenters) {
        var self = username.toLowerCase();
        var map = {};

        function add(name, why) {
            if (!name) return;
            var key = String(name).toLowerCase();
            if (key === self) return;
            var row = map[key] || (map[key] = {username: name, score: 0, why: []});
            row.score = Math.max(row.score, PRIOR[why] || 0.3);
            if (row.why.indexOf(why) < 0) row.why.push(why);
        }

        if (profileComments) {
            profileComments.comments.forEach(function (comment) { add(comment.author, 'commented-or-replied'); });
        }
        (network.following || []).forEach(function (person) { add(person.username, 'you-follow'); });
        (network.followers || []).forEach(function (person) { add(person.username, 'follows-you'); });
        (favorites || []).forEach(function (project) {
            add(project.author && project.author.username, 'favorited-project');
        });
        (projectCommenters || []).forEach(function (name) { add(name, 'commented-your-project'); });

        return Object.keys(map).map(function (key) { return map[key]; })
            .sort(function (a, b) { return b.score - a.score; });
    }

    function newest(comments) {
        var best = null;
        comments.forEach(function (comment) {
            if (!comment.timestamp) return;
            if (!best || Date.parse(comment.timestamp) > Date.parse(best.timestamp)) best = comment;
        });
        return best;
    }

    function scanCandidates(username, candidates, budget, ctx, progress) {
        var picked = candidates.slice(0, budget);
        var self = username.toLowerCase();
        var found = [];
        var alive = 0;

        return pool(picked, function (candidate) {
            return siteHtml('/site-api/comments/user/' + encodeUser(candidate.username) + '/', ctx)
                .then(function (html) {
                    alive++;
                    var parsed = parseComments(html);
                    parsed.comments.forEach(function (comment) {
                        if (String(comment.author).toLowerCase() !== self) return;
                        found.push({
                            id: comment.id,
                            text: comment.text,
                            timestamp: comment.timestamp,
                            thread: comment.thread,
                            source: 'profile-scan',
                            location: {
                                kind: 'profile',
                                username: candidate.username,
                                url: userUrl(candidate.username)
                            },
                            evidence: candidate.why
                        });
                    });
                })
                .catch(function () { /* blocked or deleted account: skip it */ });
        }, 5, progress).then(function () {
            return {found: found, scanned: picked.length, alive: alive};
        });
    }

    // Favourited projects are the one project surface worth the extra requests: people comment
    // on what they liked far more often than on a random project.
    function scanFavoriteProjects(username, favorites, budget, ctx, progress) {
        var picked = (favorites || []).slice(0, budget);
        var self = username.toLowerCase();
        var found = [];
        return pool(picked, function (project) {
            return siteHtml('/site-api/comments/project/' + project.id + '/', ctx).then(function (html) {
                var parsed = parseComments(html);
                parsed.comments.forEach(function (comment) {
                    if (String(comment.author).toLowerCase() !== self) return;
                    found.push({
                        id: comment.id,
                        text: comment.text,
                        timestamp: comment.timestamp,
                        thread: comment.thread,
                        source: 'favorite-project',
                        location: {kind: 'project', id: project.id, title: project.title, url: project.url},
                        evidence: ['favorited-project']
                    });
                });
            }).catch(function () { /* deleted project */ });
        }, 4, progress).then(function () {
            return {found: found, scanned: picked.length};
        });
    }

    // The strongest candidates are also worth a second hop: people this account replied to or
    // follows often receive comments on their own projects, which no profile surface shows.
    function scanCandidateProjects(username, candidates, userBudget, perUser, ctx, progress) {
        var picked = candidates.slice(0, userBudget);
        var self = username.toLowerCase();
        var found = [];
        var surfaces = 0;
        return pool(picked, function (candidate) {
            return apiJson('/users/' + encodeUser(candidate.username) + '/projects?limit=' +
                perUser + '&offset=0', ctx).then(function (rows) {
                var list = (Array.isArray(rows) ? rows : []).slice(0, perUser);
                return pool(list, function (project) {
                    surfaces++;
                    return siteHtml('/site-api/comments/project/' + project.id + '/', ctx)
                        .then(function (html) {
                            parseComments(html).comments.forEach(function (comment) {
                                if (String(comment.author).toLowerCase() !== self) return;
                                found.push({
                                    id: comment.id,
                                    text: comment.text,
                                    timestamp: comment.timestamp,
                                    thread: comment.thread,
                                    source: 'candidate-project',
                                    location: {
                                        kind: 'project',
                                        id: project.id,
                                        title: project.title,
                                        url: projectUrl(project.id)
                                    },
                                    evidence: candidate.why
                                });
                            });
                        }).catch(function () { /* deleted project */ });
                }, 3);
            }).catch(function () { /* deleted account */ });
        }, 3, progress).then(function () {
            return {found: found, users: picked.length, surfaces: surfaces};
        });
    }

    function trace(username, network, favorites, profileComments, projectAuthored, projectCommenters, budget, ctx, notify) {
        var candidates = buildCandidates(username, network, favorites, profileComments, projectCommenters);
        var favoriteBudget = Math.min(10, Math.floor(budget / 5));
        var profileBudget = Math.max(0, budget - favoriteBudget);
        var hopBudget = Math.min(6, Math.floor(budget / 8));

        notify && notify('Yorum taraması: ' + Math.min(candidates.length, profileBudget) +
            ' profil · ' + favoriteBudget + ' favori proje · ' + hopBudget + ' kişi projesi');

        return Promise.all([
            profileBudget ? scanCandidates(username, candidates, profileBudget, ctx) :
                Promise.resolve({found: [], scanned: 0, alive: 0}),
            favoriteBudget ? scanFavoriteProjects(username, favorites, favoriteBudget, ctx) :
                Promise.resolve({found: [], scanned: 0}),
            hopBudget ? scanCandidateProjects(username, candidates, hopBudget, 3, ctx) :
                Promise.resolve({found: [], users: 0, surfaces: 0})
        ]).then(function (parts) {
            var authored = (projectAuthored || []).concat(parts[0].found, parts[1].found, parts[2].found);
            var seen = {};
            authored = authored.filter(function (comment) {
                var key = comment.id || (comment.location.kind + ':' + comment.timestamp + ':' + comment.text);
                if (seen[key]) return false;
                seen[key] = true;
                return true;
            }).sort(function (a, b) {
                return Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0);
            });

            var locations = {};
            authored.forEach(function (comment) {
                var loc = comment.location;
                var key = loc.kind + ':' + (loc.id || loc.username);
                var row = locations[key] || (locations[key] = {
                    kind: loc.kind,
                    username: loc.username || null,
                    projectId: loc.id || null,
                    title: loc.title || null,
                    url: loc.url,
                    count: 0,
                    newest: null
                });
                row.count++;
                if (!row.newest || Date.parse(comment.timestamp || 0) > Date.parse(row.newest.timestamp || 0)) {
                    row.newest = {id: comment.id, text: comment.text, timestamp: comment.timestamp};
                }
            });

            var locationList = Object.keys(locations).map(function (key) { return locations[key]; })
                .sort(function (a, b) {
                    return Date.parse(b.newest && b.newest.timestamp || 0) -
                        Date.parse(a.newest && a.newest.timestamp || 0);
                });

            var poolSize = candidates.length + Math.min(10, favorites.length);
            var scanned = parts[0].scanned + parts[1].scanned + parts[2].surfaces;
            var coverage = poolSize ? clamp(scanned / (poolSize + parts[2].surfaces), 0, 1) : 0;
            var last = authored[0] || null;
            var age = last ? daysSince(last.timestamp) : null;
            // A fresh hit is very likely the real latest; an old hit or a miss only says how much
            // of the likely surface was actually read, so the number falls back on coverage.
            var confidence = last ?
                clamp(0.55 + 0.35 * coverage + 0.08 * Math.exp(-(age || 365) / 90), 0, 0.98) :
                clamp(0.2 + 0.45 * coverage, 0, 0.8);

            return {
                last: last,
                found: authored.length,
                locations: locationList,
                recent: authored.slice(0, 60),
                algorithm: {
                    name: 'CommentTrace v1',
                    model: 'ranked surface scan · prior(relationship) · second-hop projects',
                    priors: PRIOR,
                    candidatePool: candidates.length,
                    profilesScanned: parts[0].scanned,
                    favoriteProjectsScanned: parts[1].scanned,
                    candidateUsersExpanded: parts[2].users,
                    candidateProjectsScanned: parts[2].surfaces,
                    window: 'newest 25 threads per surface',
                    confidenceFormula: last ?
                        '0.55 + 0.35×coverage + 0.08×e^(-ageDays/90)' :
                        '0.20 + 0.45×coverage',
                    confidence: round(confidence, 3),
                    coverage: round(coverage, 3)
                },
                truncated: scanned < poolSize
            };
        });
    }

    // ---------------------------------------------------------------- derived

    function timeline(projects) {
        var monthly = {};
        var stamps = [];
        projects.forEach(function (project) {
            var stamp = project.created || project.shared;
            if (!stamp) return;
            var key = String(stamp).slice(0, 7);
            monthly[key] = (monthly[key] || 0) + 1;
            var t = Date.parse(stamp);
            if (!isNaN(t)) stamps.push(t);
        });
        stamps.sort(function (a, b) { return a - b; });
        var keys = Object.keys(monthly).sort();
        var gaps = [];
        for (var i = 1; i < stamps.length; i++) {
            gaps.push(Math.round((stamps[i] - stamps[i - 1]) / 86400000));
        }
        var busiest = keys.slice().sort(function (a, b) { return monthly[b] - monthly[a]; })[0] || null;
        var yearly = {};
        keys.forEach(function (key) {
            var year = key.slice(0, 4);
            yearly[year] = (yearly[year] || 0) + monthly[key];
        });
        var longest = gaps.length ? Math.max.apply(null, gaps) : 0;

        return {
            firstProject: stamps.length ? new Date(stamps[0]).toISOString() : null,
            lastProject: stamps.length ? new Date(stamps[stamps.length - 1]).toISOString() : null,
            activeDays: stamps.length ? Math.round((stamps[stamps.length - 1] - stamps[0]) / 86400000) : 0,
            monthly: monthly,
            yearly: yearly,
            busiestMonth: busiest ? {month: busiest, projects: monthly[busiest]} : null,
            longestGapDays: longest,
            averageGapDays: gaps.length ? Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : 0,
            months: keys.length
        };
    }

    function insights(user, bio, projects) {
        var text = [bio].concat(projects.slice(0, 8).map(function (project) {
            return (project.description || '') + ' ' + (project.instructions || '');
        })).join(' ').toLowerCase();

        var stops = {
            tr: [' ve ', ' bir ', ' bu ', ' için ', ' çok ', ' ben ', ' ama ', ' gibi ', ' daha '],
            en: [' the ', ' and ', ' you ', ' this ', ' that ', ' with ', ' for ', ' have ', ' not '],
            es: [' el ', ' la ', ' los ', ' que ', ' para ', ' con ', ' una ', ' por '],
            pt: [' que ', ' não ', ' uma ', ' para ', ' com ', ' isso ', ' como '],
            de: [' der ', ' die ', ' das ', ' und ', ' nicht ', ' ich ', ' mit '],
            fr: [' le ', ' la ', ' les ', ' et ', ' pas ', ' pour ', ' avec '],
            ru: [' и ', ' в ', ' на ', ' это ', ' как ', ' не ']
        };
        var languages = Object.keys(stops).map(function (code) {
            var hits = 0;
            stops[code].forEach(function (word) { if (text.indexOf(word) >= 0) hits++; });
            return {code: code, hits: hits};
        }).filter(function (row) { return row.hits > 0; })
            .sort(function (a, b) { return b.hits - a.hits; }).slice(0, 3);

        var mentions = {};
        text.replace(/(?:^|[^\w@])@([a-z0-9_-]{3,20})/g, function (all, name) {
            mentions[name] = (mentions[name] || 0) + 1;
            return all;
        });
        var hashtags = {};
        text.replace(/#([a-z0-9_]{2,30})/g, function (all, tag) {
            hashtags[tag] = (hashtags[tag] || 0) + 1;
            return all;
        });
        var links = text.match(/https?:\/\/[^\s)]+/g) || [];
        var emoji = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];

        var hours = new Array(24).fill(0);
        projects.forEach(function (project) {
            var t = Date.parse(project.created || '');
            if (!isNaN(t)) hours[new Date(t).getUTCHours()]++;
        });
        var peak = 0;
        hours.forEach(function (value, hour) { if (value > hours[peak]) peak = hour; });

        return {
            fingerprint: fingerprint([user.id, user.username, user.joined].join('|')),
            languages: languages,
            links: links.slice(0, 10),
            mentions: Object.keys(mentions).slice(0, 12),
            hashtags: Object.keys(hashtags).slice(0, 12),
            emojiCount: emoji.length,
            bioLength: bio.length,
            profileWords: bio.trim() ? bio.trim().split(/\s+/).length : 0,
            uppercaseRatio: bio ? round((bio.match(/[A-ZÇĞİÖŞÜ]/g) || []).length / Math.max(1, bio.length) * 100, 1) : 0,
            projectCreationHoursUtc: hours,
            peakCreationHourUtc: peak
        };
    }

    // ---------------------------------------------------------------- forensics

    // Everything below is computed from data already fetched above. No new endpoint exists for
    // any of it, which is exactly why it is worth reading: reply latency, visible vocabulary,
    // remix influence and thumbnail colours are measurements, not opinions. Each block is also
    // listed in `provenance` with the endpoint and method that produced it, so the answer to
    // "how did they get this" is always in the response itself.
    var STOP_WORDS = {};
    ('the and for you your with that this from have has not but are was were they their them ' +
        'can will just all any how what when where who why too very much more most some such ' +
        'into out about over under than then three two one new use using make made get got ' +
        'bir ve bu için çok daha gibi ama ben sen o da de ki ile mi mı mu mü ne nasıl neden ' +
        'the a an to of in on at is it i my me we our us be been being do does did so if or ' +
        'project projects game games scratch code coding play click here link https http www ' +
        'com tıklayın oyna oyun oyunu yap yapımı hazır indir linki').split(' ')
        .forEach(function (word) { if (word) STOP_WORDS[word] = true; });

    function tokenise(text) {
        var words = String(text || '').toLowerCase().match(/[a-zçğıöşü0-9_]{3,}/g) || [];
        return words.filter(function (word) {
            return !STOP_WORDS[word] && !/^\d+$/.test(word);
        });
    }

    function countEmoji(text) {
        return (String(text || '').match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
    }

    function topEntries(map, limit) {
        return Object.keys(map).map(function (key) {
            return {value: key, count: map[key]};
        }).sort(function (a, b) { return b.count - a.count; }).slice(0, limit);
    }

    function styleFingerprint(bio, projects, authoredComments) {
        var text = [bio].concat(projects.map(function (project) {
            return (project.title || '') + ' ' + (project.description || '') + ' ' +
                (project.instructions || '');
        })).join(' ');
        var words = tokenise(text);
        var vocabulary = {};
        words.forEach(function (word) { vocabulary[word] = (vocabulary[word] || 0) + 1; });
        var unique = Object.keys(vocabulary).length;

        var titles = projects.map(function (project) { return project.title || ''; })
            .filter(Boolean);
        var groups = {};
        titles.forEach(function (title) {
            var key = title.toLowerCase()
                .replace(/[^a-z0-9çğıöşü ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ')
                .filter(function (word) { return word.length > 1; })
                .slice(0, 2)
                .join(' ');
            if (key.length < 5) return;
            (groups[key] = groups[key] || []).push(title);
        });
        var series = Object.keys(groups).filter(function (key) {
            return groups[key].length >= 2;
        }).map(function (key) {
            return {prefix: key, count: groups[key].length, titles: groups[key].slice(0, 4)};
        }).sort(function (a, b) { return b.count - a.count; }).slice(0, 6);

        var comments = (authoredComments || []).filter(function (comment) {
            return comment.text;
        });
        var lengths = comments.map(function (comment) { return comment.text.length; })
            .sort(function (a, b) { return a - b; });
        var corpus = comments.map(function (comment) { return comment.text; }).join(' ');
        var letters = corpus.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || [];
        var caps = corpus.match(/[A-ZÇĞİÖŞÜ]/g) || [];
        var withEmoji = comments.filter(function (comment) {
            return countEmoji(comment.text) > 0;
        }).length;

        return {
            vocabularySize: unique,
            wordCount: words.length,
            lexicalRichness: words.length ? round(unique / words.length, 3) : 0,
            topWords: topEntries(vocabulary, 15).map(function (row) {
                return {word: row.value, count: row.count};
            }),
            titles: {
                count: titles.length,
                averageLength: titles.length ? round(titles.reduce(function (sum, title) {
                    return sum + title.length;
                }, 0) / titles.length, 1) : 0,
                withEmoji: titles.filter(function (title) { return countEmoji(title) > 0; }).length,
                withNumber: titles.filter(function (title) { return /\d/.test(title); }).length,
                series: series
            },
            comments: {
                visible: comments.length,
                averageLength: lengths.length ? round(lengths.reduce(function (a, b) { return a + b; }, 0) / lengths.length, 1) : 0,
                medianLength: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0,
                withEmoji: withEmoji,
                emojiRate: comments.length ? round(withEmoji / comments.length * 100, 1) : 0,
                exclamations: comments.filter(function (comment) { return /!/.test(comment.text); }).length,
                questions: comments.filter(function (comment) { return /\?/.test(comment.text); }).length,
                capsRatio: letters.length ? round(caps.length / letters.length * 100, 1) : 0
            }
        };
    }

    var GENRES = {
        game: ['game', 'oyun', 'juego', 'spiel'],
        platformer: ['platform', 'mario', 'sonic'],
        rpg: ['rpg', 'quest', 'adventure', 'macera'],
        tower: ['tower defense', 'tower', 'kule'],
        clicker: ['clicker', 'idle', 'tıklama', 'tikla'],
        horror: ['horror', 'scary', 'korku', 'doors', 'fnaf', 'five nights', 'granny', 'poppy'],
        shooter: ['shoot', 'gun', 'fps', 'silah', 'battle royale'],
        racing: ['race', 'racing', 'drift', 'araba', 'car'],
        puzzle: ['puzzle', 'bulmaca', 'sudoku', 'mahjong'],
        art: ['art', 'draw', 'çizim', 'cizim', 'paint', 'pixel'],
        music: ['music', 'song', 'beat', 'müzik', 'muzik', 'piano'],
        story: ['story', 'hikaye', 'chapter', 'bölüm', 'bolum'],
        chat: ['chat', 'sohbet', 'talk'],
        simulator: ['simulator', 'simülasyon', 'simulasyon', 'tycoon', 'sim'],
        meme: ['meme', 'funny', 'komik', 'brainrot', 'skibidi', 'rizz'],
        minecraft: ['minecraft', 'roblox', 'among us', 'fortnite']
    };

    function tasteMap(username, favorites, projects) {
        var self = username.toLowerCase();
        var authors = {};
        var text = favorites.map(function (project) {
            return (project.title || '') + ' ' + (project.description || '');
        }).join(' ');
        favorites.forEach(function (project) {
            var name = project.author && project.author.username;
            if (!name || name.toLowerCase() === self) return;
            authors[name] = (authors[name] || 0) + 1;
        });
        var lower = text.toLowerCase();
        var genres = Object.keys(GENRES).map(function (name) {
            var hits = 0;
            GENRES[name].forEach(function (word) {
                var index = lower.indexOf(word);
                while (index >= 0) { hits++; index = lower.indexOf(word, index + word.length); }
            });
            return {name: name, hits: hits};
        }).filter(function (row) { return row.hits > 0; })
            .sort(function (a, b) { return b.hits - a.hits; }).slice(0, 8);

        var words = {};
        tokenise(text).forEach(function (word) { words[word] = (words[word] || 0) + 1; });
        var favoriteViews = favorites.map(function (project) { return project.stats.views; });
        var ownViews = projects.map(function (project) { return project.stats.views; });

        return {
            favoriteCount: favorites.length,
            favoriteAuthors: topEntries(authors, 12).map(function (row) {
                return {username: row.value, count: row.count, url: userUrl(row.value)};
            }),
            keywords: topEntries(words, 15).map(function (row) {
                return {word: row.value, count: row.count};
            }),
            genres: genres,
            averageFavoriteViews: round(favoriteViews.reduce(function (a, b) { return a + b; }, 0) /
                Math.max(1, favoriteViews.length), 1),
            averageOwnViews: round(ownViews.reduce(function (a, b) { return a + b; }, 0) /
                Math.max(1, ownViews.length), 1)
        };
    }

    // The comment HTML nests replies under their thread, so the order inside a thread is the
    // observable conversation. Sorting by timestamp and measuring the gap before each comment
    // the account wrote gives a real reply latency — no endpoint exposes it directly.
    function conversations(username, profileThreads, projectThreads) {
        var self = username.toLowerCase();
        var threads = [];
        (profileThreads || []).forEach(function (thread) {
            threads.push({
                id: thread.id, author: thread.author, text: thread.text,
                timestamp: thread.timestamp, replies: thread.replies || [],
                surface: 'profile', url: userUrl(username)
            });
        });
        (projectThreads || []).forEach(function (thread) { threads.push(thread); });

        var latencies = [];
        var partners = {};
        var hourHistogram = new Array(24).fill(0);
        var accountComments = 0;
        var repliedThreads = 0;
        var eligibleThreads = 0;
        var unanswered = 0;
        var longest = null;

        threads.forEach(function (thread) {
            var list = [{author: thread.author, timestamp: thread.timestamp, text: thread.text}]
                .concat((thread.replies || []).map(function (reply) {
                    return {author: reply.author, timestamp: reply.timestamp, text: reply.text};
                }))
                .filter(function (comment) { return comment.timestamp; })
                .sort(function (a, b) {
                    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
                });

            if (thread.author.toLowerCase() !== self) eligibleThreads++;
            var mine = 0;
            list.forEach(function (comment, index) {
                if (comment.author.toLowerCase() !== self) return;
                mine++;
                accountComments++;
                var hour = new Date(comment.timestamp).getUTCHours();
                if (!isNaN(hour)) hourHistogram[hour]++;
                if (index > 0) {
                    var delta = (Date.parse(comment.timestamp) - Date.parse(list[index - 1].timestamp)) / 60000;
                    if (delta >= 0 && delta < 60 * 24 * 30) latencies.push(delta);
                }
            });
            if (mine) {
                repliedThreads++;
                if (thread.author.toLowerCase() !== self) {
                    partners[thread.author] = (partners[thread.author] || 0) + 1;
                }
            }
            if (list.length && list[list.length - 1].author.toLowerCase() !== self) unanswered++;
            if (!longest || list.length > longest.comments) {
                longest = {
                    id: thread.id,
                    surface: thread.surface,
                    project: thread.project || null,
                    url: thread.surface === 'project' && thread.project ? thread.project.url : userUrl(username),
                    comments: list.length
                };
            }
        });

        latencies.sort(function (a, b) { return a - b; });
        return {
            visibleThreads: threads.length,
            accountComments: accountComments,
            repliedThreads: repliedThreads,
            replyRate: eligibleThreads ? round(repliedThreads / eligibleThreads * 100, 1) : 0,
            threadsEndingWithoutAccount: unanswered,
            replyLatency: {
                samples: latencies.length,
                medianMinutes: latencies.length ? round(latencies[Math.floor(latencies.length / 2)], 1) : null,
                p90Minutes: latencies.length ? round(latencies[Math.floor(latencies.length * 0.9)], 1) : null,
                fastestMinutes: latencies.length ? round(latencies[0], 1) : null,
                slowestMinutes: latencies.length ? round(latencies[latencies.length - 1], 1) : null
            },
            partners: topEntries(partners, 12).map(function (row) {
                return {username: row.value, count: row.count, url: userUrl(row.value)};
            }),
            longestThread: longest,
            commentHourHistogramUtc: hourHistogram
        };
    }

    function signals(username, projects, followers, following, favorites, comments, traceResult, conversation, timelineData) {
        var lastProject = 0;
        projects.forEach(function (project) {
            [project.modified, project.created, project.shared].forEach(function (stamp) {
                var t = Date.parse(stamp || '');
                if (!isNaN(t) && t > lastProject) lastProject = t;
            });
        });
        var lastComment = traceResult && traceResult.last ? Date.parse(traceResult.last.timestamp) : 0;
        var lastActivity = Math.max(lastProject, lastComment);
        var ownIds = {};
        projects.forEach(function (project) { ownIds[project.id] = true; });
        var selfRemixes = projects.filter(function (project) {
            return project.remix && project.remix.parent && ownIds[project.remix.parent.id];
        }).length;

        return {
            lastProjectDaysAgo: lastProject ? Math.round((Date.now() - lastProject) / 86400000) : null,
            lastCommentDaysAgo: lastComment ? Math.round((Date.now() - lastComment) / 86400000) : null,
            lastActivityDaysAgo: lastActivity ? Math.round((Date.now() - lastActivity) / 86400000) : null,
            dormant: lastActivity ? (Date.now() - lastActivity) > 180 * 86400000 : null,
            hubRatio: following.length ? round(followers.length / following.length, 2) : followers.length,
            selfRemixes: selfRemixes,
            projects: projects.length,
            commentToProjectRatio: projects.length ? round((comments && comments.count != null ?
                comments.count : (conversation ? conversation.accountComments : 0)) / projects.length, 2) : null,
            replyRate: conversation ? conversation.replyRate : null,
            publicSpanDays: timelineData ? timelineData.activeDays : null
        };
    }

    function remixGraph(username, projects, cap, ctx, notify) {
        if (!projects.length || cap <= 0) return Promise.resolve(null);
        var self = username.toLowerCase();
        var poolMap = {};
        function add(list) {
            list.forEach(function (project) { if (project) poolMap[project.id] = project; });
        }
        add(projects.slice().sort(function (a, b) { return b.stats.views - a.stats.views; })
            .slice(0, Math.max(1, Math.ceil(cap / 2))));
        add(projects.slice().sort(function (a, b) { return b.stats.remixes - a.stats.remixes; })
            .slice(0, Math.ceil(cap / 3)));
        add(projects.slice(0, Math.ceil(cap / 3)));

        var picks = Object.keys(poolMap).map(function (id) { return poolMap[id]; })
            .sort(function (a, b) { return b.stats.remixes - a.stats.remixes; }).slice(0, cap);
        // stats.remixes is not a reliable gate: Scratch reports 0 on projects that still have
        // remixes, so the sampled list is asked directly instead of trusting the counter
        var targets = picks;
        var byProject = {};
        var authors = {};
        var selfRemixes = 0;

        notify && notify('Remix ağı: ' + targets.length + ' proje');

        return pool(targets, function (project) {
            return apiJson('/projects/' + project.id + '/remixes?limit=20', ctx).then(function (rows) {
                var list = (Array.isArray(rows) ? rows : []).map(function (remix) {
                    var author = remix.author && remix.author.username || '';
                    if (author && author.toLowerCase() !== self) {
                        authors[author] = (authors[author] || 0) + 1;
                    } else if (author) {
                        selfRemixes++;
                    }
                    return {
                        id: remix.id,
                        title: remix.title || '',
                        author: author,
                        url: projectUrl(remix.id),
                        views: (remix.stats && Number(remix.stats.views)) || 0,
                        loves: (remix.stats && Number(remix.stats.loves)) || 0,
                        created: (remix.history && remix.history.created) || null
                    };
                }).sort(function (a, b) { return b.views - a.views; });
                byProject[project.id] = list;
            }).catch(function () { byProject[project.id] = null; });
        }, 4).then(function () {
            var all = [];
            var entries = targets.map(function (project) {
                var list = byProject[project.id] || [];
                list.forEach(function (remix) {
                    remix.parent = {id: project.id, title: project.title, views: project.stats.views};
                    all.push(remix);
                });
                return {
                    id: project.id,
                    title: project.title,
                    url: project.url,
                    views: project.stats.views,
                    remixCount: project.stats.remixes,
                    sampled: list.length,
                    top: list.slice(0, 3)
                };
            });
            all.sort(function (a, b) { return b.views - a.views; });
            var best = all[0] || null;
            return {
                sampledProjects: targets.length,
                totalRemixCount: projects.reduce(function (sum, project) {
                    return sum + project.stats.remixes;
                }, 0),
                sampledRemixes: all.length,
                uniqueRemixers: Object.keys(authors).length,
                topRemixers: topEntries(authors, 12).map(function (row) {
                    return {username: row.value, count: row.count, url: userUrl(row.value)};
                }),
                selfRemixes: selfRemixes,
                bestRemix: best,
                bestLift: best ? round(best.views / Math.max(1, best.parent.views), 2) : null,
                projects: entries.filter(function (entry) { return entry.sampled > 0; })
                    .sort(function (a, b) { return b.remixCount - a.remixCount; })
            };
        });
    }

    // ---------------------------------------------------------------- palette

    function hexColour(r, g, b) {
        return '#' + [r, g, b].map(function (value) {
            return ('0' + Math.max(0, Math.min(255, Math.round(value))).toString(16)).slice(-2);
        }).join('');
    }

    function corsImage(url) {
        // cdn2 answers with a 302 that carries no CORS header, so a canvas read is blocked
        // before the image even lands. The uploads host serves the same path with ACAO: *.
        return String(url || '').replace('://cdn2.scratch.mit.edu/', '://uploads.scratch.mit.edu/');
    }

    function imagePalette(url) {
        return new Promise(function (resolve) {
            if (!url || typeof Image === 'undefined') { resolve(null); return; }
            var done = false;
            var timer = setTimeout(function () { finish(null); }, 8000);
            function finish(value) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(value);
            }
            var image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = function () {
                try {
                    var canvas = document.createElement('canvas');
                    canvas.width = 24;
                    canvas.height = 18;
                    var paint = canvas.getContext('2d', {willReadFrequently: true});
                    paint.drawImage(image, 0, 0, 24, 18);
                    var data = paint.getImageData(0, 0, 24, 18).data;
                    var bins = {};
                    var red = 0;
                    var green = 0;
                    var blue = 0;
                    var saturation = 0;
                    var total = 0;
                    for (var i = 0; i < data.length; i += 4) {
                        if (data[i + 3] < 128) continue;
                        var R = data[i];
                        var G = data[i + 1];
                        var B = data[i + 2];
                        red += R; green += G; blue += B; total++;
                        var max = Math.max(R, G, B);
                        var min = Math.min(R, G, B);
                        saturation += max ? (max - min) / max : 0;
                        var key = ((R >> 5) << 6) | ((G >> 5) << 3) | (B >> 5);
                        bins[key] = (bins[key] || 0) + 1;
                    }
                    if (!total) { finish(null); return; }
                    var colours = Object.keys(bins).map(function (key) {
                        var code = Number(key);
                        return {
                            hex: hexColour(((code >> 6) & 7) * 32 + 16,
                                ((code >> 3) & 7) * 32 + 16, (code & 7) * 32 + 16),
                            share: bins[key] / total
                        };
                    }).sort(function (a, b) { return b.share - a.share; }).slice(0, 6);
                    finish({
                        colours: colours,
                        brightness: round((0.2126 * red + 0.7152 * green + 0.0722 * blue) / total / 255, 3),
                        saturation: round(saturation / total, 3),
                        warmth: round(red / Math.max(1, red + green + blue), 3)
                    });
                } catch (error) {
                    finish(null);
                }
            };
            image.onerror = function () { finish(null); };
            image.src = url;
        });
    }

    function palette(projects, avatarUrl, cap) {
        if (typeof document === 'undefined' || typeof Image === 'undefined' || cap <= 0) {
            return Promise.resolve(null);
        }
        var mix = {};
        projects.slice().sort(function (a, b) { return b.stats.views - a.stats.views; })
            .slice(0, Math.max(1, Math.ceil(cap / 2))).forEach(function (project) { mix[project.id] = project; });
        projects.slice(0, Math.max(1, Math.ceil(cap / 2))).forEach(function (project) {
            mix[project.id] = project;
        });
        var picks = Object.keys(mix).map(function (id) { return mix[id]; }).slice(0, cap);
        var urls = picks.map(function (project) {
            return corsImage((project.images && (project.images['282x218'] ||
                project.images['480x360'])) || project.thumb);
        }).filter(Boolean);

        return pool(urls.concat(avatarUrl ? [corsImage(avatarUrl)] : []), imagePalette, 3)
            .then(function (results) {
            var numbers = results.slice(0, urls.length).filter(Boolean);
            var avatar = avatarUrl ? results[urls.length] : null;
            if (!numbers.length && !avatar) return null;
            var bins = {};
            var brightness = 0;
            var saturation = 0;
            var warmth = 0;
            numbers.forEach(function (result) {
                brightness += result.brightness;
                saturation += result.saturation;
                warmth += result.warmth;
                result.colours.forEach(function (colour) {
                    bins[colour.hex] = (bins[colour.hex] || 0) + colour.share / numbers.length;
                });
            });
            var colours = Object.keys(bins).map(function (hex) {
                return {hex: hex, share: round(bins[hex], 3)};
            }).sort(function (a, b) { return b.share - a.share; }).slice(0, 8);
            var avgBrightness = numbers.length ? brightness / numbers.length : 0;
            return {
                images: numbers.length,
                sampledProjects: picks.length,
                colours: colours,
                brightness: round(avgBrightness, 3),
                saturation: round(saturation / Math.max(1, numbers.length), 3),
                warmth: round(warmth / Math.max(1, numbers.length), 3),
                tone: avgBrightness < 0.34 ? 'dark' : avgBrightness > 0.68 ? 'bright' : 'balanced',
                temperature: (warmth / Math.max(1, numbers.length)) > 0.56 ? 'warm' : 'cool',
                avatar: avatar ? {
                    colours: avatar.colours,
                    brightness: avatar.brightness,
                    saturation: avatar.saturation,
                    warmth: avatar.warmth
                } : null
            };
        });
    }

    function analytics(user, projects, followers, following, favorites, comments) {
        var totals = {views: 0, loves: 0, favorites: 0, remixes: 0};
        projects.forEach(function (project) {
            totals.views += project.stats.views;
            totals.loves += project.stats.loves;
            totals.favorites += project.stats.favorites;
            totals.remixes += project.stats.remixes;
        });
        var views = projects.map(function (project) { return project.stats.views; });
        var loves = projects.map(function (project) { return project.stats.loves; });
        var count = projects.length || 1;
        var ageDays = Math.max(1, daysSince(user.joined) || 1);
        var commentTotal = comments && comments.count != null ? comments.count : null;
        // the profile comment count is not published, so the readable total is the sum of the
        // project comment counters this run actually opened
        var commentScanned = 0;
        var commentScannedProjects = 0;
        projects.forEach(function (project) {
            if (project.commentCount == null) return;
            commentScannedProjects++;
            commentScanned += project.commentCount;
        });

        var byViews = projects.slice().sort(function (a, b) { return b.stats.views - a.stats.views; });
        var byLoves = projects.slice().sort(function (a, b) { return b.stats.loves - a.stats.loves; });
        var byAge = projects.filter(function (project) { return project.created; })
            .sort(function (a, b) { return Date.parse(a.created) - Date.parse(b.created); });
        var gems = projects.filter(function (project) {
            return project.stats.views >= 50;
        }).sort(function (a, b) {
            return (b.stats.loves / Math.max(1, b.stats.views)) -
                (a.stats.loves / Math.max(1, a.stats.views));
        }).slice(0, 5);

        var monthlyCounts = {};
        projects.forEach(function (project) {
            var key = String(project.created || '').slice(0, 7);
            if (key) monthlyCounts[key] = (monthlyCounts[key] || 0) + 1;
        });
        var counts = Object.keys(monthlyCounts).map(function (key) { return monthlyCounts[key]; });
        var mean = counts.length ? counts.reduce(function (a, b) { return a + b; }, 0) / counts.length : 0;
        var variance = counts.length ? counts.reduce(function (a, b) {
            return a + Math.pow(b - mean, 2);
        }, 0) / counts.length : 0;
        var consistency = mean ? clamp(1 - Math.sqrt(variance) / mean, 0, 1) : 0;

        var lastProjectDays = projects.length ? Math.min.apply(null, projects.map(function (project) {
            var value = daysSince(project.modified || project.created);
            return value == null ? 99999 : value;
        })) : null;

        var engagement = (totals.loves + totals.favorites * 2 + totals.remixes * 4 +
            (commentTotal || commentScanned) * 3) / Math.max(1, totals.views);

        return {
            totals: {
                views: totals.views,
                loves: totals.loves,
                favorites: totals.favorites,
                remixes: totals.remixes,
                comments: commentTotal != null ? commentTotal : (commentScannedProjects ? commentScanned : null),
                commentsScannedProjects: commentScannedProjects,
                commentsVisibleOnProfile: comments ? comments.visibleComments : 0
            },
            averages: {
                views: round(totals.views / count, 1),
                loves: round(totals.loves / count, 1),
                favorites: round(totals.favorites / count, 1),
                remixes: round(totals.remixes / count, 1),
                viewsMedian: median(views),
                lovesMedian: median(loves)
            },
            rates: {
                lovePerView: totals.views ? round(totals.loves / totals.views * 100, 2) : 0,
                favoritePerView: totals.views ? round(totals.favorites / totals.views * 100, 2) : 0,
                remixPerView: totals.views ? round(totals.remixes / totals.views * 100, 2) : 0,
                engagementIndex: round(engagement * 100, 2)
            },
            network: {
                followers: followers.length,
                following: following.length,
                reciprocal: followers.filter(function (person) {
                    return following.some(function (other) { return other.id === person.id; });
                }).length,
                followerPerFollowing: following.length ? round(followers.length / following.length, 2) : followers.length
            },
            productivity: {
                accountAgeDays: ageDays,
                projects: projects.length,
                projectsPerMonth: round(projects.length / Math.max(1, ageDays / 30.44), 2),
                projectsPerYear: round(projects.length / Math.max(1, ageDays / 365.25), 2),
                viewsPerDay: round(totals.views / ageDays, 2),
                followersPerMonth: round(followers.length / Math.max(1, ageDays / 30.44), 2),
                lastProjectDaysAgo: lastProjectDays,
                consistency: round(consistency, 3)
            },
            top: {
                byViews: byViews.slice(0, 5).map(function (project) {
                    return {id: project.id, title: project.title, views: project.stats.views,
                        loves: project.stats.loves, url: project.url};
                }),
                byLoves: byLoves.slice(0, 5).map(function (project) {
                    return {id: project.id, title: project.title, views: project.stats.views,
                        loves: project.stats.loves, url: project.url};
                }),
                hiddenGems: gems.map(function (project) {
                    return {id: project.id, title: project.title, views: project.stats.views,
                        loves: project.stats.loves, loveRate: project.loveRate, url: project.url};
                }),
                newest: byAge.length ? {
                    id: byAge[byAge.length - 1].id, title: byAge[byAge.length - 1].title,
                    created: byAge[byAge.length - 1].created, url: byAge[byAge.length - 1].url
                } : null,
                oldest: byAge[0] ? {
                    id: byAge[0].id, title: byAge[0].title,
                    created: byAge[0].created, url: byAge[0].url
                } : null
            },
            favoriteProjects: favorites.length,
            viralIndex: median(views) ? round(Math.max.apply(null, views.concat(0)) / median(views), 2) : 0
        };
    }

    // ---------------------------------------------------------------- pipeline

    function optionDepth(params) {
        var depth = String(params.get('depth') || '').toLowerCase();
        if (depth === 'quick' || depth === 'deep' || depth === 'standard') return depth;
        return 'standard';
    }

    function limitsFor(depth, params) {
        var scan = params.has('scan') ? Number(params.get('scan')) : NaN;
        if (isNaN(scan)) {
            scan = depth === 'quick' ? 0 : depth === 'deep' ? 96 : DEFAULT_SCAN;
        }
        return {
            scan: clamp(scan, 0, 240),
            projectComments: depth === 'quick' ? 0 : depth === 'deep' ? 80 : 30,
            favoriteProjects: depth === 'quick' ? 0 : 10,
            remix: depth === 'quick' ? 0 : depth === 'deep' ? 12 : 6,
            palette: depth === 'quick' ? 0 : depth === 'deep' ? 8 : 4,
            depth: depth
        };
    }

    var SECTIONS = {
        '': 'root', 'full': 'root', 'quick': 'root',
        'projects': 'projects', 'favorites': 'favorites', 'network': 'network',
        'studios': 'studios', 'comments': 'comments', 'trace': 'trace',
        'timeline': 'timeline', 'insights': 'insights', 'analytics': 'analytics',
        'conversations': 'conversations', 'style': 'style', 'taste': 'taste',
        'remix': 'remix', 'palette': 'palette', 'signals': 'signals',
        'provenance': 'provenance', 'raw': 'raw'
    };

    function slice(payload, section) {
        var base = {
            api: 'users2',
            version: VERSION,
            boosted: true,
            found: payload.found,
            username: payload.username,
            generatedAt: payload.generatedAt,
            cached: payload.cached,
            depth: payload.depth
        };
        if (section === 'root') return payload;
        if (section === 'projects') {
            base.count = payload.counts.projects;
            base.projects = payload.projects;
        } else if (section === 'favorites') {
            base.count = payload.favorites.length;
            base.favorites = payload.favorites;
        } else if (section === 'network') {
            base.network = payload.network;
        } else if (section === 'studios') {
            base.studios = payload.studios;
        } else if (section === 'comments') {
            base.comments = payload.comments;
        } else if (section === 'trace') {
            base.trace = payload.trace;
        } else if (section === 'timeline') {
            base.timeline = payload.timeline;
        } else if (section === 'insights') {
            base.insights = payload.insights;
            base.palette = payload.palette;
        } else if (section === 'analytics') {
            base.analytics = payload.analytics;
        } else if (section === 'conversations') {
            base.conversations = payload.conversations;
        } else if (section === 'style') {
            base.style = payload.style;
        } else if (section === 'taste') {
            base.taste = payload.taste;
        } else if (section === 'remix') {
            base.remix = payload.remix;
        } else if (section === 'palette') {
            base.palette = payload.palette;
        } else if (section === 'signals') {
            base.signals = payload.signals;
        } else if (section === 'provenance') {
            base.provenance = payload.provenance;
        } else if (section === 'raw') {
            base.raw = payload.raw;
        }
        base.coverage = payload.coverage;
        return base;
    }

    function load(username, section, params, hooks) {
        var started = Date.now();
        var depth = optionDepth(params);
        var limits = limitsFor(depth, params);
        if (section === 'quick') {
            limits = {scan: 0, projectComments: 0, favoriteProjects: 0, remix: 0, palette: 0, depth: 'quick'};
        }
        var refresh = params.get('refresh') === '1';
        var cacheKey = [username.toLowerCase(), depth, limits.scan, limits.projectComments,
            limits.favoriteProjects, limits.remix, limits.palette, section].join('|');
        if (!refresh) {
            var hit = cacheRead(cacheKey);
            if (hit) {
                hit.cached = true;
                return Promise.resolve(hit);
            }
        }

        var notify = hooks && hooks.progress ? hooks.progress : function () {};
        var ctx = {requests: 0, errors: 0};
        // list-only sections must not pay for the comment crawl they never read
        var light = ['projects', 'favorites', 'network', 'studios', 'timeline', 'insights',
            'style', 'taste', 'raw'].indexOf(section) >= 0;
        if (light) {
            limits.scan = 0;
            limits.projectComments = 0;
            limits.favoriteProjects = 0;
        }
        var wantTrace = limits.scan > 0;
        var wantsRemix = limits.remix > 0 && (section === 'root' || section === 'remix');
        var wantsPalette = limits.palette > 0 &&
            (section === 'root' || section === 'palette' || section === 'insights');

        return apiJson('/users/' + encodeUser(username), ctx).then(function (user) {
            if (!user || !user.id) throw new Error('not found');
            var profile = collectProfile(user, ctx);
            notify('Profil alındı · projeler ve ağ çekiliyor');

            return Promise.all([
                collectProjects(username, ctx),
                collectPeople(username, 'followers', ctx),
                collectPeople(username, 'following', ctx),
                collectFavorites(username, ctx),
                collectStudios(username, ctx),
                collectProfileComments(username, ctx)
            ]).then(function (parts) {
                var projects = parts[0];
                var followers = parts[1];
                var following = parts[2];
                var favorites = parts[3];
                var studios = parts[4];
                var profileComments = parts[5];

                notify(projects.length + ' proje · ' + followers.length + ' takipçi · ' +
                    favorites.length + ' favori');

                var projectAuthored = [];
                var projectCommenters = [];
                var projectThreads = [];
                var ownProfileAuthored = [];
                var commentStep = 0;

                // The account's own profile page is the one surface where replies it wrote are
                // already in hand, so they join the trace without another request.
                if (profileComments) {
                    var selfName = username.toLowerCase();
                    profileComments.comments.forEach(function (comment) {
                        if (String(comment.author).toLowerCase() !== selfName) return;
                        ownProfileAuthored.push({
                            id: comment.id,
                            text: comment.text,
                            timestamp: comment.timestamp,
                            thread: comment.thread,
                            source: 'own-profile',
                            location: {kind: 'profile', username: username, url: userUrl(username)}
                        });
                    });
                }

                var enrich = limits.projectComments > 0 ?
                    enrichProjectComments(username, projects, limits.projectComments, ctx, function (done, total) {
                        commentStep++;
                        if (commentStep % 8 === 0 || done === total) {
                            notify('Proje yorumları · ' + done + '/' + total);
                        }
                    }).then(function (scan) {
                        projectAuthored = scan.authored;
                        projectCommenters = scan.commenters;
                        projectThreads = scan.threads || [];
                    }) :
                    Promise.resolve();

                return Promise.all([enrich]).then(function () {
                    var tracePromise;
                    if (wantTrace && canUseSiteApi()) {
                        tracePromise = trace(username, {
                            followers: followers, following: following
                        }, favorites, profileComments, projectAuthored.concat(ownProfileAuthored),
                            projectCommenters, limits.scan, ctx, notify);
                    } else {
                        tracePromise = Promise.resolve(null);
                    }
                    var remixPromise = wantsRemix ?
                        remixGraph(username, projects, limits.remix, ctx, notify) :
                        Promise.resolve(null);
                    var palettePromise = wantsPalette ?
                        palette(projects, profile.avatar, limits.palette) : Promise.resolve(null);

                    return Promise.all([tracePromise, remixPromise, palettePromise])
                        .then(function (results) {
                        var traceResult = results[0];
                        var remixResult = results[1];
                        var paletteResult = results[2];
                        var network = {
                            followers: followers,
                            following: following,
                            mutuals: followers.filter(function (person) {
                                return following.some(function (other) { return other.id === person.id; });
                            }),
                            followersCount: followers.length,
                            followingCount: following.length
                        };
                        var comments = profileComments ? {
                            count: profileComments.count,
                            visibleThreads: profileComments.threads.length,
                            visibleComments: profileComments.comments.length,
                            received: profileComments.threads,
                            note: 'Scratch returns only the newest ~25 threads of a profile; older threads are not reachable.'
                        } : {
                            count: null, visibleThreads: 0, visibleComments: 0, received: [],
                            note: 'The site API is required for comment reads.'
                        };

                        var derivedTimeline = timeline(projects);
                        var derivedInsights = insights(profile, profile.bio || '', projects);
                        var derivedAnalytics = analytics(profile, projects, followers, following,
                            favorites, comments);
                        var derivedConversations = conversations(username,
                            profileComments ? profileComments.threads : [], projectThreads);
                        var derivedStyle = styleFingerprint(profile.bio || '', projects,
                            projectAuthored.concat(ownProfileAuthored));
                        var derivedTaste = tasteMap(username, favorites, projects);
                        var truncated = {
                            projects: projects.length >= MAX_LIST,
                            followers: followers.length >= MAX_LIST,
                            following: following.length >= MAX_LIST,
                            favorites: favorites.length >= MAX_LIST
                        };
                        derivedAnalytics.network.truncated = Object.keys(truncated).some(function (key) {
                            return truncated[key];
                        });
                        if (traceResult) {
                            var traceMonths = {};
                            traceResult.recent.forEach(function (comment) {
                                var key = String(comment.timestamp || '').slice(0, 7);
                                if (key) traceMonths[key] = (traceMonths[key] || 0) + 1;
                            });
                            derivedTimeline.commentMonths = traceMonths;
                        }

                        var derivedSignals = signals(username, projects, followers, following,
                            favorites, comments, traceResult, derivedConversations, derivedTimeline);
                        var provenance = [
                            {block: 'identity', source: 'GET /users/{name}', method: 'read'},
                            {block: 'projects', source: 'GET /users/{name}/projects',
                                method: 'enumerated', rows: projects.length},
                            {block: 'followers + following', source: 'GET /users/{name}/followers · /following',
                                method: 'enumerated', rows: followers.length + following.length},
                            {block: 'favorites', source: 'GET /users/{name}/favorites',
                                method: 'enumerated', rows: favorites.length},
                            {block: 'studios', source: 'GET /users/{name}/studios/curate · /users/{name}/studios_following/',
                                method: 'api + html'},
                            {block: 'comments.received', source: 'GET /site-api/comments/user/{name}/',
                                method: 'visible window', window: 'newest ~25 threads'},
                            {block: 'comments.onProjects', source: 'GET /site-api/comments/project/{id}/',
                                method: 'one request per project',
                                rows: projects.filter(function (project) {
                                    return project.commentCount != null;
                                }).length},
                            {block: 'comment trace', source: 'ranked scan of the same comment lists',
                                method: 'heuristic', filters: traceResult ? traceResult.algorithm.candidatePool : 0,
                                scanned: traceResult ? traceResult.algorithm.profilesScanned +
                                    traceResult.algorithm.favoriteProjectsScanned +
                                    traceResult.algorithm.candidateProjectsScanned : 0,
                                confidence: traceResult ? traceResult.algorithm.confidence : null},
                            {block: 'conversations', source: 'parsed comment threads',
                                method: 'derived', rows: derivedConversations.visibleThreads},
                            {block: 'style', source: 'bio + project text + authored comments',
                                method: 'derived', words: derivedStyle.wordCount},
                            {block: 'taste', source: 'favorite project titles and descriptions',
                                method: 'derived', rows: favorites.length},
                            {block: 'remix', source: 'GET /projects/{id}/remixes',
                                method: 'sampled', rows: remixResult ? remixResult.sampledProjects : 0},
                            {block: 'palette', source: 'project thumbnails + avatar',
                                method: 'canvas pixel sample', rows: paletteResult ? paletteResult.images : 0},
                            {block: 'signals', source: 'all of the above', method: 'derived'}
                        ];

                        var payload = {
                            api: 'users2',
                            version: VERSION,
                            boosted: true,
                            generatedAt: new Date().toISOString(),
                            elapsedMs: Date.now() - started,
                            cached: false,
                            found: true,
                            depth: limits.depth,

                            // v1-compatible head: swapping /users/{name} for /users2/{name}
                            // keeps every field a v1 consumer already reads
                            id: user.id,
                            username: user.username,
                            scratchteam: !!user.scratchteam,
                            history: user.history || {},
                            profile: user.profile || {},

                            counts: {
                                projects: projects.length,
                                followers: followers.length,
                                following: following.length,
                                favorites: favorites.length,
                                studiosCurated: studios.curated.length,
                                studiosFollowing: studios.following.length,
                                commentsReceivedVisible: comments.count,
                                publicFootprint: projects.length + favorites.length +
                                    followers.length + following.length +
                                    studios.curated.length + studios.following.length
                            },
                            stats: derivedAnalytics.totals,
                            analytics: derivedAnalytics,
                            projects: projects,
                            favorites: favorites,
                            network: network,
                            studios: studios,
                            comments: comments,
                            trace: traceResult,
                            timeline: derivedTimeline,
                            insights: derivedInsights,
                            conversations: derivedConversations,
                            style: derivedStyle,
                            taste: derivedTaste,
                            remix: remixResult,
                            palette: paletteResult,
                            signals: derivedSignals,
                            provenance: provenance,

                            coverage: {
                                complete: ctx.errors === 0 && !truncated.projects &&
                                    !truncated.followers && !truncated.following && !truncated.favorites,
                                errors: ctx.errors,
                                requests: ctx.requests,
                                truncated: truncated,
                                caps: {
                                    projects: MAX_LIST,
                                    lists: MAX_LIST,
                                    projectCommentScan: limits.projectComments,
                                    traceScan: limits.scan,
                                    remixSample: limits.remix,
                                    paletteImages: limits.palette
                                },
                                unavailable: [
                                    {field: 'lovedProjects', reason: 'Scratch publishes a love count per project, not the list of users who loved it.'},
                                    {field: 'commentHistory', reason: 'The comment endpoint returns the newest ~25 threads only; older comments cannot be paged.'},
                                    {field: 'viewHistory', reason: 'Only current view totals are published, with no timeline.'},
                                    {field: 'privateProjects', reason: 'Unshared projects are visible only to their owner.'},
                                    {field: 'deletedComments', reason: 'Deleted comments leave no public trace.'},
                                    {field: 'lastComment', reason: 'No comment-search endpoint exists; the trace scans the surfaces this account most likely wrote on.'}
                                ]
                            },
                            upstream: {
                                api: API + '/users/' + encodeUser(username),
                                projects: API + '/users/' + encodeUser(username) + '/projects',
                                followers: API + '/users/' + encodeUser(username) + '/followers',
                                following: API + '/users/' + encodeUser(username) + '/following',
                                favorites: API + '/users/' + encodeUser(username) + '/favorites'
                            },
                            raw: {
                                user: user,
                                projectIds: projects.map(function (project) { return project.id; }),
                                followers: followers.map(function (person) { return person.username; }),
                                following: following.map(function (person) { return person.username; }),
                                favoriteIds: favorites.map(function (project) { return project.id; })
                            }
                        };

                        var result = slice(payload, section);
                        cacheWrite(cacheKey, result);
                        return result;
                    });
                });
            });
        }).catch(function (error) {
            if (error && (error.status === 404 || error.message === 'not found')) {
                return {
                    api: 'users2',
                    version: VERSION,
                    boosted: true,
                    found: false,
                    username: username,
                    generatedAt: new Date().toISOString(),
                    error: 'No Scratch account named "' + username + '".'
                };
            }
            return {
                api: 'users2',
                version: VERSION,
                boosted: true,
                found: false,
                username: username,
                generatedAt: new Date().toISOString(),
                error: String(error && error.message || error)
            };
        });
    }

    // ---------------------------------------------------------------- route

    function parseRoute(raw) {
        var url;
        try { url = new URL(raw, location.href); } catch (error) { return null; }
        if (url.hostname !== 'scratch.mit.edu' && url.hostname !== 'api.scratch.mit.edu') return null;
        var match = url.pathname.match(/^\/users2(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);
        if (!match) return null;
        var section = (match[2] || '').toLowerCase();
        return {
            username: match[1] ? decodeURIComponent(match[1]) : '',
            section: Object.prototype.hasOwnProperty.call(SECTIONS, section) ? SECTIONS[section] : 'unknown',
            params: url.searchParams,
            href: url.href
        };
    }

    function usage() {
        return {
            api: 'users2',
            version: VERSION,
            boosted: true,
            usage: SITE + '/users2/{username} · /users2/{username}/{section}',
            sections: Object.keys(SECTIONS).filter(Boolean),
            params: ['depth=quick|standard|deep', 'scan=0..240', 'refresh=1', 'pretty=0']
        };
    }

    function respond(route) {
        if (!route.username) {
            return Promise.resolve({status: 200, text: JSON.stringify(usage(), null, 2)});
        }
        if (route.section === 'unknown') {
            return Promise.resolve({status: 404, text: JSON.stringify({
                api: 'users2',
                found: false,
                error: 'Unknown section.',
                sections: Object.keys(SECTIONS).filter(Boolean)
            }, null, 2)});
        }
        return load(route.username, route.section, route.params).then(function (payload) {
            return {
                status: payload.found === false ? 404 : 200,
                text: JSON.stringify(payload, null, 2)
            };
        });
    }

    function respondWith(route) {
        var pretty = route.params.get('pretty') !== '0';
        return Promise.resolve().then(function () {
            if (!enabled) {
                return {status: 503, text: JSON.stringify({
                    api: 'users2',
                    boosted: false,
                    error: 'The users2 feature is switched off in ScratchDream.'
                }, null, 2)};
            }
            return respond(route).then(function (result) {
                return {
                    status: result.status,
                    text: pretty ? result.text : JSON.stringify(JSON.parse(result.text))
                };
            });
        }).catch(function (error) {
            return {status: 500, text: JSON.stringify({
                api: 'users2',
                error: String(error && error.message || error)
            }, null, 2)};
        });
    }

    function installFetch() {
        if (!window.fetch) return;
        window.fetch = function (input, init) {
            var raw = typeof input === 'string' ? input : input && input.url;
            var route = raw && parseRoute(raw);
            if (!route) return nativeFetch(input, init);
            return respondWith(route).then(function (result) {
                return new Response(result.text, {
                    status: result.status,
                    statusText: result.status === 200 ? 'OK' : 'Error',
                    headers: {'Content-Type': 'application/json; charset=utf-8', 'X-Users2': 'boosted'}
                });
            });
        };
    }

    function installXhr() {
        var XHR = window.XMLHttpRequest;
        if (!XHR) return;
        var open = XHR.prototype.open;
        var send = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
            this.__sdUsers2Route = parseRoute(String(url));
            return open.apply(this, arguments);
        };
        XHR.prototype.send = function () {
            var route = this.__sdUsers2Route;
            var xhr = this;
            if (!route) return send.apply(this, arguments);
            respondWith(route).then(function (result) {
                Object.defineProperty(xhr, 'readyState', {configurable: true, value: 4});
                Object.defineProperty(xhr, 'status', {configurable: true, value: result.status});
                Object.defineProperty(xhr, 'statusText', {
                    configurable: true,
                    value: result.status === 200 ? 'OK' : 'Error'
                });
                Object.defineProperty(xhr, 'responseText', {configurable: true, value: result.text});
                Object.defineProperty(xhr, 'response', {
                    configurable: true,
                    value: xhr.responseType === 'json' ? JSON.parse(result.text) : result.text
                });
                xhr.getAllResponseHeaders = function () { return 'content-type: application/json\r\n'; };
                xhr.getResponseHeader = function (name) {
                    return /content-type/i.test(name) ? 'application/json' : null;
                };
                xhr.dispatchEvent(new Event('readystatechange'));
                xhr.dispatchEvent(new Event('load'));
                xhr.dispatchEvent(new Event('loadend'));
            });
        };
    }

    // ---------------------------------------------------------------- raw page

    // A tab on /users2/{name} is the response and nothing else: no dashboard, no cards, no
    // banner. Just pretty JSON on a mono <pre>, the way an API reads when opened in a browser.
    function paintRaw(text, username) {
        var styleId = 'sd-users2-raw-style';
        if (!document.getElementById(styleId)) {
            var style = document.createElement('style');
            style.id = styleId;
            style.textContent = 'html.sd-users2-raw,html.sd-users2-raw body{margin:0!important;' +
                'padding:0!important;background:#fff!important;overflow:hidden!important}' +
                'html.sd-users2-raw body>*:not(#sd-users2-json){display:none!important}' +
                '#sd-users2-json{position:fixed;inset:0;margin:0;padding:14px 18px;overflow:auto;' +
                'background:#fff;color:#111;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,' +
                '"Liberation Mono",monospace;white-space:pre;tab-size:2}' +
                '@media(prefers-color-scheme:dark){html.sd-users2-raw,html.sd-users2-raw body' +
                '{background:#1e1e1e!important}#sd-users2-json{background:#1e1e1e;color:#d6d6d6}}';
            (document.head || document.documentElement).appendChild(style);
        }
        document.documentElement.classList.add('sd-users2-raw');
        var pre = document.getElementById('sd-users2-json');
        if (!pre) {
            pre = document.createElement('pre');
            pre.id = 'sd-users2-json';
            document.body.appendChild(pre);
        }
        pre.textContent = text;
        document.title = 'users2' + (username ? '/' + username : '');
    }

    function rawPage() {
        var match = location.pathname.match(/^\/users2(?:\/([^/]+))?\/?$/);
        if (!match) return;
        var username = match[1] ? decodeURIComponent(match[1]) : '';
        if (!username) {
            paintRaw(JSON.stringify(usage(), null, 2), '');
            return;
        }
        if (!enabled) {
            paintRaw(JSON.stringify({
                api: 'users2',
                boosted: false,
                error: 'The users2 feature is switched off in ScratchDream.'
            }, null, 2), username);
            return;
        }
        var params = new URLSearchParams(location.search);
        var started = Date.now();
        load(username, 'root', params).then(function (payload) {
            if (payload && payload.elapsedMs == null) payload.elapsedMs = Date.now() - started;
            paintRaw(JSON.stringify(payload, null, 2), username);
        }).catch(function (error) {
            paintRaw(JSON.stringify({
                api: 'users2',
                error: String(error && error.message || error)
            }, null, 2), username);
        });
    }

    // ---------------------------------------------------------------- feature gate

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        var data = event.data;
        if (!data || data.source !== 'adox-bridge' || data.type !== 'features') return;
        enabled = !data.flags || data.flags.users2 !== false;
        if (!enabled) document.documentElement.classList.add('sd-users2-off');
    });

    installFetch();
    installXhr();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', rawPage, {once: true});
    } else {
        rawPage();
    }

    // the viewer is a separate file so the engine stays readable; it only needs this handle
    window.__sdUsers2 = {
        version: VERSION,
        parseRoute: parseRoute,
        load: load,
        sections: Object.keys(SECTIONS).filter(Boolean),
        isEnabled: function () { return enabled; }
    };
})();
