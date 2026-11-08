// ScratchDream project optimizer. Runs in the editor's own world so it can reach the VM, the
// asset storage and the renderer. The button sits in the menu bar and the dialog is built from
// the editor's modal classes, so it looks like Scratch on every host (Scratch, TurboWarp,
// PenguinMod) without hardcoding a theme.
//
// The rule for every pass is the same: never change what a project does and never lower what it
// looks or sounds like. Vector costumes are rasterised before and after and rejected if the
// pixels move; bitmap and audio passes only remove metadata containers; code passes only touch
// things that are provably unreachable. Everything is staged and swapped in at the end, and the
// result screen can put the old records back.
(function () {
    'use strict';

    var BUTTON_ID = 'adox-optimize-button';
    var STYLE_ID = 'adox-optimize-style';
    var DIALOG_ID = 'adox-optimize-dialog';
    var TIME_BUDGET = 25000;
    var SVG_MAX_RASTER = 192;

    // ---------------------------------------------------------------- tiny helpers
    function clamp (v, a, b) {
        return Math.min(b, Math.max(a, v));
    }
    function now () {
        return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    }
    function nextTick () {
        return new Promise(function (resolve) { window.setTimeout(resolve, 0); });
    }
    function byteLength (value) {
        if (!value) return 0;
        if (typeof value === 'string') return new TextEncoder().encode(value).length;
        if (value.byteLength !== undefined) return value.byteLength;
        if (value.length !== undefined) return value.length;
        return 0;
    }
    function bytesOf (data) {
        if (!data) return new Uint8Array(0);
        if (typeof data === 'string') return new TextEncoder().encode(data);
        if (data instanceof Uint8Array) return data;
        if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        return new Uint8Array(0);
    }
    function encodeText (value) {
        return new TextEncoder().encode(String(value == null ? '' : value));
    }
    function assetBytes (asset) {
        if (!asset) return new Uint8Array(0);
        try {
            if (typeof asset.decodeText === 'function' && asset.dataFormat === 'svg') {
                return new TextEncoder().encode(asset.decodeText());
            }
        } catch (e) { /* fall through to raw data */ }
        return bytesOf(asset.data);
    }
    function assetText (asset) {
        if (!asset) return '';
        try {
            if (typeof asset.decodeText === 'function') return asset.decodeText();
        } catch (e) { /* fall through */ }
        var bytes = assetBytes(asset);
        try { return new TextDecoder().decode(bytes); } catch (e) { return ''; }
    }
    function formatNumber (value, digits, locale) {
        try {
            return new Intl.NumberFormat(locale || 'en', {
                minimumFractionDigits: 0,
                maximumFractionDigits: digits
            }).format(value);
        } catch (e) {
            return String(value);
        }
    }
    function formatBytes (n, locale) {
        if (!isFinite(n) || n <= 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = 0;
        var v = n;
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i++;
        }
        var digits = v >= 100 ? 0 : (v >= 10 ? 1 : 2);
        return formatNumber(v, digits, locale) + ' ' + units[i];
    }
    function formatCount (n, locale) {
        return formatNumber(n, 0, locale);
    }
    function escapeRegExp (text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function bytesToBase64 (bytes) {
        var chunk = 0x8000;
        var out = '';
        for (var i = 0; i < bytes.length; i += chunk) {
            out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(out);
    }
    function base64ToBytes (text) {
        var bin = atob(text.replace(/\s+/g, ''));
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    function readU32 (bytes, offset) {
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    }
    function writeU32 (out, offset, value) {
        out[offset] = (value >>> 24) & 255;
        out[offset + 1] = (value >>> 16) & 255;
        out[offset + 2] = (value >>> 8) & 255;
        out[offset + 3] = value & 255;
    }
    function readU16 (bytes, offset) {
        return (bytes[offset] << 8) | bytes[offset + 1];
    }
    function readU32LE (bytes, offset) {
        return (bytes[offset] | (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    }
    function readU16LE (bytes, offset) {
        return bytes[offset] | (bytes[offset + 1] << 8);
    }
    function writeU32LE (out, offset, value) {
        out[offset] = value & 255;
        out[offset + 1] = (value >>> 8) & 255;
        out[offset + 2] = (value >>> 16) & 255;
        out[offset + 3] = (value >>> 24) & 255;
    }
    function ascii (bytes, offset, length) {
        var out = '';
        for (var i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
        return out;
    }

    // ---------------------------------------------------------------- finding the VM
    var vmRef = null;
    function isVm (candidate) {
        return !!(candidate && candidate.runtime && candidate.runtime.storage &&
            typeof candidate.toJSON === 'function' && Array.isArray(candidate.runtime.targets));
    }
    function findVmInTree () {
        var host = document.getElementById('app') || document.body.firstElementChild;
        if (!host) return null;
        var key = null;
        var keys = Object.keys(host);
        for (var k = 0; k < keys.length; k++) {
            if (/reactContainer/i.test(keys[k])) {
                key = keys[k];
                break;
            }
        }
        var fiber = key ? host[key] : null;
        if (!fiber && host._reactRootContainer) {
            var root = host._reactRootContainer._internalRoot || host._reactRootContainer;
            fiber = root && root.current;
        }
        var queue = [];
        if (fiber) queue.push(fiber);
        for (var i = 0; i < queue.length && i < 8000; i++) {
            var f = queue[i];
            if (!f) continue;
            var props = f.memoizedProps;
            var stateProps = f.stateNode && f.stateNode.props;
            if (props && isVm(props.vm)) return props.vm;
            if (stateProps && isVm(stateProps.vm)) return stateProps.vm;
            if (f.child) queue.push(f.child);
            if (f.sibling) queue.push(f.sibling);
        }
        return null;
    }
    function findVm () {
        if (isVm(vmRef)) return vmRef;
        if (isVm(window.vm)) {
            vmRef = window.vm;
            return vmRef;
        }
        var found = findVmInTree();
        vmRef = isVm(found) ? found : null;
        return vmRef;
    }
    function originalTargets (vm) {
        var all = (vm && vm.runtime && vm.runtime.targets) || [];
        var out = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i] && all[i].isOriginal !== false) out.push(all[i]);
        }
        return out;
    }
    function targetName (target) {
        try { return target.getName(); } catch (e) { return target.isStage ? 'Stage' : 'Sprite'; }
    }

    // ---------------------------------------------------------------- native class lookup
    // Scratch hashes the suffix of every CSS module class, and the hash is different on every
    // build. The rules are in the page's own stylesheets, so the exact live names are read out of
    // them once. If a host has no such rules the custom classes below simply do all the work.
    var nativeClassCache = {};
    function classFromElement (stem) {
        var nodes = document.querySelectorAll('[class*="' + stem + '"]');
        for (var i = 0; i < nodes.length; i++) {
            var tokens = String(nodes[i].className || '').split(/\s+/);
            for (var t = 0; t < tokens.length; t++) {
                if (tokens[t] === stem || tokens[t].indexOf(stem + '_') === 0) return tokens[t];
            }
        }
        return null;
    }
    function classFromRules (rules, stem) {
        var re = new RegExp('\\.' + escapeRegExp(stem) + '([_A-Za-z0-9-]*)');
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            if (rule.selectorText) {
                var match = re.exec(rule.selectorText);
                if (match) return stem + match[1];
            }
            if (rule.cssRules) {
                var nested = classFromRules(rule.cssRules, stem);
                if (nested) return nested;
            }
        }
        return null;
    }
    function nativeClass (stem) {
        if (Object.prototype.hasOwnProperty.call(nativeClassCache, stem)) return nativeClassCache[stem];
        var found = classFromElement(stem);
        if (!found) {
            var sheets = document.styleSheets;
            for (var i = 0; i < sheets.length && !found; i++) {
                var rules = null;
                try { rules = sheets[i].cssRules; } catch (e) { continue; }
                if (rules) found = classFromRules(rules, stem);
            }
        }
        nativeClassCache[stem] = found;
        return found;
    }
    function addNative (node, stem) {
        var cls = nativeClass(stem);
        if (cls) node.classList.add(cls);
        return node;
    }

    // ---------------------------------------------------------------- MD5-free asset create
    function createAsset (vm, assetType, dataFormat, data) {
        return vm.runtime.storage.createAsset(assetType, dataFormat, data, null, true);
    }
    function assetCacheKey (assetType, assetId, dataFormat) {
        return assetType + '|' + (assetId || '') + '|' + (dataFormat || '');
    }
    function collectAssets (vm) {
        var map = Object.create(null);
        var seen = Object.create(null);
        var targets = originalTargets(vm);
        var costumeCount = 0;
        var soundCount = 0;
        var unique = 0;
        function add (owner, assetType, target) {
            var asset = owner.asset;
            var assetId = owner.assetId || (asset && asset.assetId);
            if (!asset || !assetId) return;
            var format = String(owner.dataFormat || asset.dataFormat || '').toLowerCase();
            var key = assetCacheKey(assetType, assetId, format);
            var entry = map[key];
            if (!entry) {
                entry = map[key] = {
                    key: key,
                    assetType: assetType,
                    assetId: assetId,
                    dataFormat: format,
                    asset: asset,
                    bytes: byteLength(asset.data),
                    owners: []
                };
                unique++;
            }
            entry.owners.push({owner: owner, target: target, assetType: assetType});
            if (!seen[key]) {
                seen[key] = true;
            }
        }
        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            var costumes = [];
            var sounds = [];
            try { costumes = target.getCostumes ? target.getCostumes() : []; } catch (e) { costumes = []; }
            try { sounds = target.getSounds ? target.getSounds() : []; } catch (e) { sounds = []; }
            for (var c = 0; c < costumes.length; c++) {
                add(costumes[c], 'costume', target);
                costumeCount++;
            }
            for (var s = 0; s < sounds.length; s++) {
                add(sounds[s], 'sound', target);
                soundCount++;
            }
        }
        var bytes = 0;
        var keys = Object.keys(map);
        for (var u = 0; u < keys.length; u++) bytes += map[keys[u]].bytes;
        return {
            map: map,
            keys: keys,
            unique: unique,
            costumes: costumeCount,
            sounds: soundCount,
            sprites: Math.max(0, targets.length - 1),
            assetBytes: bytes
        };
    }
    function measureProject (vm) {
        var collected = collectAssets(vm);
        var jsonBytes = 0;
        try {
            jsonBytes = JSON.stringify(vm.toJSON()).length;
        } catch (e) { jsonBytes = 0; }
        return {
            assetBytes: collected.assetBytes,
            jsonBytes: jsonBytes,
            totalBytes: collected.assetBytes + jsonBytes,
            costumes: collected.costumes,
            sounds: collected.sounds,
            sprites: collected.sprites,
            uniqueAssets: collected.unique,
            assets: collected
        };
    }

    // ---------------------------------------------------------------- lossless bitmap/audio passes
    // CRC32 is only needed to write valid PNG chunks back; it is the ordinary reflected table.
    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c >>> 0;
        }
        return table;
    })();
    function crc32 (bytes, start, end) {
        var c = 0xFFFFFFFF;
        for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function pngChunk (type, data) {
        var out = new Uint8Array(12 + data.length);
        writeU32(out, 0, data.length);
        out[4] = type.charCodeAt(0);
        out[5] = type.charCodeAt(1);
        out[6] = type.charCodeAt(2);
        out[7] = type.charCodeAt(3);
        out.set(data, 8);
        writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
        return out;
    }
    var PNG_DROP = {
        tEXt: 1, zTXt: 1, iTXt: 1, tIME: 1, eXIf: 1, dSIG: 1,
        pHYs: 1, pCAL: 1, sCAL: 1, sPLT: 1, hIST: 1
    };
    // Removes metadata chunks and folds the IDAT chunks into one. No pixel is touched.
    function stripPngMetadata (bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 33) return null;
        var signal = [137, 80, 78, 71, 13, 10, 26, 10];
        for (var sig = 0; sig < 8; sig++) if (bytes[sig] !== signal[sig]) return null;
        var offset = 8;
        var chunks = [];
        var idat = null;
        var ihdr = null;
        var seenEnd = false;
        while (offset + 12 <= bytes.length) {
            var length = readU32(bytes, offset);
            if (length > bytes.length - offset - 12) return null;
            var type = ascii(bytes, offset + 4, 4);
            var data = bytes.subarray(offset + 8, offset + 8 + length);
            if (type === 'IHDR') ihdr = data;
            if (type === 'acTL') return null;
            if (type === 'IDAT') {
                if (!idat) idat = [];
                idat.push(data);
            } else if (!PNG_DROP[type]) {
                chunks.push({type: type, data: data});
            }
            offset += 12 + length;
            if (type === 'IEND') {
                seenEnd = true;
                break;
            }
        }
        if (!seenEnd || !ihdr || !idat) return null;
        var parts = [new Uint8Array(signal)];
        var wroteIdat = false;
        for (var i = 0; i < chunks.length; i++) {
            if (chunks[i].type === 'IDAT') {
                if (!wroteIdat) {
                    var merged = new Uint8Array(idat.reduce(function (n, d) { return n + d.length; }, 0));
                    var at = 0;
                    for (var d = 0; d < idat.length; d++) {
                        merged.set(idat[d], at);
                        at += idat[d].length;
                    }
                    parts.push(pngChunk('IDAT', merged));
                    wroteIdat = true;
                }
                continue;
            }
            parts.push(pngChunk(chunks[i].type, chunks[i].data));
            if (chunks[i].type === 'IHDR') {
                // the IDAT chunk belongs after the colour chunks, so it is appended at the first
                // original IDAT position instead of immediately after IHDR
            }
        }
        if (!wroteIdat) {
            // no non-IDAT chunk came after the last one: append the merged pixels before IEND
            var tail = parts.pop();
            var mergedTail = new Uint8Array(idat.reduce(function (n, d) { return n + d.length; }, 0));
            var tailAt = 0;
            for (var t = 0; t < idat.length; t++) {
                mergedTail.set(idat[t], tailAt);
                tailAt += idat[t].length;
            }
            parts.push(pngChunk('IDAT', mergedTail));
            parts.push(tail);
        } else if (parts[parts.length - 1][4] !== 73 || parts[parts.length - 1][5] !== 69) {
            // IEND may have been pushed before IDAT only in a malformed file
        }
        var total = 0;
        for (var p = 0; p < parts.length; p++) total += parts[p].length;
        var out = new Uint8Array(total);
        var pos = 0;
        for (var q = 0; q < parts.length; q++) {
            out.set(parts[q], pos);
            pos += parts[q].length;
        }
        return out.length < bytes.length ? out : null;
    }
    function pngInfo (bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 33) return null;
        var width = readU32(bytes, 16);
        var height = readU32(bytes, 20);
        var bitDepth = bytes[24];
        var colorType = bytes[25];
        var interlace = bytes[28];
        return {width: width, height: height, bitDepth: bitDepth, colorType: colorType, interlace: interlace};
    }
    function canvasPng (bitmap) {
        return new Promise(function (resolve, reject) {
            var canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            var ctx = canvas.getContext('2d', {willReadFrequently: true});
            if (!ctx) return reject(new Error('no canvas'));
            ctx.drawImage(bitmap, 0, 0);
            var before;
            try {
                before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            } catch (e) { return reject(e); }
            canvas.toBlob(function (blob) {
                if (!blob) return reject(new Error('no png blob'));
                blob.arrayBuffer().then(function (buffer) {
                    var bytes = new Uint8Array(buffer);
                    createImageBitmap(new Blob([bytes], {type: 'image/png'})).then(function (afterBitmap) {
                        if (afterBitmap.width !== bitmap.width || afterBitmap.height !== bitmap.height) {
                            afterBitmap.close && afterBitmap.close();
                            return reject(new Error('size changed'));
                        }
                        var afterCanvas = document.createElement('canvas');
                        afterCanvas.width = afterBitmap.width;
                        afterCanvas.height = afterBitmap.height;
                        var afterCtx = afterCanvas.getContext('2d', {willReadFrequently: true});
                        afterCtx.drawImage(afterBitmap, 0, 0);
                        var after;
                        try {
                            after = afterCtx.getImageData(0, 0, afterCanvas.width, afterCanvas.height).data;
                        } catch (e) {
                            afterBitmap.close && afterBitmap.close();
                            return reject(e);
                        }
                        afterBitmap.close && afterBitmap.close();
                        if (after.length !== before.length) return reject(new Error('pixel length changed'));
                        for (var i = 0; i < before.length; i++) {
                            if (before[i] !== after[i]) return reject(new Error('pixel changed'));
                        }
                        resolve(bytes);
                    }).catch(reject);
                }).catch(reject);
            }, 'image/png');
        });
    }
    async function optimizePng (bytes) {
        var stripped = stripPngMetadata(bytes);
        var best = stripped || bytes;
        var info = pngInfo(bytes);
        if (!info || info.bitDepth !== 8 || info.interlace !== 0) {
            return best.length < bytes.length ? {bytes: best, kind: 'png'} : null;
        }
        var pixels = info.width * info.height;
        if (pixels > 4200000 || bytes.length > 9 * 1024 * 1024) {
            return best.length < bytes.length ? {bytes: best, kind: 'png'} : null;
        }
        try {
            var bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
            var canvasBytes = await canvasPng(bitmap);
            bitmap.close && bitmap.close();
            if (canvasBytes && canvasBytes.length < best.length) best = canvasBytes;
        } catch (e) {
            // colour profiles, huge alpha edges and unusual filters simply keep the lossless strip
        }
        return best.length < bytes.length ? {bytes: best, kind: 'png'} : null;
    }

    // JPEG: strip EXIF (unless it carries a non-default orientation), XMP and comments before
    // the first scan. ICC and Adobe colour markers stay, so colour rendering does not change.
    function exifOrientation (segment) {
        try {
            if (segment.length < 14) return 1;
            if (ascii(segment, 0, 4) !== 'Exif') return 1;
            var tiff = 6;
            var little = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
            var big = segment[tiff] === 0x4D && segment[tiff + 1] === 0x4D;
            if (!little && !big) return 1;
            function u16 (at) {
                return little ? (segment[at] | (segment[at + 1] << 8)) : ((segment[at] << 8) | segment[at + 1]);
            }
            function u32 (at) {
                return little ? ((segment[at] | (segment[at + 1] << 8) | (segment[at + 2] << 16) | (segment[at + 3] << 24)) >>> 0)
                    : ((segment[at] << 24) | (segment[at + 1] << 16) | (segment[at + 2] << 8) | segment[at + 3]) >>> 0;
            }
            if (u16(tiff + 2) !== 42) return 1;
            var ifd = tiff + u32(tiff + 4);
            if (ifd + 2 > segment.length) return 1;
            var count = u16(ifd);
            for (var i = 0; i < count; i++) {
                var at = ifd + 2 + i * 12;
                if (at + 12 > segment.length) break;
                if (u16(at) === 0x0112) {
                    var type = u16(at + 2);
                    var n = u32(at + 4);
                    if (type === 3 && n >= 1) return u16(at + 8);
                }
            }
        } catch (e) { /* a broken EXIF block is metadata, not pixels */ }
        return 1;
    }
    function optimizeJpeg (bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
        if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
        var out = [bytes.subarray(0, 2)];
        var offset = 2;
        var changed = false;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset] !== 0xFF) return null;
            var marker = bytes[offset + 1];
            if (marker === 0xD9) {
                out.push(bytes.subarray(offset));
                offset = bytes.length;
                break;
            }
            if (marker === 0xDA) {
                out.push(bytes.subarray(offset));
                offset = bytes.length;
                break;
            }
            if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
                out.push(bytes.subarray(offset, offset + 2));
                offset += 2;
                continue;
            }
            if (offset + 4 > bytes.length) return null;
            var length = readU16(bytes, offset + 2);
            if (length < 2 || offset + 2 + length > bytes.length) return null;
            var segment = bytes.subarray(offset, offset + 2 + length);
            var keep = true;
            if (marker === 0xE1) {
                var payload = bytes.subarray(offset + 4, offset + 2 + length);
                if (ascii(payload, 0, 4) === 'Exif' && exifOrientation(payload) === 1) keep = false;
                else if (ascii(payload, 0, 5) !== 'Exif\0') {
                    // XMP and other APP1 payloads are pure metadata
                    keep = false;
                }
                if (!keep) changed = true;
            } else if (marker === 0xFE || marker === 0xEC || marker === 0xED || marker === 0xEF) {
                keep = false;
                changed = true;
            }
            if (keep) out.push(segment);
            offset += 2 + length;
        }
        if (offset < bytes.length) out.push(bytes.subarray(offset));
        if (!changed) return null;
        var total = 0;
        for (var i = 0; i < out.length; i++) total += out[i].length;
        if (total >= bytes.length) return null;
        var result = new Uint8Array(total);
        var at = 0;
        for (var j = 0; j < out.length; j++) {
            result.set(out[j], at);
            at += out[j].length;
        }
        return {bytes: result, kind: 'jpg'};
    }

    // WAV: keep the fmt and data chunks (and the small audio-only chunks), drop LIST/INFO,
    // broadcast-extension, id3, JUNK and padding metadata. Sample bytes are copied verbatim.
    var WAV_KEEP = {'fmt ': 1, 'data': 1, 'fact': 1, 'smpl': 1, 'inst': 1, 'cue ': 1};
    function optimizeWav (bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 44) return null;
        if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
        var offset = 12;
        var parts = [];
        var audio = null;
        while (offset + 8 <= bytes.length) {
            var id = ascii(bytes, offset, 4);
            var size = readU32LE(bytes, offset + 4);
            if (size > bytes.length - offset - 8) return null;
            var data = bytes.subarray(offset + 8, offset + 8 + size);
            if (id === 'data') audio = data;
            if (WAV_KEEP[id]) parts.push({id: id, data: data});
            offset += 8 + size + (size & 1);
        }
        if (offset !== bytes.length || !audio) return null;
        var bodySize = 4;
        for (var i = 0; i < parts.length; i++) bodySize += 8 + parts[i].data.length + (parts[i].data.length & 1);
        var out = new Uint8Array(8 + bodySize);
        out.set(bytes.subarray(0, 4), 0);
        writeU32LE(out, 4, bodySize);
        out.set(bytes.subarray(8, 12), 8);
        var at = 12;
        for (var p = 0; p < parts.length; p++) {
            var part = parts[p];
            out[at] = part.id.charCodeAt(0);
            out[at + 1] = part.id.charCodeAt(1);
            out[at + 2] = part.id.charCodeAt(2);
            out[at + 3] = part.id.charCodeAt(3);
            writeU32LE(out, at + 4, part.data.length);
            out.set(part.data, at + 8);
            at += 8 + part.data.length + (part.data.length & 1);
        }
        return out.length < bytes.length ? {bytes: out, kind: 'wav'} : null;
    }
    function optimizeMp3 (bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 32) return null;
        var start = 0;
        var changed = false;
        // ID3v2 tags at the front. The size field is four syncsafe bytes.
        while (start + 10 <= bytes.length && ascii(bytes, start, 3) === 'ID3') {
            var size = ((bytes[start + 6] & 0x7F) << 21) | ((bytes[start + 7] & 0x7F) << 14) |
                ((bytes[start + 8] & 0x7F) << 7) | (bytes[start + 9] & 0x7F);
            var tagLength = 10 + size + ((bytes[start + 5] & 0x10) ? 10 : 0);
            if (tagLength <= 10 || start + tagLength > bytes.length) break;
            start += tagLength;
            changed = true;
        }
        var end = bytes.length;
        if (end - start >= 128 && ascii(bytes, end - 128, 3) === 'TAG') {
            end -= 128;
            changed = true;
        }
        if (end - start >= 32 && ascii(bytes, end - 32, 8) === 'APETAGEX') {
            var apeSize = readU32LE(bytes, end - 32 + 12);
            if (apeSize > 0 && apeSize <= end - start) {
                end -= apeSize;
                changed = true;
            }
        }
        if (!changed || end <= start) return null;
        var out = bytes.subarray(start, end);
        return out.length < bytes.length ? {bytes: out, kind: 'mp3'} : null;
    }
    async function optimizeBinaryAsset (assetType, format, bytes) {
        if (format === 'png') return optimizePng(bytes);
        if (format === 'jpg' || format === 'jpeg') return optimizeJpeg(bytes);
        if (format === 'wav') return optimizeWav(bytes);
        if (format === 'mp3') return optimizeMp3(bytes);
        return null;
    }

    // ---------------------------------------------------------------- WAV -> MP3
    // WAV is the one large format that can be made several times smaller without touching a
    // pixel. The encoder is quality-first (192 kbps for 44.1 kHz stereo); after encoding, both
    // files are decoded again and the duration, peak and RMS must agree before the swap is kept.
    var MP3_RATES = {8000: 1, 11025: 1, 12000: 1, 16000: 1, 22050: 1, 24000: 1, 32000: 1, 44100: 1, 48000: 1};
    function readWavPcm (bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 44) return null;
        if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
        var offset = 12;
        var fmt = null;
        var data = null;
        while (offset + 8 <= bytes.length) {
            var id = ascii(bytes, offset, 4);
            var size = readU32LE(bytes, offset + 4);
            if (size > bytes.length - offset - 8) return null;
            if (id === 'fmt ' && size >= 16) fmt = bytes.subarray(offset + 8, offset + 8 + size);
            if (id === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
            offset += 8 + size + (size & 1);
        }
        if (!fmt || !data || fmt.length < 16) return null;
        var format = readU16LE(fmt, 0);
        var channels = readU16LE(fmt, 2);
        var sampleRate = readU32LE(fmt, 4);
        var bits = readU16LE(fmt, 14);
        if (format === 0xFFFE && fmt.length >= 26) format = readU16LE(fmt, 24);
        if ((format !== 1 && format !== 3) || channels < 1 || channels > 2) return null;
        if (!MP3_RATES[sampleRate]) return null;
        var width = Math.ceil(bits / 8);
        if (format === 1 && (bits !== 8 && bits !== 16 && bits !== 24 && bits !== 32)) return null;
        if (format === 3 && bits !== 32) return null;
        if (!width) return null;
        var frameSize = width * channels;
        var frames = Math.floor(data.length / frameSize);
        if (frames < 128) return null;
        var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        var left = new Int16Array(frames);
        var right = channels > 1 ? new Int16Array(frames) : null;
        function sample (at) {
            if (format === 3) {
                var f = view.getFloat32(at, true);
                if (f > 1) f = 1;
                else if (f < -1) f = -1;
                return Math.round(f * 32767);
            }
            if (bits === 8) return (data[at] - 128) << 8;
            if (bits === 16) return view.getInt16(at, true);
            if (bits === 24) {
                var v = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
                if (v & 0x800000) v |= 0xFF000000;
                return v >> 8;
            }
            return view.getInt32(at, true) >> 16;
        }
        for (var i = 0; i < frames; i++) {
            var at = i * frameSize;
            left[i] = sample(at);
            if (right) right[i] = sample(at + width);
        }
        return {left: left, right: right, channels: channels, sampleRate: sampleRate, duration: frames / sampleRate};
    }
    function mp3Bitrate (sampleRate, channels) {
        if (sampleRate >= 44100) return channels > 1 ? 192 : 128;
        if (sampleRate >= 32000) return channels > 1 ? 160 : 112;
        if (sampleRate >= 22050) return channels > 1 ? 128 : 96;
        if (sampleRate >= 16000) return channels > 1 ? 112 : 80;
        return channels > 1 ? 96 : 64;
    }
    async function encodeMp3 (pcm, deadline) {
        var lib = window.__adoxLame || window.lamejs || window.lame;
        if (!lib || typeof lib.Mp3Encoder !== 'function') return null;
        var encoder;
        try {
            encoder = new lib.Mp3Encoder(pcm.channels, pcm.sampleRate, mp3Bitrate(pcm.sampleRate, pcm.channels));
        } catch (e) {
            return null;
        }
        var block = 1152;
        var chunks = [];
        var total = 0;
        for (var i = 0; i < pcm.left.length; i += block) {
            var end = Math.min(i + block, pcm.left.length);
            var left = pcm.left.subarray(i, end);
            var right = pcm.right ? pcm.right.subarray(i, end) : left;
            var encoded = encoder.encodeBuffer(left, right);
            if (encoded && encoded.length) {
                var copy = new Uint8Array(encoded.length);
                copy.set(encoded);
                chunks.push(copy);
                total += copy.length;
            }
            if (i % (block * 64) === 0) {
                if (now() > deadline) return null;
                await nextTick();
            }
        }
        var tail = encoder.flush();
        if (tail && tail.length) {
            var tailCopy = new Uint8Array(tail.length);
            tailCopy.set(tail);
            chunks.push(tailCopy);
            total += tailCopy.length;
        }
        if (total < 128) return null;
        var out = new Uint8Array(total);
        var at = 0;
        for (var c = 0; c < chunks.length; c++) {
            out.set(chunks[c], at);
            at += chunks[c].length;
        }
        var framed = false;
        for (var s = 0; s < Math.min(out.length - 1, 4096); s++) {
            if (out[s] === 0xFF && (out[s + 1] & 0xE0) === 0xE0) { framed = true; break; }
        }
        return framed ? out : null;
    }
    var audioVerifyContext = null;
    function decodeAudioBytes (bytes) {
        var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Offline) return Promise.resolve(null);
        if (!audioVerifyContext) {
            try { audioVerifyContext = new Offline(1, 1, 48000); } catch (e) { audioVerifyContext = null; }
        }
        if (!audioVerifyContext) return Promise.resolve(null);
        var copy = new Uint8Array(bytes.length);
        copy.set(bytes);
        return new Promise(function (resolve) {
            var settled = false;
            function finish (value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }
            var timer = window.setTimeout(function () { finish(null); }, 5000);
            try {
                var maybe = audioVerifyContext.decodeAudioData(copy.buffer, function (buffer) {
                    window.clearTimeout(timer);
                    finish(buffer);
                }, function () {
                    window.clearTimeout(timer);
                    finish(null);
                });
                if (maybe && typeof maybe.then === 'function') {
                    maybe.then(function (buffer) { window.clearTimeout(timer); finish(buffer); },
                        function () { window.clearTimeout(timer); finish(null); });
                }
            } catch (e) {
                window.clearTimeout(timer);
                finish(null);
            }
        });
    }
    function audioFingerprint (buffer) {
        if (!buffer || !buffer.length) return null;
        var channels = Math.min(buffer.numberOfChannels || 1, 2);
        var sum = 0;
        var peak = 0;
        var samples = 0;
        for (var c = 0; c < channels; c++) {
            var data = buffer.getChannelData(c);
            var step = Math.max(1, Math.floor(data.length / 50000));
            for (var i = 0; i < data.length; i += step) {
                var value = data[i];
                sum += value * value;
                if (Math.abs(value) > peak) peak = Math.abs(value);
                samples++;
            }
        }
        return {
            duration: buffer.duration,
            rate: buffer.sampleRate,
            peak: peak,
            rms: samples ? Math.sqrt(sum / samples) : 0
        };
    }
    async function convertWavToMp3 (bytes, deadline) {
        if (!(window.__adoxLame || window.lamejs || window.lame)) return null;
        var pcm = readWavPcm(bytes);
        if (!pcm || pcm.duration < 0.05 || pcm.duration > 600) return null;
        var before = audioFingerprint(await decodeAudioBytes(bytes));
        if (!before) return null;
        var mp3 = await encodeMp3(pcm, deadline);
        if (!mp3) return null;
        var after = audioFingerprint(await decodeAudioBytes(mp3));
        if (!after) return null;
        // MP3 decoding appends the encoder/decoder delay (up to three 576-sample frames at
        // low sample rates). It is padding, not audio, so allow for it explicitly.
        var codecPad = 1728 / pcm.sampleRate;
        var tolerance = Math.max(0.15, before.duration * 0.02, codecPad);
        if (Math.abs(before.duration - after.duration) > tolerance) return null;
        if (after.peak < 0.01 && before.peak > 0.02) return null;
        if (before.rms > 0.01 &&
            (after.rms < before.rms * 0.6 || after.rms > before.rms * 1.6)) return null;
        return mp3;
    }

    // ---------------------------------------------------------------- vector costumes
    var SVG_TEXT_TAGS = {
        text: 1, tspan: 1, textPath: 1, style: 1, title: 1, desc: 1, script: 1
    };
    var SVG_NUMERIC_ATTRS = {
        d: 1, points: 1, x: 1, y: 1, x1: 1, y1: 1, x2: 1, y2: 1, cx: 1, cy: 1,
        r: 1, rx: 1, ry: 1, fx: 1, fy: 1, fr: 1, width: 1, height: 1, offset: 1,
        'stroke-width': 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1,
        'stroke-miterlimit': 1, 'stroke-opacity': 1, 'fill-opacity': 1, opacity: 1,
        'font-size': 1, 'letter-spacing': 1, 'word-spacing': 1, kerning: 1,
        'baseline-shift': 1, transform: 1, gradientTransform: 1, patternTransform: 1,
        viewBox: 1, markerWidth: 1, markerHeight: 1, refX: 1, refY: 1, startOffset: 1,
        textLength: 1, pathLength: 1, dx: 1, dy: 1, rotate: 1
    };
    function parseSvg (text) {
        try {
            var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
            if (!doc || !doc.documentElement) return null;
            if (doc.documentElement.nodeName.toLowerCase() === 'parsererror') return null;
            if (doc.getElementsByTagName('parsererror').length) return null;
            if (doc.documentElement.nodeName.toLowerCase() !== 'svg') return null;
            return doc;
        } catch (e) {
            return null;
        }
    }
    function svgDimensions (doc) {
        var root = doc.documentElement;
        var w = parseFloat(root.getAttribute('width'));
        var h = parseFloat(root.getAttribute('height'));
        var box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if ((!isFinite(w) || w <= 0) && box.length === 4 && isFinite(box[2])) w = box[2];
        if ((!isFinite(h) || h <= 0) && box.length === 4 && isFinite(box[3])) h = box[3];
        if (!isFinite(w) || w <= 0) w = 300;
        if (!isFinite(h) || h <= 0) h = 150;
        return {w: w, h: h};
    }
    function removeNodes (nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
        }
    }
    function svgIdMap (doc) {
        var map = Object.create(null);
        var all = doc.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var id = all[i].getAttribute && all[i].getAttribute('id');
            if (id && !map[id]) map[id] = all[i];
        }
        return map;
    }
    function collectSvgRefs (doc) {
        var idMap = svgIdMap(doc);
        var refs = Object.create(null);
        function add (id) {
            if (id && idMap[id]) refs[id] = true;
        }
        function scanCss (css) {
            if (!css) return;
            var re = /#([A-Za-z_][\w:.-]*)/g;
            var match;
            while ((match = re.exec(css))) add(match[1]);
        }
        function scanValue (value) {
            if (!value) return;
            var urlRe = /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g;
            var match;
            while ((match = urlRe.exec(value))) add(match[1]);
            var trimmed = value.trim();
            if (trimmed.charAt(0) === '#') add(trimmed.slice(1));
        }
        function scanAnim (value) {
            if (!value) return;
            var re = /([A-Za-z_][\w:.-]*)\.(?:begin|end|repeat|click|mouseover|mouseout|focusin|focusout|activate)/g;
            var match;
            while ((match = re.exec(value))) add(match[1]);
        }
        function scanElement (el) {
            if (!el || !el.attributes) return;
            var tag = String(el.tagName || '').toLowerCase();
            for (var i = 0; i < el.attributes.length; i++) {
                var attr = el.attributes[i];
                var name = attr.name.toLowerCase();
                var value = attr.value;
                if (name === 'href' || name === 'xlink:href') {
                    if (value.charAt(0) === '#') add(value.slice(1));
                    else scanValue(value);
                } else if (name === 'begin' || name === 'end') {
                    scanAnim(value);
                } else {
                    scanValue(value);
                    if (name === 'style') scanCss(value);
                }
            }
            if (tag === 'style') scanCss(el.textContent || '');
        }
        var all = doc.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) scanElement(all[i]);
        var changed = true;
        var guard = 0;
        while (changed && guard++ < 8) {
            changed = false;
            var ids = Object.keys(refs);
            for (var r = 0; r < ids.length; r++) {
                var node = idMap[ids[r]];
                if (!node) continue;
                var before = Object.keys(refs).length;
                scanElement(node);
                if (Object.keys(refs).length !== before) changed = true;
            }
        }
        return {refs: refs, idMap: idMap};
    }
    function trimNumber (token) {
        if (!token || /[eE]/.test(token)) return token;
        var out = token.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
        out = out.replace(/^(-?)0\./, '$1.');
        if (out === '-0') out = '0';
        return out;
    }
    function roundNumber (token, precision) {
        var n = Number(token);
        if (!isFinite(n)) return token;
        var factor = Math.pow(10, precision);
        var rounded = Math.round(n * factor) / factor;
        if (Math.abs(rounded) < 1e-9) return '0';
        var text = String(rounded);
        if (/[eE]/.test(text)) text = rounded.toFixed(precision);
        return trimNumber(text);
    }
    function normalizeNumberText (value, precision) {
        return value.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, function (token) {
            return precision === null ? trimNumber(token) : roundNumber(token, precision);
        });
    }
    function minifyCssText (css) {
        var out = '';
        var quote = null;
        var pendingSpace = false;
        var dropAfterColon = false;
        var i = 0;
        while (i < css.length) {
            var ch = css.charAt(i);
            var next = css.charAt(i + 1);
            if (quote) {
                out += ch;
                if (ch === '\\' && i + 1 < css.length) {
                    out += next;
                    i += 2;
                    continue;
                }
                if (ch === quote) quote = null;
                i++;
                continue;
            }
            if (ch === '/' && next === '*') {
                i += 2;
                while (i < css.length && !(css.charAt(i) === '*' && css.charAt(i + 1) === '/')) i++;
                i += 2;
                continue;
            }
            if (ch === '"' || ch === "'") {
                if (pendingSpace && out && !/[{}:;,>+~]/.test(out.charAt(out.length - 1))) out += ' ';
                pendingSpace = false;
                dropAfterColon = false;
                quote = ch;
                out += ch;
                i++;
                continue;
            }
            if (/\s/.test(ch)) {
                if (!dropAfterColon) pendingSpace = true;
                i++;
                continue;
            }
            if (ch === ':') {
                pendingSpace = false;
                out += ch;
                dropAfterColon = true;
                i++;
                continue;
            }
            if (/[{};,>+~]/.test(ch)) {
                pendingSpace = false;
                dropAfterColon = false;
                out += ch;
                i++;
                continue;
            }
            if (pendingSpace && out && !/[{}:;,>+~]/.test(out.charAt(out.length - 1))) out += ' ';
            pendingSpace = false;
            dropAfterColon = false;
            out += ch;
            i++;
        }
        return out.replace(/;}/g, '}').trim();
    }
    function pathMinify (value, precision) {
        var out = normalizeNumberText(value, precision);
        out = out.replace(/\s*,\s*/g, ',').replace(/([A-Za-z])\s+/g, '$1').replace(/\s+/g, ' ').trim();
        return out;
    }
    function cleanSvgMarkup (doc) {
        var comments = [];
        var walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT, null, false);
        var node;
        while ((node = walker.nextNode())) comments.push(node);
        removeNodes(comments);

        var root = doc.documentElement;
        var all = doc.getElementsByTagName('*');
        var doomed = [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var tag = String(el.tagName || '').toLowerCase();
            if (tag === 'metadata' || tag === 'script' ||
                tag.indexOf('sodipodi:') === 0 || tag.indexOf('inkscape:') === 0 ||
                tag.indexOf('adobe:') === 0) {
                doomed.push(el);
            }
        }
        removeNodes(doomed);

        all = doc.getElementsByTagName('*');
        for (var e = 0; e < all.length; e++) {
            var element = all[e];
            var attrs = [];
            for (var a = 0; a < element.attributes.length; a++) attrs.push(element.attributes[a].name);
            for (var at = 0; at < attrs.length; at++) {
                var name = attrs[at];
                var lower = name.toLowerCase();
                if (lower === 'enable-background' || lower === 'data-name' ||
                    lower.indexOf('on') === 0 && /^on[a-z]+$/.test(lower) ||
                    lower.indexOf('inkscape:') === 0 || lower.indexOf('sodipodi:') === 0 ||
                    lower.indexOf('i:') === 0 || lower.indexOf('serif:') === 0 ||
                    lower.indexOf('dc:') === 0 || lower.indexOf('cc:') === 0 ||
                    lower.indexOf('rdf:') === 0) {
                    element.removeAttribute(name);
                }
            }
        }

        // Namespace declarations that only belonged to the editor metadata removed above.
        var nsPrefixes = ['inkscape', 'sodipodi', 'dc', 'cc', 'rdf', 'i', 'serif', 'adobe'];
        for (var n = 0; n < nsPrefixes.length; n++) {
            var prefix = nsPrefixes[n];
            if (root.hasAttribute('xmlns:' + prefix)) {
                var used = false;
                for (var el2 = 0; el2 < all.length && !used; el2++) {
                    var tag2 = String(all[el2].tagName || '').toLowerCase();
                    if (tag2.indexOf(prefix + ':') === 0) used = true;
                    for (var a2 = 0; a2 < all[el2].attributes.length; a2++) {
                        if (all[el2].attributes[a2].name.toLowerCase().indexOf(prefix + ':') === 0) used = true;
                    }
                }
                if (!used) root.removeAttribute('xmlns:' + prefix);
            }
        }
        if (root.hasAttribute('xmlns:xlink') && !/xlink:/.test(new XMLSerializer().serializeToString(root))) {
            root.removeAttribute('xmlns:xlink');
        }
    }
    function optimizeEmbeddedImages (doc) {
        var images = doc.getElementsByTagName('image');
        var xlink = 'http://www.w3.org/1999/xlink';
        for (var i = 0; i < images.length; i++) {
            var image = images[i];
            var href = image.getAttribute('href') || image.getAttributeNS(xlink, 'href') || '';
            var match = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/i.exec(href);
            if (!match) continue;
            var mime = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
            try {
                var raw = base64ToBytes(match[2]);
                var result = mime === 'png' ? stripPngMetadata(raw) : optimizeJpeg(raw);
                if (!result) continue;
                var bytes = result.bytes || result;
                if (!bytes || bytes.length >= raw.length) continue;
                var replacement = 'data:image/' + (mime === 'png' ? 'png' : 'jpeg') + ';base64,' + bytesToBase64(bytes);
                if (image.hasAttribute('href')) image.setAttribute('href', replacement);
                if (image.hasAttributeNS(xlink, 'href')) image.setAttributeNS(xlink, 'xlink:href', replacement);
            } catch (e) { /* an embedded image that cannot be decoded is left alone */ }
        }
    }
    function pruneSvgDefinitions (doc) {
        var defs = doc.getElementsByTagName('defs');
        var refs = collectSvgRefs(doc).refs;
        for (var i = 0; i < defs.length; i++) {
            var children = [];
            for (var c = 0; c < defs[i].children.length; c++) children.push(defs[i].children[c]);
            for (var ch = 0; ch < children.length; ch++) {
                var child = children[ch];
                var id = child.getAttribute && child.getAttribute('id');
                var tag = String(child.tagName || '').toLowerCase();
                if (id && !refs[id]) {
                    defs[i].removeChild(child);
                } else if (!id && (tag === 'style' && !(child.textContent || '').trim())) {
                    defs[i].removeChild(child);
                }
            }
        }
        var emptyDefs = [];
        var allDefs = doc.getElementsByTagName('defs');
        for (var d = 0; d < allDefs.length; d++) {
            if (!allDefs[d].children.length && !(allDefs[d].textContent || '').trim()) emptyDefs.push(allDefs[d]);
        }
        removeNodes(emptyDefs);
    }
    function removeEmptyGroups (doc) {
        var groups = doc.getElementsByTagName('g');
        var doomed = [];
        for (var i = 0; i < groups.length; i++) {
            var group = groups[i];
            if (group.children.length) continue;
            if (group.hasAttribute('data-paper-data')) continue;
            var id = group.getAttribute('id');
            if (id) continue;
            doomed.push(group);
        }
        removeNodes(doomed);
    }
    function trimSvgText (doc) {
        var walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT, null, false);
        var nodes = [];
        var node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue && !node.nodeValue.trim()) {
                var parent = node.parentNode;
                var tag = parent && parent.tagName ? String(parent.tagName).toLowerCase() : '';
                if (!SVG_TEXT_TAGS[tag]) nodes.push(node);
            }
        }
        removeNodes(nodes);
    }
    function minifySvgStyles (doc) {
        var all = doc.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            if (all[i].hasAttribute && all[i].hasAttribute('style')) {
                all[i].setAttribute('style', minifyCssText(all[i].getAttribute('style')));
            }
            if (String(all[i].tagName).toLowerCase() === 'style') {
                all[i].textContent = minifyCssText(all[i].textContent || '');
            }
        }
    }
    function normalizeSvgNumbers (doc, precision) {
        var all = doc.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            for (var a = 0; a < all[i].attributes.length; a++) {
                var attr = all[i].attributes[a];
                var name = attr.name;
                if (name === 'd' || name === 'points') {
                    attr.value = pathMinify(attr.value, precision);
                } else if (SVG_NUMERIC_ATTRS[name]) {
                    attr.value = normalizeNumberText(attr.value, precision === null ? null : 4);
                }
            }
        }
    }
    function transformSvg (text, level) {
        var doc = parseSvg(text);
        if (!doc) return null;
        cleanSvgMarkup(doc);
        if (level >= 1) {
            optimizeEmbeddedImages(doc);
            pruneSvgDefinitions(doc);
            removeEmptyGroups(doc);
        }
        minifySvgStyles(doc);
        normalizeSvgNumbers(doc, level >= 2 ? 4 : null);
        trimSvgText(doc);
        var out;
        try { out = new XMLSerializer().serializeToString(doc.documentElement); } catch (e) { return null; }
        if (!out) return null;
        out = out.replace(/^\s*<\?xml[^>]*\?>\s*/i, '').trim();
        if (out.length >= text.length) return null;
        return out;
    }
    function rasterizeSvg (text) {
        return new Promise(function (resolve, reject) {
            var doc = parseSvg(text);
            if (!doc) return reject(new Error('svg parse'));
            var dims = svgDimensions(doc);
            var scale = Math.min(SVG_MAX_RASTER / Math.max(dims.w, dims.h, 1), 8);
            if (!isFinite(scale) || scale <= 0) scale = 1;
            var width = Math.max(8, Math.round(dims.w * scale));
            var height = Math.max(8, Math.round(dims.h * scale));
            var blob = new Blob([text], {type: 'image/svg+xml;charset=utf-8'});
            var url = URL.createObjectURL(blob);
            var img = new Image();
            var settled = false;
            var timer = window.setTimeout(function () {
                finish(new Error('svg timeout'));
            }, 4500);
            function finish (error) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
                if (error) return reject(error);
                var canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext('2d', {willReadFrequently: true});
                if (!ctx) return reject(new Error('no canvas'));
                try {
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve({data: ctx.getImageData(0, 0, width, height).data, width: width, height: height});
                } catch (e) { reject(e); }
            }
            img.onload = function () { finish(null); };
            img.onerror = function () { finish(new Error('svg load')); };
            img.src = url;
        });
    }
    function compareRasters (before, after) {
        if (!before || !after || before.width !== after.width || before.height !== after.height) return false;
        var a = before.data;
        var b = after.data;
        var total = before.width * before.height;
        var diff = 0;
        var alphaDiff = 0;
        for (var i = 0; i < a.length; i += 4) {
            var da = Math.abs(a[i] - b[i]);
            var dr = Math.abs(a[i + 1] - b[i + 1]);
            var dg = Math.abs(a[i + 2] - b[i + 2]);
            var db = Math.abs(a[i + 3] - b[i + 3]);
            if (Math.max(da, dr, dg, db) > 8) diff++;
            alphaDiff += Math.abs(a[i + 3] - b[i + 3]);
        }
        return diff <= Math.max(4, total * 0.004) && alphaDiff <= total * 0.01;
    }
    async function optimizeSvgText (text, deadline) {
        var safe = transformSvg(text, 1);
        var deep = now() < deadline ? transformSvg(text, 2) : null;
        if (!safe && !deep) {
            var minimal = transformSvg(text, 0);
            return minimal ? {text: minimal, mode: 'metadata', originalSize: text.length, size: minimal.length} : null;
        }
        var original = null;
        try { original = await rasterizeSvg(text); } catch (e) { original = null; }
        if (!original) {
            // The SVG cannot be rasterised here (external references, an unusual filter, ...).
            // Only the metadata pass is provably render-neutral, so only that one is used.
            var metadata = transformSvg(text, 0);
            return metadata ? {text: metadata, mode: 'metadata', originalSize: text.length, size: metadata.length} : null;
        }
        var best = null;
        var bestMode = '';
        if (safe) {
            var safeRaster = null;
            try { safeRaster = await rasterizeSvg(safe); } catch (e) { safeRaster = null; }
            if (safeRaster && compareRasters(original, safeRaster)) {
                best = safe;
                bestMode = 'safe';
            }
        }
        if (deep && (!best || deep.length < best.length)) {
            var deepRaster = null;
            try { deepRaster = await rasterizeSvg(deep); } catch (e) { deepRaster = null; }
            if (deepRaster && compareRasters(original, deepRaster)) {
                best = deep;
                bestMode = 'deep';
            }
        }
        if (best) return {text: best, mode: bestMode, originalSize: text.length, size: best.length};
        var fallback = transformSvg(text, 0);
        return fallback ? {text: fallback, mode: 'metadata', originalSize: text.length, size: fallback.length} : null;
    }

    // ---------------------------------------------------------------- code passes
    var EMPTY_HAT_OPCODES = {
        event_whenflagclicked: 1,
        event_whenkeypressed: 1,
        event_whenthisspriteclicked: 1,
        event_whenstageclicked: 1,
        event_whenbroadcastreceived: 1,
        event_whenbackdropswitchesto: 1,
        event_whengreaterthan: 1,
        control_start_as_clone: 1
    };
    function scanReferences (vm, skipBlocks) {
        var varIds = Object.create(null);
        var listIds = Object.create(null);
        var broadcastIds = Object.create(null);
        var dynamicBroadcast = false;
        function scanBlocks (blocksInstance) {
            if (!blocksInstance || !blocksInstance._blocks) return;
            var blocks = blocksInstance._blocks;
            var keys = Object.keys(blocks);
            for (var i = 0; i < keys.length; i++) {
                var id = keys[i];
                if (skipBlocks && skipBlocks[id]) continue;
                var block = blocks[id];
                if (!block) continue;
                var fields = block.fields || {};
                var fieldNames = Object.keys(fields);
                for (var f = 0; f < fieldNames.length; f++) {
                    var name = fieldNames[f];
                    var field = fields[name];
                    if (!field || !field.id) continue;
                    var type = field.variableType || '';
                    if (type === 'broadcast_msg' || name === 'BROADCAST_OPTION') broadcastIds[field.id] = true;
                    else if (type === 'list') listIds[field.id] = true;
                    else varIds[field.id] = true;
                }
                if (block.opcode === 'event_broadcast' || block.opcode === 'event_broadcastandwait') {
                    var broadcastInput = block.inputs && block.inputs.BROADCAST_INPUT;
                    if (broadcastInput) {
                        var source = broadcastInput.block && blocks[broadcastInput.block];
                        if (!source || source.opcode !== 'event_broadcast_menu') dynamicBroadcast = true;
                    }
                }
            }
        }
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) scanBlocks(targets[t].blocks);
        if (vm.runtime.monitorBlocks) scanBlocks(vm.runtime.monitorBlocks);
        return {varIds: varIds, listIds: listIds, broadcastIds: broadcastIds, dynamicBroadcast: dynamicBroadcast};
    }
    function planEmptyScripts (vm) {
        var out = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            var blocks = target.blocks;
            if (!blocks || !blocks._blocks || !blocks._scripts) continue;
            var scripts = blocks._scripts.slice();
            for (var s = 0; s < scripts.length; s++) {
                var id = scripts[s];
                var block = blocks._blocks[id];
                if (!block || !block.topLevel) continue;
                if (!EMPTY_HAT_OPCODES[block.opcode]) continue;
                if (block.next) continue;
                var hasComment = false;
                var comments = target.comments || {};
                var commentIds = Object.keys(comments);
                for (var c = 0; c < commentIds.length; c++) {
                    if (comments[commentIds[c]] && comments[commentIds[c]].blockId === id) {
                        hasComment = true;
                        break;
                    }
                }
                if (hasComment) continue;
                out.push({target: target, block: block, index: s});
            }
        }
        return out;
    }
    function planEmptyComments (vm) {
        var out = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            var comments = target.comments || {};
            var ids = Object.keys(comments);
            for (var i = 0; i < ids.length; i++) {
                var comment = comments[ids[i]];
                if (comment && !String(comment.text || '').trim()) {
                    out.push({target: target, id: ids[i], comment: comment});
                }
            }
        }
        return out;
    }
    function monitorReferencesId (vm, id) {
        try {
            var state = vm.runtime._monitorState;
            if (!state) return false;
            var keys = Object.keys(state);
            for (var i = 0; i < keys.length; i++) {
                if (keys[i].indexOf(id) >= 0) return true;
            }
        } catch (e) { /* no monitor state */ }
        return false;
    }
    function planUnusedVariables (vm, refs) {
        var out = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            var ids = Object.keys(target.variables || {});
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                var variable = target.variables[id];
                if (!variable || variable.isCloud) continue;
                var type = variable.type || '';
                var used = false;
                if (type === 'list') used = !!refs.listIds[id];
                else if (type === 'broadcast_msg') used = refs.dynamicBroadcast || !!refs.broadcastIds[id];
                else used = !!refs.varIds[id];
                if (!used && monitorReferencesId(vm, id)) used = true;
                if (!used) out.push({target: target, id: id, variable: variable});
            }
        }
        return out;
    }
    // A block that no script can reach is dead weight: it is not in _scripts, no other block
    // points at it and it has no parent. Top-level loose stacks are deliberately kept, because
    // those are work in progress rather than deleted code.
    function planOrphanBlocks (vm, removedScriptIds) {
        var out = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            var blocks = target.blocks;
            if (!blocks || !blocks._blocks || !blocks._scripts) continue;
            var reachable = Object.create(null);
            var stack = [];
            for (var s = 0; s < blocks._scripts.length; s++) {
                var scriptId = blocks._scripts[s];
                if (!removedScriptIds[scriptId]) stack.push(scriptId);
            }
            function collectRefs (value) {
                if (!value) return;
                if (typeof value === 'string') {
                    if (blocks._blocks[value]) stack.push(value);
                    return;
                }
                if (Array.isArray(value)) {
                    for (var v = 0; v < value.length; v++) collectRefs(value[v]);
                    return;
                }
                if (typeof value === 'object') {
                    if (typeof value.block === 'string' && blocks._blocks[value.block]) stack.push(value.block);
                    if (typeof value.shadow === 'string' && blocks._blocks[value.shadow]) stack.push(value.shadow);
                }
            }
            while (stack.length) {
                var id = stack.pop();
                if (!id || reachable[id]) continue;
                var block = blocks._blocks[id];
                if (!block) continue;
                reachable[id] = true;
                if (block.next) stack.push(block.next);
                var inputs = block.inputs || {};
                var names = Object.keys(inputs);
                for (var i = 0; i < names.length; i++) collectRefs(inputs[names[i]]);
            }
            var keys = Object.keys(blocks._blocks);
            for (var k = 0; k < keys.length; k++) {
                var orphanId = keys[k];
                if (reachable[orphanId]) continue;
                var orphan = blocks._blocks[orphanId];
                if (!orphan || orphan.topLevel) continue;
                out.push({target: target, block: orphan, index: -1});
            }
        }
        return out;
    }
    function variableRank (variable) {
        var type = variable && variable.type ? variable.type : '';
        if (type === 'list') return 1;
        if (type === 'broadcast_msg') return 2;
        return 0;
    }
    function declarationOrder (target) {
        var ids = Object.keys(target.variables || {});
        if (ids.length < 2) return null;
        var sorted = ids.slice().sort(function (a, b) {
            var va = target.variables[a] || {};
            var vb = target.variables[b] || {};
            var ra = variableRank(va);
            var rb = variableRank(vb);
            if (ra !== rb) return ra - rb;
            var na = String(va.name || '');
            var nb = String(vb.name || '');
            var cmp = 0;
            try { cmp = na.localeCompare(nb, undefined, {numeric: true, sensitivity: 'base'}); }
            catch (e) { cmp = na.toLowerCase() < nb.toLowerCase() ? -1 : (na.toLowerCase() > nb.toLowerCase() ? 1 : 0); }
            if (cmp) return cmp;
            return a < b ? -1 : (a > b ? 1 : 0);
        });
        var changed = false;
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] !== sorted[i]) { changed = true; break; }
        }
        return changed ? sorted : null;
    }
    function planDeclarationOrder (vm) {
        var out = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var ids = declarationOrder(targets[t]);
            if (ids) out.push({target: targets[t], ids: ids});
        }
        return out;
    }

    // ---------------------------------------------------------------- sprite folders
    // Folder grouping is page metadata, not sb3 data. The store lives in adox-kostum.js, so the
    // optimizer only plans and hands the result to window.__adoxSpriteFolders. User-named folders
    // keep their sprites; generic "Folder 3" folders are renamed from their contents; loose
    // sprites are filed by what the sprite is called and what it contains.
    function foldText (value) {
        var text = String(value || '');
        try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* older engine */ }
        return text.toLowerCase()
            .replace(/[\u0131\u0130]/g, 'i')
            .replace(/[\u015f\u015e]/g, 's')
            .replace(/[\u011f\u011e]/g, 'g')
            .replace(/[\u00fc\u00dc]/g, 'u')
            .replace(/[\u00f6\u00d6]/g, 'o')
            .replace(/[\u00e7\u00c7]/g, 'c');
    }
    function wordsOf (value) {
        var words = foldText(value).split(/[^a-z0-9]+/);
        var out = [];
        for (var i = 0; i < words.length; i++) if (words[i]) out.push(words[i]);
        return out;
    }
    var FOLDER_WORDS = {
        world: {weight: 1, words: ['world', 'dunya', 'map', 'mapper', 'terrain', 'tile', 'tiles', 'background',
            'arka', 'bg', 'prop', 'props', 'wall', 'walls', 'light', 'lights', 'shaft', 'shafts', 'particle',
            'particles', 'water', 'su', 'cloud', 'clouds', 'bulut', 'tree', 'agac', 'rock', 'kaya', 'sky',
            'gokyuzu', 'fish', 'balik', 'creature', 'yaratik', 'environment', 'cevre', 'decor', 'decoration',
            'dekor', 'effect', 'efekt', 'grass', 'cimen', 'forest', 'orman', 'mountain', 'dag', 'level',
            'seviye', 'platform', 'zemin', 'shadow', 'golge']},
        ui: {weight: 2, words: ['ui', 'hud', 'interface', 'arayuz', 'menu', 'overlay', 'vignette', 'achievement',
            'achievements', 'score', 'skor', 'text', 'yazi', 'inventory', 'item', 'items', 'cursor', 'imlec',
            'panel', 'button', 'buton', 'label', 'etiket', 'title', 'baslik', 'dialog', 'diyalog', 'screen',
            'ekran', 'thumbnail']},
        audio: {weight: 2, words: ['audio', 'music', 'muzik', 'sound', 'sounds', 'ses', 'sfx', 'voice', 'vokal',
            'loop', 'loops', 'piano', 'piyano', 'drum', 'davul', 'guitar', 'gitar', 'motor', 'horn', 'korna',
            'alarm']},
        system: {weight: 1, words: ['system', 'sistem', 'engine', 'loader', 'yukleyici', 'processor', 'islemci',
            'resources', 'resource', 'kaynak', 'io', 'debug', 'hata', 'manager', 'yonetici', 'util', 'helper',
            'yardimci', 'controller', 'kontrol', 'data', 'veri', 'settings', 'ayar', 'save', 'kayit', 'library',
            'kutuphane', 'animation', 'animasyon', 'bounds']},
        main: {weight: 1, words: ['main', 'ana', 'player', 'oyuncu', 'hero', 'kahraman', 'character', 'karakter',
            'protagon', 'sub', 'submarine', 'submersible', 'denizalti', 'ship', 'gemi', 'boat', 'tekne', 'car', 'araba',
            'vehicle', 'arac', 'robot', 'ninja', 'cat', 'kedi', 'dog', 'kopek', 'person', 'kisi']}
    };
    var FOLDER_ORDER = ['main', 'world', 'ui', 'audio', 'system', 'other'];
    function classifySprite (target, name) {
        var words = wordsOf(name);
        var scores = {main: 0, world: 0, ui: 0, audio: 0, system: 0};
        var categories = ['main', 'world', 'ui', 'audio', 'system'];
        for (var c = 0; c < categories.length; c++) {
            var category = categories[c];
            var group = FOLDER_WORDS[category];
            for (var w = 0; w < group.words.length; w++) {
                if (words.indexOf(group.words[w]) >= 0) scores[category] += group.weight;
            }
        }
        var best = 'other';
        var bestScore = 0;
        // world wins ties against the generic system words, and audio/UI have extra weight
        var tieOrder = ['audio', 'ui', 'main', 'world', 'system'];
        for (var i = 0; i < tieOrder.length; i++) {
            if (scores[tieOrder[i]] > bestScore) {
                best = tieOrder[i];
                bestScore = scores[tieOrder[i]];
            }
        }
        if (bestScore > 0) return best;
        var costumes = 0;
        var sounds = 0;
        var scripts = 0;
        try { costumes = target && target.getCostumes ? target.getCostumes().length : 0; } catch (e) { costumes = 0; }
        try { sounds = target && target.getSounds ? target.getSounds().length : 0; } catch (e) { sounds = 0; }
        try { scripts = target && target.blocks ? target.blocks._scripts.length : 0; } catch (e) { scripts = 0; }
        if (sounds >= 3 && costumes <= 2) return 'audio';
        if (costumes >= 20 && scripts <= 3) return 'world';
        if (costumes >= 20 && sounds >= 4) return 'world';
        return 'other';
    }
    function genericFolderName (name) {
        var folded = foldText(name).replace(/\s+/g, ' ').trim();
        if (/^(folder|klasor|group|grup|dossier|carpeta|cartella)(\s*\d+)?$/.test(folded)) return true;
        return /^(sprites?|kuklalar?|mixed|karma|other|diger)$/.test(folded);
    }
    function folderText (category, text) {
        if (category === 'main') return text('folderMain');
        if (category === 'world') return text('folderWorld');
        if (category === 'ui') return text('folderUi');
        if (category === 'audio') return text('folderAudio');
        if (category === 'system') return text('folderSystem');
        return text('folderOther');
    }
    function folderStore () {
        var api = window.__adoxSpriteFolders;
        return api && typeof api.snapshot === 'function' && typeof api.apply === 'function' ? api : null;
    }
    function planFolders (vm, text) {
        var api = folderStore();
        if (!api) return null;
        if (typeof api.available === 'function') {
            try { if (!api.available()) return null; } catch (e) { return null; }
        }
        var snapshot = null;
        try { snapshot = api.snapshot(); } catch (e) { return null; }
        if (!snapshot || !Array.isArray(snapshot.sprites) || snapshot.sprites.length < 2) return null;
        var targetsById = {};
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) targetsById[targets[t].id] = targets[t];
        var categories = {};
        for (var s = 0; s < snapshot.sprites.length; s++) {
            var sprite = snapshot.sprites[s];
            categories[sprite.id] = classifySprite(targetsById[sprite.id], sprite.name);
        }
        var assignments = {};
        var originalAssignments = Array.isArray(snapshot.assignments) ? snapshot.assignments : [];
        for (var a = 0; a < originalAssignments.length; a++) {
            if (originalAssignments[a] && originalAssignments[a].id && originalAssignments[a].folder) {
                assignments[originalAssignments[a].id] = originalAssignments[a].folder;
            }
        }
        var sourceFolders = Array.isArray(snapshot.folders) ? snapshot.folders : [];
        var buckets = [];
        var byKey = {};
        var canonical = {};
        var filed = {};
        var categoryBucket = {};
        function bucketFor (id, name, custom, sourceName) {
            var clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
            if (!clean) clean = text('folderSprites');
            var key = foldText(clean);
            var bucket = byKey[key];
            if (bucket) {
                if (custom && !bucket.custom) {
                    bucket.custom = true;
                    bucket.sourceName = String(sourceName || clean);
                }
                return bucket;
            }
            bucket = {
                id: id || '',
                name: clean,
                sprites: [],
                custom: !!custom,
                sourceName: String(sourceName || clean),
                category: '',
                renamed: false,
                wasGeneric: false
            };
            byKey[key] = bucket;
            buckets.push(bucket);
            return bucket;
        }
        function put (bucket, spriteId) {
            if (!bucket || filed[spriteId]) return;
            filed[spriteId] = true;
            bucket.sprites.push(spriteId);
        }
        // Folders the user created keep their names and their sprites. Two folders that differ
        // only in case or spacing become one, which is what the user meant anyway.
        for (var f = 0; f < sourceFolders.length; f++) {
            var folder = sourceFolders[f];
            if (!folder || !folder.id || !folder.name || genericFolderName(folder.name)) continue;
            canonical[folder.id] = bucketFor(folder.id, folder.name, true, folder.name);
        }
        for (var s2 = 0; s2 < snapshot.sprites.length; s2++) {
            var sprite2 = snapshot.sprites[s2];
            var folderId = assignments[sprite2.id];
            var bucket = folderId ? canonical[folderId] : null;
            if (bucket) put(bucket, sprite2.id);
        }
        function putByCategory (spriteId) {
            var category = categories[spriteId] || 'other';
            var bucket = categoryBucket[category];
            if (!bucket) {
                var label = folderText(category, text);
                var existing = byKey[foldText(label)];
                bucket = existing || bucketFor('', label, false, label);
                bucket.category = category;
                categoryBucket[category] = bucket;
            }
            put(bucket, spriteId);
        }
        // A generic folder is renamed from its contents when every sprite in it belongs to one
        // category. A mixed generic folder is dissolved so each sprite can join its real group.
        for (var f2 = 0; f2 < sourceFolders.length; f2++) {
            var old = sourceFolders[f2];
            if (!old || !old.id || !old.name || !genericFolderName(old.name)) continue;
            var members = [];
            for (var m = 0; m < snapshot.sprites.length; m++) {
                if (assignments[snapshot.sprites[m].id] === old.id) members.push(snapshot.sprites[m].id);
            }
            if (!members.length) continue;
            var counts = {};
            for (var m2 = 0; m2 < members.length; m2++) {
                var cat = categories[members[m2]] || 'other';
                counts[cat] = (counts[cat] || 0) + 1;
            }
            var catKeys = Object.keys(counts);
            if (catKeys.length === 1) {
                var only = catKeys[0];
                var target = categoryBucket[only];
                if (!target) {
                    var label2 = folderText(only, text);
                    target = byKey[foldText(label2)] || bucketFor(old.id, label2, false, old.name);
                    target.category = only;
                    target.wasGeneric = true;
                    target.renamed = foldText(old.name) !== foldText(target.name);
                    categoryBucket[only] = target;
                }
                for (var m3 = 0; m3 < members.length; m3++) put(target, members[m3]);
            } else {
                for (var m4 = 0; m4 < members.length; m4++) putByCategory(members[m4]);
            }
        }
        for (var loose = 0; loose < snapshot.sprites.length; loose++) {
            if (!filed[snapshot.sprites[loose].id]) putByCategory(snapshot.sprites[loose].id);
        }
        var kept = [];
        for (var b = 0; b < buckets.length; b++) {
            if (!buckets[b].sprites.length) continue;
            if (buckets[b].sprites.length && !buckets[b].custom && buckets[b].category === 'other') {
                // if every sprite is simply "other", a folder called Sprites reads better
                var others = 0;
                for (var ob = 0; ob < buckets.length; ob++) if (buckets[ob].sprites.length) others++;
                if (others === 1) buckets[b].name = text('folderSprites');
            }
            kept.push(buckets[b]);
        }
        kept.sort(function (left, right) {
            var li = FOLDER_ORDER.indexOf(left.category);
            var ri = FOLDER_ORDER.indexOf(right.category);
            if (li < 0) li = FOLDER_ORDER.length;
            if (ri < 0) ri = FOLDER_ORDER.length;
            if (li !== ri) return li - ri;
            return 0;
        });
        var renamed = 0;
        var result = [];
        var filedCount = 0;
        for (var k = 0; k < kept.length; k++) {
            var item = kept[k];
            if (foldText(item.name) !== foldText(item.sourceName)) renamed++;
            filedCount += item.sprites.length;
            result.push({id: item.id, name: item.name, sprites: item.sprites});
        }
        var removed = Math.max(0, sourceFolders.length - result.length);
        var originalNames = {};
        for (var os = 0; os < sourceFolders.length; os++) originalNames[sourceFolders[os].id] = sourceFolders[os].name;
        var finalNames = {};
        for (var fi = 0; fi < result.length; fi++) {
            for (var fs = 0; fs < result[fi].sprites.length; fs++) finalNames[result[fi].sprites[fs]] = result[fi].name;
        }
        var assignmentsChanged = false;
        for (var si = 0; si < snapshot.sprites.length; si++) {
            var sid = snapshot.sprites[si].id;
            var beforeName = assignments[sid] ? (originalNames[assignments[sid]] || '') : '';
            var afterName = finalNames[sid] || '';
            if (foldText(beforeName) !== foldText(afterName)) { assignmentsChanged = true; break; }
        }
        var namesChanged = sourceFolders.length !== result.length;
        if (!namesChanged) {
            for (var ni = 0; ni < sourceFolders.length; ni++) {
                if (foldText(sourceFolders[ni].name) !== foldText(result[ni].name)) {
                    namesChanged = true;
                    break;
                }
            }
        }
        var changed = assignmentsChanged || namesChanged;
        if (!changed) {
            // still report the current folder count so the result screen can show the tidy state
            return {
                changed: false,
                folders: [],
                stats: {count: result.length, filed: filedCount, renamed: 0, removed: 0, changed: false},
                snapshot: null
            };
        }
        return {
            changed: true,
            folders: result,
            stats: {count: result.length, filed: filedCount, renamed: renamed, removed: removed, changed: true},
            snapshot: {
                folders: sourceFolders.map(function (item) { return {id: item.id, name: item.name}; }),
                assignments: originalAssignments.map(function (item) {
                    return {id: item.id, name: item.name, folder: item.folder || ''};
                })
            }
        };
    }
    function applyFolderPlan (plan) {
        if (!plan || !plan.changed || !plan.folders.length) return null;
        var api = folderStore();
        if (!api) return null;
        var payload = plan.folders.map(function (folder) {
            return {id: folder.id || undefined, name: folder.name, sprites: folder.sprites.slice()};
        });
        var reply = null;
        try { reply = api.apply(payload); } catch (e) { reply = null; }
        if (!reply || !reply.ok) return null;
        return plan.snapshot;
    }
    function restoreFolders (snapshot) {
        if (!snapshot) return;
        var api = folderStore();
        if (!api) return;
        var byFolder = {};
        var assignments = Array.isArray(snapshot.assignments) ? snapshot.assignments : [];
        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];
            if (!assignment || !assignment.folder) continue;
            if (!byFolder[assignment.folder]) byFolder[assignment.folder] = [];
            byFolder[assignment.folder].push(assignment.id);
        }
        var folders = Array.isArray(snapshot.folders) ? snapshot.folders : [];
        var payload = folders.map(function (folder) {
            return {id: folder.id, name: folder.name, sprites: byFolder[folder.id] || []};
        });
        try { api.apply(payload); } catch (e) { /* the folder store is best-effort metadata */ }
    }
    function scriptHeight (blocks, id, seen) {
        var height = 0;
        while (id && !seen[id]) {
            seen[id] = true;
            var block = blocks._blocks[id];
            if (!block) break;
            height++;
            var inputs = block.inputs || {};
            var names = Object.keys(inputs);
            for (var i = 0; i < names.length; i++) {
                if (names[i] !== 'SUBSTACK' && names[i] !== 'SUBSTACK2') continue;
                var input = inputs[names[i]];
                if (!input || !input.block) continue;
                var branch = blocks._blocks[input.block];
                if (!branch || branch.shadow) continue;
                height += scriptHeight(blocks, input.block, seen);
            }
            id = block.next;
        }
        return height;
    }
    function tidyLayout (vm, removedScriptIds) {
        var positions = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            var blocks = target.blocks;
            if (!blocks || !blocks._blocks || !blocks._scripts) continue;
            var items = [];
            for (var s = 0; s < blocks._scripts.length; s++) {
                var id = blocks._scripts[s];
                if (removedScriptIds[id]) continue;
                var block = blocks._blocks[id];
                if (!block || !block.topLevel) continue;
                items.push(block);
            }
            if (!items.length) continue;
            items.sort(function (a, b) {
                var ay = Number(a.y) || 0;
                var by = Number(b.y) || 0;
                if (ay !== by) return ay - by;
                return (Number(a.x) || 0) - (Number(b.x) || 0);
            });
            var x = 48;
            var y = 48;
            var columnBottom = 48;
            for (var i = 0; i < items.length; i++) {
                var block = items[i];
                var seen = Object.create(null);
                var height = scriptHeight(blocks, block.id, seen);
                var pixels = height * 48 + 24;
                if (columnBottom > 48 && columnBottom + pixels > 1600) {
                    x += 576;
                    y = 48;
                    columnBottom = 48;
                }
                var newX = Math.round(x);
                var newY = Math.round(y);
                var oldX = Number(block.x) || 0;
                var oldY = Number(block.y) || 0;
                if (Math.abs(oldX - newX) >= 1 || Math.abs(oldY - newY) >= 1) {
                    positions.push({
                        target: target,
                        block: block,
                        x: newX,
                        y: newY,
                        oldX: block.x,
                        oldY: block.y
                    });
                }
                y += pixels + 24;
                columnBottom = y;
            }
        }
        return positions;
    }

    // ---------------------------------------------------------------- apply / roll back
    // Rebuilding the Blockly workspace nudges comment geometry to whole pixels. That is a
    // display concern, not project data, so keep the exact numbers from before the rebuild.
    function captureCommentMetrics (vm) {
        var out = [];
        var targets = originalTargets(vm);
        for (var t = 0; t < targets.length; t++) {
            var comments = targets[t].comments || {};
            var ids = Object.keys(comments);
            for (var i = 0; i < ids.length; i++) {
                var comment = comments[ids[i]];
                if (!comment) continue;
                out.push({
                    target: targets[t],
                    id: ids[i],
                    x: comment.x,
                    y: comment.y,
                    width: comment.width,
                    height: comment.height
                });
            }
        }
        return out;
    }
    function restoreCommentMetrics (metrics) {
        if (!metrics) return;
        for (var i = 0; i < metrics.length; i++) {
            var entry = metrics[i];
            // a workspace rebuild can replace the comment objects, so resolve by id
            var comments = entry.target && entry.target.comments;
            var comment = comments && comments[entry.id];
            if (!comment) continue;
            if (entry.x !== undefined) comment.x = entry.x;
            if (entry.y !== undefined) comment.y = entry.y;
            if (entry.width !== undefined) comment.width = entry.width;
            if (entry.height !== undefined) comment.height = entry.height;
        }
    }
    function restoreCommentMetricsAfterRebuild (metrics) {
        // the GUI rebuilds Blockly from the workspaceUpdate event in a later task and its
        // comment move events round the geometry; apply the exact values again afterwards
        restoreCommentMetrics(metrics);
        window.setTimeout(function () { restoreCommentMetrics(metrics); }, 0);
        window.setTimeout(function () { restoreCommentMetrics(metrics); }, 250);
    }
    function refreshEditor (vm) {
        try { vm.emitWorkspaceUpdate(); } catch (e) { try { vm.refreshWorkspace(); } catch (e2) { /* no workspace */ } }
        try { vm.emitTargetsUpdate(); } catch (e) { /* player without target list */ }
        try { vm.emitProjectChanged(); } catch (e) { /* older VM */ }
        try { var rt = vm.runtime; if (rt && rt.requestRedraw) rt.requestRedraw(); } catch (e) { /* no renderer */ }
    }
    function swapOwnerAsset (owner, newAsset, journal, newFormat) {
        journal.assets.push({
            owner: owner,
            asset: owner.asset,
            assetId: owner.assetId,
            md5: owner.md5,
            md5ext: owner.md5ext,
            dataFormat: owner.dataFormat
        });
        owner.asset = newAsset;
        owner.assetId = newAsset.assetId;
        if (newFormat && newFormat !== owner.dataFormat) owner.dataFormat = newFormat;
        owner.md5 = newAsset.assetId + '.' + owner.dataFormat;
        if (Object.prototype.hasOwnProperty.call(owner, 'md5ext')) owner.md5ext = owner.md5;
    }
    function restoreJournal (vm, journal) {
        if (!journal) return;
        try {
            for (var a = journal.assets.length - 1; a >= 0; a--) {
                var ar = journal.assets[a];
                ar.owner.asset = ar.asset;
                ar.owner.assetId = ar.assetId;
                ar.owner.md5 = ar.md5;
                if (ar.dataFormat !== undefined) ar.owner.dataFormat = ar.dataFormat;
                if (ar.md5ext !== undefined) ar.owner.md5ext = ar.md5ext;
            }
        } catch (e) { /* keep restoring what can be restored */ }
        try {
            // the declaration map must be restored before removed variables are put back, because
            // both journals can point at the same original object
            for (var d = journal.declarations.length - 1; d >= 0; d--) {
                var dr = journal.declarations[d];
                dr.target.variables = dr.variables;
            }
        } catch (e) { /* same */ }
        try {
            for (var v = journal.variables.length - 1; v >= 0; v--) {
                var vr = journal.variables[v];
                vr.target.variables[vr.id] = vr.variable;
            }
        } catch (e) { /* same */ }
        try {
            for (var c = journal.comments.length - 1; c >= 0; c--) {
                var cr = journal.comments[c];
                cr.target.comments[cr.id] = cr.comment;
            }
        } catch (e) { /* same */ }
        try {
            for (var b = journal.blocks.length - 1; b >= 0; b--) {
                var br = journal.blocks[b];
                var block = br.block;
                br.target.blocks._blocks[block.id] = block;
                if (br.index < 0) continue;
                var scripts = br.target.blocks._scripts;
                var index = Math.min(br.index, scripts.length);
                if (scripts.indexOf(block.id) < 0) scripts.splice(index, 0, block.id);
            }
        } catch (e) { /* same */ }
        try {
            for (var p = 0; p < journal.positions.length; p++) {
                var position = journal.positions[p];
                // the workspace rebuild swaps block objects, so always look the block up by id
                var currentBlock = position.target && position.target.blocks &&
                    position.target.blocks._blocks[position.block.id];
                var restoredBlock = currentBlock || position.block;
                restoredBlock.x = position.oldX;
                restoredBlock.y = position.oldY;
            }
        } catch (e) { /* same */ }
        try {
            var targets = originalTargets(vm);
            for (var t = 0; t < targets.length; t++) {
                if (targets[t].blocks && targets[t].blocks.resetCache) targets[t].blocks.resetCache();
            }
        } catch (e) { /* same */ }
        try { restoreFolders(journal.folders); } catch (e) { /* folder metadata is best-effort */ }
        refreshEditor(vm);
        restoreCommentMetricsAfterRebuild(journal.commentMetrics);
    }
    function applyPlan (vm, plan) {
        var journal = {
            assets: [],
            declarations: [],
            variables: [],
            comments: [],
            commentMetrics: [],
            blocks: [],
            positions: [],
            folders: null
        };
        try {
            journal.commentMetrics = captureCommentMetrics(vm);
            for (var s = 0; s < plan.swaps.length; s++) {
                var swap = plan.swaps[s];
                for (var o = 0; o < swap.entry.owners.length; o++) {
                    swapOwnerAsset(swap.entry.owners[o].owner, swap.newAsset, journal, swap.newFormat);
                }
            }
            for (var b = 0; b < plan.scripts.length; b++) {
                var entry = plan.scripts[b];
                var scripts = entry.target.blocks._scripts;
                var index = scripts.indexOf(entry.block.id);
                if (index >= 0) scripts.splice(index, 1);
                delete entry.target.blocks._blocks[entry.block.id];
                journal.blocks.push({target: entry.target, block: entry.block, index: index});
            }
            for (var ob = 0; ob < plan.orphans.length; ob++) {
                var orphan = plan.orphans[ob];
                delete orphan.target.blocks._blocks[orphan.block.id];
                journal.blocks.push({target: orphan.target, block: orphan.block, index: -1});
            }
            for (var c = 0; c < plan.comments.length; c++) {
                var comment = plan.comments[c];
                delete comment.target.comments[comment.id];
                journal.comments.push(comment);
            }
            for (var d = 0; d < plan.declarations.length; d++) {
                var declaration = plan.declarations[d];
                journal.declarations.push({target: declaration.target, variables: declaration.target.variables});
                var ordered = {};
                for (var di = 0; di < declaration.ids.length; di++) {
                    var id = declaration.ids[di];
                    if (declaration.target.variables[id]) ordered[id] = declaration.target.variables[id];
                }
                declaration.target.variables = ordered;
            }
            // remove unused declarations after the order journal, so undo can put the original
            // object (with its original insertion order) back in one step
            for (var v = 0; v < plan.variables.length; v++) {
                var variable = plan.variables[v];
                delete variable.target.variables[variable.id];
                journal.variables.push(variable);
            }
            for (var p = 0; p < plan.positions.length; p++) {
                var position = plan.positions[p];
                journal.positions.push(position);
                var positionBlock = (position.target && position.target.blocks &&
                    position.target.blocks._blocks[position.block.id]) || position.block;
                positionBlock.x = position.x;
                positionBlock.y = position.y;
            }
            var targets = originalTargets(vm);
            for (var t = 0; t < targets.length; t++) {
                if (targets[t].blocks && targets[t].blocks.resetCache) targets[t].blocks.resetCache();
            }
            refreshEditor(vm);
            restoreCommentMetricsAfterRebuild(journal.commentMetrics);
        } catch (error) {
            restoreJournal(vm, journal);
            throw error;
        }
        return journal;
    }

    // ---------------------------------------------------------------- project run
    function sortBySizeDesc (list) {
        return list.slice().sort(function (a, b) { return b.bytes - a.bytes; });
    }
    function pushSwap (swaps, entry, newAsset, newFormat) {
        swaps.push({entry: entry, newAsset: newAsset, newFormat: newFormat || ''});
    }
    async function runOptimizer (vm, onProgress, state) {
        var started = now();
        var deadline = started + TIME_BUDGET;
        var before = measureProject(vm);
        var collected = before.assets;
        var text = makeText(vm);
        var stats = {
            before: before,
            after: null,
            svg: {count: 0, before: 0, after: 0, skipped: 0},
            image: {count: 0, before: 0, after: 0, skipped: 0},
            sound: {count: 0, before: 0, after: 0, skipped: 0, encoded: 0},
            code: {variables: 0, lists: 0, broadcasts: 0, scripts: 0, comments: 0, orphans: 0, sorted: 0},
            folders: {count: 0, filed: 0, renamed: 0, removed: 0, changed: false},
            arranged: 0,
            skippedAssets: 0,
            timeLimitHit: false,
            cancelled: false
        };
        var swaps = [];
        function report (step, status, detail, progress) {
            if (!onProgress) return;
            try { onProgress(step, status, detail, progress); } catch (e) { /* UI never stops the run */ }
        }
        function cancelled () {
            return !!(state && state.cancelled);
        }
        report(0, 'active', '', 0);

        var svgEntries = [];
        var imageEntries = [];
        var soundEntries = [];
        for (var i = 0; i < collected.keys.length; i++) {
            var entry = collected.map[collected.keys[i]];
            if (entry.assetType === 'sound') soundEntries.push(entry);
            else if (entry.dataFormat === 'svg') svgEntries.push(entry);
            else if (entry.dataFormat === 'png' || entry.dataFormat === 'jpg' ||
                entry.dataFormat === 'jpeg') imageEntries.push(entry);
        }
        svgEntries = sortBySizeDesc(svgEntries);
        imageEntries = sortBySizeDesc(imageEntries);
        soundEntries = sortBySizeDesc(soundEntries);

        report(1, 'active', '', 0);
        for (var s = 0; s < svgEntries.length; s++) {
            if (cancelled()) {
                stats.cancelled = true;
                return {stats: stats, swaps: swaps, plan: null, cancelled: true};
            }
            if (now() > deadline) {
                stats.timeLimitHit = true;
                stats.svg.skipped += svgEntries.length - s;
                break;
            }
            var svgEntry = svgEntries[s];
            report(1, 'active', (s + 1) + ' / ' + svgEntries.length, s / Math.max(1, svgEntries.length));
            try {
                var svgText = assetText(svgEntry.asset);
                var result = svgText ? await optimizeSvgText(svgText, deadline) : null;
                if (result && result.size < svgEntry.bytes) {
                    // asset data must stay binary: the editor's decodeText() hands it to
                    // TextDecoder, which rejects a plain string with a TypeError
                    var svgBytes = encodeText(result.text);
                    var newSvg = createAsset(vm, 'costume', 'svg', svgBytes);
                    if (newSvg && newSvg.assetId) {
                        pushSwap(swaps, svgEntry, newSvg);
                        stats.svg.count++;
                        stats.svg.before += svgEntry.bytes;
                        stats.svg.after += svgBytes.length;
                    }
                } else {
                    stats.svg.skipped++;
                }
            } catch (e) {
                stats.svg.skipped++;
                if (window.console) window.console.warn('ScratchDream optimize svg:', e);
            }
            if (s % 2 === 0) await nextTick();
        }
        report(1, 'done', '', 1);

        report(2, 'active', '', 0);
        for (var im = 0; im < imageEntries.length; im++) {
            if (cancelled()) {
                stats.cancelled = true;
                return {stats: stats, swaps: swaps, plan: null, cancelled: true};
            }
            if (now() > deadline) {
                stats.timeLimitHit = true;
                stats.image.skipped += imageEntries.length - im;
                break;
            }
            var imageEntry = imageEntries[im];
            report(2, 'active', (im + 1) + ' / ' + imageEntries.length, im / Math.max(1, imageEntries.length));
            try {
                var imageResult = await optimizeBinaryAsset(imageEntry.assetType, imageEntry.dataFormat,
                    assetBytes(imageEntry.asset));
                if (imageResult && imageResult.bytes.length < imageEntry.bytes) {
                    var newImage = createAsset(vm, imageEntry.assetType, imageEntry.dataFormat, imageResult.bytes);
                    if (newImage && newImage.assetId) {
                        pushSwap(swaps, imageEntry, newImage);
                        stats.image.count++;
                        stats.image.before += imageEntry.bytes;
                        stats.image.after += imageResult.bytes.length;
                    }
                } else {
                    stats.image.skipped++;
                }
            } catch (e) {
                stats.image.skipped++;
                if (window.console) window.console.warn('ScratchDream optimize image:', e);
            }
            if (im % 2 === 0) await nextTick();
        }
        report(2, 'done', '', 1);

        report(3, 'active', '', 0);
        for (var so = 0; so < soundEntries.length; so++) {
            if (cancelled()) {
                stats.cancelled = true;
                return {stats: stats, swaps: swaps, plan: null, cancelled: true};
            }
            if (now() > deadline) {
                stats.timeLimitHit = true;
                stats.sound.skipped += soundEntries.length - so;
                break;
            }
            var soundEntry = soundEntries[so];
            report(3, 'active', (so + 1) + ' / ' + soundEntries.length, so / Math.max(1, soundEntries.length));
            try {
                var soundBytes = assetBytes(soundEntry.asset);
                var soundResult = await optimizeBinaryAsset('sound', soundEntry.dataFormat, soundBytes);
                var bestSound = soundResult && soundResult.bytes.length < soundBytes.length ?
                    soundResult.bytes : soundBytes;
                var soundFormat = soundEntry.dataFormat;
                var encodedMp3 = false;
                if (soundEntry.dataFormat === 'wav') {
                    var mp3 = await convertWavToMp3(bestSound, deadline);
                    if (mp3 && mp3.length < bestSound.length) {
                        bestSound = mp3;
                        soundFormat = 'mp3';
                        encodedMp3 = true;
                    }
                }
                if (bestSound.length < soundEntry.bytes) {
                    var newSound = createAsset(vm, 'sound', soundFormat, bestSound);
                    if (newSound && newSound.assetId) {
                        pushSwap(swaps, soundEntry, newSound, soundFormat === soundEntry.dataFormat ? '' : soundFormat);
                        stats.sound.count++;
                        if (encodedMp3) stats.sound.encoded++;
                        stats.sound.before += soundEntry.bytes;
                        stats.sound.after += bestSound.length;
                    }
                } else {
                    stats.sound.skipped++;
                }
            } catch (e) {
                stats.sound.skipped++;
                if (window.console) window.console.warn('ScratchDream optimize sound:', e);
            }
            if (so % 2 === 0) await nextTick();
        }
        report(3, 'done', '', 1);

        if (cancelled()) {
            stats.cancelled = true;
            return {stats: stats, swaps: swaps, plan: null, cancelled: true};
        }
        report(4, 'active', '', 0);
        var scripts = planEmptyScripts(vm);
        var removedScriptIds = Object.create(null);
        for (var rs = 0; rs < scripts.length; rs++) removedScriptIds[scripts[rs].block.id] = true;
        var orphans = planOrphanBlocks(vm, removedScriptIds);
        var removedBlockIds = Object.create(null);
        for (var rb = 0; rb < orphans.length; rb++) removedBlockIds[orphans[rb].block.id] = true;
        for (var rbs in removedScriptIds) removedBlockIds[rbs] = true;
        var refs = scanReferences(vm, removedBlockIds);
        var variables = planUnusedVariables(vm, refs);
        var comments = planEmptyComments(vm);
        var declarations = planDeclarationOrder(vm);
        var positions = tidyLayout(vm, removedScriptIds);
        for (var vi = 0; vi < variables.length; vi++) {
            var type = variables[vi].variable.type || '';
            if (type === 'list') stats.code.lists++;
            else if (type === 'broadcast_msg') stats.code.broadcasts++;
            else stats.code.variables++;
        }
        stats.code.scripts = scripts.length;
        stats.code.comments = comments.length;
        stats.code.orphans = orphans.length;
        for (var di = 0; di < declarations.length; di++) stats.code.sorted += declarations[di].ids.length;
        stats.arranged = positions.length;
        report(4, 'active', text('stepFolders'), 0.82);
        var folderPlan = planFolders(vm, makeText(vm));
        if (folderPlan && folderPlan.stats) stats.folders = folderPlan.stats;
        report(4, 'active', text('stepFolders'), 0.94);
        report(4, 'done', '', 1);

        if (cancelled()) {
            stats.cancelled = true;
            return {stats: stats, swaps: swaps, plan: null, cancelled: true};
        }
        report(5, 'active', '', 0);
        var plan = {
            swaps: swaps,
            scripts: scripts,
            orphans: orphans,
            variables: variables,
            comments: comments,
            declarations: declarations,
            positions: positions,
            folders: folderPlan
        };
        var journal = applyPlan(vm, plan);
        if (folderPlan && folderPlan.changed) {
            journal.folders = applyFolderPlan(folderPlan);
            if (!journal.folders) {
                stats.folders = {count: 0, filed: 0, renamed: 0, removed: 0, changed: false};
            }
        }
        report(5, 'done', '', 1);
        report(6, 'active', '', 0);
        var after = before;
        try {
            after = measureProject(vm);
        } catch (e) {
            if (window.console) window.console.warn('ScratchDream optimize measure:', e);
        }
        stats.after = after;
        stats.duration = Math.round(now() - started);
        stats.savedBytes = Math.max(0, before.totalBytes - after.totalBytes);
        stats.savedPercent = before.totalBytes > 0 ? stats.savedBytes / before.totalBytes * 100 : 0;
        stats.savedAssets = Math.max(0, before.assetBytes - after.assetBytes);
        stats.savedJson = Math.max(0, before.jsonBytes - after.jsonBytes);
        report(6, 'done', '', 1);
        return {stats: stats, swaps: swaps, plan: plan, journal: journal, cancelled: false};
    }

    // ---------------------------------------------------------------- language + UI strings
    var STRINGS = {
        en: {
            button: 'Optimize',
            buttonTitle: 'Make this project smaller without changing it',
            title: 'Optimize project',
            reading: 'Reading project…',
            confirmHead: 'Smaller project. Same project.',
            confirmIntro: 'ScratchDream cleans up costumes, sounds and scripts in place. Blocks, behaviour and visual quality stay the same. Every vector costume is rasterised before and after, and a change that moves the pixels is rejected.',
            bulletSvg: 'Minifies vector costumes and checks every pixel',
            bulletBin: 'Strips hidden metadata from PNG, JPG, WAV and MP3',
            bulletAudio: 'Stores WAV sounds as high-quality MP3 after a duration and loudness check',
            bulletCode: 'Removes unused variables, lists, broadcasts and empty scripts',
            bulletLayout: 'Tidies the block layout without touching the blocks',
            bulletFolders: 'Groups sprites into named folders and tidies the Variables lists',
            note: 'Runs in about 20 seconds. The biggest assets are cleaned first.',
            projectSize: 'Project size',
            sprites: 'sprites',
            costumes: 'costumes',
            sounds: 'sounds',
            unique: 'unique assets',
            cancel: 'Cancel',
            confirm: 'Optimize now',
            progressHead: 'Optimizing…',
            running: 'Leave this tab open. The project is checked after every pass.',
            cancelling: 'Cancelling…',
            cancelHead: 'Optimization cancelled',
            cancelBody: 'Nothing was changed. The project is exactly as it was.',
            stepRead: 'Reading project',
            stepSvg: 'Vector costumes',
            stepImage: 'Bitmap costumes',
            stepSound: 'Sounds',
            stepCode: 'Code cleanup',
            stepFolders: 'Sprite folders',
            stepApply: 'Applying changes',
            stepMeasure: 'Measuring result',
            doneHead: 'Project optimized',
            alreadyHead: 'Already optimized',
            alreadyBody: 'Nothing safe was left to remove. The project is already in good shape.',
            savedLabel: 'saved',
            beforeAfter: 'Before',
            after: 'After',
            statVectors: 'Vector costumes',
            statImages: 'Bitmap costumes',
            statSounds: 'Sounds',
            statCode: 'Code',
            statLayout: 'Blocks arranged',
            statFolders: 'Sprite folders',
            statFiled: 'sprites filed',
            statRenamed: 'folders renamed',
            statSorted: 'items sorted',
            statOrphans: 'orphan blocks',
            statEncoded: 'to MP3',
            folderMain: 'Main',
            folderWorld: 'World',
            folderUi: 'Interface',
            folderAudio: 'Audio',
            folderSystem: 'System',
            folderOther: 'Other',
            folderSprites: 'Sprites',
            folderMixed: 'Mixed',
            skip: 'skipped',
            statRemoved: 'removed',
            statScripts: 'empty scripts',
            statComments: 'empty comments',
            statVars: 'variables',
            statLists: 'lists',
            statBroadcasts: 'broadcasts',
            timeLimit: 'The time limit was reached. {n} assets were left for a second run.',
            undo: 'Undo',
            done: 'Done',
            undoDone: 'Changes undone. The project is back to its previous records.',
            errorHead: 'Optimization could not finish',
            errorBody: 'Nothing was applied. The project is unchanged.',
            close: 'Close',
            noProject: 'Open a project in the editor first.',
            stepProgress: '{a} / {b}',
            loaded: 'Ready',
            features: 'Safe passes',
            statAssetBytes: 'Assets',
            statJson: 'Project data'
        },
        tr: {
            button: 'Optimize',
            buttonTitle: 'Projeyi bozmadan küçült',
            title: 'Projeyi optimize et',
            reading: 'Proje okunuyor…',
            confirmHead: 'Daha küçük proje. Aynı proje.',
            confirmIntro: 'ScratchDream kostümleri, sesleri ve kodları yerinde temizler. Bloklar, davranış ve görsel kalite aynı kalır. Her vektör kostüm önce ve sonra rasterleştirilir; pikselleri kaydıran değişiklik reddedilir.',
            bulletSvg: 'Vektör kostümleri küçültür, her pikseli kontrol eder',
            bulletBin: 'PNG, JPG, WAV ve MP3 içindeki gizli üst veriyi siler',
            bulletAudio: 'WAV sesleri süre ve ses seviyesi kontrolünden sonra yüksek kaliteli MP3 olarak saklar',
            bulletCode: 'Kullanılmayan değişken, liste, haber ve boş scriptleri kaldırır',
            bulletLayout: 'Bloklara dokunmadan kod düzenini toparlar',
            bulletFolders: 'Kuklaları adlandırılmış klasörlere ayırır ve değişken listelerini düzenler',
            note: 'Yaklaşık 20 saniye sürer. Önce en büyük dosyalar temizlenir.',
            projectSize: 'Proje boyutu',
            sprites: 'sprite',
            costumes: 'kostüm',
            sounds: 'ses',
            unique: 'benzersiz dosya',
            cancel: 'Vazgeç',
            confirm: 'Optimize et',
            progressHead: 'Optimize ediliyor…',
            running: 'Bu sekmeyi açık tut. Her adımdan sonra proje denetlenir.',
            cancelling: 'İptal ediliyor…',
            cancelHead: 'Optimizasyon iptal edildi',
            cancelBody: 'Hiçbir değişiklik yapılmadı. Proje tamamen aynı kaldı.',
            stepRead: 'Proje okunuyor',
            stepSvg: 'Vektör kostümler',
            stepImage: 'Bitmap kostümler',
            stepSound: 'Sesler',
            stepCode: 'Kod temizliği',
            stepFolders: 'Kukla klasörleri',
            stepApply: 'Değişiklikler uygulanıyor',
            stepMeasure: 'Sonuç ölçülüyor',
            doneHead: 'Proje optimize edildi',
            alreadyHead: 'Zaten optimize',
            alreadyBody: 'Güvenle kaldırılacak bir şey kalmadı. Proje zaten iyi durumda.',
            savedLabel: 'kazanç',
            beforeAfter: 'Önce',
            after: 'Sonra',
            statVectors: 'Vektör kostümler',
            statImages: 'Bitmap kostümler',
            statSounds: 'Sesler',
            statCode: 'Kod',
            statLayout: 'Düzenlenen blok',
            statFolders: 'Kukla klasörleri',
            statFiled: 'kukla yerleştirildi',
            statRenamed: 'klasör adlandırıldı',
            statSorted: 'öğe sıralandı',
            statOrphans: 'sahipsiz blok',
            statEncoded: "MP3'e",
            folderMain: 'Ana',
            folderWorld: 'Dünya',
            folderUi: 'Arayüz',
            folderAudio: 'Ses',
            folderSystem: 'Sistem',
            folderOther: 'Diğer',
            folderSprites: 'Kuklalar',
            folderMixed: 'Karma',
            skip: 'atlandı',
            statRemoved: 'kaldırıldı',
            statScripts: 'boş script',
            statComments: 'boş yorum',
            statVars: 'değişken',
            statLists: 'liste',
            statBroadcasts: 'haber',
            timeLimit: 'Süre sınırına ulaşıldı. {n} dosya ikinci çalışmaya kaldı.',
            undo: 'Geri al',
            done: 'Tamam',
            undoDone: 'Değişiklikler geri alındı. Proje önceki kayıtlarına döndü.',
            errorHead: 'Optimizasyon tamamlanamadı',
            errorBody: 'Hiçbir değişiklik uygulanmadı. Proje olduğu gibi duruyor.',
            close: 'Kapat',
            noProject: 'Önce editörde bir proje aç.',
            stepProgress: '{a} / {b}',
            loaded: 'Hazır',
            features: 'Güvenli adımlar',
            statAssetBytes: 'Dosyalar',
            statJson: 'Proje verisi'
        }
    };
    function localeOf (vm) {
        var locale = '';
        try { if (vm && vm.getLocale) locale = vm.getLocale(); } catch (e) { locale = ''; }
        if (!locale) locale = document.documentElement.lang || navigator.language || 'en';
        return /^tr/i.test(locale) ? 'tr' : 'en';
    }
    function makeText (vm) {
        var table = STRINGS[localeOf(vm)] || STRINGS.en;
        return function (key, values) {
            var text = table[key] !== undefined ? table[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
            if (values) {
                Object.keys(values).forEach(function (name) {
                    text = text.replace(new RegExp('\\{' + name + '\\}', 'g'), String(values[name]));
                });
            }
            return text;
        };
    }

    // ---------------------------------------------------------------- styles
    var CSS_TEXT = [
        '#adox-optimize-button{cursor:pointer;padding:0 .8rem;font-weight:700;font-size:.8rem;',
        'letter-spacing:.15px;display:flex;align-items:center;height:3rem;align-self:center;white-space:nowrap;',
        'color:var(--ui-white,#fff);user-select:none;border:0;background:transparent;font-family:inherit}',
        '#adox-optimize-button:hover,#adox-optimize-button:focus-visible{background-color:var(--ui-black-transparent,rgba(0,0,0,.15));outline:none}',
        '#adox-optimize-button .adox-opt-icon{width:1.15rem;height:1.15rem;margin-right:.4rem;flex:0 0 auto;display:block}',
        '#adox-optimize-button .adox-opt-icon svg,.adox-opt-head-icon svg{width:100%;height:100%;display:block;fill:currentColor}',
        '.adox-opt-overlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;',
        'justify-content:center;overflow:auto;padding:8vh 16px 32px;box-sizing:border-box}',
        '.adox-opt-card{margin:0;width:560px;max-width:100%;background:var(--ui-modal-background,#fff);',
        'color:var(--text-primary,#575e75);border:4px solid var(--ui-white-transparent,rgba(255,255,255,.5));',
        'border-radius:.5rem;overflow:hidden;box-shadow:0 14px 48px rgba(0,0,0,.35);',
        'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;user-select:none}',
        '.adox-opt-head{display:flex;align-items:center;height:3.125rem;padding:0 .5rem 0 1rem;',
        'background:var(--ui-modal-header-background,#855cd6);color:var(--ui-modal-header-foreground,#fff);font-weight:700}',
        '.adox-opt-head-icon{width:1.35rem;height:1.35rem;margin-right:.55rem;flex:0 0 auto;display:block;opacity:.95}',
        '.adox-opt-head-title{flex:1;min-width:0;font-size:1rem;line-height:1.2;letter-spacing:.2px;',
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.adox-opt-close{width:2rem;height:2rem;flex:0 0 auto;border:0;border-radius:50%;cursor:pointer;',
        'background:var(--ui-black-transparent,rgba(0,0,0,.12));color:inherit;font:inherit;font-size:1.35rem;',
        'line-height:1;display:flex;align-items:center;justify-content:center;padding:0 0 .15rem}',
        '.adox-opt-close:hover{background:rgba(0,0,0,.22)}',
        '.adox-opt-close[disabled]{opacity:.45;cursor:default}',
        '.adox-opt-body{padding:1.35rem 2rem 1.25rem;background:var(--ui-modal-background,#fff)}',
        '.adox-opt-h{font-size:1.25rem;font-weight:700;line-height:1.25;margin:0 0 .65rem;color:var(--text-primary,#575e75)}',
        '.adox-opt-p{font-size:.875rem;line-height:1.45;margin:0 0 .9rem;opacity:.9}',
        '.adox-opt-list{list-style:none;margin:0 0 1rem;padding:0;display:grid;gap:.45rem}',
        '.adox-opt-list li{display:flex;align-items:flex-start;gap:.55rem;font-size:.83rem;line-height:1.35}',
        '.adox-opt-check{width:1.1rem;height:1.1rem;flex:0 0 auto;border-radius:50%;margin-top:.06rem;',
        'background:var(--looks-secondary,#855cd6);color:#fff;font-size:.7rem;font-weight:800;',
        'display:flex;align-items:center;justify-content:center}',
        '.adox-opt-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem .9rem;',
        'padding:.7rem .8rem;margin:0 0 1rem;border-radius:.35rem;background:var(--ui-primary-transparent,rgba(0,0,0,.06));',
        'font-size:.78rem;line-height:1.3}',
        '.adox-opt-facts strong{display:block;font-size:.92rem;color:var(--text-primary,#575e75)}',
        '.adox-opt-note{font-size:.75rem;line-height:1.35;opacity:.62;margin:0 0 1rem}',
        '.adox-opt-actions{display:flex;justify-content:flex-end;align-items:center;gap:.5rem;flex-wrap:wrap}',
        '.adox-opt-actions .adox-opt-btn{min-width:6.4rem;justify-content:center}',
        '.adox-opt-btn{appearance:none;border:1px solid var(--ui-black-transparent,rgba(0,0,0,.15));',
        'border-radius:.25rem;padding:.65rem 1rem;font:inherit;font-size:.85rem;font-weight:700;cursor:pointer;',
        'background:var(--ui-white,#fff);color:var(--text-primary,#575e75);display:inline-flex;align-items:center}',
        '.adox-opt-btn:hover{filter:brightness(.97)}',
        '.adox-opt-btn:focus-visible{outline:2px solid var(--looks-secondary,#855cd6);outline-offset:2px}',
        '.adox-opt-btn.adox-opt-primary{background:var(--looks-secondary,#855cd6);border-color:var(--looks-secondary,#855cd6);color:#fff}',
        '.adox-opt-btn[disabled]{opacity:.55;cursor:default}',
        '.adox-opt-progress{height:.55rem;border-radius:999px;background:var(--ui-primary-transparent,rgba(0,0,0,.09));',
        'overflow:hidden;margin:.25rem 0 1rem}',
        '.adox-opt-progress span{display:block;height:100%;width:0;background:var(--looks-secondary,#855cd6);',
        'border-radius:999px;transition:width .18s linear}',
        '.adox-opt-steps{list-style:none;margin:0 0 1rem;padding:0;display:grid;gap:.32rem}',
        '.adox-opt-step{display:flex;align-items:center;gap:.55rem;font-size:.82rem;line-height:1.3;opacity:.55}',
        '.adox-opt-step-icon{width:1.05rem;height:1.05rem;border-radius:50%;flex:0 0 auto;box-sizing:border-box;',
        'border:2px solid var(--ui-black-transparent,rgba(0,0,0,.22));display:flex;align-items:center;',
        'justify-content:center;font-size:.65rem;font-weight:800;color:#fff}',
        '.adox-opt-step.active{opacity:1}',
        '.adox-opt-step.active .adox-opt-step-icon{border-color:var(--looks-secondary,#855cd6);',
        'border-top-color:transparent;animation:adox-opt-spin .8s linear infinite}',
        '.adox-opt-step.done{opacity:1}',
        '.adox-opt-step.done .adox-opt-step-icon{background:var(--looks-secondary,#855cd6);border-color:var(--looks-secondary,#855cd6)}',
        '.adox-opt-step-detail{margin-left:auto;font-size:.72rem;opacity:.6;font-variant-numeric:tabular-nums}',
        '.adox-opt-big{font-size:2.35rem;line-height:1;font-weight:800;color:var(--looks-secondary,#855cd6);margin:.15rem 0 .2rem}',
        '.adox-opt-big-sub{font-size:.9rem;opacity:.7;margin-bottom:1rem}',
        '.adox-opt-beforeafter{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;font-size:.9rem;margin:0 0 1rem}',
        '.adox-opt-beforeafter strong{font-size:1.05rem}',
        '.adox-opt-arrow{opacity:.5}',
        '.adox-opt-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem .9rem;margin:0 0 1.1rem}',
        '.adox-opt-stat{padding:.55rem .65rem;border-radius:.35rem;background:var(--ui-primary-transparent,rgba(0,0,0,.05));',
        'font-size:.76rem;line-height:1.3;min-width:0}',
        '.adox-opt-stat strong{display:block;font-size:.92rem;color:var(--text-primary,#575e75);overflow:hidden;',
        'text-overflow:ellipsis;white-space:nowrap}',
        '.adox-opt-stat-sub{display:block;margin-top:.12rem;font-size:.69rem;opacity:.58;overflow:hidden;',
        'text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',
        '.adox-opt-ok-msg{font-size:.8rem;line-height:1.4;color:var(--pen-primary,#0fbd8c);margin:0 0 1rem}',
        '.adox-opt-error{font-size:.8rem;line-height:1.4;color:var(--red-primary,#ff6680);margin:0 0 1rem}',
        '@keyframes adox-opt-spin{to{transform:rotate(360deg)}}',
        '@media (prefers-reduced-motion:reduce){.adox-opt-step.active .adox-opt-step-icon{animation:none}}',
        '@media (max-width:620px){.adox-opt-body{padding:1.1rem 1.15rem 1rem}',
        '.adox-opt-facts,.adox-opt-stats{grid-template-columns:1fr}}'
    ].join('');
    function ensureStyles () {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS_TEXT;
        (document.head || document.documentElement).appendChild(style);
    }

    // ---------------------------------------------------------------- menu bar button
    var SPARKLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M12 2.1l1.95 5.45 5.45 1.95-5.45 1.95L12 16.9l-1.95-5.45L4.6 9.5l5.45-1.95L12 2.1z"/>' +
        '<path d="M19.1 1.6l.66 1.84 1.84.66-1.84.66-.66 1.84-.66-1.84-1.84-.66 1.84-.66.66-1.84z"/>' +
        '<path d="M5.2 15.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4z"/>' +
        '</svg>';

    function makeNode (tag, className, content) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined && content !== null) node.textContent = String(content);
        return node;
    }
    function iconNode (className) {
        var node = makeNode('span', className);
        node.innerHTML = SPARKLE_ICON;
        return node;
    }
    function findMenuHost () {
        var main = document.querySelector('[class*="menu-bar_main-menu"]');
        if (main) return main;
        return document.querySelector('[class*="menu-bar_menu-bar"]');
    }
    function ensureButton () {
        var existing = document.getElementById(BUTTON_ID);
        var vm = findVm();
        var text = makeText(vm);
        if (existing) {
            var existingLabel = existing.querySelector('.adox-opt-label');
            if (existingLabel && existingLabel.textContent !== text('button')) {
                existingLabel.textContent = text('button');
            }
            existing.title = text('buttonTitle');
            return existing;
        }
        var host = findMenuHost();
        if (!host) return null;
        ensureStyles();

        var button = makeNode('div', 'adox-opt-button');
        button.id = BUTTON_ID;
        addNative(button, 'menu-bar_menu-bar-item');
        addNative(button, 'menu-bar_hoverable');
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', text('button'));
        button.tabIndex = 0;
        button.title = text('buttonTitle');
        button.appendChild(iconNode('adox-opt-icon'));
        var label = makeNode('span', 'adox-opt-label', text('button'));
        addNative(label, 'menu-bar_collapsible-label');
        button.appendChild(label);

        function activate (event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            openOptimizerDialog();
        }
        button.addEventListener('click', activate);
        button.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                activate(event);
            }
        });

        var growable = host.querySelector('[class*="menu-bar_growable"]');
        if (growable && growable.parentNode === host) host.insertBefore(button, growable);
        else host.appendChild(button);
        return button;
    }

    // ---------------------------------------------------------------- dialog
    var activeDialog = null;
    function openOptimizerDialog () {
        if (activeDialog) {
            activeDialog.focus();
            return;
        }
        ensureStyles();
        var vm = findVm();
        var text = makeText(vm);
        var locale = localeOf(vm);
        var previousFocus = document.activeElement;
        var previousOverflow = document.body.style.overflow;
        var state = {
            running: false,
            cancelled: false,
            closed: false,
            timer: 0,
            journal: null,
            vm: vm
        };

        var overlay = makeNode('div', 'adox-opt-overlay');
        addNative(overlay, 'modal_modal-overlay');
        overlay.setAttribute('data-adox-optimize', '');
        var card = makeNode('div', 'adox-opt-card');
        addNative(card, 'modal_modal-content');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'adox-opt-dialog-title');
        card.tabIndex = -1;
        var head = makeNode('div', 'adox-opt-head');
        addNative(head, 'modal_header');
        var titleNode = makeNode('div', 'adox-opt-head-title');
        titleNode.id = 'adox-opt-dialog-title';
        var closeButton = makeNode('button', 'adox-opt-close', '\u00d7');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', text('close'));
        closeButton.title = text('close');
        head.appendChild(iconNode('adox-opt-head-icon'));
        head.appendChild(titleNode);
        head.appendChild(closeButton);
        var body = makeNode('div', 'adox-opt-body');
        addNative(body, 'prompt_body');
        card.appendChild(head);
        card.appendChild(body);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        activeDialog = {
            focus: function () {
                try { card.focus(); } catch (e) { /* older browser */ }
            }
        };

        function setTitle (value) {
            titleNode.textContent = value;
        }
        function clearBody () {
            while (body.firstChild) body.removeChild(body.firstChild);
        }
        function addHeading (value) {
            var heading = makeNode('h2', 'adox-opt-h', value);
            body.appendChild(heading);
            return heading;
        }
        function addParagraph (value, className) {
            var paragraph = makeNode('p', className || 'adox-opt-p', value);
            body.appendChild(paragraph);
            return paragraph;
        }
        function makeButton (label, primary) {
            var button = makeNode('button', 'adox-opt-btn' + (primary ? ' adox-opt-primary' : ''), label);
            button.type = 'button';
            return button;
        }
        function addActions () {
            var row = makeNode('div', 'adox-opt-actions');
            addNative(row, 'prompt_button-row');
            for (var i = 0; i < arguments.length; i++) row.appendChild(arguments[i]);
            body.appendChild(row);
            return row;
        }
        function focusNode (node) {
            if (!node) return;
            try { node.focus({preventScroll: true}); } catch (e) { try { node.focus(); } catch (e2) { /* no focus */ } }
        }
        function close (force) {
            if (state.closed) return;
            if (state.running && !force) {
                requestCancel();
                return;
            }
            state.closed = true;
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = 0;
            }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            document.removeEventListener('keydown', onKey, true);
            document.body.style.overflow = previousOverflow;
            activeDialog = null;
            if (previousFocus && previousFocus.focus) {
                try { previousFocus.focus({preventScroll: true}); } catch (e) {
                    try { previousFocus.focus(); } catch (e2) { /* focus moved on */ }
                }
            }
        }
        function requestCancel () {
            if (!state.running) {
                close(true);
                return;
            }
            state.cancelled = true;
            closeButton.disabled = true;
            var cancelButton = body.querySelector('[data-adox-cancel]');
            if (cancelButton) {
                cancelButton.disabled = true;
                cancelButton.textContent = text('cancelling');
            }
            var runningText = body.querySelector('.adox-opt-running');
            if (runningText) runningText.textContent = text('cancelling');
        }
        function onKey (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }
            if (event.key !== 'Tab') return;
            var nodes = card.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), ' +
                'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
            var focusables = [];
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].offsetParent !== null) focusables.push(nodes[i]);
            }
            if (!focusables.length) {
                event.preventDefault();
                focusNode(card);
                return;
            }
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
                event.preventDefault();
                focusNode(last);
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                focusNode(first);
            }
        }
        closeButton.addEventListener('click', function () { close(false); });
        document.addEventListener('keydown', onKey, true);

        function addFeatureList () {
            var list = makeNode('ul', 'adox-opt-list');
            var features = [text('bulletSvg'), text('bulletBin'), text('bulletAudio'),
                text('bulletCode'), text('bulletFolders'), text('bulletLayout')];
            for (var i = 0; i < features.length; i++) {
                var item = makeNode('li');
                item.appendChild(makeNode('span', 'adox-opt-check', '\u2713'));
                item.appendChild(makeNode('span', '', features[i]));
                list.appendChild(item);
            }
            body.appendChild(list);
        }
        function addFact (label, value) {
            var box = makeNode('div');
            box.appendChild(makeNode('strong', '', value));
            box.appendChild(makeNode('span', '', label));
            return box;
        }
        function addStats (stats) {
            var grid = makeNode('div', 'adox-opt-stats');

            function addStat (label, value, sub) {
                var box = makeNode('div', 'adox-opt-stat');
                box.appendChild(makeNode('strong', '', value));
                box.appendChild(makeNode('span', '', label));
                if (sub) box.appendChild(makeNode('span', 'adox-opt-stat-sub', sub));
                grid.appendChild(box);
            }
            function assetStat (label, part) {
                var sub = '';
                if (part.count > 0) {
                    sub = formatBytes(part.before, locale) + ' \u2192 ' + formatBytes(part.after, locale);
                } else if (part.skipped > 0) {
                    sub = formatCount(part.skipped, locale) + ' ' + text('skip');
                }
                if (part.encoded) {
                    sub += (sub ? ' \u00b7 ' : '') + formatCount(part.encoded, locale) + ' ' + text('statEncoded');
                }
                addStat(label, formatCount(part.count, locale), sub);
            }
            assetStat(text('statVectors'), stats.svg);
            assetStat(text('statImages'), stats.image);
            assetStat(text('statSounds'), stats.sound);

            var codeTotal = stats.code.variables + stats.code.lists + stats.code.broadcasts +
                stats.code.scripts + stats.code.comments + stats.code.orphans;
            var codeParts = [];
            if (stats.code.variables) codeParts.push(formatCount(stats.code.variables, locale) + ' ' + text('statVars'));
            if (stats.code.lists) codeParts.push(formatCount(stats.code.lists, locale) + ' ' + text('statLists'));
            if (stats.code.broadcasts) codeParts.push(formatCount(stats.code.broadcasts, locale) + ' ' + text('statBroadcasts'));
            if (stats.code.scripts) codeParts.push(formatCount(stats.code.scripts, locale) + ' ' + text('statScripts'));
            if (stats.code.comments) codeParts.push(formatCount(stats.code.comments, locale) + ' ' + text('statComments'));
            if (stats.code.orphans) codeParts.push(formatCount(stats.code.orphans, locale) + ' ' + text('statOrphans'));
            if (stats.code.sorted) codeParts.push(formatCount(stats.code.sorted, locale) + ' ' + text('statSorted'));
            addStat(text('statCode'), formatCount(codeTotal, locale), codeParts.join(' \u00b7 '));
            addStat(text('statLayout'), formatCount(stats.arranged, locale), '');
            if (stats.folders && stats.folders.count) {
                var folderParts = [];
                if (stats.folders.filed) folderParts.push(formatCount(stats.folders.filed, locale) + ' ' + text('statFiled'));
                if (stats.folders.renamed) folderParts.push(formatCount(stats.folders.renamed, locale) + ' ' + text('statRenamed'));
                addStat(text('statFolders'), formatCount(stats.folders.count, locale), folderParts.join(' \u00b7 '));
            }
            if (stats.after) {
                addStat(text('statJson'), formatBytes(stats.after.jsonBytes, locale),
                    formatBytes(stats.before.jsonBytes, locale) + ' \u2192 ' + formatBytes(stats.after.jsonBytes, locale));
            }
            body.appendChild(grid);
        }

        function showLoading () {
            clearBody();
            setTitle(text('title'));
            addHeading(text('reading'));
            addParagraph(text('running'), 'adox-opt-p adox-opt-running');
            var bar = makeNode('div', 'adox-opt-progress');
            var fill = makeNode('span');
            fill.style.width = '18%';
            bar.appendChild(fill);
            body.appendChild(bar);
            closeButton.disabled = false;
            closeButton.setAttribute('aria-label', text('close'));
            closeButton.title = text('close');
            focusNode(card);
        }
        function showError (message) {
            clearBody();
            setTitle(text('title'));
            addHeading(text('errorHead'));
            addParagraph(text('errorBody'));
            if (message) {
                var detail = makeNode('p', 'adox-opt-note');
                detail.textContent = String(message).slice(0, 320);
                body.appendChild(detail);
            }
            var closeAction = makeButton(text('close'), true);
            closeAction.addEventListener('click', function () { close(true); });
            addActions(closeAction);
            focusNode(closeAction);
        }
        function showNoProject () {
            clearBody();
            setTitle(text('title'));
            addHeading(text('noProject'));
            addParagraph(text('confirmIntro'));
            var closeAction = makeButton(text('close'), true);
            closeAction.addEventListener('click', function () { close(true); });
            addActions(closeAction);
            focusNode(closeAction);
        }
        function showConfirm (before) {
            clearBody();
            setTitle(text('title'));
            addHeading(text('confirmHead'));
            addParagraph(text('confirmIntro'));
            addFeatureList();

            var facts = makeNode('div', 'adox-opt-facts');
            facts.appendChild(addFact(text('projectSize'), formatBytes(before.totalBytes, locale)));
            facts.appendChild(addFact(text('sprites'), formatCount(before.sprites, locale)));
            facts.appendChild(addFact(text('costumes'), formatCount(before.costumes, locale)));
            facts.appendChild(addFact(text('sounds'), formatCount(before.sounds, locale)));
            facts.appendChild(addFact(text('unique'), formatCount(before.uniqueAssets, locale)));
            body.appendChild(facts);
            addParagraph(text('note'), 'adox-opt-note');

            var cancelAction = makeButton(text('cancel'), false);
            var confirmAction = makeButton(text('confirm'), true);
            cancelAction.addEventListener('click', function () { close(true); });
            confirmAction.addEventListener('click', function () {
                confirmAction.disabled = true;
                cancelAction.disabled = true;
                showProgress();
            });
            addActions(cancelAction, confirmAction);
            focusNode(cancelAction);
        }
        function showProgress () {
            clearBody();
            setTitle(text('progressHead'));
            addHeading(text('progressHead'));
            addParagraph(text('running'), 'adox-opt-p adox-opt-running');

            var bar = makeNode('div', 'adox-opt-progress');
            var fill = makeNode('span');
            bar.appendChild(fill);
            body.appendChild(bar);

            var stepLabels = [
                text('stepRead'),
                text('stepSvg'),
                text('stepImage'),
                text('stepSound'),
                text('stepCode') + ' \u00b7 ' + text('stepFolders'),
                text('stepApply'),
                text('stepMeasure')
            ];
            var rows = [];
            var steps = makeNode('ul', 'adox-opt-steps');
            for (var i = 0; i < stepLabels.length; i++) {
                var row = makeNode('li', 'adox-opt-step');
                var rowIcon = makeNode('span', 'adox-opt-step-icon');
                var rowLabel = makeNode('span', '', stepLabels[i]);
                var rowDetail = makeNode('span', 'adox-opt-step-detail');
                row.appendChild(rowIcon);
                row.appendChild(rowLabel);
                row.appendChild(rowDetail);
                steps.appendChild(row);
                rows.push({row: row, icon: rowIcon, detail: rowDetail});
            }
            body.appendChild(steps);

            var cancelAction = makeButton(text('cancel'), false);
            cancelAction.setAttribute('data-adox-cancel', '1');
            cancelAction.addEventListener('click', requestCancel);
            addActions(cancelAction);

            closeButton.disabled = false;
            closeButton.setAttribute('aria-label', text('close'));
            closeButton.title = text('close');

            var lastStep = -1;
            function markDone (index) {
                if (index < 0 || index >= rows.length) return;
                rows[index].row.classList.remove('active');
                rows[index].row.classList.add('done');
                rows[index].icon.textContent = '\u2713';
                rows[index].detail.textContent = '';
            }
            function onProgress (step, status, detail, progress) {
                if (state.closed) return;
                if (step < 0 || step >= rows.length) return;
                if (step > lastStep) {
                    for (var d = Math.max(0, lastStep); d < step; d++) markDone(d);
                    lastStep = step;
                }
                var row = rows[step];
                if (status === 'done') {
                    markDone(step);
                } else {
                    row.row.classList.add('active');
                    row.detail.textContent = detail ? String(detail) : '';
                }
                var fraction = (step + clamp(Number(progress) || 0, 0, 1)) / rows.length;
                fill.style.width = Math.round(clamp(fraction, 0, 1) * 100) + '%';
            }

            state.running = true;
            state.cancelled = false;
            state.timer = window.setTimeout(function () {
                state.timer = 0;
                runOptimizer(vm, onProgress, state).then(function (result) {
                    state.running = false;
                    if (state.closed) return;
                    if (result.cancelled) {
                        showCancelled();
                        return;
                    }
                    state.journal = result.journal;
                    showResult(result.stats, result.journal);
                }).catch(function (error) {
                    state.running = false;
                    if (state.closed) return;
                    if (window.console) window.console.error('ScratchDream optimize:', error);
                    showError(error && error.message ? error.message : '');
                });
            }, 50);
        }
        function showCancelled () {
            clearBody();
            setTitle(text('title'));
            addHeading(text('cancelHead'));
            addParagraph(text('cancelBody'));
            var doneAction = makeButton(text('done'), true);
            doneAction.addEventListener('click', function () { close(true); });
            addActions(doneAction);
            closeButton.disabled = false;
            focusNode(doneAction);
        }
        function showResult (stats, journal) {
            clearBody();
            setTitle(text('title'));
            var codeTotal = stats.code.variables + stats.code.lists + stats.code.broadcasts +
                stats.code.scripts + stats.code.comments + stats.code.orphans;
            var hasChanges = stats.savedBytes > 0 || codeTotal > 0 || stats.arranged > 0 ||
                stats.code.sorted > 0 || (stats.folders && stats.folders.changed);
            closeButton.disabled = false;

            if (!hasChanges) {
                addHeading(text('alreadyHead'));
                addParagraph(text('alreadyBody'));
                var doneAction = makeButton(text('done'), true);
                doneAction.addEventListener('click', function () { close(true); });
                addActions(doneAction);
                focusNode(doneAction);
                return;
            }

            addHeading(text('doneHead'));
            if (stats.savedBytes > 0) {
                var big = makeNode('div', 'adox-opt-big', '-' + formatNumber(stats.savedPercent, 1, locale) + '%');
                body.appendChild(big);
                body.appendChild(makeNode('div', 'adox-opt-big-sub',
                    formatBytes(stats.savedBytes, locale) + ' ' + text('savedLabel')));
            } else {
                body.appendChild(makeNode('div', 'adox-opt-big', '\u2713'));
                body.appendChild(makeNode('div', 'adox-opt-big-sub', text('doneHead')));
            }

            var beforeAfter = makeNode('div', 'adox-opt-beforeafter');
            beforeAfter.appendChild(makeNode('span', '', text('beforeAfter') + ' '));
            beforeAfter.appendChild(makeNode('strong', '', formatBytes(stats.before.totalBytes, locale)));
            beforeAfter.appendChild(makeNode('span', 'adox-opt-arrow', '\u2192'));
            beforeAfter.appendChild(makeNode('span', '', text('after') + ' '));
            beforeAfter.appendChild(makeNode('strong', '', formatBytes(stats.after.totalBytes, locale)));
            body.appendChild(beforeAfter);

            addStats(stats);
            if (stats.timeLimitHit) {
                addParagraph(text('timeLimit', {n: formatCount(stats.skippedAssets, locale)}), 'adox-opt-note');
            }

            var undoAction = makeButton(text('undo'), false);
            var doneAction = makeButton(text('done'), true);
            undoAction.addEventListener('click', function () {
                undoAction.disabled = true;
                doneAction.disabled = true;
                try {
                    restoreJournal(vm, journal);
                    showUndone();
                } catch (error) {
                    if (window.console) window.console.error('ScratchDream undo:', error);
                    doneAction.disabled = false;
                    undoAction.disabled = false;
                }
            });
            doneAction.addEventListener('click', function () { close(true); });
            addActions(undoAction, doneAction);
            focusNode(doneAction);
        }
        function showUndone () {
            clearBody();
            setTitle(text('title'));
            addHeading(text('undoDone'));
            var doneAction = makeButton(text('done'), true);
            doneAction.addEventListener('click', function () { close(true); });
            addActions(doneAction);
            focusNode(doneAction);
        }

        if (!vm) {
            showNoProject();
            return;
        }
        showLoading();
        state.timer = window.setTimeout(function () {
            state.timer = 0;
            var before = null;
            try {
                before = measureProject(vm);
            } catch (error) {
                if (window.console) window.console.error('ScratchDream optimize measure:', error);
            }
            if (state.closed) return;
            if (!before) {
                showError('');
                return;
            }
            showConfirm(before);
        }, 40);
    }

    // ---------------------------------------------------------------- start
    function boot () {
        ensureStyles();
        ensureButton();
        window.setInterval(ensureButton, 900);
        window.addEventListener('load', ensureButton, {once: true});
        window.addEventListener('resize', ensureButton);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, {once: true});
    } else {
        boot();
    }
})();
