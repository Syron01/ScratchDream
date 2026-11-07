// The owner's system language is Turkish, but the test browser defaults to en-US.
// Force tr-TR in the popup and check the longer strings still fit the compact row list.
import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, id, stop} = await startExtension(path.join(ROOT, 'extension'));
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language', {get: () => 'tr-TR'});
    Object.defineProperty(navigator, 'languages', {get: () => ['tr-TR', 'tr', 'en']});
});
await page.setViewport({width: 420, height: 600});
await page.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
await page.goto(`chrome-extension://${id}/popup.html`, {waitUntil: 'load'});
await new Promise(r => setTimeout(r, 700));

const out = await page.evaluate(() => {
    const pop = document.querySelector('.popup').getBoundingClientRect();
    const wide = [...document.querySelectorAll('*')].filter(e => {
        if (e === document.body || e === document.documentElement) return false;
        const r = e.getBoundingClientRect();
        return r.right > pop.right + .5 || e.scrollWidth > Math.ceil(r.width) + .5;
    }).map(e => e.className || e.id || e.tagName);
    return {
        lang: document.documentElement.lang,
        width: Math.round(pop.width), height: Math.round(pop.height),
        names: [...document.querySelectorAll('.tile-name')].map(n => n.textContent),
        descs: [...document.querySelectorAll('.tile-desc')].map(n => n.textContent),
        filters: [...document.querySelectorAll('.filter')].map(f => f.textContent),
        status: document.getElementById('status').textContent,
        buttons: ['alloff', 'editor'].map(k => document.getElementById(k).textContent.trim()),
        overflowing: wide,
        left: Math.round(pop.left), top: Math.round(pop.top)
    };
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({path: shotPath('popup-tr.png'), clip: {
    x: out.left, y: out.top, width: out.width, height: out.height
}});
stop();
