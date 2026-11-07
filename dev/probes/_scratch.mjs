import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
tab.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
await tab.setViewport({width: 1440, height: 900});
await tab.goto('https://scratch.mit.edu/projects/editor/', {waitUntil: 'networkidle2', timeout: 120000});
await wait(9000);
const state = await tab.evaluate(() => ({
    url: location.href,
    paint: !!document.querySelector('[class*="paint-editor_mode-selector"]'),
    tools: [...document.querySelectorAll('.adox-tool')].map(b => b.dataset.adoxKey)
}));
console.log('state', JSON.stringify(state));
if (!state.paint) {
    const opened = await tab.evaluate(() => {
        const t = [...document.querySelectorAll('[role="tab"]')].find(x => /costume|kostüm/i.test(x.textContent || ''));
        if (t) { t.click(); return t.textContent.trim(); }
        return null;
    });
    console.log('costume tab', opened);
    await wait(4000);
}
const after = await tab.evaluate(() => {
    const px = document.querySelector('.adox-px-btn');
    const row = document.querySelector('[class*="paint-editor_canvas-controls"]');
    return {
        paint: !!document.querySelector('[class*="paint-editor_mode-selector"]'),
        tools: [...document.querySelectorAll('.adox-tool')].map(b => b.dataset.adoxKey),
        rail: !!document.querySelector('.adox-rail'),
        board: !!document.querySelector('.adox-board-btn'),
        pixel: !!px,
        pixelInRow: px && row ? [...row.children].indexOf(px) : -1,
        pixelLabel: px ? px.textContent.trim() : null
    };
});
console.log('after', JSON.stringify(after));
if (after.pixel) {
    await tab.evaluate(() => document.querySelector('.adox-px-btn').click());
    await wait(1200);
    const px = await tab.evaluate(() => {
        const r = document.querySelector('.adox-px');
        if (!r) return null;
        const w = r.querySelector('.adox-px-win').getBoundingClientRect();
        return {
            open: true, win: [Math.round(w.width), Math.round(w.height)],
            tools: r.querySelectorAll('.adox-px-tool').length,
            active: r.querySelector('.adox-px-tool.adox-on').dataset.tool,
            checks: [...r.querySelectorAll('.adox-px-check input')].map(i => i.checked)
        };
    });
    console.log('pixel', JSON.stringify(px));
    await tab.screenshot({path: shotPath('scratch-pixel.png')});
    // draw one diagonal and apply: the output must reach the costume, not just the overlay
    const c = await tab.evaluate(() => {
        const r = document.querySelector('.adox-px-canvas').getBoundingClientRect();
        return {x: r.x, y: r.y, w: r.width, h: r.height};
    });
    await tab.mouse.move(c.x + c.w * .3, c.y + c.h * .3);
    await tab.mouse.down();
    await tab.mouse.move(c.x + c.w * .6, c.y + c.h * .6, {steps: 10});
    await tab.mouse.up();
    await wait(300);
    const thumbs = () => tab.evaluate(() => [...document.images]
        .map(i => i.src).filter(s => /^(blob:|data:image)/.test(s)).join('|'));
    const before = await thumbs();
    await tab.evaluate(() => document.querySelector('.adox-px-apply').click());
    await wait(1800);
    const after = await thumbs();
    console.log('applied', JSON.stringify({
        changed: before !== after,
        open: await tab.evaluate(() => !!document.querySelector('.adox-px')),
        thumbs: await tab.evaluate(() => [...document.images].filter(i => /^(blob:|data:image)/.test(i.src)).length)
    }));
    await tab.screenshot({path: shotPath('scratch-pixel-applied.png')});
}
// ERR_BLOCKED_BY_CLIENT is the expected one here: that is our own diet ruleset answering an
// analytics request on scratch.mit.edu, not the product failing
console.log('errors', JSON.stringify(errs.map(e =>
    /ERR_BLOCKED_BY_CLIENT/.test(e) ? e + ' (our diet ruleset)' : e)));
stop();
