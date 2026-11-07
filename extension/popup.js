'use strict';

// Two languages are written here and the browser picks one. The panels inside the editor instead
// read the language the site was loaded in, so the two can disagree on a Turkish Windows with an
// English Scratch. Closing that gap needs the page's locale relayed through bridge.js into
// storage; nothing else in this file can see it.
var TR = (navigator.language || 'en').toLowerCase().indexOf('tr') === 0;

var ICONS = {
    search: '<circle cx="10.5" cy="10.5" r="6.4" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M15.4 15.4 21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    power: '<path d="M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17A8.932 8.932 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z"/>',
    external: '<path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>',
    pixel: '<path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 0h2v6h-6v-2h4v-4zM8 8h8v8H8z"/>',
    shapes: '<path d="M12 2 6.5 11h11L12 2zM17.5 13a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM3 13h8v8H3v-8z"/>',
    pen: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
    anchor: '<path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>',
    layers: '<path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/>',
    mask: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13.5v11c3.04 0 5.5-2.46 5.5-5.5S15.04 6.5 12 6.5z"/>',
    gradient: '<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zM6.5 12c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>',
    board: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
    bolt: '<path d="M11 21h-1l1-7H7.5c-.85 0-.55-.34-.31-.78C8.73 10.79 10.53 7.54 13 3h1l-1 7h3.48c.83 0 .57.34.32.78C13.27 15.21 11 21 11 21z"/>'
};

function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g>' +
        (ICONS[name] || '') + '</g></svg>';
}

// Material glyphs do not share one optical box: my_location fills 22 units while the pencil
// fills 18, so at a fixed size some icons read large and some small. Every glyph is fitted to
// the same optical square around the icon centre, which is what makes the column look even.
function fitGlyphs(root) {
    (root || document).querySelectorAll('svg > g').forEach(function (g) {
        var svgEl = g.ownerSVGElement;
        var box = parseFloat(window.getComputedStyle(svgEl).width) || 20;
        var b;
        try { b = g.getBBox(); } catch (e) { return; }
        if (!b.width || !b.height) return;
        // equal area rather than equal bbox: a narrow bolt and a wide bar glyph then carry
        // the same visual mass as a square one
        var target = box * 0.84;
        var k = Math.sqrt((target * target) / Math.max(1, b.width * b.height));
        k = Math.min(1.12, Math.max(0.72, k));
        var cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        g.setAttribute('transform', 'translate(' + (12 - cx * k).toFixed(2) + ' ' +
            (12 - cy * k).toFixed(2) + ') scale(' + k.toFixed(3) + ')');
    });
}

// Each tile says what the tool really does. The keys are the ones the editor actually listens for.
var FEATURES = [
    {
        id: 'pixel', group: 'drawing', icon: 'pixel', keys: ['Alt + P'],
        en: ['Vector bitmapping', 'Pixel art that never blurs'],
        tr: ['Vektör pikselleme', 'Bulanıklık yapmayan piksel sanatı'],
        search: 'pixel vector bitmapping blur crisp unblur snap grid trim residue transparent edge bitmap piksel'
    },
    {
        id: 'shapes', group: 'drawing', icon: 'shapes',
        en: ['Shape tools', 'Arm a shape, then drag'],
        tr: ['Şekil araçları', 'Kuşan, sürükleyerek boyutlandır'],
        search: 'shape triangle star arrow square circle sekil'
    },
    {
        id: 'pen', group: 'drawing', icon: 'pen', keys: ['[ ]', 'Alt + wheel'],
        en: ['Pen and nibs', 'Six pressure nibs'],
        tr: ['Kalem ve uçlar', 'Basınç okuyan 6 uç'],
        search: 'pen nib pressure brush kalem basinc'
    },
    {
        id: 'anchor', group: 'drawing', icon: 'anchor', keys: ['Alt + D'],
        en: ['Animation anchor', 'Centres every pivot'],
        tr: ['Animasyon ekseni', 'Eksen çizimin ortasına'],
        search: 'anchor pivot center jitter animation eksen merkez'
    },
    {
        id: 'rail', group: 'panels', icon: 'layers',
        en: ['Layer rail', 'Pick, hide, lock, reorder'],
        tr: ['Katman şeridi', 'Seç, gizle, kilitle, sırala'],
        search: 'layer rail objects hide lock rename order katman'
    },
    {
        id: 'fx', group: 'panels', icon: 'mask', keys: ['Alt + M', 'Alt + B', 'Alt + X'],
        en: ['Mask and blend', 'Masks, blend, PNG'],
        tr: ['Maske ve karışım', 'Maske, karışım, PNG'],
        search: 'mask blend clip png export maske karisim'
    },
    {
        id: 'board', group: 'panels', icon: 'board',
        en: ['Plan board', 'Cards saved in the browser'],
        tr: ['Plan tahtası', 'Kartlar tarayıcıda saklanır'],
        search: 'board plan notes cards gdd columns tahta not kart'
    },
    {
        id: 'gradient', group: 'colour', icon: 'gradient',
        en: ['Gradient stops', 'Stops in the colour box'],
        tr: ['Degrade durakları', 'Duraklar renk kutusunda'],
        search: 'gradient stops colour color degrade renk'
    },
    {
        id: 'speed', group: 'speed', icon: 'bolt',
        en: ['Load diet', 'Slower polling when idle, analytics blocked'],
        tr: ['Yük diyeti', 'Boşta yavaş yoklama, analitik engeli'],
        search: 'speed performance lag freeze fps repaint diet optimisation hiz performans kasılma donma boyama analitik'
    }
];

var I18N = {
    search: ['Search', 'Ara'],
    filters: [
        ['All', 'Drawing', 'Panels', 'Colour', 'Speed'],
        ['Tümü', 'Çizim', 'Paneller', 'Renk', 'Hız']
    ],
    status: ['{on} of {total} on', '{on} / {total} açık'],
    alloff: ['Turn all off', 'Hepsini kapat'],
    allon: ['Turn all on', 'Hepsini aç'],
    open: ['Open editor', 'Editörü aç'],
    empty: ['Nothing matches.', 'Eşleşen yok.']
};

function pick(pair) {
    return Array.isArray(pair) ? pair[TR ? 1 : 0] : pair[TR ? 'tr' : 'en'];
}

function words(f) {
    return f[TR ? 'tr' : 'en'];
}

function el(tag, cls, value) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
}

var store = {};

function tileOf(f) {
    var tile = el('article', 'tile');
    tile.dataset.group = f.group;
    tile.dataset.id = f.id;
    tile.dataset.search = f.search + ' ' + words(f).join(' ');
    tile.tabIndex = 0;

    var icon = el('span', 'tile-icon');
    icon.innerHTML = svg(f.icon);

    var text = el('div', 'tile-text');
    text.append(el('p', 'tile-name', words(f)[0]), el('p', 'tile-desc', words(f)[1]));

    var sw = el('button', 'switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', words(f)[0]);
    sw.setAttribute('aria-checked', String(store[f.id] !== false));

    tile.append(icon, text, sw);

    function toggle() {
        sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'));
        store[f.id] = sw.getAttribute('aria-checked') === 'true';
        save();
        refresh();
    }
    sw.addEventListener('click', function (event) {
        event.stopPropagation();
        toggle();
    });
    tile.addEventListener('click', function (event) {
        if (event.target !== sw) toggle();
    });
    tile.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });
    return tile;
}

var tiles = [];
var filters = [];

function refresh() {
    var on = 0;
    tiles.forEach(function (tile) {
        var sw = tile.querySelector('.switch');
        var live = sw.getAttribute('aria-checked') === 'true';
        tile.classList.toggle('is-on', live);
        tile.dataset.on = String(live);
        if (live) on++;
    });
    document.getElementById('status').textContent = pick(I18N.status)
        .replace('{on}', on).replace('{total}', tiles.length);
    document.getElementById('alloff-label').textContent = pick(on ? I18N.alloff : I18N.allon);
}

function applyFilters() {
    var q = document.getElementById('search').value.trim().toLowerCase();
    var active = (filters.filter(function (f) { return f.getAttribute('aria-pressed') === 'true'; })[0] || filters[0]).dataset.filter;
    var visible = 0;
    tiles.forEach(function (tile) {
        var sameGroup = active === 'all' || tile.dataset.group === active;
        var hit = !q || tile.dataset.search.toLowerCase().indexOf(q) >= 0;
        var show = sameGroup && hit;
        tile.classList.toggle('is-hidden', !show);
        if (show) visible++;
    });
    document.getElementById('empty').classList.toggle('show', visible === 0);
}

// The diet switch owns a network ruleset too, and Chrome keeps that state outside our storage.
// Every save, and every opening of this popup, pushes the stored truth across.
// The Chrome this was tested on names these option fields enableRulesetIds/disableRulesetIds and
// older ones enableRulesets/disableRulesets; each build answers the other's spelling with a binding
// error. The retry is here because swallowing that error once left the switch clicking happily
// while the ruleset never moved at all.
var SPELLS = [['enableRulesetIds', 'disableRulesetIds'], ['enableRulesets', 'disableRulesets']];
var spell = 0;

function syncDiet(on) {
    var dnr = chrome.declarativeNetRequest;
    if (!dnr || !dnr.updateEnabledRulesets) return;
    function push() {
        var options = {};
        options[on ? SPELLS[spell][0] : SPELLS[spell][1]] = ['diet'];
        return dnr.updateEnabledRulesets(options).catch(function () {
            if (spell > 0) return;
            spell = 1;
            return push();
        });
    }
    dnr.getEnabledRulesets().then(function (live) {
        if ((live.indexOf('diet') >= 0) === on) return;
        return push();
    }).catch(function () { /* a Chrome that gives no ruleset access keeps whatever it has */ });
}

function save() {
    var payload = {};
    FEATURES.forEach(function (f) { payload[f.id] = store[f.id] !== false; });
    chrome.storage.local.set({features: payload});
    syncDiet(payload.speed !== false);
}

function render() {
    var grid = document.getElementById('grid');
    var empty = document.getElementById('empty');
    FEATURES.forEach(function (f) {
        var tile = tileOf(f);
        grid.insertBefore(tile, empty);
        tiles.push(tile);

        // the tile is the switch's label; a click anywhere on it counts, and so does keyboard focus
        tile.querySelector('.switch').addEventListener('keydown', function (event) {
            event.stopPropagation();
        });
    });
    refresh();
    applyFilters();
    fitGlyphs();
}

function localise() {
    document.documentElement.lang = TR ? 'tr' : 'en';
    var search = document.getElementById('search');
    search.placeholder = pick(I18N.search);
    search.setAttribute('aria-label', pick(I18N.search));
    Array.prototype.forEach.call(document.querySelectorAll('.filter'), function (b, i) {
        b.textContent = pick(I18N.filters)[i];
    });
    document.getElementById('empty').textContent = pick(I18N.empty);
    document.getElementById('alloff').setAttribute('aria-label', pick(I18N.alloff));
    document.getElementById('alloff').title = pick(I18N.alloff);
    document.getElementById('editor-label').textContent = pick(I18N.open);
    document.getElementById('editor').title = pick(I18N.open);
}

document.querySelectorAll('[data-icon]').forEach(function (node) {
    node.innerHTML = svg(node.dataset.icon);
});
fitGlyphs();

localise();

filters = Array.prototype.slice.call(document.querySelectorAll('.filter'));
filters.forEach(function (f) {
    f.addEventListener('click', function () {
        filters.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        f.setAttribute('aria-pressed', 'true');
        applyFilters();
    });
});

document.getElementById('search').addEventListener('input', applyFilters);

document.addEventListener('keydown', function (event) {
    var input = document.getElementById('search');
    if (event.key === '/' && document.activeElement !== input) {
        event.preventDefault();
        input.focus();
    } else if (event.key === 'Escape' && document.activeElement === input) {
        input.value = '';
        applyFilters();
        input.blur();
    }
});

document.getElementById('alloff').addEventListener('click', function () {
    var anyOn = FEATURES.some(function (f) { return store[f.id] !== false; });
    FEATURES.forEach(function (f) { store[f.id] = !anyOn; });
    save();
    tiles.forEach(function (tile) {
        var f = FEATURES.filter(function (x) { return x.id === tile.dataset.id; })[0];
        tile.querySelector('.switch').setAttribute('aria-checked', String(store[f.id] !== false));
    });
    refresh();
});

document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

chrome.storage.local.get('features', function (saved) {
    store = (saved && saved.features) || {};
    render();
    syncDiet(store.speed !== false);
});
