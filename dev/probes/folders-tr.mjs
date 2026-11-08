import path from 'node:path';
import {startExtension} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'), {lang: 'tr-TR'});
const wait = ms => new Promise(r => setTimeout(r, ms));
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 900});
await tab.goto('https://turbowarp.org/editor', {waitUntil: 'networkidle2', timeout: 120000});
await wait(5000);
await tab.keyboard.press('Escape');
await tab.evaluate(() => window.vm.duplicateSprite(window.vm.runtime.targets.find(t => !t.isStage).id));
await wait(800);

const ui = () => tab.evaluate(() => {
    const bar = document.querySelector('.adox-folders');
    return {
        chips: bar ? [...bar.querySelectorAll('.adox-fchip')].map(c => c.textContent.trim()) : null,
        shown: [...document.querySelectorAll('[class*="sprite-selector_sprite-wrapper"]')]
            .filter(w => w.style.display !== 'none')
            .map(w => (w.querySelector('[class*="sprite-selector-item_sprite-name"]') || {}).textContent),
        store: JSON.parse(localStorage.getItem('adox-folders-v1') || '{}')
    };
});
// Turkish locale in the editor: create a folder and assign the selected sprite
await tab.click('.adox-fnew');
await wait(250);
await tab.keyboard.type('Karakterler');
await tab.keyboard.press('Enter');
await wait(400);
await tab.evaluate(() => {
    const tile = document.querySelector('[class*="sprite-selector-item_sprite-selector-item"]');
    tile.querySelector('.adox-sf-tile').click();
});
await wait(300);
console.log('menu tr', await tab.evaluate(() => [...document.querySelectorAll('.adox-fmenu button')].map(b => b.textContent.trim())));
await tab.evaluate(() => {
    const row = [...document.querySelectorAll('.adox-fmenu button')].find(b => /Karakterler/.test(b.textContent));
    if (row) row.click();
});
await wait(400);
console.log('assigned', JSON.stringify(await ui()));

// rename the sprite through the VM and check the folder follows the runtime id
await tab.evaluate(() => {
    const t = window.vm.runtime.targets.find(x => !x.isStage);
    window.vm.renameSprite(t.id, 'Jotaro');
});
await wait(1200);
const afterRename = await ui();
console.log('after sprite rename', JSON.stringify(afterRename));
await tab.evaluate(() => document.querySelector('.adox-fchip[data-folder]:not([data-folder=""])').click());
await wait(400);
console.log('folder view', JSON.stringify(await ui()));
console.log('all chip label', await tab.evaluate(() => document.querySelector('.adox-fchip[data-folder=""]').textContent.trim()));

// remove from the folder
await tab.evaluate(() => {
    const tile = document.querySelector('[class*="sprite-selector-item_sprite-selector-item"]');
    tile.querySelector('.adox-sf-tile').click();
});
await wait(300);
console.log('menu assigned', await tab.evaluate(() => [...document.querySelectorAll('.adox-fmenu button')].map(b => b.textContent.trim())));
await tab.evaluate(() => {
    const row = [...document.querySelectorAll('.adox-fmenu button')].find(b => /No folder|Klasörsüz/.test(b.textContent));
    if (row) row.click();
});
await wait(500);
console.log('after unassign', JSON.stringify(await ui()));
stop();
