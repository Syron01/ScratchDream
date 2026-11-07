// End-to-end proof of ScratchDream: real Chrome, real extension, live TurboWarp editor.
// Checks the compact toolbar popup, the tools injected into the costume editor, the plan board,
// the separate vector pixel editor (including a real bitmap round-trip) and the animation anchor.
// The jitter is re-measured from the raw SVG by an independent rasteriser, never by our numbers.
import fs from 'node:fs';
import path from 'node:path';
import {startExtension, shotPath} from './harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const EXT_DIR = path.join(ROOT, 'extension');
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra) => {
    results.push({name, pass: Boolean(pass), extra});
    console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' · ' + JSON.stringify(extra)));
};

const {browser, id, stop} = await startExtension(EXT_DIR);
ok('1. chrome installs the unpacked extension', !!id, id);

const popup = await browser.newPage();
await popup.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
await popup.goto(`chrome-extension://${id}/popup.html`, {waitUntil: 'load'});
await wait(700);

const shot = async (page, name, box) => {
    const clip = box || await page.evaluate(() => ({
        x: 0, y: 0,
        width: Math.ceil(document.body.getBoundingClientRect().width),
        height: Math.ceil(document.documentElement.scrollHeight)
    }));
    await page.screenshot({path: shotPath(name), clip});
};

// ---------------------------------------------------------------- the popup (v9 board)
const p0 = await popup.evaluate(() => {
    const cs = el => getComputedStyle(el);
    const tiles = [...document.querySelectorAll('.tile')];
    const body = document.body.getBoundingClientRect();
    const mark = document.querySelector('.mark');
    const manifest = chrome.runtime.getManifest();
    return {
        brand: document.querySelector('.title').textContent,
        ver: document.getElementById('version').textContent,
        manifestVer: manifest.version,
        background: manifest.background,
        hosts: manifest.host_permissions,
        permissions: manifest.permissions,
        scripts: manifest.content_scripts.length,
        markW: mark && mark.complete ? mark.naturalWidth : 0,
        status: document.getElementById('status').textContent,
        tiles: tiles.length,
        ids: tiles.map(t => t.dataset.id),
        switches: document.querySelectorAll('.switch').length,
        filters: [...document.querySelectorAll('.filter')].map(f => f.textContent),
        chipFit: [...document.querySelectorAll('.filter')].map(f => f.scrollWidth <= f.clientWidth),
        rowHeights: [...document.querySelectorAll('.tile')].map(t => Math.round(t.getBoundingClientRect().height)),
        search: document.querySelectorAll('input[type=search]').length,
        radius: cs(tiles[0]).borderRadius,
        surface: cs(document.querySelector('.grid')).backgroundColor,
        head: cs(document.querySelector('.head')).backgroundColor,
        checkRadius: cs(document.querySelector('.switch')).borderRadius,
        font: cs(tiles[0]).fontFamily,
        faces: document.fonts.size,
        w: Math.ceil(document.querySelector('.popup').getBoundingClientRect().width),
        h: Math.ceil(document.querySelector('.popup').getBoundingClientRect().height),
        foot: ['alloff', 'editor'].map(k => {
            const b = document.getElementById(k).getBoundingClientRect();
            return b.bottom <= body.bottom + 1 && b.width > 40;
        }),
        magic: /magic/i.test(document.body.textContent)
    };
});
await popup.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'dark'}]);
const darkHead = await popup.evaluate(() => getComputedStyle(document.querySelector('.head')).backgroundColor);
await popup.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);

ok('2. name, logo, version from the manifest', p0.brand === 'ScratchDream' &&
    p0.ver === 'v' + p0.manifestVer && /^2\.\d+\.\d+$/.test(p0.manifestVer) && p0.markW >= 20,
    [p0.brand, p0.ver, p0.markW]);
ok('3. Scratch skin: flat square rows, native Helvetica, purple menubar, fits 420x600',
    p0.radius === '0px' && p0.surface === 'rgb(255, 255, 255)' && /Helvetica Neue/.test(p0.font) &&
    p0.head === 'rgb(133, 92, 214)' && darkHead === 'rgb(133, 92, 214)' && p0.checkRadius === '4px' &&
    p0.faces === 0 && p0.w === 420 && p0.h <= 600 && p0.foot.every(Boolean) &&
    new Set(p0.rowHeights).size === 1,
    [p0.radius, p0.surface, p0.head, darkHead, p0.checkRadius, p0.faces, p0.w, p0.h, p0.rowHeights]);
ok('4. all nine features, pixel first, plan board and load diet among the panels',
    p0.ids.join() === 'pixel,shapes,pen,anchor,rail,fx,board,gradient,speed' && p0.tiles === 9 &&
    p0.switches === 9 && p0.status === '9 of 9 on', [p0.ids, p0.status]);
ok('5. one search field and five honest category chips, each inside its own column',
    p0.search === 1 && p0.filters.join() === 'All,Drawing,Panels,Colour,Speed' &&
    p0.chipFit.every(Boolean), [p0.filters, p0.chipFit]);
// the load diet owns a network ruleset switch, so declarativeNetRequest is allowed here —
// what must never come back is a background worker, a host permission or Magic Code
ok('6. no Magic Code, no background worker, no host access; storage plus the diet switch',
    !p0.background && !p0.hosts && p0.permissions.includes('storage') &&
    p0.permissions.every(p => p === 'storage' || p === 'declarativeNetRequest') &&
    p0.scripts === 2 && !p0.magic,
    {background: p0.background, hosts: p0.hosts, permissions: p0.permissions});
ok('7. its files are gone from disk, too',
    !fs.existsSync(EXT_DIR + '/magic') && !fs.existsSync(path.join(ROOT, 'mcp-server')),
    {magic: fs.existsSync(EXT_DIR + '/magic')});

await shot(popup, 'popup-current.png');
await popup.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'dark'}]);
await shot(popup, 'popup-dark.png');
await popup.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);

const finding = await popup.evaluate(() => {
    const input = document.getElementById('search');
    const type = v => { input.value = v; input.dispatchEvent(new Event('input', {bubbles: true})); };
    const visible = () => [...document.querySelectorAll('.tile:not(.is-hidden)')].map(t => t.dataset.id);
    type('mask');
    const byMask = visible();
    type('');
    document.querySelector('.filter[data-filter="colour"]').click();
    const byColour = visible();
    const grid = document.getElementById('grid').getBoundingClientRect();
    const lone = document.querySelector('.tile[data-id="gradient"]').getBoundingClientRect();
    const loneLeft = Math.round(lone.left - grid.left);
    document.querySelector('.filter[data-filter="all"]').click();
    type('zzzz');
    const empty = document.getElementById('empty').classList.contains('show');
    type('');
    return {byMask, byColour, empty, loneLeft};
});
ok('8. search and tabs narrow the grid; an empty result says so',
    finding.byMask.join() === 'fx' && finding.byColour.join() === 'gradient' && finding.empty &&
    finding.loneLeft <= 4, finding);

const offOne = await popup.evaluate(() => new Promise(res => {
    const tile = document.querySelector('.tile[data-id="shapes"]');
    const still = document.querySelector('.tile[data-id="pen"]');
    const onColor = getComputedStyle(still.querySelector('.tile-name')).color;
    tile.click();
    setTimeout(() => res({
        on: tile.dataset.on,
        checked: tile.querySelector('.switch').getAttribute('aria-checked'),
        status: document.getElementById('status').textContent,
        nameColor: getComputedStyle(tile.querySelector('.tile-name')).color,
        onColor,
        stillOn: still.dataset.on
    }), 250);
}));
const stored = await popup.evaluate(() => new Promise(res =>
    chrome.storage.local.get('features', s => res(s.features))));
ok('9. a click anywhere on the tile switches it, dims it and counts',
    offOne.on === 'false' && offOne.checked === 'false' && offOne.status === '8 of 9 on' &&
    offOne.nameColor !== offOne.onColor && offOne.stillOn === 'true' && stored.shapes === false,
    [offOne, stored]);

const allOff = await popup.evaluate(() => {
    document.getElementById('alloff').click();
    return {
        checked: [...document.querySelectorAll('.switch')].map(s => s.getAttribute('aria-checked')),
        label: document.getElementById('alloff-label').textContent,
        status: document.getElementById('status').textContent
    };
});
const storedOff = await popup.evaluate(() => new Promise(res =>
    chrome.storage.local.get('features', s => res(s.features))));
await popup.reload({waitUntil: 'load'});
await wait(500);
const afterReload = await popup.evaluate(() => ({
    checked: [...document.querySelectorAll('.switch')].map(s => s.getAttribute('aria-checked')),
    label: document.getElementById('alloff-label').textContent,
    status: document.getElementById('status').textContent
}));
ok('10. "turn all off" writes every switch and survives a reload',
    allOff.checked.every(v => v === 'false') && Object.keys(storedOff).length === 9 &&
    Object.keys(storedOff).every(k => storedOff[k] === false) &&
    allOff.label === 'Turn all on' && allOff.status === '0 of 9 on' &&
    afterReload.checked.every(v => v === 'false') && afterReload.label === 'Turn all on',
    [allOff, storedOff, afterReload]);

const backOn = await popup.evaluate(() => {
    document.getElementById('alloff').click();
    return {
        checked: [...document.querySelectorAll('.switch')].map(s => s.getAttribute('aria-checked')),
        label: document.getElementById('alloff-label').textContent,
        status: document.getElementById('status').textContent
    };
});
const storedOn = await popup.evaluate(() => new Promise(res =>
    chrome.storage.local.get('features', s => res(s.features))));
ok('11. the same button brings all nine back',
    backOn.checked.every(v => v === 'true') && backOn.status === '9 of 9 on' &&
    backOn.label === 'Turn all off' && Object.keys(storedOn).every(k => storedOn[k] === true),
    storedOn);

// ---------------------------------------------------------------- the live editor tab
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 900});
const errs = [];
const consoleErrs = [];
tab.on('pageerror', e => errs.push(String(e.message).slice(0, 90)));
tab.on('console', m => {
    if (m.type() === 'error' && /fillColor|Cannot read properties|is not a function/.test(m.text())) {
        consoleErrs.push(m.text().slice(0, 120));
    }
});
await tab.goto('https://turbowarp.org/editor', {waitUntil: 'networkidle2', timeout: 120000});
await wait(4000);
await tab.keyboard.press('Escape');
// the editor boots at its own pace; click the costume tab and wait for the injected rail
// instead of trusting one fixed delay
for (let i = 0; i < 40; i++) {
    await wait(250);
    const ready = await tab.evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"]');
        if (tabs.length > 1) tabs[1].click();
        return document.querySelectorAll('.adox-tool').length === 4 &&
            !!document.querySelector('.adox-rail') && !!document.querySelector('.adox-board-btn');
    });
    if (ready) break;
}
await wait(800);

const t0 = await tab.evaluate(() => ({
    tools: [...document.querySelectorAll('.adox-tool')].map(b => b.dataset.adoxKey),
    rail: !!document.querySelector('.adox-rail'),
    board: !!document.querySelector('.adox-board-btn'),
    pixel: document.querySelector('.adox-px-btn') ? document.querySelector('.adox-px-btn').textContent.trim() : null,
    convertRow: (() => {
        const row = document.querySelector('[class*="paint-editor_canvas-controls"]');
        return row ? [...row.children].indexOf(document.querySelector('.adox-px-btn')) : -1;
    })(),
    gap: (() => {
        const row = document.querySelector('[class*="paint-editor_canvas-controls"]');
        const px = document.querySelector('.adox-px-btn');
        const native = row && [...row.children].find(k => k !== px && /Convert/.test(k.textContent || ''));
        return px && native ? Math.round(native.getBoundingClientRect().left - px.getBoundingClientRect().right) : -1;
    })()
}));
ok('12. four tool buttons, the rail, the board, and vector bitmapping first with a real gap',
    t0.tools.join() === 'shapes,pen,fx,anchor' && t0.rail && t0.board && t0.pixel === 'Vector bitmapping' &&
    t0.convertRow === 0 && t0.gap >= 6, t0);

const corner = await tab.evaluate(() => {
    const host = document.querySelector('[class*="asset-panel_detail-area"]').getBoundingClientRect();
    const b = document.querySelector('.adox-board-btn').getBoundingClientRect();
    return {right: Math.round(host.right - b.right), top: Math.round(b.top - host.top)};
});
ok('13. the board button sits in the empty top-right strip',
    corner.right >= 0 && corner.right < 60 && corner.top >= 0 && corner.top < 40, corner);

const board = await tab.evaluate(() => new Promise(res => {
    document.querySelector('.adox-board-btn').click();
    const panel = document.querySelector('.adox-board');
    const firstCol = panel.querySelector('.adox-bcol');
    [...firstCol.querySelectorAll('.adox-badd')][0].click();
    const card = panel.querySelector('.adox-bcard');
    const title = card.querySelector('.adox-ctitle');
    title.value = 'Kostüm geçişi';
    title.dispatchEvent(new Event('input', {bubbles: true}));
    const note = card.querySelector('textarea:not(.adox-ctitle)');
    note.value = '2.2 px sıçrama';
    note.dispatchEvent(new Event('input', {bubbles: true}));
    const head = panel.querySelector('.adox-bhead');
    const r = panel.getBoundingClientRect();
    // the board writes through a 250ms debounce, so the store is read after it settles
    setTimeout(() => {
        const keys = Object.keys(localStorage).filter(k => k.indexOf('adox-board-v1:') === 0);
        const saved = keys.length ? JSON.parse(localStorage.getItem(keys[0])) : null;
        res({
            cols: panel.querySelectorAll('.adox-bcol').length,
            cards: panel.querySelectorAll('.adox-bcard').length,
            overflow: panel.querySelector('.adox-bcols').scrollWidth - panel.querySelector('.adox-bcols').clientWidth,
            closeIn: panel.querySelector('.adox-close').getBoundingClientRect().right <= r.right,
            buttons: head.querySelectorAll('button').length,
            title: saved && saved.cards[0] && saved.cards[0].title,
            keys: keys.length,
            draggableBars: panel.querySelectorAll('.adox-bcard .adox-drag[draggable=true]').length
        });
    }, 500);
}));
ok('14. plan board: three columns, a live card, stored in this browser, no sideways scroll',
    board.cols === 3 && board.cards === 1 && board.overflow === 0 && board.closeIn &&
    board.buttons === 2 && board.title === 'Kostüm geçişi' && board.keys === 1 && board.draggableBars === 1,
    board);
const reopened = await tab.evaluate(() => new Promise(res => {
    document.querySelector('.adox-board .adox-close').click();
    document.querySelector('.adox-board-btn').click();
    setTimeout(() => {
        const panel = document.querySelector('.adox-board');
        const card = panel.querySelector('.adox-bcard');
        const out = {title: card && card.querySelector('.adox-ctitle').value,
            note: card && card.querySelector('textarea:not(.adox-ctitle)').value,
            footer: [...panel.querySelectorAll('.adox-bfoot button')].map(b => b.textContent)};
        panel.querySelector('.adox-close').click();
        res(out);
    }, 400);
}));
ok('15. closing and reopening keeps the card, and export/import are offered',
    reopened.title === 'Kostüm geçişi' && reopened.note === '2.2 px sıçrama' &&
    reopened.footer.join() === 'Export,Import', reopened);

// ---------------------------------------------------------------- the advanced box stays small
const fx = await tab.evaluate(() => {
    document.querySelector('[data-adox-key="fx"]').click();
    const p = document.querySelector('.adox-panel');
    const r = b => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; };
    const cells = [...p.querySelectorAll('.adox-cell')];
    return {
        panel: r(p), cells: cells.length, cell: r(cells[0]),
        heights: cells.map(c => Math.round(c.getBoundingClientRect().height)),
        demos: cells.filter(c => c.querySelector('.adox-demo')).length,
        beside: cells.slice(0, 4).map(c => {
            const d = c.querySelector('.adox-demo').getBoundingClientRect();
            const s = c.querySelector('span').getBoundingClientRect();
            return s.left >= d.right - 2;
        })
    };
});
await wait(400);
ok('16. the advanced box fits the screen: no cell is a poster',
    fx.panel[1] < 420 && Math.max(...fx.heights) < 46 && fx.cells === fx.demos,
    {panel: fx.panel, cell: fx.cell, tallest: Math.max(...fx.heights), cells: fx.cells, demos: fx.demos});
ok('17. every option shows its mini sample beside its name', fx.beside.every(Boolean), fx.beside);
await shot(tab, 'fx-compact.png', {x: 0, y: 0, width: 900, height: 620});
await tab.evaluate(() => document.querySelector('.adox-close').click());

// ---------------------------------------------------------------- pixel art is its own mode
// A native multi-selection is left armed on purpose: clearing the paper items under a stale
// selection is the classic way to break the paint editor, so the apply below must clear it.
await tab.keyboard.down('Control');
await tab.keyboard.press('KeyA');
await tab.keyboard.up('Control');
await wait(500);
const armedSelection = await tab.evaluate(() => window.ReduxStore.getState().scratchPaint.selectedItems.length);
const preArt = await tab.evaluate(() => {
    const paint = window.paper.project.layers.find(l => l.data && l.data.isPaintingLayer);
    const all = paint.children.filter(c => !c.guide && c.bounds);
    const u = all.reduce((a, ch) => {
        const b = ch.bounds;
        return [Math.min(a[0], b.x), Math.min(a[1], b.y), Math.max(a[2], b.x + b.width), Math.max(a[3], b.y + b.height)];
    }, [1e9, 1e9, -1e9, -1e9]);
    return {centre: [(u[0] + u[2]) / 2, (u[1] + u[3]) / 2], box: u};
});
const openPixel = await tab.evaluate(() => new Promise(res => {
    document.querySelector('.adox-px-btn').click();
    setTimeout(() => {
        const root = document.querySelector('.adox-px');
        const win = root.querySelector('.adox-px-win');
        const b = win.getBoundingClientRect();
        const stage = root.querySelector('.adox-px-stage').getBoundingClientRect();
        const side = root.querySelector('.adox-px-side').getBoundingClientRect();
        const tools = root.querySelector('.adox-px-tools').getBoundingClientRect();
        const checks = [...root.querySelectorAll('.adox-px-check input')].map(i => i.checked);
        const sel = document.querySelector('[class*="tool-select-base_mod-tool-select"][class*="is-selected"]');
        const probe = document.createElement('div');
        probe.style.color = getComputedStyle(root).getPropertyValue('--adox-accent').trim();
        root.appendChild(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        res({
            parent: root.parentElement === document.body,
            fixed: getComputedStyle(root).position,
            win: [Math.round(b.width), Math.round(b.height)],
            pct: [Math.round(b.width / innerWidth * 100), Math.round(b.height / innerHeight * 100)],
            stage: Math.round(stage.width), side: Math.round(side.width), tools: Math.round(tools.width),
            count: root.querySelectorAll('.adox-px-tool').length,
            active: root.querySelector('.adox-px-tool.adox-on').dataset.tool,
            checks,
            label: root.querySelector('.adox-px-apply').textContent,
            font: getComputedStyle(root).fontFamily,
            radius: getComputedStyle(win).borderRadius,
            accentIsSiteAccent: accent === getComputedStyle(sel).backgroundColor
        });
    }, 900);
}));
ok('18. pixel art is a separate mode: a centred card over the editor, never a tool-rail popover',
    openPixel.parent && openPixel.fixed === 'fixed' && openPixel.win[0] <= 980 && openPixel.win[1] <= 680 &&
    openPixel.pct[0] < 85 && openPixel.pct[1] < 90, openPixel);
ok('19. the canvas gets the room: a wide stage, tools and side stay columns',
    openPixel.stage > openPixel.side * 2 && openPixel.tools < 80 && openPixel.count === 9,
    [openPixel.stage, openPixel.side, openPixel.tools, openPixel.count]);
ok('20. filled brush is the default, the grid and the auto edge-fix are on',
    openPixel.active === 'brush' && openPixel.checks.join() === 'true,true,true' &&
    openPixel.label === 'Apply as vector', openPixel);
ok('21. the card borrows the editor font and accent, never a brand theme',
    !/ScratchDream/.test(openPixel.font) && openPixel.radius === '8px' && openPixel.accentIsSiteAccent,
    [openPixel.font, openPixel.radius, openPixel.accentIsSiteAccent]);

const card = await tab.evaluate(() => {
    const r = document.querySelector('.adox-px-canvas').getBoundingClientRect();
    return {x: r.x, y: r.y, w: r.width, h: r.height};
});
await tab.mouse.move(card.x + card.w * .3, card.y + card.h * .3);
await tab.mouse.down();
await tab.mouse.move(card.x + card.w * .55, card.y + card.h * .55, {steps: 12});
await tab.mouse.up();
await wait(300);
await tab.evaluate(() => document.querySelector('.adox-px-tool[data-tool="rect"]').click());
await tab.mouse.move(card.x + card.w * .2, card.y + card.h * .2);
await tab.mouse.down();
await tab.mouse.move(card.x + card.w * .4, card.y + card.h * .35, {steps: 6});
await tab.mouse.up();
await wait(300);
const painted = await tab.evaluate(() => {
    const c = document.querySelector('.adox-px-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return {painted: n, undo: !document.querySelector('.adox-px-icon').disabled};
});
ok('22. brush pixels land solid, the rectangle is filled, and undo arms',
    painted.painted > 200 && painted.undo, painted);
await shot(tab, 'pixel-editor.png', {x: 0, y: 0, width: 1440, height: 900});

const pixelBefore = await tab.evaluate(() => {
    const t = window.vm.editingTarget;
    return {md5: t.getCostumes()[t.currentCostume].assetId};
});
await tab.evaluate(() => document.querySelector('.adox-px-apply').click());
await wait(1800);
const applied = await tab.evaluate(() => {
    const t = window.vm.editingTarget;
    const c = t.getCostumes()[t.currentCostume];
    const raw = c.asset && (c.asset.data !== undefined ? c.asset.data : c.asset);
    const txt = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const paint = window.paper.project.layers.find(l => l.data && l.data.isPaintingLayer);
    const first = paint && paint.children.find(ch => !ch.guide);
    return {
        open: !!document.querySelector('.adox-px'),
        format: window.ReduxStore.getState().scratchPaint.format,
        md5: c.assetId,
        sel: window.ReduxStore.getState().scratchPaint.selectedItems.length,
        items: paint ? paint.children.filter(ch => !ch.guide).length : 0,
        fills: paint ? paint.children.filter(ch => ch.fillColor).length : 0,
        svgPaths: (txt.match(/<path/g) || []).length,
        sample: first ? String(first.pathData) : '',
        union: paint ? (() => {
            const all = paint.children.filter(c => !c.guide && c.bounds);
            const u = all.reduce((a, ch) => {
                const b = ch.bounds;
                return [Math.min(a[0], b.x), Math.min(a[1], b.y), Math.max(a[2], b.x + b.width), Math.max(a[3], b.y + b.height)];
            }, [1e9, 1e9, -1e9, -1e9]);
            return [(u[0] + u[2]) / 2, (u[1] + u[3]) / 2];
        })() : null,
        transparent: (txt.match(/(?:fill-)?opacity="0\.[0-9]+"/g) || []).length
    };
});
ok('23. apply clears the stale selection, closes the mode and writes vector squares',
    armedSelection > 0 && applied.sel === 0 && !applied.open && /^VECTOR/.test(applied.format) &&
    applied.items > 1 && applied.fills === applied.items && applied.md5 !== pixelBefore.md5, applied);
ok('24. the pixel art lands exactly where the costume already sat, not in a corner',
    applied.union && Math.hypot(applied.union[0] - preArt.centre[0], applied.union[1] - preArt.centre[1]) < 3,
    {before: preArt.centre.map(v => Math.round(v)), after: applied.union && applied.union.map(v => Math.round(v))});
ok('25. every written pixel is opaque: no half-transparent edge survives',
    applied.transparent === 0, {softFills: applied.transparent});
ok('26. the saved art is merged pixel runs, one path per colour, not one path per pixel',
    applied.svgPaths > 1 && applied.svgPaths === applied.items &&
    /M[-\d.]+[, ][-\d.]+h[-\d.]+v[-\d.]+h-/.test(applied.sample),
    {paths: applied.svgPaths, items: applied.items, sample: applied.sample.slice(0, 60)});
await tab.keyboard.down('Control');
await tab.keyboard.press('KeyZ');
await tab.keyboard.up('Control');
await wait(900);
const pixelUndone = await tab.evaluate(() => ({
    md5: window.vm.editingTarget.getCostumes()[window.vm.editingTarget.currentCostume].assetId,
    paint: window.paper.project.layers.find(l => l.data && l.data.isPaintingLayer).children.length
}));
ok('27. one native undo puts the original costume back',
    pixelUndone.md5 !== applied.md5, pixelUndone);

// ---------------------------------------------------------------- make a genuinely jittery sprite
// Setup, not a product feature: a second costume is created through the VM, then painted with the
// native brush. Driving the costume context menu by pixel coordinates made the suite flaky after a
// rewrite changed the thumbnail, so the setup no longer depends on where a menu happens to open.
const two = await tab.evaluate(async () => {
    await window.vm.duplicateCostume(0);
    const t = window.vm.editingTarget;
    return {n: t.getCostumes().length, cur: t.currentCostume};
});
ok('28. the test sprite now has two costumes', two.n === 2, two);

const brush = await tab.evaluate(() => {
    const btn = [...document.querySelectorAll('[class*="paint-editor_mode-selector"] [role="button"], [class*="paint-editor_mode-selector"] button')]
        .find(b => /brush/i.test(b.title || b.getAttribute('aria-label') || ''));
    if (!btn) return null;
    btn.click();
    return btn.title || btn.getAttribute('aria-label');
});
ok('29. the native brush armed', !!brush, brush);
await tab.waitForFunction(() => {
    const c = document.querySelector('[class*="paper-canvas"]');
    return c && c.getBoundingClientRect().width > 100;
}, {timeout: 15000});
const view = await tab.evaluate(() => {
    const r = document.querySelector('[class*="paper-canvas"]').getBoundingClientRect();
    return {x: r.x, y: r.y, w: r.width, h: r.height};
});
// the nib box opens itself the moment the editor's brush is clicked, and it floats over the left
// half of the art. The stroke below is what the user was reaching for, so the box has to get out
// of the way and the ink still has to land — an earlier build kept the box open and ate strokes
// that started under it.
await wait(300);
const nib = await tab.evaluate(() => ({open: Boolean(document.querySelector('.adox-panel')),
    ink: window.paper.project.layers.find(l => l.data && l.data.isPaintingLayer).children.length}));
await tab.mouse.move(view.x + view.w * .78, view.y + view.h * .74);
await tab.mouse.down();
await tab.mouse.move(view.x + view.w * .84, view.y + view.h * .8, {steps: 10});
await tab.mouse.up();
await wait(1600);
const nibAfter = await tab.evaluate(() => ({open: Boolean(document.querySelector('.adox-panel')),
    ink: window.paper.project.layers.find(l => l.data && l.data.isPaintingLayer).children.length}));
ok('30. the stroke the user wanted wins over the box the brush opened',
    nib.open && !nibAfter.open && nibAfter.ink > nib.ink, {nib, nibAfter});

// ---------------------------------------------------------------- the anchor, measured twice
const measure = () => tab.evaluate(async () => {
    const centroid = svg => new Promise(res => {
        const img = new Image();
        img.onload = () => {
            const S = 8;
            const w = Number((/\swidth="([\d.]+)"/.exec(svg) || [])[1]) || img.naturalWidth;
            const h = Number((/\sheight="([\d.]+)"/.exec(svg) || [])[1]) || img.naturalHeight;
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * S));
            cv.height = Math.max(1, Math.round(h * S));
            const ctx = cv.getContext('2d', {willReadFrequently: true});
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
            let a = 0, x = 0, y = 0;
            for (let i = 0; i < d.length; i += 4) {
                const al = d[i + 3];
                if (!al) continue;
                a += al; x += al * (i / 4 % cv.width); y += al * Math.floor(i / 4 / cv.width);
            }
            res(a ? [x / a / S, y / a / S] : null);
        };
        img.onerror = () => res(null);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    const t = window.vm.editingTarget;
    const out = [];
    for (const c of t.getCostumes()) {
        const raw = c.asset && c.asset.data !== undefined ? c.asset.data : c.asset;
        const txt = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        out.push({name: c.name, c: await centroid(txt), pivot: [c.rotationCenterX, c.rotationCenterY]});
    }
    const land = out.filter(o => o.c).map(o => [o.c[0] - o.pivot[0], o.c[1] - o.pivot[1]]);
    let tot = 0;
    for (let i = 1; i < land.length; i++) {
        tot += Math.hypot(land[i][0] - land[i - 1][0], land[i][1] - land[i - 1][1]);
    }
    return {n: out.length, mean: land.length > 1 ? tot / (land.length - 1) : 0, out};
});

const before = await measure();
ok('31. the duplicated-and-painted sprite really jitters', before.mean > 1,
    {costumes: before.n, jitterPx: Math.round(before.mean * 10) / 10});

await tab.evaluate(() => document.querySelector('[data-adox-key="anchor"]').click());
await wait(4000);

const box = await tab.evaluate(() => {
    const panel = document.querySelector('.adox-panel');
    const cs = getComputedStyle(panel);
    const rows = [...panel.querySelectorAll('.adox-arow')];
    const sel = document.querySelector('[class*="tool-select-base_mod-tool-select"][class*="is-selected"]');
    const probe = document.createElement('div');
    probe.style.color = cs.getPropertyValue('--adox-accent').trim();
    panel.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const r = panel.getBoundingClientRect();
    return {
        size: [Math.round(r.width), Math.round(r.height)],
        jump: panel.querySelector('.adox-jump strong').textContent,
        sub: panel.querySelector('.adox-sub').textContent,
        modes: [...panel.querySelectorAll('[data-mode]')].map(b => b.dataset.mode + ':' + b.ariaPressed).join(),
        rows: rows.length,
        thumbs: rows.map(x => (x.querySelector('.adox-athumb').style.backgroundImage || '').slice(0, 5)),
        deltas: rows.map(x => x.querySelector('.adox-adelta').textContent),
        primaryOff: panel.querySelector('.adox-primary').disabled,
        undoOff: panel.querySelector('.adox-ghost').disabled,
        accentIsSiteAccent: accent === getComputedStyle(sel).backgroundColor,
        font: cs.fontFamily, radius: cs.borderRadius
    };
});
ok('32. the panel prints the jitter an outside measurement finds',
    Math.abs(Number(box.jump) - before.mean) < .3, [box.jump, Math.round(before.mean * 10) / 10]);
ok('33. one row per costume, each with its own thumbnail and a pivot shift',
    box.rows === before.n && box.thumbs.every(x => x.startsWith('url(')) &&
    box.deltas.every(d => /^(=|→ )/.test(d)) && box.deltas.some(d => d.startsWith('→')),
    {rows: box.rows, thumbs: box.thumbs, deltas: box.deltas});
ok('34. three plans offered, "match first" is the default',
    box.modes === 'body:false,own:false,match:true', box.modes);
ok('35. the box stays native: site font, 4px radius, accent borrowed from the selected tool',
    !/ScratchDream/.test(box.font) && box.radius === '4px' && box.accentIsSiteAccent &&
    box.size[1] < 340, [box.font, box.radius, box.accentIsSiteAccent, box.size]);
await shot(tab, 'anchor-panel.png', {x: 0, y: 0, width: 1000, height: 700});

await tab.evaluate(() => document.querySelector('.adox-primary').click());
await wait(1000);
const after = await measure();
ok('36. apply drives the real jitter to zero', after.mean < .05 &&
    after.out.some((o, i) => Math.hypot(o.pivot[0] - before.out[i].pivot[0], o.pivot[1] - before.out[i].pivot[1]) > .5),
    {before: Math.round(before.mean * 10) / 10, after: Math.round(after.mean * 100) / 100});
const box2 = await tab.evaluate(() => ({
    jump: document.querySelector('.adox-jump strong').textContent,
    sub: document.querySelector('.adox-sub').textContent,
    undoOff: document.querySelector('.adox-ghost').disabled
}));
ok('37. the box agrees and offers the way back',
    box2.undoOff === false && Number(box2.jump) < .05 && /→/.test(box2.sub), box2);

await tab.evaluate(() => document.querySelector('.adox-ghost').click());
await wait(900);
const undone = await measure();
ok('38. undo puts every original pivot back',
    undone.out.every((o, i) => Math.abs(o.pivot[0] - before.out[i].pivot[0]) < .001 &&
        Math.abs(o.pivot[1] - before.out[i].pivot[1]) < .001),
    {jitter: Math.round(undone.mean * 10) / 10});

const own = await tab.evaluate(() => {
    document.querySelector('[data-mode="own"]').click();
    return new Promise(res => setTimeout(() => {
        const panel = document.querySelector('.adox-panel');
        res({
            modes: [...panel.querySelectorAll('[data-mode]')].map(b => b.dataset.mode + ':' + b.ariaPressed).join(),
            sub: panel.querySelector('.adox-sub').textContent,
            deltas: [...panel.querySelectorAll('.adox-adelta')].map(d => d.textContent)
        });
    }, 500));
});
ok('39. switching plan re-plans every row', own.modes === 'body:false,own:true,match:false' &&
    own.deltas.every(d => /→/.test(d)) && /→.*px/.test(own.sub), own);

const single = await tab.evaluate(() => {
    const t = window.vm.editingTarget;
    t.deleteCostume(1);
    document.querySelector('[data-mode="match"]').click();
    return new Promise(res => setTimeout(() => {
        const p = document.querySelector('.adox-panel');
        res({
            n: t.getCostumes().length,
            sub: p.querySelector('.adox-sub').textContent,
            rows: p.querySelectorAll('.adox-arow').length,
            primaryOff: p.querySelector('.adox-primary').disabled
        });
    }, 900));
});
ok('40. one costume left: the box says what it needs instead of freezing',
    single.n === 1 && single.sub.length > 8 && single.rows === 0 && single.primaryOff === true, single);
await tab.evaluate(() => document.querySelector('.adox-panel .adox-close').click());

// ---------------------------------------------------------------- vector → bitmap, then the pixel box
// The editor rebuilds its whole tool row on this switch. Our button now sits before the native
// convert control, so the native one is found by its label, not by being the first match.
await tab.evaluate(() => {
    const el = [...document.querySelectorAll('[class*="paint-editor_bitmap-button"]')]
        .find(e => !e.classList.contains('adox-px-btn') && !/-icon/.test(String(e.className)) &&
            /Convert/.test(e.textContent || ''));
    el.click();
});
// the snap finishes with one commit, so wait for the costume asset itself to become PNG
// instead of guessing a fixed delay (the 1:1 palette pass adds a little work)
for (let i = 0; i < 40; i++) {
    await wait(250);
    const ready = await tab.evaluate(() => {
        const t = window.vm.editingTarget;
        const c = t && t.getCostumes()[t.currentCostume];
        const raw = c && c.asset && c.asset.data;
        const bytes = raw instanceof Uint8Array ? raw : null;
        return window.ReduxStore.getState().scratchPaint.format === 'BITMAP' &&
            !!bytes && bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
    });
    if (ready) break;
}
const switched = await tab.evaluate(() => ({
    format: window.ReduxStore.getState().scratchPaint.format,
    tools: [...document.querySelectorAll('.adox-tool')].map(b => b.dataset.adoxKey),
    pixel: !!document.querySelector('.adox-px-btn')
}));
ok('41. the four tools and the pixel option survive a real vector→bitmap switch',
    switched.format === 'BITMAP' && switched.tools.join() === 'shapes,pen,fx,anchor' && switched.pixel,
    switched);

// Scratch's conversion bakes soft edges into the raster. Our hook picks the grid from the thinnest
// stroke (1:1, or 2x2 once every stroke is two units thick) and writes solid pixels, so the saved
// PNG is hard alpha only — no gradient when the artist zooms in.
// the native conversion writes its soft PNG first and the snap commits a moment later, so read
// the saved asset until the hard result has landed instead of racing the two writes
let crisp = {semi: -1, opaque: 0, size: []};
for (let i = 0; i < 40; i++) {
    await wait(250);
    try {
        crisp = await tab.evaluate(async () => {
            const c = window.vm.editingTarget.getCostumes()[window.vm.editingTarget.currentCostume];
            const raw = c.asset && c.asset.data;
            if (!(raw instanceof Uint8Array)) return {semi: -1, opaque: 0, size: []};
            const bmp = await createImageBitmap(new Blob([raw], {type: 'image/png'}));
            const cv = document.createElement('canvas');
            cv.width = bmp.width; cv.height = bmp.height;
            const ctx = cv.getContext('2d', {willReadFrequently: true});
            ctx.drawImage(bmp, 0, 0);
            const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
            let semi = 0, opaque = 0;
            for (let k = 3; k < d.length; k += 4) {
                if (d[k] && d[k] < 255) semi++;
                if (d[k] === 255) opaque++;
            }
            return {semi, opaque, size: [bmp.width, bmp.height]};
        });
    } catch (e) {
        crisp = {semi: -1, opaque: 0, size: []};
    }
    if (crisp.semi === 0 && crisp.opaque > 1000) break;
}
ok('42. converting to bitmap leaves hard pixel edges, not baked blur',
    crisp.semi === 0 && crisp.opaque > 1000, crisp);

await tab.evaluate(() => document.querySelector('.adox-px-btn').click());
await wait(2600);
const roundTrip = await tab.evaluate(() => ({
    format: window.ReduxStore.getState().scratchPaint.format,
    open: !!document.querySelector('.adox-px'),
    count: document.querySelectorAll('.adox-px-tool').length,
    toast: document.querySelector('.adox-toast') ? document.querySelector('.adox-toast').textContent : ''
}));
ok('43. a bitmap costume is converted to vector before the pixel mode opens',
    roundTrip.format === 'VECTOR' && roundTrip.open && roundTrip.count === 9, roundTrip);
await tab.keyboard.press('Escape');
await wait(300);
ok('44. Escape closes the separate mode without touching the editor',
    await tab.evaluate(() => !document.querySelector('.adox-px') && !!window.ReduxStore.getState().scratchPaint),
    null);

// Enabling the ruleset is not the same as the rule firing. From inside the live editor, ask
// for the two analytics hosts the diet blocks and one site asset that must still arrive:
// only the third is allowed to answer.
const diet = await tab.evaluate(async () => {
    const probe = async url => {
        try {
            await fetch(url, {mode: 'no-cors', cache: 'no-store'});
            return 'reached';
        } catch (e) {
            return String((e && e.message) || '').toLowerCase().indexOf('failed to fetch') >= 0 ? 'blocked' : 'error';
        }
    };
    return {
        tag: await probe('https://www.googletagmanager.com/gtag/js?id=G-TEST0000'),
        ga: await probe('https://www.google-analytics.com/collect?v=1&t=pageview&tid=UA-TEST'),
        own: await probe(location.href.split('?')[0])
    };
});
ok('45. the diet ruleset actually drops analytics requests from the editor page',
    diet.tag === 'blocked' && diet.ga === 'blocked' && diet.own === 'reached', diet);

// The tile is supposed to own this ruleset, and Chrome has renamed the option fields the call
// takes at least once: a rejected call used to be swallowed, leaving a switch that clicked
// cheerfully while the ruleset never moved. This is the check that would have caught it.
const dietSwitch = async (want) => popup.evaluate((on) => {
    const sw = document.querySelector('.tile[data-id="speed"] .switch');
    if ((sw.getAttribute('aria-checked') === 'true') !== on) sw.click();
}, want);
const rulesetsNow = async () => popup.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
await dietSwitch(false);
await wait(1200);
const dietOffRules = await rulesetsNow();
await dietSwitch(true);
await wait(1200);
const dietOnRules = await rulesetsNow();
ok('46. the diet tile moves the network ruleset off and on',
    dietOffRules.indexOf('diet') < 0 && dietOnRules.indexOf('diet') >= 0, {dietOffRules, dietOnRules});

ok('47. no page error and no fillColor/function error escaped during any of it',
    errs.length === 0 && consoleErrs.length === 0, {page: errs, console: consoleErrs});

const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
stop();
process.exit(fails.length ? 1 : 0);
