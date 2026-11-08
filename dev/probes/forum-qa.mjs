// Full signed-in pass: every forum surface, both themes, plus the compose dialog. The numbers
// are the ones the owner kept catching by eye: send button present, no duplicate labels, no
// purple links, no white band under a scrolled dark page.
import path from 'node:path';
import {startExtension} from '../harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const PW = process.env.SD_PW || '';
const OUT = path.join(ROOT, 'dev/out/');
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'), {lang: 'tr-TR'});
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push('page: ' + String(e.message).slice(0, 200)));
tab.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200));
});
await tab.setViewport({width: 1600, height: 1000});

await tab.goto('https://scratch.mit.edu/login/', {waitUntil: 'domcontentloaded', timeout: 120000});
const login = await tab.evaluate(async (pw) => {
    const m = document.cookie.match(/scratchcsrftoken=([^;]+)/);
    const tok = m ? m[1] : '';
    const body = new URLSearchParams({csrfmiddlewaretoken: tok, username: 'games-coder', password: pw});
    const r = await fetch('/login/', {
        method: 'POST', credentials: 'include', redirect: 'manual',
        headers: {'content-type': 'application/x-www-form-urlencoded', 'x-csrftoken': tok},
        body
    });
    return r.status;
}, PW);
console.log('login status', login);

async function shoot(url, name, opts) {
    opts = opts || {};
    if (opts.light !== undefined) {
        await tab.emulateMediaFeatures([{name: 'prefers-color-scheme', value: opts.light ? 'light' : 'dark'}]);
    }
    if (opts.clearTheme) {
        await tab.evaluate(() => localStorage.removeItem('sd-x-theme')).catch(() => {});
    }
    await tab.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
    await tab.waitForFunction(opts.wait || (() => document.querySelector('.x-item, .x-post, .x-note')), {timeout: 30000}).catch(() => {});
    await new Promise(r => setTimeout(r, 2300));
    if (opts.scroll) await tab.evaluate(y => window.scrollTo(0, y), opts.scroll);
    if (opts.act) await tab.evaluate(opts.act);
    if (opts.act) await new Promise(r => setTimeout(r, 500));
    const st = await tab.evaluate(() => {
        const vis = s => {
            const e = document.querySelector(s);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return {h: Math.round(b.height), w: Math.round(b.width), y: Math.round(b.y)};
        };
        const colors = [...document.querySelectorAll('.x-app a')].map(a => getComputedStyle(a).color);
        const purple = colors.filter(c => /133, 92, 214/.test(c)).length;
        const dlg = document.querySelector('.x-dialog');
        const send = dlg && dlg.querySelector('.x-send');
        return {
            me: (document.querySelector('.x-me-t b') || {}).textContent || null,
            items: document.querySelectorAll('.x-item').length,
            posts: document.querySelectorAll('.x-post').length,
            purpleLinks: purple,
            quoteLabels: [...document.querySelectorAll('.x-post .x-actions')].slice(0, 1).map(a => a.textContent.replace(/\s+/g, ' ').trim()),
            dialog: !!dlg,
            dialogSend: send ? {text: send.textContent, visible: send.getBoundingClientRect().height > 0, disabled: send.disabled} : null,
            dialogClose: dlg ? dlg.querySelectorAll('.x-iconbtn').length : 0,
            whiteBand: (() => {
                const x = window.innerWidth / 2;
                const y = window.innerHeight - 40;
                const el = document.elementFromPoint(x, y);
                if (!el) return 'none';
                let n = el, bg = '';
                while (n && n !== document.documentElement) {
                    const c = getComputedStyle(n).backgroundColor;
                    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
                    n = n.parentElement;
                }
                return bg;
            })(),
            activeNav: [...document.querySelectorAll('.x-nav.on')].map(a => a.textContent.trim()),
            tabBar: (() => { const b=document.querySelector('.x-top .x-tabs'); return b ? getComputedStyle(b).display : 'none'; })(),
            logo: (() => { const i=document.querySelector('.x-logo-img'); return i ? {ok: i.naturalWidth > 0, src: i.src.slice(0, 40)} : null; })(),
            promptAv: (() => { const n=document.querySelector('.x-prompt .x-av'); return n ? (n.querySelector('img') ? 'photo' : n.textContent) : null; })(),
            counter: (document.querySelector('.x-count') || {}).textContent || null
        };
    });
    await tab.screenshot({path: OUT + name + '.png'});
    return {name, ...st};
}

const out = [];
out.push(await shoot('https://scratch.mit.edu/discuss/', 'qa-home-light', {light: true, clearTheme: true, scroll: 900, wait: () => document.querySelectorAll('.x-item').length >= 5}));
out.push(await shoot('https://scratch.mit.edu/discuss/?view=forums', 'qa-forums-light', {light: true, wait: () => document.querySelector('.x-forumcard')}));
out.push(await shoot('https://scratch.mit.edu/discuss/?view=help', 'qa-help-light', {light: true, wait: () => document.querySelectorAll('.x-item').length >= 3}));
out.push(await shoot('https://scratch.mit.edu/discuss/topic/860046/', 'qa-topic-light', {light: true, scroll: 700, wait: () => document.querySelectorAll('.x-post').length >= 3}));
out.push(await shoot('https://scratch.mit.edu/discuss/search/?action=show_user&show_as=topics', 'qa-mine-light', {light: true}));
out.push(await shoot('https://scratch.mit.edu/discuss/', 'qa-compose-light', {
    light: true,
    act: () => document.querySelector('.x-cta').click()
}));
out.push(await shoot('https://scratch.mit.edu/discuss/', 'qa-home-dark', {light: false, clearTheme: true, scroll: 900, wait: () => document.querySelectorAll('.x-item').length >= 5}));
out.push(await shoot('https://scratch.mit.edu/discuss/topic/860046/', 'qa-topic-dark', {light: false, scroll: 700, wait: () => document.querySelectorAll('.x-post').length >= 3}));

console.log(JSON.stringify(out, null, 2));
console.log('errors:', errs.length ? errs : 'none');
stop();
