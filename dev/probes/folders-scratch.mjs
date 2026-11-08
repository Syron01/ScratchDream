import path from 'node:path';
import {startExtension, shotPath} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, id, stop} = await startExtension(path.join(ROOT, 'extension'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const tab = await browser.newPage();
const errs = [];
tab.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 180)));
tab.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 180)); });
await tab.setViewport({width: 1440, height: 900});
await tab.goto('https://scratch.mit.edu/projects/editor/', {waitUntil: 'networkidle2', timeout: 120000});
await wait(9000);
await tab.keyboard.press('Escape');
console.log('title', await tab.evaluate(() => document.title));
console.log('pane', await tab.evaluate(() => !!document.querySelector('[class*="sprite-selector_sprite-selector"]')));
await wait(2000);
const ui = () => tab.evaluate(() => {
    const bar = document.querySelector('.adox-folders');
    return {
        bar: !!bar,
        chips: bar ? [...bar.querySelectorAll('.adox-fchip[data-folder]')].map(c => c.textContent.trim()) : null,
        colors: bar ? {bg: getComputedStyle(bar).backgroundColor, color: getComputedStyle(bar).color,
            accent: getComputedStyle(bar.querySelector('.adox-fchip')).color} : null,
        tileBtns: document.querySelectorAll('.adox-sf-tile').length,
        selectedBorder: (() => {
            const t = document.querySelector('[class*="sprite-selector-item_is-selected"]');
            return t ? getComputedStyle(t).borderTopColor : null;
        })()
    };
});
console.log('initial', JSON.stringify(await ui()));
await tab.click('.adox-fnew');
await wait(250);
await tab.keyboard.type('Jotaro');
await tab.keyboard.press('Enter');
await wait(500);
console.log('created', JSON.stringify(await ui()));
// assign the only sprite via the tile button
await tab.evaluate(() => {
    const tile = document.querySelector('[class*="sprite-selector-item_sprite-selector-item"]');
    tile.querySelector('.adox-sf-tile').click();
});
await wait(300);
console.log('menu rows', await tab.evaluate(() => [...document.querySelectorAll('.adox-fmenu button')].map(b => b.textContent.trim())));
await tab.evaluate(() => {
    const row = [...document.querySelectorAll('.adox-fmenu button')].find(b => /Jotaro/.test(b.textContent));
    if (row) row.click();
});
await wait(500);
console.log('assigned', JSON.stringify(await ui()));
// view the folder
await tab.evaluate(() => {
    const chip = document.querySelector('.adox-fchip[data-folder]:not([data-folder=""])');
    if (chip) chip.click();
});
await wait(400);
console.log('filtered shown', await tab.evaluate(() => [...document.querySelectorAll('[class*="sprite-selector_sprite-wrapper"]')].filter(w => w.style.display !== 'none').length));
await tab.screenshot({path: shotPath('folders-scratch'), clip: await tab.evaluate(() => {
    const r = document.querySelector('[class*="sprite-selector_sprite-selector"]').getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
})});
console.log('bar box', await tab.evaluate(() => {
    const b = document.querySelector('.adox-folders').getBoundingClientRect();
    const s = document.querySelector('[class*="sprite-selector_scroll-wrapper"]').getBoundingClientRect();
    return {bar: {w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top)},
        scroll: {w: Math.round(s.width), h: Math.round(s.height), top: Math.round(s.top)}};
}));
console.log('errors', JSON.stringify(errs));
stop();
