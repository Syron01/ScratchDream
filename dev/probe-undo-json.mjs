// Per-target JSON diff after undo, to find anything that is not restored exactly.
import path from 'node:path';
import {startExtension} from './harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const tab = await browser.newPage();
await tab.goto('https://turbowarp.org/811805586/editor?fps=60&limitless&hqpen', {waitUntil: 'networkidle2', timeout: 180000});
await tab.waitForFunction(() => window.vm && window.vm.runtime.targets.length > 10, {timeout: 180000});
await wait(2500);
const before = await tab.evaluate(() => {
    const vm = window.vm;
    const raw = vm.toJSON();
    const full = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const targets = json.targets.map(t => ({name: t.name, text: JSON.stringify(t), keys: {
        comments: t.comments ? Object.keys(t.comments) : [],
        blocks: t.blocks ? Object.keys(t.blocks) : [],
        variables: t.variables ? Object.keys(t.variables) : [],
        sounds: (t.sounds || []).map(s => ({name: s.name, dataFormat: s.dataFormat, md5ext: s.md5ext})),
        costumes: (t.costumes || []).map(s => ({name: s.name, dataFormat: s.dataFormat, md5ext: s.md5ext}))
    }}));
    window.__undoBefore = {full, targets};
    return {length: full.length, targetCount: targets.length, rawType: typeof raw};
});
console.log('BEFORE', JSON.stringify(before));
await tab.click('#adox-optimize-button');
await wait(900);
await tab.evaluate(() => {
    const b = [...document.querySelectorAll('[data-adox-optimize] button')].find(x => /Optimize now/i.test(x.textContent));
    if (b) b.click();
});
for (let i = 0; i < 80; i++) {
    await wait(500);
    const ready = await tab.evaluate(() => {
        const o = document.querySelector('[data-adox-optimize]');
        return !!(o && [...o.querySelectorAll('button')].some(b => /Undo/i.test(b.textContent)));
    });
    if (ready) break;
}
const after = await tab.evaluate(async () => {
    [...document.querySelectorAll('[data-adox-optimize] button')].find(b => /Undo/i.test(b.textContent)).click();
    await new Promise(r => setTimeout(r, 900));
    const vm = window.vm;
    const raw = vm.toJSON();
    const full = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const targetRows = json.targets.map(t => ({name: t.name, text: JSON.stringify(t), keys: {
        comments: t.comments ? Object.keys(t.comments) : [],
        blocks: t.blocks ? Object.keys(t.blocks) : [],
        variables: t.variables ? Object.keys(t.variables) : [],
        sounds: (t.sounds || []).map(s => ({name: s.name, dataFormat: s.dataFormat, md5ext: s.md5ext})),
        costumes: (t.costumes || []).map(s => ({name: s.name, dataFormat: s.dataFormat, md5ext: s.md5ext}))
    }}));
    const beforeData = window.__undoBefore;
    let firstTarget = null;
    const targetDiffs = [];
    for (let i = 0; i < Math.max(beforeData.targets.length, targetRows.length); i++) {
        const b = beforeData.targets[i];
        const a = targetRows[i];
        if (!b || !a || b.text !== a.text) {
            let first = -1;
            const bt = b ? b.text : '';
            const at = a ? a.text : '';
            const limit = Math.min(bt.length, at.length);
            for (let j = 0; j < limit; j++) if (bt[j] !== at[j]) { first = j; break; }
            if (first < 0) first = limit;
            const row = {
                index: i,
                beforeName: b && b.name, afterName: a && a.name,
                beforeLength: bt.length, afterLength: at.length,
                first,
                before: bt.slice(Math.max(0, first - 160), first + 260),
                after: at.slice(Math.max(0, first - 160), first + 260),
                commentKeysBefore: b && b.keys.comments,
                commentKeysAfter: a && a.keys.comments,
                soundBefore: b && b.keys.sounds,
                soundAfter: a && a.keys.sounds
            };
            targetDiffs.push(row);
            if (firstTarget === null) firstTarget = row;
        }
    }
    let fullFirst = -1;
    const limit = Math.min(full.length, beforeData.full.length);
    for (let i = 0; i < limit; i++) if (full[i] !== beforeData.full[i]) { fullFirst = i; break; }
    if (fullFirst < 0 && full.length !== beforeData.full.length) fullFirst = limit;
    return {
        beforeLength: beforeData.full.length,
        afterLength: full.length,
        fullEqual: full === beforeData.full,
        fullFirst,
        targetDiffs: targetDiffs.slice(0, 6),
        targetDiffCount: targetDiffs.length
    };
});
console.log(JSON.stringify(after, null, 2));
await stop();
