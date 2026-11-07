// Captures the screenshots used by README.md and docs/index.html.
// Runs a real Chrome with the unpacked extension against the live TurboWarp editor.
import fs from 'node:fs';
import path from 'node:path';
import {startExtension} from './harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const EXT_DIR = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'docs', 'assets');
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, {recursive: true});

const {browser, id, stop} = await startExtension(EXT_DIR);
console.log('extension', id);

const save = async (page, name, opts) => {
    await page.screenshot({path: path.join(OUT, name), ...(opts || {})});
    console.log('saved', name);
};

const savePanel = async (page, name, selector, pad = 24) => {
    const box = await page.evaluate((sel, gap) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            x: Math.max(0, Math.floor(r.x - gap)),
            y: Math.max(0, Math.floor(r.y - gap)),
            width: Math.ceil(r.width + gap * 2),
            height: Math.ceil(r.height + gap * 2)
        };
    }, selector, pad);
    if (box) await save(page, name, {clip: box});
};

try {
    // ---------------------------------------------------------------- toolbar popup
    const popup = await browser.newPage();
    await popup.setViewport({width: 420, height: 620, deviceScaleFactor: 2});
    await popup.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
    await popup.goto(`chrome-extension://${id}/popup.html`, {waitUntil: 'load'});
    await wait(800);
    const popupBox = await popup.evaluate(() => {
        const r = document.querySelector('.popup').getBoundingClientRect();
        return {x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height)};
    });
    await save(popup, 'popup.png', {clip: popupBox});

    // ---------------------------------------------------------------- live costume editor
    const tab = await browser.newPage();
    await tab.setViewport({width: 1440, height: 900, deviceScaleFactor: 1});
    await tab.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
    await tab.goto('https://turbowarp.org/editor', {waitUntil: 'networkidle2', timeout: 120000});
    await wait(3500);
    await tab.keyboard.press('Escape');
    for (let i = 0; i < 60; i++) {
        await wait(250);
        const ready = await tab.evaluate(() => {
            const tabs = document.querySelectorAll('[role="tab"]');
            if (tabs.length > 1) tabs[1].click();
            return document.querySelectorAll('.adox-tool').length === 4 &&
                !!document.querySelector('.adox-rail') && !!document.querySelector('.adox-board-btn') &&
                !!document.querySelector('.adox-px-btn');
        });
        if (ready) break;
    }
    await wait(900);
    await save(tab, 'editor.png');

    // shapes panel
    await tab.evaluate(() => document.querySelector('[data-adox-key="shapes"]').click());
    await wait(1600);
    await savePanel(tab, 'shapes.png', '.adox-panel');
    await tab.evaluate(() => document.querySelector('.adox-close').click());
    await wait(250);

    // advanced (mask / blend / PNG) panel
    await tab.evaluate(() => document.querySelector('[data-adox-key="fx"]').click());
    await wait(1600);
    await savePanel(tab, 'fx.png', '.adox-panel');
    await tab.evaluate(() => document.querySelector('.adox-close').click());
    await wait(250);

    // layer rail pinned open
    await tab.evaluate(() => {
        const rail = document.querySelector('.adox-rail');
        if (rail) rail.classList.add('adox-pin');
    });
    await wait(500);
    await save(tab, 'layers.png');
    await tab.evaluate(() => {
        const rail = document.querySelector('.adox-rail');
        if (rail) rail.classList.remove('adox-pin');
    });
    await wait(250);

    // animation anchor: a second costume with a deliberately offset pivot, so the panel
    // shows the real problem (a costume swap that makes the drawing jump)
    await tab.evaluate(async () => {
        if (window.vm && window.vm.editingTarget) {
            await window.vm.duplicateCostume(0);
            const t = window.vm.editingTarget;
            const cs = t.getCostumes();
            if (cs.length > 1) {
                cs[1].rotationCenterX = Number(cs[1].rotationCenterX) + 12;
                cs[1].rotationCenterY = Number(cs[1].rotationCenterY) + 8;
            }
        }
    });
    await wait(800);
    await tab.evaluate(() => document.querySelector('[data-adox-key="anchor"]').click());
    await wait(1800);
    await savePanel(tab, 'anchor.png', '.adox-panel');
    await tab.evaluate(() => {
        const p = document.querySelector('.adox-panel .adox-close');
        if (p) p.click();
    });
    await wait(250);

    // plan board with a few realistic cards
    await tab.evaluate(() => new Promise(res => {
        document.querySelector('.adox-board-btn').click();
        const panel = document.querySelector('.adox-board');
        const add = (index, title, note) => {
            let cols = panel.querySelectorAll('.adox-bcol');
            const col = cols[index];
            if (!col) return;
            const plus = col.querySelector('.adox-badd');
            if (plus) plus.click();
            cols = panel.querySelectorAll('.adox-bcol');
            const cards = cols[index].querySelectorAll('.adox-bcard');
            const card = cards[cards.length - 1];
            if (!card) return;
            const t = card.querySelector('.adox-ctitle');
            if (t) { t.value = title; t.dispatchEvent(new Event('input', {bubbles: true})); }
            const n = card.querySelector('textarea:not(.adox-ctitle)');
            if (n) { n.value = note; n.dispatchEvent(new Event('input', {bubbles: true})); }
        };
        add(0, 'Cat walk cycle', '8 frames · shared anchor');
        add(0, 'Pixel UI icons', '16 px grid, no anti-aliasing');
        add(1, 'Costume swap jitter', 'Measure pivot, apply the fix');
        add(1, 'Mask the badge', 'Keep it inside the shield');
        add(2, 'Transparent PNG', '4× export for the shop page');
        setTimeout(res, 800);
    }));
    await save(tab, 'board.png');
    await tab.evaluate(() => document.querySelector('.adox-board .adox-close').click());
    await wait(250);

    // vector pixel editor (its own window over the costume editor)
    await tab.evaluate(() => document.querySelector('.adox-px-btn').click());
    for (let i = 0; i < 40; i++) {
        await wait(250);
        const open = await tab.evaluate(() => !!document.querySelector('.adox-px-canvas'));
        if (open) break;
    }
    await wait(900);
    await save(tab, 'pixel-editor.png');
    const pxBox = await tab.evaluate(() => {
        const w = document.querySelector('.adox-px-win');
        if (!w) return null;
        const r = w.getBoundingClientRect();
        return {x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height)};
    });
    if (pxBox) await save(tab, 'pixel-window.png', {clip: pxBox});
    await tab.evaluate(() => {
        const c = document.querySelector('.adox-px-cancel');
        if (c) c.click();
    });
    await wait(250);

    // the same editor in a dark theme, to show that the boxes borrow the editor's own colours
    await tab.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'dark'}]);
    await wait(800);
    await tab.evaluate(() => document.querySelector('[data-adox-key="fx"]').click());
    await wait(1600);
    await savePanel(tab, 'fx-dark.png', '.adox-panel');
    await tab.evaluate(() => document.querySelector('.adox-close').click());
    await wait(400);
    await save(tab, 'editor-dark.png');
} finally {
    stop();
}
