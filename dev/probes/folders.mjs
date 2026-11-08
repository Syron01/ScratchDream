import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, id, stop} = await startExtension(path.join(ROOT, 'extension'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
tab.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await tab.setViewport({width: 1440, height: 900});
await tab.goto('https://turbowarp.org/editor', {waitUntil: 'networkidle2', timeout: 120000});
await wait(5000);
await tab.keyboard.press('Escape');

const state = () => tab.evaluate(() => {
    const bar = document.querySelector('.adox-folders');
    const scroll = document.querySelector('[class*="sprite-selector_scroll-wrapper"]');
    return {
        title: document.title,
        bar: !!bar,
        chips: bar ? [...bar.querySelectorAll('.adox-fchip')].map(c => ({
            folder: c.dataset.folder, text: c.textContent.trim(), selected: c.getAttribute('aria-selected')
        })) : null,
        hint: document.querySelector('.adox-fempty') ? {
            text: document.querySelector('.adox-fempty').textContent, shown: document.querySelector('.adox-fempty').style.display
        } : null,
        sprites: (window.vm && window.vm.runtime.targets || []).filter(t => !t.isStage).map(t => t.sprite.name),
        visibleTiles: [...document.querySelectorAll('[class*="sprite-selector_sprite-wrapper"]')]
            .filter(w => w.style.display !== 'none').length,
        tiles: [...document.querySelectorAll('[class*="sprite-selector-item_sprite-selector-item"]')]
            .map(t => ({name: (t.querySelector('[class*="sprite-selector-item_sprite-name"]') || {}).textContent,
                btn: !!t.querySelector('.adox-sf-tile')})),
        scrollH: scroll ? scroll.getBoundingClientRect().height : 0,
        barH: bar ? bar.getBoundingClientRect().height : 0,
        barFits: bar ? bar.scrollWidth <= bar.clientWidth + 1 : null
    };
});
console.log('initial', JSON.stringify(await state(), null, 1));

// create a folder through the plus chip
await tab.click('.adox-fnew');
await wait(300);
console.log('input open', await tab.evaluate(() => !!document.querySelector('.adox-finput') && document.activeElement === document.querySelector('.adox-finput')));
await tab.keyboard.type('characters');
await tab.keyboard.press('Enter');
await wait(500);
console.log('after create', JSON.stringify(await state(), null, 1));

// duplicate the sprite so there is something to group
await tab.evaluate(() => {
    const vm = window.vm;
    const src = vm.runtime.targets.find(t => !t.isStage);
    if (vm.duplicateSprite) vm.duplicateSprite(src.id);
});
await wait(1200);
console.log('after duplicate', JSON.stringify(await state(), null, 1));

// assign the second sprite through its corner button menu
const menu = await tab.evaluate(() => {
    const tiles = [...document.querySelectorAll('[class*="sprite-selector-item_sprite-selector-item"]')];
    const tile = tiles[tiles.length - 1];
    const btn = tile.querySelector('.adox-sf-tile');
    if (!btn) return {ok: false};
    btn.click();
    return {ok: true, rows: [...document.querySelectorAll('.adox-fmenu button')].map(b => b.textContent.trim())};
});
console.log('tile menu', JSON.stringify(menu));
await tab.evaluate(() => {
    const row = [...document.querySelectorAll('.adox-fmenu button')].find(b => /characters/.test(b.textContent));
    if (row) row.click();
});
await wait(500);
console.log('after assign', JSON.stringify(await state(), null, 1));

// filter to the folder
await tab.evaluate(() => {
    const chip = [...document.querySelectorAll('.adox-fchip')].find(c => c.dataset.folder);
    if (chip) chip.click();
});
await wait(400);
console.log('filtered', JSON.stringify(await state(), null, 1));

// adding a sprite while a folder is open must reveal it rather than hide it
await tab.evaluate(() => window.vm.duplicateSprite(window.vm.runtime.targets.find(t => !t.isStage).id));
await wait(1200);
console.log('after add while filtered', JSON.stringify(await state(), null, 1));

// rename through a real double click on the chip
const chipBox = await tab.evaluate(() => {
    const chip = [...document.querySelectorAll('.adox-fchip')].find(c => c.dataset.folder);
    const r = chip.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
});
await tab.mouse.click(chipBox.x, chipBox.y, {clickCount: 2});
await wait(300);
console.log('rename input', await tab.evaluate(() => !!document.querySelector('.adox-finput')));
await tab.keyboard.down('Control'); await tab.keyboard.press('KeyA'); await tab.keyboard.up('Control');
await tab.keyboard.type('characters 2');
await tab.keyboard.press('Enter');
await wait(500);
console.log('after rename', JSON.stringify(await state(), null, 1));

await tab.screenshot({path: shotPath('folders'), clip: await tab.evaluate(() => {
    const r = document.querySelector('[class*="sprite-selector_sprite-selector"]').getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
})});

// persistence: reload the page
await tab.reload({waitUntil: 'networkidle2'});
await wait(6000);
await tab.keyboard.press('Escape');
console.log('after reload', JSON.stringify(await state(), null, 1));

// delete the folder through the chip's context menu
await tab.evaluate(() => {
    const chip = [...document.querySelectorAll('.adox-fchip')].find(c => c.dataset.folder);
    chip.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 300, clientY: 300}));
});
await wait(300);
console.log('chip menu', await tab.evaluate(() => [...document.querySelectorAll('.adox-fmenu button')].map(b => b.textContent.trim())));
await tab.evaluate(() => {
    const row = [...document.querySelectorAll('.adox-fmenu button')].find(b => /Delete|sil/i.test(b.textContent));
    if (row) row.click();
});
await wait(500);
console.log('after delete', JSON.stringify(await state(), null, 1));

// switch the feature off from the popup storage and check the bar disappears
const pop = await browser.newPage();
await pop.goto(`chrome-extension://${id}/popup.html`, {waitUntil: 'load'});
await wait(500);
console.log('popup', await pop.evaluate(() => {
    const tile = document.querySelector('.tile[data-id="folders"]');
    return {tiles: document.querySelectorAll('.tile').length, folder: !!tile,
        label: tile ? tile.querySelector('.tile-name').textContent : null,
        on: tile ? tile.querySelector('.switch').getAttribute('aria-checked') : null};
}));
console.log('popup search', await pop.evaluate(() => {
    const s = document.getElementById('search');
    s.value = 'klasör';
    s.dispatchEvent(new Event('input'));
    const tile = document.querySelector('.tile[data-id="folders"]');
    return {hidden: tile.classList.contains('is-hidden')};
}));
await pop.evaluate(() => document.querySelector('.tile[data-id="folders"]').click());
await wait(1200);
console.log('after switch off', JSON.stringify(await state(), null, 1));
console.log('errors', JSON.stringify(errs));
stop();
