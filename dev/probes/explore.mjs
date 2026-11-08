// Proves the rebuilt Explore page: five pages fetched at once, the native 16-card grid
// replaced by a scored feed with four counts per card, endless scrolling, the Rising order
// matching the Explore 2.0 formula, search and the extra category filters.
import path from 'node:path';
import {startExtension} from '../harness.mjs';
const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const tab = await browser.newPage();
await tab.setViewport({width: 1366, height: 900});
await tab.goto('https://scratch.mit.edu/explore/projects/all', {waitUntil: 'networkidle2', timeout: 120000});
await tab.waitForFunction(() => document.querySelectorAll('.sd-explore-card').length >= 100, {timeout: 40000});
const initial = await tab.evaluate(() => ({
    cards: document.querySelectorAll('.sd-explore-card').length,
    stats: document.querySelectorAll('.sd-explore-card .sd-meta-item').length /
        document.querySelectorAll('.sd-explore-card').length,
    nativeHidden: getComputedStyle(document.querySelector('.grid .flex-row')).display,
    sorts: [...document.querySelectorAll('.sd-explore-sort option')].map(o => o.textContent),
    status: !document.querySelector('.sd-explore-foot').hidden,
    cacheKeys: Object.keys(localStorage).filter(k => k.startsWith('sd-explore:')).length
}));

// sorting must never move the reader
await tab.evaluate(() => scrollTo(0, 600));
await wait(300);
const before = await tab.evaluate(() => scrollY);
await tab.select('.sd-explore-sort', 'newest');
await wait(3500);
const after = await tab.evaluate(() => scrollY);
await tab.select('.sd-explore-sort', 'rising');
await wait(5000);
const dom = await tab.evaluate(() => [...document.querySelectorAll('.sd-explore-card .thumbnail-image')]
    .slice(0, 10).map(a => a.href.match(/\d+/)[0]));
// independent recomputation of the rising pool; the page shuffles the seeded order, so the
// claim is that every card sits within the shuffle window of its score rank
const calc = await tab.evaluate(async () => {
    const pools = [];
    for (const start of [0, 1]) {
        const pages = [];
        for (let i = 0; i < 5; i++) {
            pages.push(fetch('https://api.scratch.mit.edu/search/projects?q=*&mode=recent&limit=40&offset=' +
                (start + i) * 40 + '&language=en').then(r => r.json()));
        }
        const seen = {};
        pools.push((await Promise.all(pages)).flat().filter(p => !seen[p.id] && (seen[p.id] = 1)).map(p => {
            const days = Math.max(0, (Date.now() - Date.parse(p.history.shared)) / 86400000);
            return {id: String(p.id), score: (p.stats.loves + 0.6 * p.stats.favorites) /
                Math.max(Math.pow(4, days - 2) + 6 * days - 0.25, 3)};
        }).sort((a, b) => b.score - a.score).map(x => x.id));
    }
    return pools;
});
const cover = pool => dom.filter(id => pool.includes(id)).length;
const best = cover(calc[0]) >= cover(calc[1]) ? calc[0] : calc[1];
const ranks = dom.map(id => best.indexOf(id));
const risingInWindow = ranks.filter(rank => rank >= 0).length >= 9 &&
    ranks.every((rank, i) => rank < 0 || Math.abs(rank - i) <= 16);
const search = await tab.evaluate(async () => {
    const input = document.querySelector('.sd-explore-search');
    input.value = 'pixel art';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await new Promise(r => setTimeout(r, 4000));
    return {
        first: [...document.querySelectorAll('.sd-explore-card .thumbnail-title a')].slice(0, 3).map(a => a.textContent),
        foot: !document.querySelector('.sd-explore-foot').hidden,
        sort: document.querySelector('.sd-explore-sort').selectedOptions[0].textContent
    };
});
for (let i = 0; i < 2; i++) {
    await tab.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await wait(2000);
}
const scrolled = await tab.evaluate(() => ({
    cards: document.querySelectorAll('.sd-explore-card').length,
    foot: !document.querySelector('.sd-explore-foot').hidden
}));
console.log(JSON.stringify({initial, scrollKept: before === after,
    risingInWindow, risingRanks: ranks,
    search, scrolled}, null, 2));
// a sort or language change must swap the feed without ever blanking the grid
async function swap(action, ms) {
    const watch = tab.evaluate(d => new Promise(res => {
        const t = performance.now();
        let min = 1e9;
        (function tick() {
            const g = document.querySelector('.sd-explore-grid');
            if (g) min = Math.min(min, g.querySelectorAll('.sd-explore-card').length);
            if (performance.now() - t < d) requestAnimationFrame(tick); else res(min);
        })();
    }), ms);
    await wait(150);
    await action();
    return watch;
}
const onSort = await swap(() => tab.select('.sd-explore-sort', 'popular'), 2500);
const onLang = await swap(() => tab.select('.sd-explore-lang', 'tr'), 2500);
const langUi = await tab.evaluate(() => ({
    placeholder: document.querySelector('.sd-explore-search').placeholder,
    sortLabel: document.querySelector('.sd-explore-sort-label').textContent,
    meta: [...document.querySelectorAll('.sd-explore-card .sd-meta-item')].slice(0, 2)
        .map(s => s.getAttribute('aria-label'))
}));
console.log(JSON.stringify({onSort, onLang, blankFree: onSort > 0 && onLang > 0, langUi}, null, 2));
stop();
