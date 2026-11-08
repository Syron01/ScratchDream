// Live check of the X-style forum skin: the native page must be out of sight, the feed must carry
// real topic rows, a thread must render its posts and a working reply box, and nothing in the
// console may break on the way.
import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const TR = process.argv[2] === 'tr';
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'), {lang: TR ? 'tr-TR' : 'en-US'});
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push('page: ' + String(e.message).slice(0, 200)));
tab.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) {
        errs.push('console: ' + m.text().slice(0, 200));
    }
});

const out = [];
async function visit(url, name, wait) {
    await tab.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
    await tab.waitForFunction(wait, {timeout: 30000}).catch(() => {});
    await new Promise(r => setTimeout(r, 700));
    const state = await tab.evaluate(() => {
        const vis = el => el ? getComputedStyle(el).display !== 'none' : false;
        const box = sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height)};
        };
        return {
            skin: !!document.querySelector('#sd-x'),
            nativeHidden: !vis(document.querySelector('#content')),
            nav: !!document.querySelector('.x-side'),
            items: document.querySelectorAll('.x-item, .x-post').length,
            firstTitle: (document.querySelector('.x-text, .x-hero h1') || {}).textContent?.trim().slice(0, 60) || '',
            main: box('.x-main'), side: box('.x-side'), rail: box('.x-rail'),
            bg: getComputedStyle(document.body).backgroundColor,
            color: getComputedStyle(document.body).color,
            composer: !!document.querySelector('#x-reply'),
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    });
    await tab.screenshot({path: shotPath(name + '.png'), fullPage: false});
    out.push({name, ...state});
}

await tab.setViewport({width: 1440, height: 900});
await visit('https://scratch.mit.edu/discuss/', TR ? 'forum-home-tr' : 'forum-home',
    () => document.querySelectorAll('.x-item').length >= 5);
await visit('https://scratch.mit.edu/discuss/4/', TR ? 'forum-cat-tr' : 'forum-cat',
    () => document.querySelectorAll('.x-item').length >= 5);
await visit('https://scratch.mit.edu/discuss/topic/518000/', TR ? 'forum-topic-tr' : 'forum-topic',
    () => document.querySelectorAll('.x-post').length >= 2);

await tab.setViewport({width: 1024, height: 900});
await visit('https://scratch.mit.edu/discuss/topic/518000/', TR ? 'forum-topic-1024-tr' : 'forum-topic-1024',
    () => document.querySelectorAll('.x-post').length >= 2);

console.log(JSON.stringify(out, null, 2));
console.log('errors:', errs.length ? errs : 'none');
stop();
