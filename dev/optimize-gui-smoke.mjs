// GUI smoke test: optimize, close the dialog, then visit every sprite and costume tab.
// Reproduces the editor's thumbnail decoding path and fails on the crash screen.
import path from 'node:path';
import {startExtension, shotPath} from './harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 980});
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
await tab.goto('https://turbowarp.org/811805586/editor?fps=60&limitless&hqpen', {waitUntil: 'networkidle2', timeout: 180000});
await tab.waitForFunction(() => window.vm && window.vm.runtime.targets.length > 10, {timeout: 180000});
await wait(3000);

await tab.click('#adox-optimize-button');
await wait(900);
await tab.evaluate(() => {
    const b = [...document.querySelectorAll('[data-adox-optimize] button')].find(x => /Optimize now/i.test(x.textContent));
    if (b) b.click();
});
let resultText = '';
for (let i = 0; i < 80; i++) {
    await wait(500);
    resultText = await tab.evaluate(() => {
        const o = document.querySelector('[data-adox-optimize]');
        if (!o) return '';
        const done = [...o.querySelectorAll('button')].find(b => /^Done$/i.test(b.textContent));
        if (!done) return '';
        return o.innerText;
    });
    if (resultText) break;
}
console.log('RESULT:', resultText.replace(/\n/g, ' | ').slice(0, 400));

const assets = await tab.evaluate(() => {
    const bad = [];
    const formats = {};
    let svgCount = 0;
    const seen = new Set();
    for (const t of window.vm.runtime.targets) {
        for (const c of (t.getCostumes ? t.getCostumes() : [])) {
            if (seen.has(c.assetId)) continue;
            seen.add(c.assetId);
            const asset = c.asset;
            formats[c.dataFormat] = (formats[c.dataFormat] || 0) + 1;
            if (c.dataFormat !== 'svg') continue;
            svgCount++;
            let decoded = null;
            try { decoded = asset.decodeText().length; } catch (e) { decoded = String(e); }
            if (!(asset.data instanceof Uint8Array) || typeof decoded !== 'number') {
                bad.push({name: c.name, data: typeof asset.data, decoded});
            }
        }
    }
    return {svgCount, formats, bad};
});
console.log('SVG ASSETS:', JSON.stringify(assets, null, 2));

await tab.evaluate(() => {
    const done = [...document.querySelectorAll('[data-adox-optimize] button')].find(b => /^Done$/i.test(b.textContent));
    if (done) done.click();
});
await wait(600);

const crash = async () => tab.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    return /Oops! Something went wrong|page has crashed/i.test(text) ? text.slice(0, 300) : '';
});
console.log('CRASH AFTER CLOSE:', JSON.stringify(await crash()));

const targets = await tab.evaluate(() => window.vm.runtime.targets
    .filter(t => !t.isStage && t.isOriginal !== false)
    .map(t => ({id: t.id, name: t.getName()})));
let visited = 0;
for (const target of targets) {
    await tab.evaluate(id => window.vm.setEditingTarget(id), target.id);
    await wait(180);
    // open the costumes tab so thumbnails render
    await tab.evaluate(() => {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const costumes = tabs.find(t => /costume|kostüm/i.test(t.textContent || ''));
        if (costumes && costumes.getAttribute('aria-selected') !== 'true') costumes.click();
    });
    await wait(120);
    const crashed = await crash();
    if (crashed) {
        console.log('CRASH ON', target.name, JSON.stringify(crashed));
        break;
    }
    visited++;
}
console.log('VISITED:', visited, '/', targets.length);
console.log('CRASH FINAL:', JSON.stringify(await crash()));
console.log('ERRORS:', JSON.stringify(errors.slice(0, 12), null, 2));
const folderText = await tab.evaluate(() => {
    const all = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0);
    return all.map(el => (el.textContent || '').trim())
        .filter(t => ['Main', 'World', 'Interface', 'Audio', 'System', 'Other'].includes(t));
});
console.log('FOLDER LABELS:', JSON.stringify(folderText));
await tab.screenshot({path: shotPath('optimizer-gui-smoke.png')});
await stop();
