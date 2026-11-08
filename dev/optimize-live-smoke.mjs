// Live editor smoke test: button, localized dialog, optimize, folders and exact undo.
// usage: node optimize-live-smoke.mjs <url> <lang> [full|dialog]
import path from 'node:path';
import {startExtension, shotPath} from './harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const url = process.argv[2] || 'https://turbowarp.org/811805586/editor?fps=60&limitless&hqpen';
const lang = process.argv[3] || 'en-US';
const mode = process.argv[4] || 'full';
const turkish = /^tr/i.test(lang);
const scratchCookie = process.argv[5] || '';
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'), {lang});
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 980});
if (scratchCookie) {
    await tab.setCookie({name: 'scratchlanguage', value: scratchCookie, domain: 'scratch.mit.edu', path: '/'});
}
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_BLOCKED_BY_CLIENT/.test(m.text())) errors.push('console: ' + m.text()); });

await tab.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000});
await wait(5000);
await tab.evaluate(() => {
    function isVm(candidate) {
        return !!(candidate && candidate.runtime && candidate.runtime.storage &&
            typeof candidate.toJSON === 'function' && Array.isArray(candidate.runtime.targets));
    }
    window.__probeVm = function () {
        if (isVm(window.vm)) { window.__probeVmRef = window.vm; return window.vm; }
        if (isVm(window.__probeVmRef)) return window.__probeVmRef;
        const host = document.getElementById('app') || document.body.firstElementChild;
        if (!host) return null;
        let fiber = null;
        for (const key of Object.keys(host)) {
            if (/reactContainer/i.test(key)) { fiber = host[key]; break; }
        }
        if (!fiber && host._reactRootContainer) {
            const root = host._reactRootContainer._internalRoot || host._reactRootContainer;
            fiber = root && root.current;
        }
        const queue = [];
        if (fiber) queue.push(fiber);
        for (let i = 0; i < queue.length && i < 12000; i++) {
            const f = queue[i];
            if (!f) continue;
            const props = f.memoizedProps;
            const stateProps = f.stateNode && f.stateNode.props;
            const found = (props && isVm(props.vm)) ? props.vm : ((stateProps && isVm(stateProps.vm)) ? stateProps.vm : null);
            if (found) { window.__probeVmRef = found; return found; }
            if (f.child) queue.push(f.child);
            if (f.sibling) queue.push(f.sibling);
        }
        return null;
    };
});
let ready = false;
for (let i = 0; i < 120; i++) {
    const targets = await tab.evaluate(() => {
        const vm = window.__probeVm && window.__probeVm();
        return vm ? vm.runtime.targets.length : 0;
    });
    if (targets > 10) { ready = true; break; }
    await wait(2000);
}
console.log('READY:', ready);
const info = await tab.evaluate(() => {
    const vm = window.__probeVm();
    return {
        url: location.href,
        title: document.title,
        locale: vm && vm.getLocale ? vm.getLocale() : '',
        targets: vm ? vm.runtime.targets.length : 0,
        button: !!document.querySelector('#adox-optimize-button'),
        folders: !!(window.__adoxSpriteFolders && window.__adoxSpriteFolders.snapshot)
    };
});
console.log('INFO:', JSON.stringify(info));

const measure = () => tab.evaluate(() => {
    const vm = window.__probeVm();
    const targets = vm.runtime.targets.filter(t => !t.isStage && t.isOriginal !== false);
    let blocks = 0, scripts = 0, assets = 0, stringAssets = 0;
    let wavSounds = 0, mp3Sounds = 0;
    const seen = new Set();
    for (const t of targets) {
        blocks += Object.keys(t.blocks._blocks).length;
        scripts += t.blocks._scripts.length;
        for (const c of t.getCostumes()) {
            if (seen.has(c.assetId)) continue;
            seen.add(c.assetId);
            if (typeof c.asset.data === 'string') stringAssets++;
            assets += c.asset.data.byteLength || c.asset.data.length || 0;
        }
        for (const s of t.getSounds()) {
            if (seen.has(s.assetId)) continue;
            seen.add(s.assetId);
            if (typeof s.asset.data === 'string') stringAssets++;
            const bytes = s.asset.data.byteLength !== undefined ? s.asset.data.byteLength : s.asset.data.length;
            assets += bytes;
            if (s.dataFormat === 'wav') wavSounds++;
            if (s.dataFormat === 'mp3') mp3Sounds++;
        }
    }
    const raw = vm.toJSON();
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    window.__liveBeforeJson = window.__liveBeforeJson || json;
    const snap = window.__adoxSpriteFolders ? window.__adoxSpriteFolders.snapshot() : {folders: [], assignments: []};
    return {
        blocks, scripts, assets, stringAssets, wavSounds, mp3Sounds,
        json: json.length,
        folders: snap.folders.map(f => f.name),
        filed: snap.assignments.filter(a => a.folder).length,
        folderCount: snap.folders.length
    };
});

const before = await measure();
console.log('BEFORE:', JSON.stringify(before));

await tab.click('#adox-optimize-button');
await wait(900);
const dialog = await tab.evaluate(() => {
    const root = document.querySelector('[data-adox-optimize]');
    if (!root) return {open: false};
    const buttons = [...root.querySelectorAll('button')].map(b => b.textContent.trim());
    return {open: true, text: root.innerText, buttons};
});
console.log('DIALOG:', JSON.stringify(dialog));
const expected = turkish
    ? {head: 'Projeyi optimize et', cancel: 'Vazgeç', primary: 'Optimize et'}
    : {head: 'Optimize project', cancel: 'Cancel', primary: 'Optimize now'};
const dialogOk = dialog.open && dialog.text.includes(expected.head) &&
    dialog.buttons.includes(expected.cancel) && dialog.buttons.includes(expected.primary);
console.log('DIALOG LOCALIZED:', dialogOk, 'expected', JSON.stringify(expected));

if (mode === 'dialog') {
    await tab.evaluate(() => {
        const root = document.querySelector('[data-adox-optimize]');
        const button = [...root.querySelectorAll('button')].find(b => /^(Cancel|Vazgeç)$/.test(b.textContent.trim()));
        if (button) button.click();
    });
    await wait(600);
    const closed = await tab.evaluate(() => !document.querySelector('[data-adox-optimize]'));
    console.log('CANCEL CLOSED:', closed);
    console.log('ERRORS:', JSON.stringify(errors.slice(0, 12), null, 2));
    await tab.screenshot({path: shotPath('optimizer-live-dialog-' + (turkish ? 'tr' : 'en') + '.png')});
    await stop();
    process.exit(0);
}

await tab.evaluate(() => {
    const root = document.querySelector('[data-adox-optimize]');
    const button = [...root.querySelectorAll('button')].find(b => /^(Optimize now|Optimize et)$/.test(b.textContent.trim()));
    if (button) button.click();
});
let result = null;
for (let i = 0; i < 160; i++) {
    await wait(500);
    result = await tab.evaluate(() => {
        const root = document.querySelector('[data-adox-optimize]');
        if (!root) return null;
        const buttons = [...root.querySelectorAll('button')].map(b => b.textContent.trim());
        if (!buttons.some(b => /^(Undo|Geri al)$/.test(b))) return null;
        return {text: root.innerText, buttons};
    });
    if (result) break;
}
console.log('RESULT:', result ? JSON.stringify({text: result.text.replace(/\n/g, ' | ').slice(0, 500), buttons: result.buttons}) : 'none');
const after = await measure();
console.log('AFTER:', JSON.stringify(after));

const folderLabels = await tab.evaluate(() => {
    const all = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0);
    return all.map(el => (el.textContent || '').trim())
        .filter(t => ['Main', 'World', 'Interface', 'Audio', 'System', 'Other', 'Ana', 'Dünya', 'Arayüz', 'Ses', 'Sistem', 'Diğer'].includes(t));
});
console.log('FOLDER LABELS:', JSON.stringify(folderLabels));

const crash = await tab.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    return /Oops! Something went wrong|page has crashed/i.test(text) ? text.slice(0, 300) : '';
});
console.log('CRASH:', JSON.stringify(crash));

await tab.evaluate(() => {
    const root = document.querySelector('[data-adox-optimize]');
    const button = [...root.querySelectorAll('button')].find(b => /^(Undo|Geri al)$/.test(b.textContent.trim()));
    if (button) button.click();
});
await wait(1500);
const undo = await tab.evaluate(() => {
    const vm = window.__probeVm();
    const raw = vm.toJSON();
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const snap = window.__adoxSpriteFolders ? window.__adoxSpriteFolders.snapshot() : {folders: [], assignments: []};
    return {
        jsonEqual: json === window.__liveBeforeJson,
        jsonLength: json.length,
        folders: snap.folders.length,
        filed: snap.assignments.filter(a => a.folder).length,
        crash: /Oops! Something went wrong|page has crashed/i.test(document.body.innerText) ? document.body.innerText.slice(0, 200) : ''
    };
});
const undoAssets = await tab.evaluate(() => {
    const vm = window.__probeVm();
    const targets = vm.runtime.targets.filter(t => !t.isStage && t.isOriginal !== false);
    let assets = 0, wavSounds = 0;
    const seen = new Set();
    for (const t of targets) {
        for (const c of t.getCostumes()) {
            if (seen.has(c.assetId)) continue;
            seen.add(c.assetId);
            assets += c.asset.data.byteLength || c.asset.data.length || 0;
        }
        for (const s of t.getSounds()) {
            if (seen.has(s.assetId)) continue;
            seen.add(s.assetId);
            assets += s.asset.data.byteLength || s.asset.data.length || 0;
            if (s.dataFormat === 'wav') wavSounds++;
        }
    }
    return {assets, wavSounds};
});
console.log('UNDO:', JSON.stringify({...undo, ...undoAssets, assetsEqual: undoAssets.assets === before.assets}));
console.log('CHECKS:', JSON.stringify({
    ready,
    button: info.button,
    foldersApi: info.folders,
    dialogLocalized: dialogOk,
    optimized: !!result,
    sizeSaved: after.assets < before.assets,
    exactUndo: undo.jsonEqual && undoAssets.assets === before.assets && undo.folders === 0 && undo.filed === 0,
    noStringAssets: after.stringAssets === 0,
    noCrash: !crash && !undo.crash
}, null, 2));
console.log('ERRORS:', JSON.stringify(errors.slice(0, 12), null, 2));
await tab.screenshot({path: shotPath('optimizer-live-' + (turkish ? 'tr' : 'en') + '.png')});
await stop();
