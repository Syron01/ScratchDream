// Interaction pass without posting anything: the compose dialog must enable its button when both
// fields are filled, the reply box must wake on typing, a quote must land in the reply box, and
// the phone layout must not overflow.
import path from 'node:path';
import {startExtension} from '../harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'), {lang: 'tr-TR'});
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push('page: ' + String(e.message).slice(0, 200)));
await tab.setViewport({width: 1600, height: 1000});
await tab.goto('https://scratch.mit.edu/login/', {waitUntil: 'domcontentloaded', timeout: 120000});
await tab.evaluate(async (pw) => {
    const m = document.cookie.match(/scratchcsrftoken=([^;]+)/);
    const tok = m ? m[1] : '';
    await fetch('/login/', {
        method: 'POST', credentials: 'include', redirect: 'manual',
        headers: {'content-type': 'application/x-www-form-urlencoded', 'x-csrftoken': tok},
        body: new URLSearchParams({csrfmiddlewaretoken: tok, username: 'games-coder', password: pw})
    });
}, process.env.SD_PW || '');

await tab.goto('https://scratch.mit.edu/discuss/', {waitUntil: 'domcontentloaded', timeout: 120000});
await tab.waitForFunction(() => document.querySelectorAll('.x-item').length >= 5, {timeout: 30000}).catch(() => {});
await new Promise(r => setTimeout(r, 1200));
await tab.click('.x-cta');
await tab.waitForSelector('.x-dialog', {timeout: 5000}).catch(() => {});
console.log('dialog open:', await tab.evaluate(() => !!document.querySelector('.x-dialog')));

const typing = await tab.evaluate(() => {
    const dlg = document.querySelector('.x-dialog');
    if (!dlg) return null;
    const title = dlg.querySelector('.x-input');
    const text = dlg.querySelector('.x-textarea');
    title.value = 'Test başlığı';
    title.dispatchEvent(new Event('input', {bubbles: true}));
    text.value = 'Kısa bir deneme gövdesi.';
    text.dispatchEvent(new Event('input', {bubbles: true}));
    const send = dlg.querySelector('.x-send');
    const cs = getComputedStyle(send);
    return {disabled: send.disabled, matches: send.matches(':disabled'), bg: cs.backgroundColor, color: cs.color, counter: dlg.querySelector('.x-count').textContent};
});
console.log('compose after typing:', typing);
await tab.screenshot({path: path.join(ROOT, 'dev/out/qa-compose-filled.png')});
await tab.keyboard.press('Escape');

await tab.goto('https://scratch.mit.edu/discuss/topic/860046/', {waitUntil: 'domcontentloaded', timeout: 120000});
await tab.waitForFunction(() => document.querySelectorAll('.x-post').length >= 3, {timeout: 30000}).catch(() => {});
await new Promise(r => setTimeout(r, 1200));
const reply = await tab.evaluate(() => {
    const ta = document.getElementById('x-reply');
    const send = document.querySelector('.x-replytop .x-send');
    if (!ta || !send) return null;
    ta.value = 'Deneme yanıtı';
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    return {beforeDisabled: false, disabled: send.disabled, bg: getComputedStyle(send).backgroundColor};
});
console.log('reply after typing:', reply);

const quoted = await tab.evaluate(() => {
    const btn = document.querySelector('.x-post .x-actions button');
    const ta = document.getElementById('x-reply');
    if (!btn || !ta) return null;
    btn.click();
    return new Promise(res => setTimeout(() => res(ta.value.slice(0, 90)), 400));
});
console.log('quote text:', JSON.stringify(quoted));

await tab.setViewport({width: 390, height: 844});
for (let i = 0; i < 3; i++) { try { await tab.goto('https://scratch.mit.edu/discuss/', {waitUntil: 'domcontentloaded', timeout: 120000}); break; } catch (e) { await new Promise(r => setTimeout(r, 800)); } }
await tab.waitForFunction(() => document.querySelectorAll('.x-item').length >= 5, {timeout: 30000}).catch(() => {});
await new Promise(r => setTimeout(r, 1200));
console.log('mobile:', await tab.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    side: getComputedStyle(document.querySelector('.x-side')).display,
    tabs: getComputedStyle(document.querySelector('.x-home-tabs')).display,
    mobnav: getComputedStyle(document.querySelector('.x-mobnav')).display,
    itemW: Math.round(document.querySelector('.x-item').getBoundingClientRect().width)
})));
await tab.screenshot({path: path.join(ROOT, 'dev/out/qa-mobile.png')});
console.log('errors:', errs.length ? errs : 'none');
stop();
