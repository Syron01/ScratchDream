// Folder planner test: custom folders keep their names, a generic folder is renamed from its
// contents, an empty folder disappears, every sprite is filed, and undo restores the originals.
import path from 'node:path';
import {startExtension} from './harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 980});
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
await tab.goto('https://turbowarp.org/editor?fps=60', {waitUntil: 'domcontentloaded', timeout: 120000});
await tab.waitForFunction(() => window.vm && window.vm.runtime.targets.length > 1, {timeout: 120000});
await wait(3000);

const setup = await tab.evaluate(async () => {
    const vm = window.vm;
    const base = vm.runtime.targets.find(t => !t.isStage && t.isOriginal !== false);
    vm.renameSprite(base.id, 'hero');
    async function duplicate(name) {
        await vm.duplicateSprite(base.id);
        const target = vm.editingTarget;
        vm.renameSprite(target.id, name);
        return target.id;
    }
    const water = await duplicate('water tiles');
    const music = await duplicate('music');
    const debug = await duplicate('debug info');
    await new Promise(r => setTimeout(r, 800));
    const snap = window.__adoxSpriteFolders.snapshot();
    const ids = {};
    snap.sprites.forEach(s => { ids[s.name] = s.id; });
    const applied = window.__adoxSpriteFolders.apply([
        {name: 'Bosses', sprites: [ids.hero]},
        {name: 'Folder 1', sprites: [ids['water tiles']]},
        {name: 'Folder 2', sprites: []},
        {name: 'My Tools', sprites: [ids['debug info']]}
    ]);
    await new Promise(r => setTimeout(r, 500));
    const before = window.__adoxSpriteFolders.snapshot();
    const raw = vm.toJSON();
    window.__folderBeforeJson = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return {
        applied,
        ids: {hero: ids.hero, water: water, music: music, debug: debug},
        folders: before.folders.map(f => f.name),
        assignments: before.assignments.map(a => ({name: a.name, folder: (before.folders.find(f => f.id === a.folder) || {}).name || ''})),
        sprites: before.sprites.length
    };
});
console.log('SETUP:', JSON.stringify(setup, null, 2));

await tab.click('#adox-optimize-button');
await wait(800);
await tab.evaluate(() => {
    const root = document.querySelector('[data-adox-optimize]');
    const button = [...root.querySelectorAll('button')].find(b => /Optimize now/i.test(b.textContent));
    if (button) button.click();
});
let result = null;
for (let i = 0; i < 80; i++) {
    await wait(400);
    result = await tab.evaluate(() => {
        const root = document.querySelector('[data-adox-optimize]');
        if (!root) return null;
        const buttons = [...root.querySelectorAll('button')].map(b => b.textContent.trim());
        return buttons.includes('Undo') ? {text: root.innerText, buttons} : null;
    });
    if (result) break;
}
console.log('RESULT:', JSON.stringify(result));

const after = await tab.evaluate(() => {
    const snap = window.__adoxSpriteFolders.snapshot();
    function folderName(id) { return (snap.folders.find(f => f.id === id) || {}).name || ''; }
    return {
        folders: snap.folders.map(f => f.name),
        assignments: snap.assignments.map(a => ({name: a.name, folder: folderName(a.folder)})),
        filed: snap.assignments.filter(a => a.folder).length,
        sprites: snap.sprites.length
    };
});
console.log('AFTER:', JSON.stringify(after, null, 2));

await tab.evaluate(() => {
    const root = document.querySelector('[data-adox-optimize]');
    const button = [...root.querySelectorAll('button')].find(b => /^Undo$/i.test(b.textContent));
    if (button) button.click();
});
await wait(1200);
const undo = await tab.evaluate(() => {
    const vm = window.vm;
    const snap = window.__adoxSpriteFolders.snapshot();
    function folderName(id) { return (snap.folders.find(f => f.id === id) || {}).name || ''; }
    const raw = vm.toJSON();
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return {
        folders: snap.folders.map(f => f.name),
        assignments: snap.assignments.map(a => ({name: a.name, folder: folderName(a.folder)})),
        filed: snap.assignments.filter(a => a.folder).length,
        jsonEqual: json === window.__folderBeforeJson
    };
});
console.log('UNDO:', JSON.stringify(undo, null, 2));

const names = after.folders;
const folderOf = name => (after.assignments.find(a => a.name === name) || {}).folder;
const checks = {
    customKept: names.includes('Bosses') && names.includes('My Tools'),
    genericRenamed: !names.includes('Folder 1') && names.includes('World'),
    emptyRemoved: !names.includes('Folder 2'),
    allFiled: after.filed === after.sprites && after.sprites === 4,
    heroInBosses: folderOf('hero') === 'Bosses',
    waterInWorld: folderOf('water tiles') === 'World',
    debugInTools: folderOf('debug info') === 'My Tools',
    musicInAudio: folderOf('music') === 'Audio',
    undoFolders: JSON.stringify(undo.folders) === JSON.stringify(setup.folders),
    undoAssignments: JSON.stringify(undo.assignments) === JSON.stringify(setup.assignments),
    undoJson: undo.jsonEqual
};
console.log('CHECKS:', JSON.stringify(checks, null, 2));
console.log('ERRORS:', JSON.stringify(errors.slice(0, 12), null, 2));
await stop();
if (Object.keys(checks).some(k => !checks[k])) process.exitCode = 1;
