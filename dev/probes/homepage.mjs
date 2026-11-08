// Live check of the home panels in both faces of the left half.
//   logged out  -> the community stream (studio moves, minutes old, picked out of a rank window)
//   signed in   -> the visitor's own numbers, measured against the snapshot of the last visit
// The signed-in case is simulated by the account-menu link the panel can read the username from,
// and both deltas are proven by moving a stored baseline backwards before the next visit.
import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/*(\w:)/, '$1')));
const {browser, id, stop} = await startExtension(path.join(ROOT, 'extension'),
    {lang: process.argv[2] === 'tr' ? 'tr-TR' : 'en-US'});
const ME = 'Bevan05';

// self-contained: everything it needs is inside this function, nothing from this file
const init = (meUser) => {
    window.__t0 = performance.now();
    window.__m = {};
    const mark = k => { if (!window.__m[k]) window.__m[k] = Math.round(performance.now() - window.__t0); };
    const mo = new MutationObserver(() => {
        if (document.querySelector('.sd-pulse')) mark('boxes');
        if (document.querySelectorAll('li.sd-rv').length >= 3) mark('left');
        if (document.querySelectorAll('li.sd-pt').length >= 2) mark('topics');
        if (document.querySelectorAll('.sd-pcats li').length) mark('bars');
    });
    document.addEventListener('DOMContentLoaded', () => {
        mo.observe(document.documentElement, {childList: true, subtree: true});
        if (!meUser) return;
        // the panel reads the visitor from the account menu; this is that link
        const nav = document.createElement('div');
        nav.id = 'account-nav';
        nav.innerHTML = '<a href="/users/' + meUser + '/">' + meUser + '</a>';
        document.documentElement.appendChild(nav);
    });
};

const state = () => {
    const cs = el => el ? getComputedStyle(el).display : null;
    const txt = el => el ? el.textContent.trim().replace(/\s+/g, ' ') : null;
    const native = [...document.querySelectorAll('.splash-header .box.activity, .splash-header .box.news')];
    const left = document.querySelector('.sd-left');
    const forums = document.querySelector('.sd-forums');
    const rows = [...document.querySelectorAll('li.sd-rv')];
    const topics = [...document.querySelectorAll('li.sd-pt')];
    const lb = left ? left.getBoundingClientRect() : null;
    const fb = forums ? forums.getBoundingClientRect() : null;
    // a picture that never arrived becomes a letter tile of the same size, so a row is only
    // broken when its slot has no box at all or one that is not the size the CSS promises
    const boxOf = r => {
        const i = r.querySelector('img.sd-rv-i');
        const t = r.querySelector('span.sd-tile');
        const n = i || t;
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return {w: Math.round(b.width), h: Math.round(b.height), kind: i ? 'img' : 'tile',
            loaded: i ? !!(i.complete && i.naturalWidth > 0) : true};
    };
    const pairOf = r => {
        const user = (r.querySelector('.sd-rv-u') || {}).textContent || '';
        const proj = r.querySelectorAll('a[href^="/projects/"]').length
            ? r.querySelector('a[href^="/projects/"]').getAttribute('href') : '';
        return user.toLowerCase() + '|' + proj;
    };
    const pics = rows.map(boxOf);
    return {
        marks: window.__m,
        title: txt(document.querySelector('.sd-left h4')),
        headerLink: txt(document.querySelector('.sd-left .box-header a')),
        nativeShown: native.filter(b => cs(b) !== 'none').length,
        rows: rows.length,
        rowProjectLinks: rows.filter(r => [...r.querySelectorAll('a')]
            .some(a => /^\/projects\/\d+\/$/.test(a.getAttribute('href')))).length,
        pictures: pics.filter(Boolean).map(p => `${p.kind} ${p.w}x${p.h}${p.loaded ? '' : ' UNLOADED'}`),
        pictureSizes: [...new Set(pics.filter(Boolean).map(p => p.w + 'x' + p.h))],
        rails: rows.map(r => getComputedStyle(r).borderLeftColor),
        dupRows: rows.length - new Set(rows.map(pairOf)).size,
        buckets: [...document.querySelectorAll('li.sd-rvb')].map(txt),
        firstRow: txt(rows[0]),
        firstRowHead: txt(rows[0] && rows[0].querySelector('.sd-rv-h')),
        summary: txt(document.querySelector('.sd-asum')),
        lookButton: txt(document.querySelector('.sd-asum .sd-plink')),
        forumTitle: txt(document.querySelector('.sd-forums h4')),
        forumLink: txt(document.querySelector('.sd-forums .box-header a')),
        bucketsOrdered: (() => {
            const b = [...document.querySelectorAll('li.sd-rvb')].map(txt);
            return b.length === new Set(b).size;
        })(),
        topics: topics.length,
        topicSticky: topics.filter(t => t.querySelector('.sd-pt-k')).length,
        topicCats: new Set(topics.map(t => txt(t.querySelector('.sd-pt-c')))).size,
        firstTopic: txt(topics[0] && topics[0].querySelector('.sd-pt-t')),
        bars: [...document.querySelectorAll('.sd-pcats li')].map(l => txt(l.querySelector('.sd-pc-l'))),
        stats: [...document.querySelectorAll('.sd-pstat')].map(txt),
        captions: [...document.querySelectorAll('.sd-pcap')].map(txt),
        notes: [...document.querySelectorAll('.sd-pnote')].map(txt),
        widths: lb && fb ? [Math.round(lb.width), Math.round(fb.width)] : null,
        heights: lb && fb ? [Math.round(lb.height), Math.round(fb.height)] : null,
        bottomGap: lb && fb ? Math.round(Math.abs(lb.bottom - fb.bottom)) : null,
        fits: lb && fb ? Math.round(fb.right - lb.left) <= 942 : null,
        inside: !!document.querySelector('.inner.mod-splash .sd-pulse')
    };
};

// turning the list over is the answer to "it never changes": it must be visible, and it must
// cost no request
const flip = page => page.evaluate(async () => {
    const titles = () => [...document.querySelectorAll('li.sd-rv .sd-rv-t')].map(t => t.textContent);
    const before = titles();
    const btn = document.querySelector('.sd-asum .sd-plink');
    if (!btn) return {error: 'no look button'};
    const seen = [before];
    for (let i = 0; i < 3; i++) {
        btn.click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        seen.push(titles());
    }
    const all = new Set();
    seen.forEach(list => list.forEach(t => all.add(t)));
    return {
        rowsPerList: seen.map(l => l.length),
        changedEveryClick: seen.slice(1).every((l, i) => l.join('|') !== seen[i].join('|')),
        distinctAcrossClicks: all.size,
        firstClickOverlap: seen[1].filter(t => seen[0].includes(t)).length,
        lists: seen.map(l => l.slice(0, 3))
    };
});

const errs = [];
const watch = page => {
    page.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
    page.on('response', r => {
        if (r.status() >= 400 && /discuss|api\.scratch|session/.test(r.url())) errs.push(r.status() + ' ' + r.url().slice(0, 110));
    });
};
const shot = async (page, name) => {
    const box = await page.evaluate(() => {
        const h = document.querySelector('.splash-header');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return {x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height};
    });
    if (box) await page.screenshot({path: path.join(ROOT, 'dev', 'out', name), clip: box});
};
const waitLeft = page => page.waitForFunction(() => document.querySelectorAll('li.sd-rv').length >= 3 ||
    document.querySelector('.sd-pnote'), {timeout: 90000}).catch(() => {});

// ---------- 1. logged out: the community stream ----------
const anon = await browser.newPage();
watch(anon);
await anon.evaluateOnNewDocument(init, '');
await anon.setViewport({width: 1440, height: 900});
await anon.goto('https://scratch.mit.edu/', {waitUntil: 'networkidle2', timeout: 120000});
await waitLeft(anon);
console.log('anon', JSON.stringify(await anon.evaluate(state), null, 1));
console.log('stream flip', JSON.stringify(await flip(anon), null, 1));

// the two native boxes only exist for a session, so the hiding rule is proven with real nodes
console.log('native boxes hidden:', JSON.stringify(await anon.evaluate(() => {
    const h = document.querySelector('.splash-header');
    const mk = cls => {
        const b = document.createElement('div');
        b.className = 'box ' + cls;
        h.appendChild(b);
        return b;
    };
    const f = [mk('activity'), mk('news')];
    const out = f.map(b => getComputedStyle(b).display);
    f.forEach(b => b.remove());
    return out;
})));

// move the forum baseline an hour back and visit again: the column must then report growth
const forumSeed = await anon.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('sd-pulse:v3') || 'null');
    if (!p || !p.cats || !p.cats.length) return null;
    p.cats.forEach(c => { c.posts -= 40; });
    p.at = Date.now() - 3600 * 1000;
    localStorage.setItem('sd-pulse:v3', JSON.stringify(p));
    return {cats: p.cats.length, want: '40 per forum'};
});
console.log('forum baseline moved:', JSON.stringify(forumSeed));
await anon.reload({waitUntil: 'networkidle2', timeout: 120000});
await waitLeft(anon);
console.log('anon again', JSON.stringify(await anon.evaluate(state), null, 1));
console.log('what was read:', JSON.stringify(await anon.evaluate(() => {
    const read = JSON.parse(localStorage.getItem('sd-act:v2') || 'null');
    return {studios: read && read.studios, movesRead: read && read.events.length,
        kinds: read && [...new Set(read.events.map(e => e.kind))],
        studiosNamed: read && Object.keys(read.names || {}).length};
})));

for (const width of [1600, 1366, 1024]) {
    await anon.setViewport({width, height: 900, deviceScaleFactor: 2});
    await new Promise(r => setTimeout(r, 500));
    await shot(anon, `home-${width}.png`);
}
await anon.screenshot({path: shotPath('home-full.png'), fullPage: true});

// ---------- 2. signed in: the personal digest ----------
const me = await browser.newPage();
watch(me);
await me.evaluateOnNewDocument(init, ME);
await me.setViewport({width: 1440, height: 900});
await me.goto('https://scratch.mit.edu/', {waitUntil: 'networkidle2', timeout: 120000});
await waitLeft(me);
console.log('me first visit', JSON.stringify(await me.evaluate(state), null, 1));

// lower the stored snapshot by a known amount, then visit again: the panel must report exactly it
const seeded = await me.evaluate(() => {
    const snap = JSON.parse(localStorage.getItem('sd-mine:v1') || 'null');
    if (!snap || !snap.byId) return null;
    const ids = Object.keys(snap.byId);
    snap.byId[ids[0]].l -= 5;
    snap.byId[ids[0]].v -= 120;
    snap.byId[ids[1]].l -= 2;
    snap.at = Date.now() - 3600 * 1000;
    localStorage.setItem('sd-mine:v1', JSON.stringify(snap));
    localStorage.removeItem('sd-me:v1');
    return {projects: ids.length, want: '+7 hearts, +120 views'};
});
console.log('personal baseline moved:', JSON.stringify(seeded));
await me.reload({waitUntil: 'networkidle2', timeout: 120000});
await waitLeft(me);
console.log('me second visit', JSON.stringify(await me.evaluate(state), null, 1));
console.log('digest flip', JSON.stringify(await flip(me), null, 1));
await me.setViewport({width: 1366, height: 900, deviceScaleFactor: 2});
await new Promise(r => setTimeout(r, 400));
await shot(me, 'home-me.png');

// ---------- 3. the popup switch hands the native boxes back ----------
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${id}/popup.html`, {waitUntil: 'load'});
await popup.click('.tile[data-id="forums"] .switch');
await popup.close();
await new Promise(r => setTimeout(r, 1200));
console.log('switch off', JSON.stringify(await me.evaluate(() => {
    const h = document.querySelector('.splash-header');
    const mk = cls => {
        const b = document.createElement('div');
        b.className = 'box ' + cls;
        h.appendChild(b);
        return b;
    };
    const f = [mk('activity'), mk('news')];
    const out = {
        cls: document.documentElement.className,
        native: f.map(b => getComputedStyle(b).display),
        ours: getComputedStyle(document.querySelector('.sd-left')).display
    };
    f.forEach(b => b.remove());
    return out;
})));
console.log('errors', JSON.stringify(errs.slice(0, 10)));
await stop();
