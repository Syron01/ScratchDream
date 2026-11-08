// End-to-end check for the ScratchDream optimizer against the live TurboWarp editor.
// - installs a synthetic project with a metadata-heavy SVG, PNG and WAV
// - verifies the menu button, the native dialog, the passes and the undo journal
// - confirms the project still serialises and the cleaned assets keep their pixels
import path from 'node:path';
import zlib from 'node:zlib';
import {startExtension, shotPath} from './harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(buffer) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([length, typeBuffer, data, crc]);
}
function makePng() {
    const width = 12;
    const height = 12;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const raw = Buffer.alloc((1 + width * 4) * height);
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 4);
        raw[row] = 0;
        for (let x = 0; x < width; x++) {
            const at = row + 1 + x * 4;
            raw[at] = Math.round(255 * x / (width - 1));
            raw[at + 1] = Math.round(255 * y / (height - 1));
            raw[at + 2] = 90;
            raw[at + 3] = 255;
        }
    }
    const idat = zlib.deflateSync(raw, {level: 9});
    const text = Buffer.from('Comment\0' + 'ScratchDream metadata '.repeat(80), 'latin1');
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(2835, 0);
    phys.writeUInt32BE(2835, 4);
    phys[8] = 1;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr),
        pngChunk('tEXt', text),
        pngChunk('pHYs', phys),
        pngChunk('IDAT', idat),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}
function wavChunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32LE(data.length, 4);
    const pad = Buffer.alloc(data.length & 1);
    return Buffer.concat([header, data, pad]);
}
function makeWav() {
    const samples = 9600;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        data.writeInt16LE(Math.round(Math.sin(i / 8) * 5000), i * 2);
    }
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(1, 0);
    fmt.writeUInt16LE(1, 2);
    fmt.writeUInt32LE(8000, 4);
    fmt.writeUInt32LE(16000, 8);
    fmt.writeUInt16LE(2, 12);
    fmt.writeUInt16LE(16, 14);
    const info = Buffer.from('INFO' + 'ISFT' + String(24).padStart(8, '0') + 'ScratchDream metadata!!', 'latin1');
    const junk = Buffer.from('ScratchDream junk '.repeat(80), 'latin1');
    const chunks = Buffer.concat([
        wavChunk('fmt ', fmt),
        wavChunk('LIST', info),
        wavChunk('JUNK', junk),
        wavChunk('data', data)
    ]);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 4, 'ascii');
    header.writeUInt32LE(chunks.length + 4, 4);
    header.write('WAVE', 8, 4, 'ascii');
    return Buffer.concat([header, chunks]);
}

const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${'ScratchDream metadata padding '.repeat(180)} -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     version="1.1" width="120" height="90" viewBox="0 0 120 90">
  <metadata>${'editor metadata '.repeat(300)}</metadata>
  <sodipodi:namedview id="namedview1" inkscape:zoom="1" inkscape:cx="0" inkscape:cy="0"/>
  <title>Optimizer test</title>
  <defs>
    <linearGradient id="usedGrad"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
    <linearGradient id="unusedGrad"><stop offset="0" stop-color="#00ff00"/><stop offset="1" stop-color="#ffff00"/></linearGradient>
    <filter id="unusedFilter"><feGaussianBlur stdDeviation="2"/></filter>
    <style>  </style>
  </defs>
  <g id="layer1" data-name="Layer 1" inkscape:label="Layer 1">
    <rect x="1.23456789" y="2.3456789" width="50.1234567" height="40.9876543" fill="url(#usedGrad)"/>
    <circle cx="80.123456" cy="40.987654" r="20.123456" fill="#123456"/>
    <path d="M10.123456 70.987654 L40.123456 70.987654 L25.123456 88.987654 Z" fill="#ff8800"/>
    <g></g>
  </g>
</svg>`;

const pngBase64 = makePng().toString('base64');
const wavBase64 = makeWav().toString('base64');

const {browser, stop} = await startExtension(path.join(ROOT, 'extension'));
const tab = await browser.newPage();
await tab.setViewport({width: 1440, height: 980});
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await tab.goto('https://turbowarp.org/editor', {waitUntil: 'networkidle2', timeout: 120000});
await wait(5000);

const installed = await tab.evaluate(async ({svgText, pngBase64, wavBase64}) => {
    const vm = window.vm;
    const storage = vm.runtime.storage;
    const svgAsset = storage.createAsset('costume', 'svg', new TextEncoder().encode(svgText), null, true);
    const pngAsset = storage.createAsset('costume', 'png',
        Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0)), null, true);
    const wavAsset = storage.createAsset('sound', 'wav',
        Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0)), null, true);
    const project = {
        targets: [
            {
                isStage: true, name: 'Stage',
                variables: {gidUsed: ['usedGlobal', 0], gidUnused: ['unusedGlobal', 0]},
                lists: {lidUnused: ['unusedList', []]},
                broadcasts: {usedMsg: 'used message', unusedMsg: 'unused message'},
                blocks: {}, comments: {},
                currentCostume: 0,
                costumes: [{
                    name: 'backdrop-svg', dataFormat: 'svg', assetId: svgAsset.assetId,
                    md5ext: svgAsset.assetId + '.svg', rotationCenterX: 60, rotationCenterY: 45
                }],
                sounds: [], volume: 100, layerOrder: 0, tempo: 60,
                videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
            },
            {
                isStage: false, name: 'Sprite1',
                variables: {lidUsed: ['usedLocal', 0], lidUnused: ['unusedLocal', 0]},
                lists: {}, broadcasts: {},
                blocks: {
                    flag1: {opcode: 'event_whenflagclicked', next: 'setGlobal', parent: null, inputs: {}, fields: {}, topLevel: true, x: 340, y: 420},
                    setGlobal: {opcode: 'data_setvariableto', next: 'setLocal', parent: 'flag1', inputs: {VALUE: [1, [10, '42']]}, fields: {VARIABLE: ['usedGlobal', 'gidUsed']}, topLevel: false},
                    setLocal: {opcode: 'data_setvariableto', next: null, parent: 'setGlobal', inputs: {VALUE: [1, [10, '7']]}, fields: {VARIABLE: ['usedLocal', 'lidUsed']}, topLevel: false},
                    emptyHat: {opcode: 'event_whenflagclicked', next: null, parent: null, inputs: {}, fields: {}, topLevel: true, x: 640, y: 500},
                    hatWithComment: {opcode: 'event_whenflagclicked', next: null, parent: null, inputs: {}, fields: {}, topLevel: true, x: 20, y: 800},
                    recvUsed: {opcode: 'event_whenbroadcastreceived', next: 'setAfterRecv', parent: null, inputs: {}, fields: {BROADCAST_OPTION: ['used message', 'usedMsg']}, topLevel: true, x: 900, y: 420},
                    setAfterRecv: {opcode: 'data_setvariableto', next: null, parent: 'recvUsed', inputs: {VALUE: [1, [10, '1']]}, fields: {VARIABLE: ['usedGlobal', 'gidUsed']}, topLevel: false}
                },
                comments: {
                    cEmpty: {blockId: null, x: 1, y: 1, width: 100, height: 50, minimized: false, text: ''},
                    cEmptyOnBlock: {blockId: 'setGlobal', x: 1, y: 1, width: 100, height: 50, minimized: false, text: '   '},
                    cKeep: {blockId: 'hatWithComment', x: 1, y: 1, width: 100, height: 50, minimized: false, text: 'keep me'}
                },
                currentCostume: 1,
                costumes: [
                    {name: 'vector', dataFormat: 'svg', assetId: svgAsset.assetId, md5ext: svgAsset.assetId + '.svg', rotationCenterX: 60, rotationCenterY: 45},
                    {name: 'bitmap', bitmapResolution: 1, dataFormat: 'png', assetId: pngAsset.assetId, md5ext: pngAsset.assetId + '.png', rotationCenterX: 6, rotationCenterY: 6}
                ],
                sounds: [{
                    name: 'beep', dataFormat: 'wav', assetId: wavAsset.assetId,
                    md5ext: wavAsset.assetId + '.wav', sampleCount: 9600, rate: 8000
                }],
                volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100,
                direction: 90, draggable: false, rotationStyle: 'all around'
            }
        ],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: 'ScratchDream optimizer test'}
    };
    vm.clear();
    await vm.fromJSON(project);
    const sprite = vm.runtime.targets.find(t => !t.isStage);
    const stage = vm.runtime.getTargetForStage();
    // fromJSON asks the storage web stores for the asset ids; keep the synthetic assets local
    // by putting the created objects straight onto the costume and sound records.
    function wireAsset (owner, asset, format) {
        owner.asset = asset;
        owner.assetId = asset.assetId;
        owner.dataFormat = format;
        owner.md5 = asset.assetId + '.' + format;
        if (Object.prototype.hasOwnProperty.call(owner, 'md5ext')) {
            owner.md5ext = asset.assetId + '.' + format;
        }
    }
    wireAsset(stage.getCostumes()[0], svgAsset, 'svg');
    wireAsset(sprite.getCostumes()[0], svgAsset, 'svg');
    wireAsset(sprite.getCostumes()[1], pngAsset, 'png');
    wireAsset(sprite.getSounds()[0], wavAsset, 'wav');
    vm.setEditingTarget(sprite.id);
    await new Promise(r => setTimeout(r, 300));
    function state() {
        return {
            stageCostume: stage.getCostumes()[0].assetId,
            spriteCostumes: sprite.getCostumes().map(c => c.assetId),
            spriteSound: sprite.getSounds()[0].assetId,
            stageVars: Object.values(stage.variables).map(v => ({id: v.id, name: v.name, type: v.type})),
            spriteVars: Object.values(sprite.variables).map(v => ({id: v.id, name: v.name, type: v.type})),
            blockIds: Object.keys(sprite.blocks._blocks),
            scripts: sprite.blocks._scripts.slice(),
            comments: Object.keys(sprite.comments),
            positions: sprite.blocks._scripts.map(id => {
                const b = sprite.blocks._blocks[id];
                return b ? {id: id, x: b.x, y: b.y} : null;
            }),
            data: {
                svg: (() => { const c = sprite.getCostumes()[0]; return c.asset.decodeText ? c.asset.decodeText() : ''; })(),
                png: (() => { const c = sprite.getCostumes()[1]; return c.asset.data instanceof Uint8Array ? c.asset.data : new Uint8Array(c.asset.data); })(),
                wav: (() => { const s = sprite.getSounds()[0]; return s.asset.data instanceof Uint8Array ? s.asset.data : new Uint8Array(s.asset.data); })()
            }
        };
    }
    const before = state();
    window.__adoxTestBefore = {png: before.data.png.slice()};
    return {
        ok: true,
        hasButton: !!document.getElementById('adox-optimize-button'),
        before: {
            stageCostume: before.stageCostume,
            spriteCostumes: before.spriteCostumes,
            spriteSound: before.spriteSound,
            stageVars: before.stageVars,
            spriteVars: before.spriteVars,
            blockIds: before.blockIds,
            scripts: before.scripts,
            comments: before.comments,
            positions: before.positions,
            svgLength: before.data.svg.length,
            pngLength: before.data.png.length,
            pngHasText: new TextDecoder('latin1').decode(before.data.png).indexOf('tEXt') >= 0,
            wavLength: before.data.wav.length,
            wavHasList: new TextDecoder('latin1').decode(before.data.wav).indexOf('LIST') >= 0,
            soundFormat: sprite.getSounds()[0].dataFormat,
            soundDuration: 1.2
        }
    };
}, {svgText, pngBase64, wavBase64});

console.log(JSON.stringify({installed}, null, 2));
if (!installed.ok) {
    console.log(JSON.stringify({errors}, null, 2));
    await stop();
    process.exit(1);
}

await wait(500);
await tab.click('#adox-optimize-button');
await wait(700);
const confirm = await tab.evaluate(() => {
    const overlay = document.querySelector('[data-adox-optimize]');
    return {
        open: !!overlay,
        text: overlay ? overlay.innerText : '',
        cancel: !!(overlay && [...overlay.querySelectorAll('button')].find(b => /Cancel/i.test(b.textContent))),
        primary: !!(overlay && [...overlay.querySelectorAll('button')].find(b => /Optimize now/i.test(b.textContent)))
    };
});
console.log(JSON.stringify({confirm}, null, 2));
await tab.screenshot({path: shotPath('optimizer-test-confirm.png')});

await tab.evaluate(() => {
    const button = [...document.querySelectorAll('[data-adox-optimize] button')]
        .find(b => /Optimize now/i.test(b.textContent));
    if (button) button.click();
});
let result = null;
for (let i = 0; i < 30; i++) {
    await wait(500);
    result = await tab.evaluate(() => {
        const overlay = document.querySelector('[data-adox-optimize]');
        if (!overlay) return {open: false};
        return {
            open: true,
            text: overlay.innerText,
            undo: [...overlay.querySelectorAll('button')].some(b => /Undo/i.test(b.textContent)),
            done: [...overlay.querySelectorAll('button')].some(b => /^Done$/i.test(b.textContent)),
            error: overlay.querySelector('.adox-opt-error') ? overlay.querySelector('.adox-opt-error').innerText : null
        };
    });
    if (result.undo && result.done) break;
}
console.log(JSON.stringify({result}, null, 2));
await tab.screenshot({path: shotPath('optimizer-test-result.png')});

const after = await tab.evaluate(async () => {
    const vm = window.vm;
    const stage = vm.runtime.getTargetForStage();
    const sprite = vm.runtime.targets.find(t => !t.isStage);
    const png = sprite.getCostumes()[1];
    const wav = sprite.getSounds()[0];
    const pngBytes = png.asset.data instanceof Uint8Array ? png.asset.data : new Uint8Array(png.asset.data);
    const wavBytes = wav.asset.data instanceof Uint8Array ? wav.asset.data : new Uint8Array(wav.asset.data);
    const svg = sprite.getCostumes()[0];
    const json = JSON.stringify(vm.toJSON());
    async function pngPixels (bytes) {
        const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        bitmap.close && bitmap.close();
        return data;
    }
    let pngPixelsEqual = null;
    let pngCompareError = null;
    try {
        const beforePixels = await pngPixels(window.__adoxTestBefore.png);
        const afterPixels = await pngPixels(pngBytes);
        pngPixelsEqual = beforePixels.length === afterPixels.length &&
            beforePixels.every((v, i) => v === afterPixels[i]);
    } catch (e) { pngCompareError = String(e); }
    let decodedSound = null;
    try {
        const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const ctx = new Offline(1, 1, 48000);
        const copy = new Uint8Array(wavBytes.length);
        copy.set(wavBytes);
        const buffer = await ctx.decodeAudioData(copy.buffer);
        decodedSound = {duration: buffer.duration, rate: buffer.sampleRate, channels: buffer.numberOfChannels};
    } catch (e) { decodedSound = {error: String(e)}; }
    let playValue = null;
    let playError = null;
    try {
        vm.greenFlag();
        await new Promise(r => setTimeout(r, 600));
        playValue = stage.variables.gidUsed ? stage.variables.gidUsed.value : null;
        vm.stopAll();
    } catch (e) { playError = String(e); }
    return {
        stageCostume: stage.getCostumes()[0].assetId,
        spriteCostumes: sprite.getCostumes().map(c => c.assetId),
        spriteSound: sprite.getSounds()[0].assetId,
        sameStageAndSpriteSvg: stage.getCostumes()[0].assetId === sprite.getCostumes()[0].assetId,
        stageVars: Object.values(stage.variables).map(v => ({id: v.id, name: v.name, type: v.type})),
        spriteVars: Object.values(sprite.variables).map(v => ({id: v.id, name: v.name, type: v.type})),
        blockIds: Object.keys(sprite.blocks._blocks),
        scripts: sprite.blocks._scripts.slice(),
        comments: Object.keys(sprite.comments),
        positions: sprite.blocks._scripts.map(id => {
            const b = sprite.blocks._blocks[id];
            return b ? {id: id, x: b.x, y: b.y} : null;
        }),
        svgLength: svg.asset.decodeText ? svg.asset.decodeText().length : 0,
        svgText: svg.asset.decodeText ? svg.asset.decodeText() : '',
        pngLength: pngBytes.length,
        pngHasText: new TextDecoder('latin1').decode(pngBytes).indexOf('tEXt') >= 0,
        wavLength: wavBytes.length,
        wavHasList: new TextDecoder('latin1').decode(wavBytes).indexOf('LIST') >= 0,
        soundFormat: wav.dataFormat,
        decodedSound: decodedSound,
        pngPixelsEqual: pngPixelsEqual,
        pngCompareError: pngCompareError,
        jsonLength: json.length,
        playValue: playValue,
        playError: playError
    };
});
console.log(JSON.stringify({after}, null, 2));

const undo = await tab.evaluate(async () => {
    const button = [...document.querySelectorAll('[data-adox-optimize] button')]
        .find(b => /Undo/i.test(b.textContent));
    if (!button) return {clicked: false};
    button.click();
    await new Promise(r => setTimeout(r, 300));
    const stage = window.vm.runtime.getTargetForStage();
    const sprite = window.vm.runtime.targets.find(t => !t.isStage);
    return {
        clicked: true,
        text: document.querySelector('[data-adox-optimize]').innerText,
        stageCostume: stage.getCostumes()[0].assetId,
        spriteCostumes: sprite.getCostumes().map(c => c.assetId),
        spriteSound: sprite.getSounds()[0].assetId,
        soundFormat: sprite.getSounds()[0].dataFormat,
        stageVars: Object.values(stage.variables).map(v => ({id: v.id, name: v.name, type: v.type})),
        spriteVars: Object.values(sprite.variables).map(v => ({id: v.id, name: v.name, type: v.type})),
        blockIds: Object.keys(sprite.blocks._blocks),
        scripts: sprite.blocks._scripts.slice(),
        comments: Object.keys(sprite.comments),
        positions: sprite.blocks._scripts.map(id => {
            const b = sprite.blocks._blocks[id];
            return b ? {id: id, x: b.x, y: b.y} : null;
        })
    };
});
console.log(JSON.stringify({undo}, null, 2));
await tab.screenshot({path: shotPath('optimizer-test-undo.png')});

console.log(JSON.stringify({errors}, null, 2));
await stop();
