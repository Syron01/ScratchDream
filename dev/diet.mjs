// Proof for the load diet, measured in the live editors with instruments that are not our own
// code: every clearRect of the paint canvas and every pointermove the page is actually handed is
// counted from outside, and the network is read from Chrome's request log.
import path from 'node:path';
import {startExtension, shotPath} from './harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const run = await startExtension(path.join(ROOT, 'extension'));
const browser = run.browser;
const results = [];
const ok = (name, pass, extra) => {
    results.push({name, pass: Boolean(pass), extra});
    console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' · ' + JSON.stringify(extra)));
};

// a real window, or Chrome stops painting and every frame number is a lie
const bclient = {moved: false};

const COUNT = () => {
    window.__c = {paints: 0, frames: 0, moves: 0, sub: 0, pokes: {}};
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function () {
        if (this.canvas && /paper-canvas/.test(String(this.canvas.className))) window.__c.paints++;
        return clear.apply(this, arguments);
    };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (fn) {
        return raf.call(window, function (t) { window.__c.frames++; return fn(t); });
    };
    // the same six events the diet listens to, counted here so a lane that refuses to slow down
    // can be shown to be caused by events the page really received
    ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'wheel', 'click'].forEach(name => {
        window.__c.pokes[name] = 0;
        window.addEventListener(name, () => window.__c.pokes[name]++, {passive: true, capture: true});
    });
    window.addEventListener('pointermove', e => {
        window.__c.moves++;
        // what a folded pen leaves behind: the events Chrome hid inside the one it delivered
        window.__c.sub += e.getCoalescedEvents ? e.getCoalescedEvents().length : 0;
        if (e.target && /paper-canvas/.test(String(e.target.className))) window.__c.onCanvas++;
    }, {passive: true, capture: true});
    // the paint toolbar says nothing in its class names, but every icon is an inline svg that
    // carries its tool name in <title>. the editor also clips painting to the selection, so a
    // stroke that follows a marquee lands on the brush and still draws nothing until the
    // selection is cleared — which is why an earlier arm of this probe measured a phantom
    window.__native = () => {
        const grid = document.querySelector('[class*="paint-editor_mode-selector"]');
        if (!grid) return [];
        return [...grid.children].filter(e => /mod-tool-select/.test(String(e.className)) &&
            !e.classList.contains('adox-tool'));
    };
    window.__toolName = (e) => {
        const img = e && e.querySelector('img');
        if (!img || !img.src) return null;
        if (img.src.startsWith('data:')) {
            try { return (atob(img.src.split(',')[1]).match(/<title>(\w+)/) || [])[1] || null; }
            catch (err) { return null; }
        }
        return img.src.split('/').pop();
    };
    window.__pick = (name) => {
        const btn = window.__native().find(e => String(window.__toolName(e)).indexOf(name) === 0);
        if (!btn) return false;
        btn.click();
        window.paper.project.deselectAll();
        return true;
    };
    window.__selected = () => {
        const on = window.__native().find(e => /is-selected/.test(String(e.className)));
        return on ? window.__toolName(on) : null;
    };
    window.__drawing = () => ({items: window.paper.project.getItems({recursive: true}).length,
        svg: window.paper.project.exportSVG().innerHTML.length});
};

const openEditor = async (url, settle, paintTab) => {
    const page = await browser.newPage();
    await page.setViewport({width: 1440, height: 900});
    await page.evaluateOnNewDocument(COUNT);
    // a request that Chrome refused never downloads, so it cannot appear in a response event;
    // performance.getEntriesByType lists it anyway, which is what made an earlier run of this
    // probe read a successful block as a failure
    const nets = {asked: [], blocked: [], reached: []};
    const isTracker = u => /googletagmanager\.com|google-analytics\.com|doubleclick\.net/.test(u);
    page.on('request', r => { if (isTracker(r.url())) nets.asked.push(r.url().slice(0, 64)); });
    page.on('requestfailed', r => { if (isTracker(r.url())) nets.blocked.push(r.url().slice(0, 64)); });
    page.on('response', r => { if (isTracker(r.url())) nets.reached.push(r.url().slice(0, 64)); });
    const client = await page.target().createCDPSession();
    if (!bclient.moved) {
        const w = await client.send('Browser.getWindowForTarget');
        await client.send('Browser.setWindowBounds', {windowId: w.windowId, bounds: {left: 20, top: 20, width: 1450, height: 950, windowState: 'normal'}});
        bclient.moved = true;
    }
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).slice(0, 110)));
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
    await page.bringToFront();
    await wait(settle);
    // only the loop arms need the paint editor open; the network arm is a page load and the
    // scratch editor rewrites its own url under a tab click, which used to kill the run
    if (paintTab) {
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find(x => /costume|kost/i.test(x.textContent || ''));
            if (tab) tab.click();
        });
        await wait(6000);
    }
    return {page, errs, nets, client};
};

// ---------------------------------------------------------------- the popup switch
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${run.id}/popup.html`, {waitUntil: 'load'});
await wait(700);
const tileCount = await popup.evaluate(() => [...document.querySelectorAll('.tile')].map(t => t.dataset.id));
ok('1. the diet is a tile in the toolbar', tileCount.length === 9 && tileCount[tileCount.length - 1] === 'speed', tileCount);
ok('2. the Speed filter exists', await popup.evaluate(() => [...document.querySelectorAll('.filter')].length) === 5);

const setDiet = async (on) => {
    await popup.evaluate((want) => {
        const tile = document.querySelector('.tile[data-id="speed"]');
        const live = tile.querySelector('.switch').getAttribute('aria-checked') === 'true';
        if (live !== want) tile.querySelector('.switch').click();
    }, on);
    await wait(1200);
};
const rulesets = () => popup.evaluate(async () => (await chrome.declarativeNetRequest.getEnabledRulesets()));
const lane = (ms) => tw.page.evaluate(async (gap) => {
    const a = JSON.parse(JSON.stringify(window.__adoxDiet));
    const before = Object.assign({}, window.__c.pokes);
    await new Promise(r => setTimeout(r, gap));
    const b = JSON.parse(JSON.stringify(window.__adoxDiet));
    // the same events the diet's own touch listener answers to, counted over this sample window
    const pokes = {};
    for (const key in window.__c.pokes) {
        const grew = window.__c.pokes[key] - before[key];
        if (grew) pokes[key] = grew;
    }
    return {ticks: b.ticks - a.ticks, slow: b.slow - a.slow, fast: b.fast - a.fast,
        slept: b.slept - a.slept, lane: b.lane, hidden: document.hidden, pokes: pokes,
        perTickMs: Math.round((b.tickMs - a.tickMs) / Math.max(1, b.ticks - a.ticks) * 100) / 100};
}, ms);
// a lane measurement in a tab Chrome thinks it can hide measures the hiding, not the loop, so
// every sample starts by making the editor the front tab again
const visible = async () => {
    await tw.page.bringToFront();
    await wait(600);
    return tw.page.evaluate(() => document.visibilityState);
};

// ---------------------------------------------------------------- the loop lanes
const tw = await openEditor('https://turbowarp.org/editor', 13000, true);
const loop = await tw.page.evaluate(() => {
    const d = window.__adoxDiet;
    return {ran: d.ticks + d.slept > 0, counts: ['ticks', 'fast', 'slow', 'slept', 'lane']
        .every(key => typeof d[key] === 'number'), hidden: document.hidden};
});
ok('3. the editor is running the counted loop', loop.ran && loop.counts, loop);

// opening the tab, revealing the page and any stray pointer event is a touch, and the loop keeps
// the fast lane for 2.2 s after the last one on purpose — so the idle sample waits for a window
// that really has no events in it, and takes a second window if the first one was polluted
await setDiet(true);
await visible();
await wait(3000);
let idle = await lane(4000);
if (idle.fast > 0 || Object.keys(idle.pokes).length) {
    await wait(3000);
    idle = await lane(4000);
}
ok('4. an idle costume tab gets the slow lane, not a drumbeat',
    idle.ticks >= 1 && idle.ticks <= 3 && idle.slow >= 1 && idle.fast === 0 && idle.lane === 4
    && !idle.hidden && Object.keys(idle.pokes).length === 0, idle);

await setDiet(false);
await visible();
const flat = await lane(4000);
ok('5. the switch puts the flat 900 ms loop back', flat.ticks >= 4 && flat.lane === 9, flat);
await setDiet(true);

// ---------------------------------------------------------------- the repaint count
const stroke = async (label, atOnce, fy) => {
    const p = tw.page;
    await visible();
    const box = await p.evaluate(() => {
        const r = document.querySelector('canvas[class*="paper-canvas"]').getBoundingClientRect();
        return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
            w: r.width, h: r.height};
    });
    // the recipe measured arm by arm: one click on the site's brush button, paper's deselectAll,
    // a settle, and then the drag. clicking the button again once it is armed puts the editor's
    // own selection clip back and the stroke paints nothing, so there is no retry loop here
    await p.evaluate(() => window.__pick('brush'));
    await wait(250);
    const selected = await p.evaluate(() => window.__selected());
    // that same click opens our nib box. it used to sit on top of the art and swallow the stroke,
    // which an earlier run of this arm read as "the brush paints nothing"; the box is placed off
    // the canvas now, so nothing is dismissed here and the point the pen lands on is checked below
    await p.evaluate(() => {
        window.paper.project.deselectAll();
        window.paper.project.view.update();
        window.__c.paints = 0; window.__c.frames = 0; window.__c.moves = 0; window.__c.sub = 0;
        window.__c.onCanvas = 0;
        for (const key in window.__c.pokes) window.__c.pokes[key] = 0;
        window.__c.d0 = window.__drawing();
    });
    // fy is a fraction of the half-height, so both arms stay inside the canvas they are drawn on
    const x0 = box.x - Math.round(box.w * 0.28), y = Math.round(box.y + box.h * fy / 2);
    const hit = await p.evaluate((xx, yy) => {
        const e = document.elementFromPoint(xx, yy);
        return {under: String(e && e.className).slice(0, 28), panel: Boolean(document.querySelector('.adox-panel'))};
    }, x0, y);
    const ev = (type, x, yy, drag) => tw.client.send('Input.dispatchMouseEvent', {
        type: type, x: x, y: yy, pointerType: 'mouse',
        button: drag || type === 'mousePressed' ? 'left' : 'none',
        buttons: type === 'mouseReleased' ? 0 : drag ? 1 : 0,
        clickCount: type === 'mousePressed' ? 1 : 0
    });
    const sent = [];
    await ev('mouseMoved', x0, y);
    await ev('mousePressed', x0, y, true);
    for (let i = 1; i <= 60; i++) {
        const move = ev('mouseMoved', x0 + i * 4, y + Math.round(Math.sin(i / 5) * 18), true);
        // paced = one CDP roundtrip per move with a frame between them, the way a 60 Hz mouse
        // behaves; burst = every move pushed at once, the way a 500 Hz pen does
        if (atOnce) sent.push(move);
        else { await move; await wait(14); }
    }
    if (atOnce) await Promise.all(sent);
    await ev('mouseReleased', x0 + 240, y, true);
    await wait(500);
    const r = await p.evaluate(() => {
        const d = window.__drawing();
        return {paints: window.__c.paints, frames: window.__c.frames, moves: window.__c.moves,
            sub: window.__c.sub, onCanvas: window.__c.onCanvas || 0,
            items: d.items - window.__c.d0.items, svg: d.svg - window.__c.d0.svg,
            pokes: Object.assign({}, window.__c.pokes)};
    });
    console.log('   ' + label + ': ' + JSON.stringify(r) + ' · armed tool ' + selected +
        ' · pen landed on ' + hit.under + (hit.panel ? ' (panel still open!)' : '') + ' (60 moves sent)');
    return {selected, hit, ...r};
};

const paced = await stroke('paced stroke  ', false, -0.5);
ok('6. one delivered move costs one repaint, never more', paced.paints <= paced.moves + 2 && paced.moves >= 40,
    {paints: paced.paints, moves: paced.moves});

const burst = await stroke('burst stroke  ', true, 0.5);
ok('7. Chrome folds a fast pen into one event per frame before the page sees it',
    burst.moves < 60 && burst.sub > burst.moves,
    {delivered: burst.moves, foldedInto: burst.sub, sent: 60, paints: burst.paints});

await tw.page.screenshot({path: shotPath('diet-stroke.png')});
// the drawing is the vector model, not the pixels of one particular canvas: a stroke that reaches
// the paper project adds a path item and lengthens the export, and that is checked per arm
ok('8. the stroke really reached the drawing',
    paced.selected === 'brush' && burst.selected === 'brush'
        && /^paper-canvas/.test(paced.hit.under) && /^paper-canvas/.test(burst.hit.under)
        && paced.onCanvas >= 40 && burst.onCanvas >= 3
        && paced.items >= 1 && paced.svg > 0 && burst.items >= 1 && burst.svg > 0,
    {armed: [paced.selected, burst.selected], under: [paced.hit.under, burst.hit.under],
     onCanvas: [paced.onCanvas, burst.onCanvas],
     paced: {items: paced.items, svg: paced.svg}, burst: {items: burst.items, svg: burst.svg}});

const hidden = await tw.page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', {get: () => true, configurable: true});
    document.dispatchEvent(new Event('visibilitychange'));
    const a = window.__adoxDiet.ticks;
    await new Promise(r => setTimeout(r, 4000));
    const s = {grew: window.__adoxDiet.ticks - a, slept: window.__adoxDiet.slept};
    Object.defineProperty(document, 'hidden', {get: () => false, configurable: true});
    document.dispatchEvent(new Event('visibilitychange'));
    return s;
});
ok('9. a background tab gets no work at all', hidden.grew === 0, hidden);

// ---------------------------------------------------------------- the network cut
const scratchWith = async (dietOn) => {
    await setDiet(dietOn);
    const s = await openEditor('https://scratch.mit.edu/projects/editor/', 20000);
    const rules = await rulesets();
    console.log('   diet ' + (dietOn ? 'ON ' : 'OFF') + ': asked ' + s.nets.asked.length +
        ', blocked ' + s.nets.blocked.length + ', downloaded ' + s.nets.reached.length +
        ', rulesets ' + JSON.stringify(rules));
    await s.page.close();
    return {nets: s.nets, rules, errs: s.errs};
};
const withOff = await scratchWith(false);
const withOn = await scratchWith(true);
ok('10. Scratch really downloads analytics while the diet is off', withOff.nets.reached.length > 0,
    {asked: withOff.nets.asked.length, downloaded: withOff.nets.reached.length});
ok('11. the ruleset follows the switch', withOff.rules.indexOf('diet') < 0 && withOn.rules.indexOf('diet') >= 0,
    [withOff.rules, withOn.rules]);
ok('12. nothing analytics reaches Scratch with the diet on', withOn.nets.reached.length === 0,
    {asked: withOn.nets.asked.length, blocked: withOn.nets.blocked.length, downloaded: withOn.nets.reached});
ok('13. the editor still runs clean with the diet on', withOn.errs.length === 0, withOn.errs.slice(0, 3));

await tw.page.close();
await popup.close();
await browser.close();
run.child.kill();

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
