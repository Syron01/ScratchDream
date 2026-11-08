// Signed-in, light-scheme pass over the forum skin: the same surface the owner sees in their own
// browser, with the numbers that decide whether the layout is sane (button heights, tab underline,
// timestamps, composer placement, every nav link staying inside /discuss).
import path from 'node:path';
import {startExtension} from '../harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'), {lang: 'tr-TR'});
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push('page: ' + String(e.message).slice(0, 200)));
tab.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200));
});
await tab.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
await tab.setViewport({width: 1600, height: 1000});

await tab.goto('https://scratch.mit.edu/login/', {waitUntil: 'domcontentloaded', timeout: 120000});
await tab.type('#id_username', 'games-coder');
await tab.type('#id_password', process.env.SD_PW || '');
await Promise.allSettled([
    tab.waitForNavigation({waitUntil: 'domcontentloaded', timeout: 60000}),
    tab.evaluate(() => document.querySelector('form').requestSubmit())
]);
console.log('session after login:', await tab.evaluate(async () => {
    const j = await (await fetch('/session/', {credentials: 'include'})).json();
    return j && j.user ? j.user.username : 'guest';
}));

const P = path.join(ROOT, 'dev/out/');
async function shoot(url, name, wait) {
    await tab.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
    await tab.waitForFunction(wait, {timeout: 30000}).catch(() => {});
    await new Promise(r => setTimeout(r, 900));
    const st = await tab.evaluate(() => {
        const box = s => {
            const e = document.querySelector(s);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return {y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width)};
        };
        const cta = document.querySelector('.x-cta');
        const tabEl = document.querySelector('.x-tab');
        const ul = tabEl && getComputedStyle(tabEl, '::after');
        const navHrefs = [...document.querySelectorAll('.x-side .x-nav')].map(a => a.getAttribute('href'));
        const times = [...document.querySelectorAll('.x-time')].map(t => t.textContent).slice(0, 6);
        const posts = [...document.querySelectorAll('.x-post .x-time')].map(t => t.textContent).slice(0, 4);
        return {
            theme: document.documentElement.className,
            bg: getComputedStyle(document.body).backgroundColor,
            me: !!document.querySelector('.x-me-link'),
            signin: !!document.querySelector('.x-login'),
            cta: cta && {h: Math.round(cta.getBoundingClientRect().height), text: cta.textContent},
            tab: box('.x-tab'), tabUnderline: ul ? ul.bottom : null,
            prompt: box('.x-prompt .x-av'),
            posts: document.querySelectorAll('.x-post').length,
            postTimes: posts,
            feedTimes: times,
            navHrefs,
            composerY: (box('.x-replytop') || {}).y,
            firstPostY: (box('.x-post') || {}).y,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    });
    await tab.screenshot({path: P + name + '.png', fullPage: false});
    return {name, ...st};
}

const out = [];
out.push(await shoot('https://scratch.mit.edu/discuss/', 'fx-home', () => document.querySelectorAll('.x-item').length >= 5));
out.push(await shoot('https://scratch.mit.edu/discuss/4/', 'fx-cat', () => document.querySelectorAll('.x-item').length >= 5));
out.push(await shoot('https://scratch.mit.edu/discuss/topic/697636/', 'fx-topic', () => document.querySelectorAll('.x-post').length >= 2));
out.push(await shoot('https://scratch.mit.edu/discuss/search/?action=show_user&show_as=topics', 'fx-mine', () => document.querySelector('.x-item, .x-note')));
console.log(JSON.stringify(out, null, 2));
console.log('errors:', errs.length ? errs : 'none');
stop();
