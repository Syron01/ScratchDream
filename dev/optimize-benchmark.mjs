// Real benchmark check: optimization, folder grouping, WAV -> MP3 and undo on project 811805586.
import path from 'node:path';
import {startExtension, shotPath} from './harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 980});
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await tab.goto('https://turbowarp.org/811805586/editor?fps=60&limitless&hqpen', {waitUntil: 'networkidle2', timeout: 180000});
await tab.waitForFunction(() => window.vm && window.vm.runtime.targets.length > 10, {timeout: 180000});
await wait(3000);

const before = await tab.evaluate(() => {
    const vm = window.vm;
    const targets = vm.runtime.targets.filter(t => !t.isStage && t.isOriginal !== false);
    let blocks = 0;
    let scripts = 0;
    let assets = 0;
    const seen = new Set();
    for (const t of targets) {
        blocks += Object.keys(t.blocks._blocks).length;
        scripts += t.blocks._scripts.length;
        for (const c of t.getCostumes()) {
            if (!seen.has(c.assetId)) { seen.add(c.assetId); assets += c.asset.data.byteLength || c.asset.data.length || 0; }
        }
        for (const s of t.getSounds()) {
            if (!seen.has(s.assetId)) { seen.add(s.assetId); assets += s.asset.data.byteLength || s.asset.data.length || 0; }
        }
    }
    const rawJson = vm.toJSON();
    const jsonText = typeof rawJson === 'string' ? rawJson : JSON.stringify(rawJson);
    window.__benchBeforeJson = jsonText;
    return {
        blocks, scripts, assets,
        json: jsonText.length,
        hasFolders: !!(window.__adoxSpriteFolders && window.__adoxSpriteFolders.snapshot),
        folders: window.__adoxSpriteFolders ? window.__adoxSpriteFolders.snapshot().folders : []
    };
});
console.log(JSON.stringify({before}, null, 2));

await tab.click('#adox-optimize-button');
await wait(900);
await tab.evaluate(() => {
    const button = [...document.querySelectorAll('[data-adox-optimize] button')]
        .find(b => /Optimize now/i.test(b.textContent));
    if (button) button.click();
});
let result = null;
for (let i = 0; i < 80; i++) {
    await wait(500);
    result = await tab.evaluate(() => {
        const overlay = document.querySelector('[data-adox-optimize]');
        if (!overlay) return {open: false};
        return {
            open: true,
            text: overlay.innerText,
            undo: [...overlay.querySelectorAll('button')].some(b => /Undo/i.test(b.textContent)),
            done: [...overlay.querySelectorAll('button')].some(b => /^Done$/i.test(b.textContent))
        };
    });
    if (result.undo && result.done) break;
}
console.log(JSON.stringify({result}, null, 2));
await tab.screenshot({path: shotPath('optimizer-benchmark-result.png')});

const after = await tab.evaluate(async () => {
    const vm = window.vm;
    const targets = vm.runtime.targets.filter(t => !t.isStage && t.isOriginal !== false);
    let blocks = 0;
    let scripts = 0;
    let assets = 0;
    let mp3Sounds = 0;
    let wavSounds = 0;
    let stringAssets = 0;
    let decoded = null;
    const seen = new Set();
    for (const t of targets) {
        blocks += Object.keys(t.blocks._blocks).length;
        scripts += t.blocks._scripts.length;
        for (const c of t.getCostumes()) {
            if (!seen.has(c.assetId)) {
                seen.add(c.assetId);
                if (typeof c.asset.data === 'string') stringAssets++;
                assets += c.asset.data.byteLength || c.asset.data.length || 0;
            }
        }
        for (const s of t.getSounds()) {
            if (!seen.has(s.assetId)) {
                seen.add(s.assetId);
                if (typeof s.asset.data === 'string') stringAssets++;
                const bytes = s.asset.data instanceof Uint8Array ? s.asset.data : new Uint8Array(s.asset.data);
                assets += bytes.length;
                if (s.dataFormat === 'mp3') mp3Sounds++;
                if (s.dataFormat === 'wav') wavSounds++;
                if (!decoded && s.dataFormat === 'mp3') {
                    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                    try {
                        const ctx = new Offline(1, 1, 48000);
                        const copy = new Uint8Array(bytes.length); copy.set(bytes);
                        const buffer = await ctx.decodeAudioData(copy.buffer);
                        decoded = {name: s.name, duration: buffer.duration, rate: buffer.sampleRate, channels: buffer.numberOfChannels};
                    } catch (e) { decoded = {error: String(e)}; }
                }
            }
        }
    }
    const snapAfter = window.__adoxSpriteFolders.snapshot();
    const rawAfterJson = vm.toJSON();
    return {
        blocks, scripts, assets,
        json: (typeof rawAfterJson === 'string' ? rawAfterJson : JSON.stringify(rawAfterJson)).length,
        mp3Sounds, wavSounds, decoded,
        stringAssets,
        folders: snapAfter.folders,
        assignments: snapAfter.assignments,
        filed: snapAfter.assignments.filter(a => a.folder).length
    };
});
console.log(JSON.stringify({after}, null, 2));
await tab.screenshot({path: shotPath('optimizer-benchmark-folders.png')});

const undo = await tab.evaluate(async () => {
    const button = [...document.querySelectorAll('[data-adox-optimize] button')]
        .find(b => /Undo/i.test(b.textContent));
    if (!button) return {clicked: false};
    button.click();
    await new Promise(r => setTimeout(r, 600));
    const vm = window.vm;
    const targets = vm.runtime.targets.filter(t => !t.isStage && t.isOriginal !== false);
    let blocks = 0;
    let scripts = 0;
    let assets = 0;
    let wavSounds = 0;
    const seen = new Set();
    for (const t of targets) {
        blocks += Object.keys(t.blocks._blocks).length;
        scripts += t.blocks._scripts.length;
        for (const c of t.getCostumes()) {
            if (!seen.has(c.assetId)) { seen.add(c.assetId); assets += c.asset.data.byteLength || c.asset.data.length || 0; }
        }
        for (const s of t.getSounds()) {
            if (!seen.has(s.assetId)) {
                seen.add(s.assetId);
                assets += s.asset.data.byteLength || s.asset.data.length || 0;
                if (s.dataFormat === 'wav') wavSounds++;
            }
        }
    }
    const snap = window.__adoxSpriteFolders.snapshot();
    const rawJson = vm.toJSON();
    const jsonText = typeof rawJson === 'string' ? rawJson : JSON.stringify(rawJson);
    const beforeJson = window.__benchBeforeJson || '';
    let firstDiff = -1;
    const limit = Math.min(jsonText.length, beforeJson.length);
    for (let i = 0; i < limit; i++) {
        if (jsonText[i] !== beforeJson[i]) { firstDiff = i; break; }
    }
    return {
        text: document.querySelector('[data-adox-optimize]').innerText,
        blocks, scripts, assets,
        json: jsonText.length,
        jsonEqual: jsonText === beforeJson,
        firstDiff,
        diffAround: firstDiff >= 0 ? jsonText.slice(Math.max(0, firstDiff - 120), firstDiff + 200) : '',
        wavSounds,
        folders: snap.folders,
        filed: snap.assignments.filter(a => a.folder).length
    };
});
console.log(JSON.stringify({undo}, null, 2));
console.log(JSON.stringify({errors}, null, 2));
await tab.screenshot({path: shotPath('optimizer-benchmark-undo.png')});
await stop();
