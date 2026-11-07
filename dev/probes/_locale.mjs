// Does the product still work when the editor is not English?
// Every native handle the product grabs is a css-module class fragment or a mode read back from the
// store, never a translated word, and this file is the live proof of that claim. It also pins the
// one documented limit: only two dictionaries are written, so an Arabic editor keeps English labels.
import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const EXT_DIR = path.join(ROOT, 'extension');
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra) => {
    results.push({name, pass: Boolean(pass), extra});
    console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' · ' + JSON.stringify(extra)));
};

async function run (lang) {
    const {browser, stop} = await startExtension(EXT_DIR, {lang});
    const tab = await browser.newPage();
    await tab.setViewport({width: 1440, height: 900});
    const errs = [];
    tab.on('pageerror', e => errs.push(String(e.message).slice(0, 90)));
    tab.on('console', m => {
        if (m.type() === 'error' && /fillColor|Cannot read properties|is not a function/.test(m.text())) {
            errs.push('console: ' + m.text().slice(0, 90));
        }
    });
    await tab.goto('https://turbowarp.org/editor', {waitUntil: 'networkidle2', timeout: 120000});
    await wait(4000);
    await tab.keyboard.press('Escape');
    for (let i = 0; i < 40; i++) {
        await wait(250);
        const ready = await tab.evaluate(() => {
            const tabs = document.querySelectorAll('[role="tab"]');
            if (tabs.length > 1) tabs[1].click();
            return document.querySelectorAll('.adox-tool').length === 4 && !!document.querySelector('.adox-rail');
        });
        if (ready) break;
    }
    await wait(800);

    const s = await tab.evaluate(() => {
        const q = sel => document.querySelector(sel);
        const native = () => [...q('[class*="paint-editor_mode-selector"]')
            .querySelectorAll('[class*="tool-select-base_mod-tool-select"]')];
        const mode = () => {
            try { return window.ReduxStore.getState().scratchPaint.mode || ''; } catch (e) { return ''; }
        };
        // the brush is whichever button the store answers BRUSH for, so a translated tooltip cannot
        // hide it: this is the same route the product itself uses
        let brushIndex = -1;
        for (let i = 0; i < native().length; i++) {
            native()[i].click();
            if (mode() === 'BRUSH') { brushIndex = i; break; }
        }
        const pxBtn = q('.adox-px-btn');
        return {
            locale: (() => {
                try { const l = window.ReduxStore.getState().locales; return {code: l.locale, rtl: !!l.isRtl}; }
                catch (e) { return {code: null, rtl: null}; }
            })(),
            tabName: (() => { const t = document.querySelectorAll('[role="tab"]');
                return t.length > 1 ? (t[1].textContent || '').trim() : null; })(),
            selectors: {
                canvas: !!q('[class*="paint-editor_canvas-container"]'),
                bitmap: !!q('[class*="paint-editor_bitmap-button"]'),
                tools: native().length,
                brushIndex
            },
            ourTitles: [...document.querySelectorAll('.adox-tool')].map(b => b.title),
            keys: [...document.querySelectorAll('.adox-tool')].map(b => b.dataset.adoxKey),
            pixelLabel: pxBtn ? pxBtn.textContent.trim() : null
        };
    });

    // click the native brush, which opens our nib box, then draw on the canvas, which must close it
    // the nib box opens on a timer after the native click, so the click and the read have to be
    // separate ticks: reading in the same evaluate catches a box that was never given the chance
    await tab.evaluate(() => {
        const q = sel => document.querySelector(sel);
        const native = [...q('[class*="paint-editor_mode-selector"]')
            .querySelectorAll('[class*="tool-select-base_mod-tool-select"]')];
        const mode = () => {
            try { return window.ReduxStore.getState().scratchPaint.mode || ''; } catch (e) { return ''; }
        };
        for (const b of native) { b.click(); if (mode() === 'BRUSH') break; }
        window.paper.project.deselectAll();
    });
    await wait(500);
    const nibBefore = await tab.evaluate(() => {
        const p = document.querySelector('.adox-panel');
        const art = document.querySelector('canvas[class*="paper-canvas"]').getBoundingClientRect();
        const r = p ? p.getBoundingClientRect() : null;
        const over = r ? Math.max(0, Math.min(r.right, art.right) - Math.max(r.left, art.left)) *
            Math.max(0, Math.min(r.bottom, art.bottom) - Math.max(r.top, art.top)) : 0;
        return {open: !!p, kind: p && p._adoxKind, dir: p && p.getAttribute('dir'),
            over: over / (art.width * art.height), before: window.paper.project.getItems({recursive: true}).length};
    });
    const box = await tab.evaluate(() => {
        const r = document.querySelector('canvas[class*="paper-canvas"]').getBoundingClientRect();
        return {x: r.x, y: r.y, w: r.width, h: r.height};
    });
    const sx = Math.round(box.x + box.w * 0.3), sy = Math.round(box.y + box.h * 0.3);
    // the point that used to be dead: with the box open, the pen still has to reach the canvas here
    const under = await tab.evaluate((xx, yy) => {
        const e = document.elementFromPoint(xx, yy);
        return String(e && e.className).slice(0, 30);
    }, sx, sy);
    await tab.mouse.move(sx, sy);
    await tab.mouse.down();
    for (let i = 1; i <= 8; i++) await tab.mouse.move(sx + i * 12, sy + i * 9);
    await tab.mouse.up();
    await wait(600);
    const stroked = await tab.evaluate(() => ({
        items: window.paper.project.getItems({recursive: true}).length,
        svg: window.paper.project.exportSVG({asString: true}).length,
        panel: !!document.querySelector('.adox-panel')
    }));

    // the anchor box is ours: it carries the dictionary text and the dir attribute
    await tab.evaluate(() => {
        const b = [...document.querySelectorAll('.adox-tool')].find(x => x.dataset.adoxKey === 'anchor');
        if (b) b.click();
    });
    await wait(700);
    const anchor = await tab.evaluate(() => {
        const p = document.querySelector('.adox-panel');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return {kind: p._adoxKind, dir: p.getAttribute('dir'),
            sub: (p.querySelector('.adox-sub') || {}).textContent,
            inPage: r.left >= -1 && r.right <= document.documentElement.clientWidth + 1};
    });
    const overflow = await tab.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.adox-tool, .adox-rail, .adox-px-btn, .adox-board-btn')]
            .map(e => {
                const r = e.getBoundingClientRect();
                return r.width && (r.right > vw + 1 || r.left < -1)
                    ? String(e.className).slice(0, 24) + '@' + Math.round(r.left) + '..' + Math.round(r.right)
                    : null;
            }).filter(Boolean);
    });
    await tab.screenshot({path: shotPath('locale-' + (s.locale.code || 'und') + '.png')});
    stop();
    return {s, nibBefore, under, stroked, anchor, overflow, errs};
}

const tr = await run('tr-TR');
ok('1. the editor really speaks turkish', tr.s.locale.code === 'tr' && /kostüm/i.test(tr.s.tabName || ''),
    {locale: tr.s.locale.code, tab: tr.s.tabName});
ok('2. every native handle resolves in the turkish dom',
    tr.s.selectors.canvas && tr.s.selectors.bitmap && tr.s.selectors.tools >= 6 && tr.s.selectors.brushIndex >= 0,
    tr.s.selectors);
ok('3. our own labels come from the turkish dictionary',
    tr.s.ourTitles.join('|') === 'Şekiller|ScratchDream kalemi|Gelişmiş|Eksen' &&
    tr.s.pixelLabel === 'Vektör pikselleme', {titles: tr.s.ourTitles, pixel: tr.s.pixelLabel});
const pct = (n) => (n * 100).toFixed(1) + '%';
ok('4. the brush opened the nib box, ltr, off the art',
    tr.nibBefore.open && tr.nibBefore.kind === 'nib' && tr.nibBefore.dir === 'ltr' && tr.nibBefore.over < 0.06,
    {dir: tr.nibBefore.dir, overArt: pct(tr.nibBefore.over)});
ok('5. the pen reaches the art with the turkish box open and the stroke paints',
    /^paper-canvas/.test(tr.under) && tr.stroked.items >= tr.nibBefore.before + 1 && tr.stroked.svg > 0 &&
    !tr.stroked.panel, {under: tr.under, before: tr.nibBefore.before, items: tr.stroked.items, svg: tr.stroked.svg});
ok('6. the anchor box writes its own turkish line', tr.anchor && tr.anchor.kind === 'anchor' &&
    /kostüm/i.test(tr.anchor.sub) && !/where the drawing/.test(tr.anchor.sub || '') && tr.anchor.inPage, tr.anchor);
ok('7. nothing we inject leaves the turkish page', tr.overflow.length === 0 && tr.errs.length === 0,
    {overflow: tr.overflow, errs: tr.errs});

const ar = await run('ar-EG');
ok('8. the editor really flipped to arabic rtl', ar.s.locale.code === 'ar' && ar.s.locale.rtl === true,
    {locale: ar.s.locale.code, rtl: ar.s.locale.rtl});
ok('9. our handles and our stroke work in a mirrored dom',
    ar.s.selectors.brushIndex >= 0 && ar.stroked.items >= ar.nibBefore.before + 1 && !ar.stroked.panel,
    {brushIndex: ar.s.selectors.brushIndex, before: ar.nibBefore.before, items: ar.stroked.items});
ok('10. the mirrored editor keeps rtl, keeps the art free and paints',
    ar.nibBefore.dir === 'rtl' && ar.nibBefore.over < 0.06 && /^paper-canvas/.test(ar.under) &&
    ar.anchor && ar.anchor.dir === 'rtl' && ar.anchor.inPage,
    {nib: ar.nibBefore.dir, overArt: pct(ar.nibBefore.over), under: ar.under, anchor: ar.anchor && ar.anchor.dir});
// the documented limit, asserted rather than hoped: two dictionaries, so arabic keeps english names
ok('11. arabic shows the english dictionary, as documented',
    ar.s.ourTitles.join('|') === 'Shapes|ScratchDream pen|Advanced|Anchor', {titles: ar.s.ourTitles});
ok('12. nothing we inject leaves the arabic page', ar.overflow.length === 0 && ar.errs.length === 0,
    {overflow: ar.overflow, errs: ar.errs});

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed' +
    (failed.length ? ' -> ' + failed.map(f => f.name).join(' | ') : ''));
