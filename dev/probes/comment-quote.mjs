// Proves the comment quote button on the real scratch.mit.edu page: one Quote control per
// comment, and clicking it opens the native reply box with the snippet already in the textarea.
// The comment API is unreachable from this network, so the probe injects the exact markup the
// deployed projects bundle renders for a comment (verified against /js/projects.bundle.js).
// If a live comment composer exists (logged-in profile), the same native-setter/input path is
// additionally proven against Scratch's real React state through its character counter.
import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const tab = await browser.newPage();
await tab.setViewport({width: 1400, height: 900});
// optional: a Scratch login is only needed for the live React check, never for the quote itself
if (process.env.SCRATCH_USER) {
    await tab.goto('https://scratch.mit.edu/login/', {waitUntil: 'networkidle2', timeout: 120000});
    await tab.type('#id_username', process.env.SCRATCH_USER);
    await tab.type('#id_password', process.env.SCRATCH_PASS);
    await tab.evaluate(() => document.querySelector('#id_username').form.requestSubmit());
    await wait(5000);
}
await tab.goto('https://scratch.mit.edu/projects/10128407/', {waitUntil: 'networkidle2', timeout: 120000});
await wait(8000);

const real = await tab.evaluate(() => document.querySelectorAll('.comment-bottom-row .comment-reply').length);
if (!real) {
    await tab.evaluate(() => {
        const list = document.querySelector('.comments-list') || document.body;
        list.innerHTML = `
          <div class="flex-row comment" id="comments-1">
            <div class="comment-body column">
              <div class="comment-top-row"><a class="username">PhilHub</a></div>
              <div class="comment-bubble"><span class="comment-content">Lol that doesn't work. It needs to add up to 100%</span>
                <div class="comment-bottom-row"><span class="comment-time">4 days ago</span><span class="comment-reply">Reply</span></div>
              </div>
            </div>
          </div>
          <div class="flex-row comment" id="comments-2">
            <div class="comment-body column">
              <div class="comment-top-row"><a class="username">DebugDungeon</a></div>
              <div class="comment-bubble"><span class="comment-content">${'Colors are changing in some places which is probably cause ai is not perfect '.repeat(3)}</span>
                <div class="comment-bottom-row"><span class="comment-time">4 days ago</span><span class="comment-reply">Reply</span></div>
              </div>
            </div>
          </div>`;
        list.querySelectorAll('.comment-reply').forEach(reply => reply.addEventListener('click', () => {
            const comment = reply.closest('.comment');
            if (comment.querySelector('.comment-reply-row')) return;
            const box = document.createElement('div');
            box.className = 'comment-reply-row';
            box.innerHTML = '<div class="compose-input"><textarea class="inplace-textarea"></textarea></div>' +
                '<div class="compose-bottom-row"><button class="button compose-cancel">Cancel</button>' +
                '<span class="compose-limit">500 characters left</span></div>';
            comment.appendChild(box);
        }));
    });
    await wait(500);
}

const buttons = await tab.evaluate(() => [...document.querySelectorAll('.sd-quote')].map(b => b.textContent));
const short = await tab.evaluate(async () => {
    document.querySelectorAll('.sd-quote')[0].click();
    await new Promise(r => setTimeout(r, 400));
    const box = document.querySelectorAll('.comment-reply-row textarea')[0];
    return box && {value: box.value, caret: box.selectionStart, focused: document.activeElement === box};
});
const long = await tab.evaluate(async () => {
    document.querySelectorAll('.sd-quote')[1].click();
    await new Promise(r => setTimeout(r, 400));
    const box = document.querySelectorAll('.comment-reply-row textarea')[1];
    return box && {value: box.value, len: box.value.length, ellipsis: box.value.endsWith('\u2026"\n\n')};
});
// profiles still serve the legacy Django comment markup, with its reply form loaded by AJAX
const legacy = await tab.evaluate(async () => {
    const host = document.querySelector('.comments-list') || document.body;
    host.innerHTML = '<div id="comments"><div class="comment" data-comment-id="1"><div class="info">' +
        '<div class="name"><a>MAGAMANY</a></div><div class="content">bro naptın ya</div>' +
        '<div><span class="time">16 days ago</span><a class="reply"><span>Reply</span></a></div>' +
        '<div data-content="reply-form"></div></div></div></div>';
    const comment = host.querySelector('.comment');
    comment.querySelector('a.reply').addEventListener('click', () => {
        comment.querySelector('[data-content="reply-form"]').innerHTML =
            '<form><textarea name="content"></textarea></form>';
    });
    await new Promise(r => setTimeout(r, 300));
    const button = comment.querySelector('.sd-quote');
    if (!button) return null;
    button.click();
    await new Promise(r => setTimeout(r, 500));
    const box = comment.querySelector('[data-content="reply-form"] textarea');
    return box && {value: box.value, caret: box.selectionStart, focused: document.activeElement === box};
});
const react = await tab.evaluate(() => {
    const box = document.querySelector('.comments-root-reply textarea.inplace-textarea');
    const limit = document.querySelector('.comments-root-reply .compose-limit');
    if (!box || !limit) return null;
    const before = limit.textContent.trim();
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(box, 'x'.repeat(490));
    box.dispatchEvent(new Event('input', {bubbles: true}));
    return new Promise(r => setTimeout(() => r({before, after: limit.textContent.trim()}), 400));
});
await tab.screenshot({path: shotPath('comment-quote.png')});
console.log(JSON.stringify({real, buttons, short, long, legacy, react}, null, 2));
stop();
