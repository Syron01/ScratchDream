// ScratchDream, costume editor. Loaded as a content script in the page's own world because it
// needs the editor's paper and store objects; the toolbar popup reaches it through bridge.js.
(function () {
    'use strict';

    var LS_KEY = 'adox-kostum-v1';
    var ART_CENTER = {x: 480, y: 360};

    // ---------------------------------------------------------------- helpers
    function clamp (v, a, b) {
        return Math.min(b, Math.max(a, v));
    }
    function fiberOf (el) {
        var key = Object.keys(el).find(function (k) {
            return k.indexOf('__reactInternalInstance$') === 0 || k.indexOf('__reactFiber$') === 0;
        });
        return key ? el[key] : null;
    }
    function paintCanvas () {
        return document.querySelector('canvas[class*="paper-canvas"]');
    }

    // TurboWarp publishes window.paper and window.ReduxStore. scratch.mit.edu runs the same
    // paint code but keeps both private, so they are read back out of the page's own bundle
    // (webpack) and React tree rather than reimplemented here.
    var paperRef = null;
    var storeRef = null;

    function isPaperScope (candidate) {
        if (!candidate || typeof candidate.setup !== 'function') return false;
        var project = candidate.project;
        return !!(project && project.view && project.layers && project.layers.length);
    }
    function findPaperInBundle () {
        var chunks = [window.webpackChunkGUI, window.webpackJsonpGUI];
        for (var c = 0; c < chunks.length; c++) {
            var chunk = chunks[c];
            if (!chunk || typeof chunk.push !== 'function') continue;
            var req = null;
            try {
                chunk.push([[Date.now()], {}, function (r) { req = r; }]);
            } catch (e) { continue; }
            if (!req || !req.m) continue;
            for (var id in req.m) {
                if (!Object.prototype.hasOwnProperty.call(req.m, id)) continue;
                var src = '';
                try { src = String(req.m[id]); } catch (e) { continue; }
                if (src.indexOf('PaperScope') < 0) continue;
                try {
                    var mod = req(id);
                    if (isPaperScope(mod)) return mod;
                } catch (e) { /* a module that only mentions PaperScope */ }
            }
        }
        return null;
    }
    function paper () {
        if (isPaperScope(paperRef)) return paperRef;
        var candidate = (window.paper && window.paper.project) ? window.paper : findPaperInBundle();
        paperRef = isPaperScope(candidate) ? candidate : null;
        return paperRef;
    }

    function findStoreInTree () {
        var canvas = paintCanvas();
        var fiber = canvas ? fiberOf(canvas) : null;
        for (var i = 0; i < 60 && fiber; i++) {
            var props = fiber.memoizedProps;
            if (props && props.value && props.value.store && typeof props.value.store.getState === 'function') {
                return props.value.store;
            }
            fiber = fiber.return;
        }
        return null;
    }
    function store () {
        if (storeRef && typeof storeRef.getState === 'function') return storeRef;
        var candidate = window.ReduxStore && typeof window.ReduxStore.getState === 'function'
            ? window.ReduxStore : findStoreInTree();
        storeRef = candidate || null;
        return storeRef;
    }
    function paintState () {
        var s = store();
        if (!s) return null;
        var state = s.getState();
        return state && state.scratchPaint ? state.scratchPaint : null;
    }
    function dispatch (action) {
        var s = store();
        if (s) s.dispatch(action);
    }
    function isBitmapFormat () {
        var p = paintState();
        return !!p && /^BITMAP/.test(p.format || '');
    }
    function isEraserMode () {
        var p = paintState();
        return !!p && /ERASER/.test(p.mode || '');
    }
    function load (fallback) {
        try {
            var raw = window.localStorage.getItem(LS_KEY);
            return raw ? Object.assign({}, fallback, JSON.parse(raw)) : fallback;
        } catch (e) {
            return fallback;
        }
    }
    function save (data) {
        try {
            window.localStorage.setItem(LS_KEY, JSON.stringify(data));
        } catch (e) { /* private mode: nothing to persist */ }
    }

    // The editor's own "copy the canvas into this costume" callback, found through React internals.
    function findUpdateImage () {
        var canvas = paintCanvas();
        var fiber = canvas ? fiberOf(canvas) : null;
        for (var i = 0; i < 45 && fiber; i++) {
            var props = fiber.stateNode && fiber.stateNode.props ? fiber.stateNode.props : fiber.memoizedProps;
            if (props && typeof props.onUpdateImage === 'function') return props.onUpdateImage;
            fiber = fiber.return;
        }
        return null;
    }

    function commit () {
        var fn = findUpdateImage();
        if (!fn) return false;
        fn(false);
        return true;
    }

    function findLayer (flag) {
        var p = paper();
        if (!p) return null;
        var layers = p.project.layers;
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].data && layers[i].data[flag]) return layers[i];
        }
        return null;
    }
    function paintingLayer () {
        return findLayer('isPaintingLayer');
    }
    function rasterItem () {
        var layer = findLayer('isRasterLayer');
        return layer && layer.children.length ? layer.children[0] : null;
    }
    // Guide layer items are hidden while the editor exports, so previews can never leak into the costume.
    function guideLayer () {
        var p = paper();
        if (!p) return null;
        var layer = findLayer('isGuideLayer');
        if (!layer) {
            layer = new p.Layer();
            layer.data = {isGuideLayer: true};
            var art = paintingLayer();
            if (art) art.activate();
        }
        return layer;
    }

    // The editor writes the same colour in several shapes ("#9966FF", "rgb(153, 102, 255)"), and for
    // "no colour" it writes null, "none" or its own mixed marker. paper reads every one of those as
    // black, so only a hex or a colour function is accepted here.
    var CSS_COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(|hsla?\(|hwb\()/i;
    function colorOf (style) {
        var p = paper();
        var v = style && style.primary;
        if (!p || typeof v !== 'string') return null;
        v = v.trim();
        if (!CSS_COLOR.test(v)) return null;
        try {
            return new p.Color(v);
        } catch (e) {
            return null;
        }
    }
    // A multi colour selection turns the store's fill into "no colour", but the editor keeps
    // painting with the colour it last had, so we remember it and do the same.
    var lastPaint = {fill: null, stroke: null};
    function pickColor (style, key) {
        var color = colorOf(style);
        if (color) {
            lastPaint[key] = style.primary;
            return color;
        }
        return lastPaint[key] ? colorOf({primary: lastPaint[key]}) : null;
    }
    function currentColors () {
        var ps = paintState();
        var color = ps && ps.color ? ps.color : {};
        return {
            fill: pickColor(color.fillColor, 'fill'),
            stroke: pickColor(color.strokeColor, 'stroke'),
            strokeWidth: color.strokeWidth || 0
        };
    }
    function applyStyle (path, useStroke) {
        var colors = currentColors();
        var mine = adoxPaint('fill', path.bounds, 0);
        var stroke = useStroke && colors.stroke;
        path.fillColor = mine === null ? colors.fill : mine;
        path.strokeColor = stroke ? colors.stroke : null;
        path.strokeWidth = stroke ? Math.max(colors.strokeWidth, 1) : 0;
        path.strokeCap = 'round';
        path.strokeJoin = 'round';
    }

    // A shape must carry the editor's gradient, not only its first colour: scratch-paint writes a real
    // <linearGradient>/<radialGradient> into the exported SVG, so a flat fill here would give us away.
    // Ported from scratch-paint/helper/style-path.js (GPL-3.0).
    function usable (v) {
        return typeof v === 'string' && CSS_COLOR.test(v.trim());
    }
    function transparentLike (p, css) {
        var c = new p.Color(css);
        c.alpha = 0;
        return c.toCSS();
    }
    function gradientColor (p, stops, type, bounds, minSize) {
        // paper 0.12.7 reads a stop as [colour, offset]; the reverse order leaves the offset
        // undefined and the canvas throws "the provided double value is non-finite"
        var list = stops.map(function (s, i) {
            var c = s[1];
            if (c === null) {
                // a transparent stop still has to carry the other stop's RGB or the blend goes through black
                var other = stops[i === 0 ? stops.length - 1 : 0][1] || stops[0][1];
                c = transparentLike(p, other);
            }
            return [c, s[0]];
        });
        var size = Math.max(minSize || 0, 1e-2);
        var start, end;
        if (type === 'RADIAL') {
            start = bounds.center;
            end = start.add(new p.Point(Math.max(Math.max(bounds.width, bounds.height) / 2, size / 2), 0));
        } else {
            start = (type === 'VERTICAL' ? bounds.topCenter : bounds.leftCenter).clone();
            end = (type === 'VERTICAL' ? bounds.bottomCenter : bounds.rightCenter).clone();
            var span = type === 'VERTICAL' ? Math.abs(end.y - start.y) : Math.abs(end.x - start.x);
            if (span < size) {
                var diff = (size - span) / 2;
                if (type === 'VERTICAL') { end.y += diff; start.y -= diff; }
                else { end.x += diff; start.x -= diff; }
            }
        }
        return {
            gradient: {stops: list, radial: type === 'RADIAL'},
            origin: start,
            destination: end
        };
    }
    // Adox keeps what the editor's picker has no room for: a third and fourth colour, and stops
    // that sit somewhere other than 0% and 100%. Everything else stays the editor's own, the type
    // and the two end colours are read from its state, so its sliders and hex field are the one
    // place a colour is ever typed.
    function nativeStyle (key) {
        var color = (paintState() || {}).color || {};
        return color[key === 'stroke' ? 'strokeColor' : 'fillColor'] || {};
    }
    function gradType (key) {
        var type = nativeStyle(key).gradientType;
        return type === 'RADIAL' || type === 'HORIZONTAL' || type === 'VERTICAL' ? type : null;
    }
    // reading order: the picker's primary at the start, Adox's extras in the middle, the picker's
    // secondary at the end, and a missing secondary is the primary again, as scratch-paint does
    function gradStops (key) {
        var g = settings.grad;
        var style = nativeStyle(key);
        var a = usable(style.primary) ? style.primary : (lastPaint[key] || null);
        if (!a) return null;
        var b = usable(style.secondary) ? style.secondary : a;
        var out = [{p: g.offsets[0], c: a}];
        for (var i = 1; i < g.count - 1; i++) out.push({p: g.offsets[i], c: g.extras[i - 1]});
        out.push({p: g.offsets[g.count - 1], c: b});
        return out;
    }
    function adoxGradient (key) {
        if (!paper() || !gradType(key)) return null;
        var stops = gradStops(key);
        if (!stops) return null;
        return stops.map(function (s) { return [s.p, usable(s.c) ? s.c : null]; });
    }
    function adoxPaint (key, bounds, minSize, type) {
        var p = paper();
        var stops = adoxGradient(key);
        if (!p || !stops) return null;
        return gradientColor(p, stops, type || gradType(key), bounds, minSize);
    }
    function styleShapePath (path) {
        var p = paper();
        var color = (paintState() || {}).color || {};
        var width = color.strokeWidth || 0;
        [['fill', 'fillColor'], ['stroke', 'strokeColor']].forEach(function (pair) {
            var mine = adoxPaint(pair[0], path.bounds, pair[0] === 'stroke' ? width : 0);
            if (mine !== null) {
                path[pair[1]] = mine;
                return;
            }
            var style = color[pair[1]] || {};
            var type = style.gradientType;
            var one = usable(style.primary) ? style.primary : (lastPaint[pair[0]] || null);
            if (usable(style.primary)) lastPaint[pair[0]] = style.primary;
            var two = usable(style.secondary) ? style.secondary : null;
            if (!one && !two) {
                path[pair[1]] = null;
                return;
            }
            if (type === 'RADIAL' || type === 'HORIZONTAL' || type === 'VERTICAL') {
                // a missing second end is not an error: scratch-paint substitutes the other rgb,
                // and passing null to paper.Color would hand a NaN to the gradient and throw
                path[pair[1]] = gradientColor(p, [[0, one || two], [1, two || one]], type,
                    path.bounds, pair[0] === 'stroke' ? width : 0);
            } else {
                path[pair[1]] = one || two;
            }
        });
        path.strokeWidth = width;
        // no stroke means no outline at all, otherwise the exporter keeps a stroke-width on a fill-only path
        if (!path.strokeColor) path.strokeWidth = 0;
    }

    // ---------------------------------------------------------------- geometry
    function round (v) {
        return Math.round(v * 1000) / 1000;
    }
    function normalizePoints (points) {
        var xs = points.map(function (p) { return p[0]; });
        var ys = points.map(function (p) { return p[1]; });
        var minX = Math.min.apply(null, xs);
        var minY = Math.min.apply(null, ys);
        var w = Math.max.apply(null, xs) - minX || 1;
        var h = Math.max.apply(null, ys) - minY || 1;
        return points.map(function (p) {
            return [round((p[0] - minX) / w * 100), round((p[1] - minY) / h * 100)];
        });
    }
    function polygonPath (points) {
        return points.map(function (p, i) {
            return (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1];
        }).join(' ') + 'Z';
    }
    function cornerPath (points, radius) {
        if (!radius || radius <= 0) return polygonPath(points);
        var count = points.length;
        var path = '';
        for (var i = 0; i < count; i++) {
            var previous = points[(i + count - 1) % count];
            var point = points[i];
            var next = points[(i + 1) % count];
            var entryLength = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
            var exitLength = Math.hypot(next[0] - point[0], next[1] - point[1]);
            var cut = Math.min(radius, entryLength / 2, exitLength / 2);
            var entry = [point[0] + ((previous[0] - point[0]) / (entryLength || 1)) * cut,
                point[1] + ((previous[1] - point[1]) / (entryLength || 1)) * cut];
            var exit = [point[0] + ((next[0] - point[0]) / (exitLength || 1)) * cut,
                point[1] + ((next[1] - point[1]) / (exitLength || 1)) * cut];
            path += (i === 0 ? 'M' : 'L') + round(entry[0]) + ',' + round(entry[1]) + ' ';
            path += 'Q' + point[0] + ',' + point[1] + ' ' + round(exit[0]) + ',' + round(exit[1]) + ' ';
        }
        return path + 'Z';
    }
    function regularPolygon (sides, startDegrees) {
        var points = [];
        for (var i = 0; i < sides; i++) {
            var angle = ((startDegrees + (i * 360 / sides)) * Math.PI) / 180;
            points.push([50 + (50 * Math.cos(angle)), 50 + (50 * Math.sin(angle))]);
        }
        return normalizePoints(points);
    }
    function rotatePoints (points, degrees) {
        var radians = degrees * Math.PI / 180;
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        return normalizePoints(points.map(function (p) {
            var x = p[0] - 50;
            var y = p[1] - 50;
            return [50 + (x * cos) - (y * sin), 50 + (x * sin) + (y * cos)];
        }));
    }
    function starPoints (tips, inner) {
        var points = [];
        for (var i = 0; i < tips * 2; i++) {
            var radius = i % 2 === 0 ? 50 : inner;
            var angle = ((-90 + (i * 180 / tips)) * Math.PI) / 180;
            points.push([50 + (radius * Math.cos(angle)), 50 + (radius * Math.sin(angle))]);
        }
        return normalizePoints(points);
    }
    function crescentPoints () {
        var points = [];
        var i;
        for (i = 0; i <= 24; i++) {
            var a = (-90 + (i * 180 / 24)) * Math.PI / 180;
            points.push([50 + (50 * Math.cos(a)), 50 + (50 * Math.sin(a))]);
        }
        for (i = 24; i >= 0; i--) {
            var b = (-90 + (i * 180 / 24)) * Math.PI / 180;
            points.push([50 + (50 * Math.cos(b)) + 26 * Math.sin(b), 50 + (50 * Math.sin(b))]);
        }
        return normalizePoints(points);
    }

    var PLUS = [
        [35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65],
        [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]
    ];

    var SHAPES = [
        {id: 'triangle', label: 'Üçgen', en: 'Triangle', points: [[50, 0], [100, 100], [0, 100]]},
        {id: 'right-triangle', label: 'Dik üçgen', en: 'Right triangle', points: [[0, 0], [100, 100], [0, 100]]},
        {id: 'rhombus', label: 'Eşkenar dörtgen', en: 'Rhombus', points: [[50, 0], [100, 50], [50, 100], [0, 50]]},
        {id: 'parallelogram', label: 'Paralelkenar', en: 'Parallelogram', points: [[22, 0], [100, 0], [78, 100], [0, 100]]},
        {id: 'trapezoid', label: 'Yamuk', en: 'Trapezoid', points: [[24, 0], [76, 0], [100, 100], [0, 100]]},
        {id: 'pentagon', label: 'Beşgen', en: 'Pentagon', points: regularPolygon(5, -90)},
        {id: 'hexagon', label: 'Altıgen', en: 'Hexagon', points: regularPolygon(6, -90)},
        {id: 'heptagon', label: 'Yedigen', en: 'Heptagon', points: regularPolygon(7, -90)},
        {id: 'octagon', label: 'Sekizgen', en: 'Octagon', points: regularPolygon(8, -67.5)},
        {id: 'star5', label: 'Yıldız', en: 'Star', points: starPoints(5, 20)},
        {id: 'star6', label: 'Altı köşeli yıldız', en: 'Six-pointed star', points: starPoints(6, 28)},
        {id: 'soft-triangle', label: 'Yumuşak üçgen', en: 'Rounded triangle', points: [[50, 0], [100, 100], [0, 100]], minRound: 14},
        {id: 'soft-pentagon', label: 'Yumuşak beşgen', en: 'Rounded pentagon', points: regularPolygon(5, -90), minRound: 12},
        {id: 'soft-hexagon', label: 'Yumuşak altıgen', en: 'Rounded hexagon', points: regularPolygon(6, -90), minRound: 12},
        {id: 'soft-square', label: 'Yumuşak kare', en: 'Rounded square', points: [[0, 0], [100, 0], [100, 100], [0, 100]], minRound: 22},
        {id: 'half-circle', label: 'Yarım daire', en: 'Half circle',
            path: 'M0,100 L0,50 A50,50 0 0 1 100,50 L100,100 Z'},
        {id: 'quarter-circle', label: 'Çeyrek daire', en: 'Quarter circle',
            path: 'M0,100 L0,0 A100,100 0 0 1 100,100 Z'},
        {id: 'ring', label: 'Halka', en: 'Ring', fillRule: 'evenodd',
            path: 'M50,0 A50,50 0 1 0 50,100 A50,50 0 1 0 50,0 Z M50,30 A20,20 0 1 1 50,70 A20,20 0 1 1 50,30 Z'},
        {id: 'drop', label: 'Damla', en: 'Drop',
            path: 'M50,2 C62,20 86,38 86,62 C86,82 70,98 50,98 C30,98 14,82 14,62 C14,38 38,20 50,2 Z'},
        {id: 'crescent', label: 'Hilal', en: 'Crescent', points: crescentPoints()},
        {id: 'arrow-up', label: 'Yukarı ok', en: 'Arrow up',
            points: [[50, 0], [100, 50], [65, 50], [65, 100], [35, 100], [35, 50], [0, 50]]},
        {id: 'arrow-down', label: 'Aşağı ok', en: 'Arrow down',
            points: [[50, 100], [100, 50], [65, 50], [65, 0], [35, 0], [35, 50], [0, 50]]},
        {id: 'arrow-right', label: 'Sağ ok', en: 'Arrow right',
            points: [[0, 35], [50, 35], [50, 0], [100, 50], [50, 100], [50, 65], [0, 65]]},
        {id: 'arrow-left', label: 'Sol ok', en: 'Arrow left',
            points: [[100, 35], [50, 35], [50, 0], [0, 50], [50, 100], [50, 65], [100, 65]]},
        {id: 'arrow-double', label: 'Çift ok', en: 'Double arrow',
            points: [[0, 50], [25, 20], [25, 35], [75, 35], [75, 20], [100, 50], [75, 80], [75, 65], [25, 65], [25, 80]]},
        {id: 'heart', label: 'Kalp', en: 'Heart',
            path: 'M50,90 C20,66 2,48 2,29 C2,13 14,2 28,2 C38,2 46,8 50,17 ' +
                'C54,8 62,2 72,2 C86,2 98,13 98,29 C98,48 80,66 50,90 Z'},
        {id: 'cloud', label: 'Bulut', en: 'Cloud',
            path: 'M26,80 C11,80 2,69 2,55 C2,42 11,32 23,30 C27,15 41,4 57,4 ' +
                'C74,4 88,16 91,32 C97,36 100,43 100,51 C100,67 89,80 73,80 Z'},
        {id: 'bolt', label: 'Şimşek', en: 'Bolt',
            points: [[58, 0], [16, 56], [43, 56], [34, 100], [86, 40], [57, 40], [78, 0]]},
        {id: 'bubble', label: 'Konuşma balonu', en: 'Speech bubble', minRound: 6,
            points: [[12, 4], [88, 4], [96, 12], [96, 62], [88, 70], [42, 70], [26, 88], [28, 70], [12, 70], [4, 62], [4, 12]]},
        {id: 'plus', label: 'Artı', en: 'Plus', points: PLUS},
        {id: 'cross', label: 'Çarpı', en: 'Cross', points: rotatePoints(PLUS, 45)}
    ];
    SHAPES.forEach(function (shape) {
        shape.d = shape.points ? cornerPath(shape.points, shape.minRound || 0) : shape.path;
    });

    // -------------------------------------------------------------------- nibs
    // the size is printed as a number, so the nib box reads the same in every language
    var NIBS = [
        {label: 'Kıl uç', en: 'Fine tip', size: 1}, {label: 'İnce uç', en: 'Thin tip', size: 2},
        {label: 'Ucu ince kalem', en: 'Pencil tip', size: 3}, {label: 'Tükenmez', en: 'Ballpoint', size: 5},
        {label: 'Keçe ucu', en: 'Felt tip', size: 8}, {label: 'Boya kalemi', en: 'Crayon', size: 12},
        {label: 'Kalın kalem', en: 'Thick pen', size: 18}, {label: 'Fırça', en: 'Brush', size: 26},
        {label: 'Kalın fırça', en: 'Thick brush', size: 40}, {label: 'Boya rulosu', en: 'Roller', size: 60},
        {label: 'Devasa', en: 'Huge', size: 100}
    ];

    var PENS = [
        {id: 'kalem', label: 'Kalem', en: 'Pen', min: 0.72, exponent: 0.35, taper: 0.3, smoothing: 0.3},
        {id: 'tukenmez', label: 'Tükenmez', en: 'Ballpoint', min: 0.92, exponent: 0.15, taper: 0.1, smoothing: 0.25},
        {id: 'firca', label: 'Fırça', en: 'Brush', min: 0.15, exponent: 1.4, taper: 0.45, smoothing: 0.5},
        {id: 'marker', label: 'Kalın marker', en: 'Marker', min: 0.95, exponent: 0.1, taper: 0.05, smoothing: 0.2},
        {id: 'kaligrafi', label: 'Kaligrafi', en: 'Calligraphy', min: 0.3, exponent: 0.8, taper: 0.25, smoothing: 0.35, chisel: true},
        {id: 'murekkep', label: 'Mürekkep', en: 'Ink', min: 0.05, exponent: 2.1, taper: 0.7, smoothing: 0.45}
    ];

    // a nib preview drawn from the profile's own maths: the user sees the taper before drawing
    function nibSwatch (profile) {
        var pts = [];
        var i;
        for (i = 0; i <= 16; i++) {
            var u = i / 16;
            pts.push({x: 3 + u * 38, y: 10 - Math.sin(u * Math.PI) * 4.5, p: 0.25 + 0.6 * Math.sin(Math.PI * u)});
        }
        var left = [];
        var right = [];
        for (i = 0; i < pts.length; i++) {
            var prev = pts[Math.max(0, i - 1)];
            var next = pts[Math.min(pts.length - 1, i + 1)];
            var angle = Math.atan2(next.y - prev.y, next.x - prev.x);
            var width = 6 * (profile.min + (1 - profile.min) * Math.pow(clamp(pts[i].p, 0.05, 1), profile.exponent));
            if (profile.chisel) width *= 0.3 + 0.7 * Math.abs(Math.sin(angle - Math.PI / 5));
            width = Math.max(0.4, width * (1 - profile.taper * 0.6 * Math.sin(Math.PI * (i / (pts.length - 1)))));
            var nx = -Math.sin(angle) * width / 2;
            var ny = Math.cos(angle) * width / 2;
            left.push(round(pts[i].x + nx) + ',' + round(pts[i].y + ny));
            right.unshift(round(pts[i].x - nx) + ',' + round(pts[i].y - ny));
        }
        return '<svg viewBox="0 0 44 20"><path d="M' + left.concat(right).join('L') + 'Z" fill="currentColor"/></svg>';
    }

    var settings = load({
        nib: 10, eraser: 40, bitNib: 10, bitEraser: 40,
        shapeSize: 160, shapeRound: 0, pen: 'kalem', penSize: 22, penPressure: true, pngScale: 1,
        grad: {count: 2, offsets: [0, 1], extras: []}
    });

    // The toolbar popup owns these switches; they live in chrome.storage, which the MAIN world
    // cannot read, so the isolated bridge hands them over as a message. Anything unknown stays on.
    var FEATURES = {shapes: true, pen: true, fx: true, rail: true, gradient: true, anchor: true,
        pixel: true, board: true, speed: true};
    function feat (key) { return FEATURES[key] !== false; }
    // localStorage is a boundary. The panel this replaced stored {on, target, type, stops}; the
    // picker supplies the colours now, so only the count, the offsets and the extra colours carry
    // over, and anything malformed is rebuilt rather than reaching .offsets at draw time.
    (function migrateGrad () {
        var old = settings.grad;
        var count = Math.min(4, Math.max(2, Number(old && old.count) || 2));
        var from = old && Array.isArray(old.stops) && old.stops.length === count
            ? old.stops.map(function (s) { return s.p; }) : null;
        var offsets = old && Array.isArray(old.offsets) && old.offsets.length === count ? old.offsets : from;
        var extras = old && Array.isArray(old.extras) ? old.extras
            : old && Array.isArray(old.stops) ? old.stops.slice(1, -1).map(function (s) { return s.c; }) : [];
        settings.grad = {count: count, offsets: [], extras: []};
        for (var i = 0; i < count; i++) {
            var v = Number(offsets && offsets[i]);
            settings.grad.offsets.push(isFinite(v) ? clamp(v, 0, 1) : i / (count - 1));
        }
        for (i = 0; i < count - 2; i++) {
            var c = extras[i];
            settings.grad.extras.push(usable(c) ? c : '#8899aa');
        }
    })();
    function saveSettings () {
        save(settings);
    }

    // ------------------------------------------------------------------- sizes
    function nibAction (size) {
        var bitmap = isBitmapFormat();
        var eraser = isEraserMode();
        if (bitmap) {
            return eraser
                ? {type: 'scratch-paint/eraser-mode/CHANGE_BIT_ERASER_SIZE', brushSize: size}
                : {type: 'scratch-paint/brush-mode/CHANGE_BIT_BRUSH_SIZE', brushSize: size};
        }
        return eraser
            ? {type: 'scratch-paint/eraser-mode/CHANGE_ERASER_SIZE', brushSize: size}
            : {type: 'scratch-paint/brush-mode/CHANGE_BRUSH_SIZE', brushSize: size};
    }
    function currentNibSize () {
        var ps = paintState();
        if (!ps) return settings.nib;
        if (isBitmapFormat()) return isEraserMode() ? ps.bitEraserSize : ps.bitBrushSize;
        return isEraserMode() ? (ps.eraserMode || {}).brushSize : (ps.brushMode || {}).brushSize;
    }
    function applyNib (size) {
        size = clamp(Math.round(size), 1, 100);
        if (isBitmapFormat()) {
            if (isEraserMode()) settings.bitEraser = size; else settings.bitNib = size;
        } else if (isEraserMode()) settings.eraser = size; else settings.nib = size;
        dispatch(nibAction(size));
        saveSettings();
        refreshNibUi();
    }
    function stepNib (delta) {
        var size = currentNibSize();
        applyNib(size + delta * Math.max(1, Math.round(size * 0.18)));
    }

    // ------------------------------------------------------------- localization
    // The editor resolved the reader's language already, so it is read from the same store
    // instead of guessing from the browser. Only the handful of words we invented are
    // translated here; everything else in the UI is an icon, a number or a key cap.
    var STRINGS = {
        en: {shapes: 'Shapes', pen: 'ScratchDream pen', gradient: 'Gradient', size: 'Size', round: 'Corner rounding', pressure: 'Pen pressure', off: 'Off', close: 'Close', apply: 'Apply', use: 'Use',
            gSolid: 'Solid', gHoriz: 'Horizontal', gVert: 'Vertical', gRadial: 'Radial', stops: 'Stops',
            fx: 'Advanced', mask: 'Mask', maskOff: 'Release', blend: 'Blend', joint: 'Corner spike', png: 'PNG', pngScale: 'Scale', nothing: 'Select a shape first', maskAlone: 'Needs a shape under it', empty: 'Nothing drawn yet', vectorOnly: 'Vector costumes only',
            objects: 'Layers', pin: 'Keep open', name: 'Name', duplicate: 'Duplicate', align: 'Align', opacity: 'Opacity',
            order: 'Order', bringToFront: 'Bring to front', bringForward: 'Forward', sendBackward: 'Backward', sendToBack: 'Send to back',
            show: 'Show', hide: 'Hide', lock: 'Lock', unlock: 'Unlock',
            alignLeft: 'Left', alignCenterH: 'Centre', alignRight: 'Right',
            alignTop: 'Top', alignCenterV: 'Middle', alignBottom: 'Bottom', alignCenter: 'Centre on canvas',
            rotateLeft: 'Rotate -90', rotateRight: 'Rotate +90',
            path: 'Path', group: 'Group', text: 'Text', compound: 'Shape', raster: 'Image',
            anchor: 'Anchor', anchorTitle: 'Animation anchor', jump: 'Jump per frame',
            anchorSub: 'Where the drawing lands on the stage when the costume changes',
            anchorBody: 'Shared body point', anchorOwn: 'Own centre', anchorFirst: 'Match first',
            anchorApply: 'Fix the pivots', anchorUndo: 'Undo', anchorBusy: 'Measuring the costumes…',
            anchorNone: 'Needs two or more costumes', anchorDone: 'pivots written', anchorSkipped: 'empty costume',
            pixel: 'Vector bitmapping', pixelArt: 'Vector bitmapping', pixelOpen: 'Vector bitmapping',
            pixelSub: 'Pixels stay sharp — no blur',
            pixelHint: 'One pixel is one costume unit',
            brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser', fill: 'Fill', line: 'Line', rect: 'Rectangle',
            ellipse: 'Ellipse', picker: 'Pick colour', move: 'Move art', color: 'Colour',
            filled: 'Filled shapes', gridOn: 'Pixel grid', autoFix: 'Fix soft edges',
            autoFixed: 'edge pixels cleaned', applyVector: 'Apply as vector', cancel: 'Cancel',
            undo: 'Undo', redo: 'Redo', fit: 'Fit', zoom: 'Zoom',
            pixelEmpty: 'Nothing drawn yet', pixelNoTarget: 'Open a costume first',
            converting: 'Converting to vector…', pxApplied: 'Vector bitmapping applied',
            pxFail: 'Could not write the costume',
            bitmapSnapped: 'Bitmap snapped at {ratio} — no blur',
            pxHeavy: 'Too much detail for one costume — undo a few pixels or use a smaller canvas',
            pixelHelp: 'B paints · E erases · G fills · arrows nudge · Ctrl+Z undoes · vector squares never blur',
            board: 'Plan', boardTitle: 'Plan board', boardSub: 'Saved in this browser',
            cardTitle: 'Card title', cardNote: 'Note', colName: 'Column name',
            addCard: 'Add card', addCol: 'Add column', newCol: 'New column',
            todo: 'To do', doing: 'Doing', done: 'Done',
            exportB: 'Export', importB: 'Import', delCard: 'Delete card', delCol: 'Delete column',
            boardBad: 'That file is not a plan board', boardExported: 'board downloaded',
            boardFail: 'the download was refused', boardImported: 'board loaded',
            px: 'px'},
        tr: {shapes: 'Şekiller', pen: 'ScratchDream kalemi', gradient: 'Gradyan', size: 'Boyut', round: 'Köşe yumuşatma', pressure: 'Kalem basıncı', off: 'Devre dışı', close: 'Kapat', apply: 'Uygula', use: 'Kullan',
            gSolid: 'Düz', gHoriz: 'Yatay', gVert: 'Dikey', gRadial: 'Radyal', stops: 'Durak',
            fx: 'Gelişmiş', mask: 'Maske', maskOff: 'Bırak', blend: 'Karışım', joint: 'Sivri köşe', png: 'PNG', pngScale: 'Çözünürlük', nothing: 'Önce bir şekil seç', maskAlone: 'Maske için altında bir şekil olmalı', empty: 'Önce bir çizim yap', vectorOnly: 'Yalnız vektör kostümde olur',
            objects: 'Katmanlar', pin: 'Açık tut', name: 'Ad', duplicate: 'Çoğalt', align: 'Hizala', opacity: 'Saydamlık',
            order: 'Sıra', bringToFront: 'En öne getir', bringForward: 'Öne getir', sendBackward: 'Arkaya gönder', sendToBack: 'En arkaya gönder',
            show: 'Göster', hide: 'Gizle', lock: 'Kilitle', unlock: 'Kilidi aç',
            alignLeft: 'Sol', alignCenterH: 'Orta', alignRight: 'Sağ',
            alignTop: 'Üst', alignCenterV: 'Orta', alignBottom: 'Alt', alignCenter: 'Tuvalin ortasına',
            rotateLeft: '-90° döndür', rotateRight: '+90° döndür',
            path: 'Yol', group: 'Grup', text: 'Yazı', compound: 'Şekil', raster: 'Resim',
            anchor: 'Eksen', anchorTitle: 'Animasyon ekseni', jump: 'Kare başına sıçrama',
            anchorSub: 'Kostüm değişince çizimin sahnede oturduğu yer',
            anchorBody: 'Ortak gövde noktası', anchorOwn: 'Kendi merkezi', anchorFirst: 'İlkine göre',
            anchorApply: 'Eksenleri düzelt', anchorUndo: 'Geri al', anchorBusy: 'Kostümler ölçülüyor…',
            anchorNone: 'İki ya da daha fazla kostüm gerekir', anchorDone: 'eksen yazıldı', anchorSkipped: 'boş kostüm',
            pixel: 'Vektör pikselleme', pixelArt: 'Vektör pikselleme', pixelOpen: 'Vektör pikselleme',
            pixelSub: 'Pikseller keskin kalır — bulanıklık yok',
            pixelHint: 'Bir piksel bir kostüm birimi',
            brush: 'Fırça', pencil: 'Kalem', eraser: 'Silgi', fill: 'Doldur', line: 'Çizgi', rect: 'Dikdörtgen',
            ellipse: 'Elips', picker: 'Renk al', move: 'Çizimi taşı', color: 'Renk',
            filled: 'Şekiller dolu', gridOn: 'Piksel ızgarası', autoFix: 'Yumuşak kenarları düzelt',
            autoFixed: 'kenar pikseli temizlendi', applyVector: 'Vektör olarak uygula', cancel: 'Vazgeç',
            undo: 'Geri al', redo: 'İleri al', fit: 'Sığdır', zoom: 'Yakınlaştır',
            pixelEmpty: 'Henüz bir çizim yok', pixelNoTarget: 'Önce bir kostüm aç',
            converting: 'Vektöre çevriliyor…', pxApplied: 'Vektör pikselleme uygulandı',
            pxFail: 'Kostüm yazılamadı',
            bitmapSnapped: 'Bitmap {ratio} oranında keskinleştirildi — bulanıklık yok',
            pxHeavy: 'Bu kostüm için çok fazla ayrıntı — birkaç pikseli geri al ya da daha küçük tuvale çiz',
            pixelHelp: 'B boyar · E siler · G doldurur · oklar kaydırır · Ctrl+Z geri alır · vektör kareler asla bulanmaz',
            board: 'Plan', boardTitle: 'Plan tahtası', boardSub: 'Bu tarayıcıda saklanır',
            cardTitle: 'Kart başlığı', cardNote: 'Not', colName: 'Sütun adı',
            addCard: 'Kart ekle', addCol: 'Sütun ekle', newCol: 'Yeni sütun',
            todo: 'Yapılacak', doing: 'Yapılıyor', done: 'Bitti',
            exportB: 'Dışa aktar', importB: 'İçe aktar', delCard: 'Kartı sil', delCol: 'Sütunu sil',
            boardBad: 'Bu dosya bir plan tahtası değil', boardExported: 'tahta indirildi',
            boardFail: 'indirme reddedildi', boardImported: 'tahta yüklendi',
            px: 'px'}
    };
    var lang = 'en';
    var isRtl = false;

    // Only two dictionaries are written out, so this is a yes/no, not a fallback ladder.
    // Anything that is not Turkish reads the English names; the layout direction below still
    // comes from the editor's own locale, so an Arabic page gets our English words RTL.
    function normalizeLang (code) {
        var c = String(code || '').toLowerCase().replace(/_/g, '-');
        return c === 'tr' || c.indexOf('tr-') === 0 ? 'tr' : 'en';
    }
    function t (key) {
        var dict = STRINGS[lang] || STRINGS.en;
        return dict[key] || STRINGS.en[key] || key;
    }
    // our own names for a shape: Turkish and English are written, the rest read English
    function nameOf (item) {
        return lang === 'tr' ? item.label : item.en;
    }
    function readLocale () {
        var s = store();
        var loc = s ? (s.getState().locales || {}) : {};
        lang = normalizeLang(loc.locale || document.documentElement.lang || navigator.language);
        isRtl = !!loc.isRtl;
    }

    // --------------------------------------------------------------------- theme
    function parseColor (input) {
        var s = String(input || '').trim();
        if (!s) return null;
        var hex = s.match(/^#([0-9a-f]{3,8})$/i);
        if (hex) {
            var h = hex[1];
            if (h.length === 3 || h.length === 4) {
                h = h.split('').map(function (c) { return c + c; }).join('');
            }
            if (h.length < 6) return null;
            return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
                a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1};
        }
        var rgb = s.match(/rgba?\(([^)]+)\)/i);
        if (rgb) {
            var parts = rgb[1].split(/[\s,/]+/).map(Number);
            return {r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1};
        }
        return null;
    }
    function rgba (c, a) {
        return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
    }
    function brightness (c) {
        return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    }
    function cssVar (cs, name) {
        var v = cs.getPropertyValue(name);
        return v ? v.trim() : '';
    }
    // the page background is often transparent, so the first painted ancestor decides
    function paintedColor (node, property) {
        for (var hops = 0; hops < 8 && node; hops++) {
            var value = window.getComputedStyle(node)[property];
            var parsed = parseColor(value);
            if (parsed && parsed.a > 0.05) return value;
            node = node.parentElement;
        }
        return null;
    }
    var hashedClassCache = {};
    // CSS module class names are build-hashed, so they are read out of the page instead of hardcoded
    function nativeClass (fragment) {
        if (hashedClassCache[fragment]) return hashedClassCache[fragment];
        var host = document.querySelector('[class*="' + fragment + '"]');
        if (host) {
            var live = Array.prototype.filter.call(host.classList, function (c) {
                return c.indexOf(fragment) >= 0;
            })[0];
            if (live) {
                hashedClassCache[fragment] = live;
                return live;
            }
        }
        for (var i = 0; i < document.styleSheets.length; i++) {
            var rules;
            try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
            for (var r = 0; r < rules.length; r++) {
                var text = rules[r].cssText || '';
                if (text.indexOf(fragment) < 0) continue;
                var token = text.match(new RegExp('[a-zA-Z0-9_-]*' + fragment + '[a-zA-Z0-9_-]*'));
                if (token) {
                    hashedClassCache[fragment] = token[0];
                    return token[0];
                }
            }
        }
        return null;
    }

    function readTheme () {
        var host = document.querySelector('[class*="paint-editor_mode-selector"]') || document.body;
        var cs = window.getComputedStyle(host);
        var selected = document.querySelector('[class*="tool-select-base_is-selected"]');
        var field = document.querySelector('input[class*="input_input"]');
        var fieldCs = field ? window.getComputedStyle(field) : null;

        var raw = {
            surface: cssVar(cs, '--paint-popover-background') || paintedColor(host, 'backgroundColor'),
            accent: (selected ? window.getComputedStyle(selected).backgroundColor : '') ||
                cssVar(cs, '--paint-looks-secondary'),
            text: cssVar(cs, '--paint-text-primary') || paintedColor(host, 'color'),
            field: cssVar(cs, '--paint-input-background') || (fieldCs ? fieldCs.backgroundColor : ''),
            border: cssVar(cs, '--paint-form-border') || (fieldCs ? fieldCs.borderColor : ''),
            tint: cssVar(cs, '--paint-looks-transparent')
        };
        var surface = parseColor(raw.surface) || {r: 255, g: 255, b: 255, a: 1};
        var accent = parseColor(raw.accent) || {r: 133, g: 92, b: 214, a: 1};
        var dark = brightness(surface) < 0.55;
        var text = parseColor(raw.text) || (dark ? {r: 238, g: 238, b: 238, a: 1} : {r: 87, g: 94, b: 117, a: 1});
        return {
            dark: dark,
            surface: raw.surface || (dark ? '#1e1e1e' : '#ffffff'),
            accent: raw.accent || rgba(accent, 1),
            text: raw.text || (dark ? '#eeeeee' : '#575e75'),
            field: raw.field || (dark ? rgba(accent, 0.12) : rgba(accent, 0.08)),
            border: raw.border || (dark ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.12)'),
            hover: rgba(accent, dark ? 0.16 : 0.1),
            active: raw.tint && parseColor(raw.tint) ? raw.tint : rgba(accent, 0.35),
            shadow: dark ? '0 8px 24px rgba(0,0,0,.5)' : '0 8px 24px rgba(148,162,188,.35)'
        };
    }
    function applyTheme (panel, theme) {
        var set = function (name, value) {
            panel.style.setProperty('--adox-' + name, value);
        };
        panel._adoxAccent = theme.accent;
        set('surface', theme.surface);
        set('accent', theme.accent);
        set('text', theme.text);
        set('field', theme.field);
        set('field-border', theme.border);
        set('hover', theme.hover);
        set('active', theme.active);
        set('shadow', theme.shadow);
        set('origin', panel._adoxFlipped ? 'right center' : 'left center');
        panel.style.colorScheme = theme.dark ? 'dark' : 'light';
    }

    // ------------------------------------------------------------------- style
    var CSS = [
        // tool buttons live inside the editor's own tool row and inherit its box, radius, icon filter
        // and press tint; only the icon geometry is ours
        '.adox-tool img.adox-icon{width:2rem;height:2rem;display:block;flex-grow:1;vertical-align:middle}',
        '.adox-tool.adox-armed{background:var(--adox-hl)!important}',
        '.adox-tool.adox-armed img{filter:brightness(0) invert(1)}',
        '.adox-seg button.adox-pressed{background:var(--adox-accent);color:#fff}',
        '.adox-seg button:disabled{opacity:.4;cursor:default}',
        '.adox-panel{position:fixed;z-index:9999;width:19rem;max-height:74vh;overflow:auto;',
        'border-radius:.25rem;padding:.5rem .55rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;',
        'font-size:.75rem;line-height:1.45;background:var(--adox-surface);color:var(--adox-text);',
        'border:1px solid var(--adox-field-border);box-shadow:var(--adox-shadow);',
        'transform-origin:var(--adox-origin,left center);animation:adox-in .14s ease-out}',
        '@keyframes adox-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}',
        '.adox-panel::-webkit-scrollbar{width:.35rem}',
        '.adox-panel::-webkit-scrollbar-thumb{background:var(--adox-hover);border-radius:.2rem}',
        // the editor's own colour dialog: bold .65rem label, 8px rows, 4px radius, 32px swatches
        '.adox-label{font-size:.65rem;font-weight:700;letter-spacing:0;opacity:.9;margin:.5rem 0 .2rem}',
        '.adox-div{border-top:1px solid var(--adox-field-border);margin:.5rem 0}',
        '.adox-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:.15rem}',
        '.adox-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem;',
        'aspect-ratio:1/1;border-radius:.25rem;cursor:pointer;padding:.2rem;color:inherit;background:transparent;',
        'border:0;font:inherit;transition:.2s}',
        '.adox-cell:hover{background:var(--adox-hover)}',
        '.adox-cell:active{background:var(--adox-active);color:#fff}',
        '.adox-cell:focus-visible{outline:2px solid var(--adox-accent);outline-offset:-2px}',
        '.adox-cell svg{width:100%;height:100%;display:block}',
        '.adox-on{background:var(--adox-accent);color:#fff}',
        '.adox-nibs{display:grid;grid-template-columns:repeat(3,1fr);gap:.15rem}',
        '.adox-pens{grid-template-columns:repeat(3,1fr)}',
        '.adox-blends{grid-template-columns:repeat(4,1fr);gap:.25rem}',
        // the chips are content-sized: a square cell inside a wide panel turns every mini sample
        // into a poster, which is exactly what made this box feel enormous
        '.adox-blends .adox-cell{aspect-ratio:auto;flex-direction:row;justify-content:flex-start;',
        'gap:.3rem;padding:.3rem .4rem;font-size:.58rem;font-weight:700;line-height:1.1;overflow:hidden}',
        '.adox-maskrow{grid-template-columns:repeat(2,1fr);gap:.25rem;margin-top:.3rem}',
        '.adox-maskrow .adox-cell{aspect-ratio:auto;flex-direction:row;justify-content:flex-start;',
        'gap:.35rem;padding:.3rem .4rem;font-size:.64rem;font-weight:700;line-height:1.1}',
        '.adox-blends .adox-cell span,.adox-maskrow .adox-cell span{min-width:0;overflow:hidden;',
        'text-overflow:ellipsis;white-space:nowrap}',
        '.adox-pen{aspect-ratio:2.2/1}',
        '.adox-off{width:100%;aspect-ratio:auto;padding:.35rem;margin-top:.3rem;font-size:.7rem;font-weight:700;',
        'background:var(--adox-field);border:1px solid var(--adox-field-border);border-radius:.25rem;',
        'color:inherit;cursor:pointer;transition:.25s ease-out}',
        '.adox-off:hover{background:var(--adox-hover)}',
        // objects box: a list row is an eye, a lock and the name, the way a layers panel reads
        '.adox-count{float:right;font-weight:400;opacity:.55;font-variant-numeric:tabular-nums}',
        '.adox-objs{display:flex;flex-direction:column;gap:.1rem;max-height:13rem;overflow:auto;',
        'margin:.15rem 0 .35rem;padding:.15rem;border:1px solid var(--adox-field-border);border-radius:.25rem}',
        '.adox-obj{display:flex;align-items:center;gap:.1rem;border-radius:.2rem;padding:.05rem .1rem;',
        'border-inline-start:2px solid transparent;transition:background .15s,border-color .15s}',
        '.adox-obj:hover{background:var(--adox-hover)}',
        '.adox-obj.adox-on{background:var(--adox-field);color:inherit;border-inline-start-color:var(--adox-accent)}',
        '.adox-obj.adox-dim .adox-objname{opacity:.45}',
        '.adox-obj .adox-mini.adox-strong{opacity:1;color:var(--adox-accent)}',
        '.adox-mini{width:1.55rem;height:1.55rem;flex:0 0 auto;display:grid;place-items:center;border:0;',
        'border-radius:.2rem;background:transparent;color:inherit;cursor:pointer;padding:0;opacity:.55;transition:.2s}',
        '.adox-mini:hover{background:var(--adox-hover);opacity:1}',
        '.adox-mini svg{width:1.05rem;height:1.05rem;display:block}',
        '.adox-mini[aria-pressed=true]{opacity:1;color:var(--adox-accent)}',
        '.adox-mini:disabled{opacity:.2;cursor:default;background:transparent}',
        '.adox-mini:focus-visible{outline:2px solid var(--adox-accent);outline-offset:-2px}',
        '.adox-objname{flex:1;min-width:0;text-align:start;font:inherit;font-size:.7rem;padding:.2rem .25rem;',
        'border:0;border-radius:.2rem;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;',
        'overflow:hidden;text-overflow:ellipsis}',
        '.adox-swatch{width:.8rem;height:.8rem;flex:0 0 auto;border-radius:.15rem;',
        'border:1px solid var(--adox-field-border);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}',
        '.adox-swatch-empty{background:repeating-linear-gradient(45deg,transparent 0 2px,var(--adox-hover) 2px 4px)}',
        '.adox-tools{display:flex;gap:.15rem;margin:.2rem 0}',
        '.adox-tools .adox-mini{width:auto;flex:1;height:1.8rem}',
        // the layer rail is a drawer on the canvas edge. closed, only its 2rem spine of shape
        // thumbnails is clipped in; the pointer (or the pin) wipes the panel open over the canvas.
        // clip-path, not width or transform: the hidden part takes no clicks, and the canvas never resizes.
        '.adox-rail{position:fixed;z-index:5;display:flex;flex-direction:column;gap:.4rem;right:0;',
        'width:17rem;padding:.5rem .55rem;box-sizing:border-box;background:var(--adox-surface);',
        'border:1px solid var(--adox-field-border);border-inline-end:0;border-radius:.55rem 0 0 .55rem;',
        'box-shadow:var(--adox-shadow);overscroll-behavior:contain;',
        'clip-path:inset(0 0 0 calc(100% - 2rem));transition:clip-path .22s cubic-bezier(.2,.8,.3,1)}',
        '.adox-rail:hover,.adox-rail:focus-within,.adox-rail.adox-pin{clip-path:none}',
        // the clip alone would still let the rows' own icons show inside the strip, so the panel
        // content fades out when closed and back in the moment the drawer starts to open
        '.adox-rail>:not(.adox-spine){opacity:0;pointer-events:none;transition:opacity .12s .12s}',
        '.adox-rail:hover>:not(.adox-spine),.adox-rail:focus-within>:not(.adox-spine),',
        '.adox-rail.adox-pin>:not(.adox-spine){opacity:1;pointer-events:auto;transition-delay:0s}',
        // the clip keeps the drawer's rightmost 2rem, so the spine is pinned to that edge: it is the
        // only thing visible until the pointer (or the pin) wipes the panel open over the canvas.
        '.adox-spine{position:absolute;top:.45rem;bottom:.45rem;right:.3rem;width:1.6rem;',
        'display:flex;flex-direction:column;gap:3px;overflow:auto}',
        '.adox-rail:hover .adox-spine,.adox-rail:focus-within .adox-spine,.adox-rail.adox-pin .adox-spine{display:none}',
        '.adox-chip{width:1.55rem;height:1.55rem;flex:0 0 auto;border-radius:.25rem;',
        'background-color:var(--adox-field);background-repeat:no-repeat;background-position:center;',
        'background-size:80% 80%;border:1px solid var(--adox-field-border);box-sizing:border-box}',
        '.adox-chip.adox-off{opacity:.28}',
        '.adox-chip.adox-on{border-color:var(--adox-accent)}',
        '.adox-rhead{display:flex;align-items:center;gap:.35rem;font-size:.8rem;font-weight:700;flex:0 0 auto}',
        '.adox-rhead .adox-mini{margin-inline-start:auto;opacity:.7}',
        '.adox-rhead .adox-mini[aria-pressed=true]{opacity:1;color:var(--adox-accent)}',
        '.adox-rail .adox-objs{flex:0 1 auto;min-height:0;max-height:none;margin:0;padding:0;border:0;gap:.15rem}',
        '.adox-rail .adox-obj{min-height:2.3rem;gap:.4rem;padding:.15rem .2rem;border-radius:.3rem;',
        'border-inline-start:3px solid transparent}',
        '.adox-thumb{width:2.05rem;height:2.05rem;flex:0 0 auto;border-radius:.25rem;',
        'background-color:var(--adox-field);background-repeat:no-repeat;background-position:center;',
        'background-size:86% 86%;border:1px solid var(--adox-field-border);box-sizing:border-box}',
        '.adox-thumb.adox-off,.adox-chip.adox-off{filter:saturate(.25)}',
        '.adox-rail .adox-objname{font-size:.8rem;padding:.3rem .35rem}',
        '.adox-rail .adox-mini{width:1.7rem;height:1.7rem}',
        '.adox-rail .adox-mini svg{width:1.15rem;height:1.15rem}',
        '.adox-rtools{display:flex;gap:.15rem;flex:0 0 auto}',
        '.adox-rspin .adox-text{font-size:.75rem;padding:.3rem .4rem}',
        '.adox-rops{display:flex;align-items:center;gap:.35rem;flex:0 0 auto}',
        '.adox-rops output{width:2.8rem;text-align:right;font-weight:700;font-size:.75rem;',
        'font-variant-numeric:tabular-nums}',
        '.adox-text{flex:1;min-width:0;font:inherit;font-size:.7rem;padding:.3rem .45rem;border-radius:.25rem;',
        'border:1px solid var(--adox-field-border);background:var(--adox-field);color:inherit;transition:.25s ease-out}',
        '.adox-text:disabled{opacity:.5}',
        '.adox-name{flex:1}',
        '.adox-nib-num{font-size:.62rem;opacity:.65;font-variant-numeric:tabular-nums}',
        '.adox-dot{border-radius:50%;background:currentColor;display:block;transition:width .2s,height .2s}',
        '.adox-ring{border-radius:50%;border:1px solid currentColor;display:block}',
        '.adox-row{display:flex;align-items:center;gap:.4rem;margin:.5rem 0;min-height:1.25rem}',
        '.adox-row output{width:2.4rem;text-align:right;font-weight:700;font-size:.7rem;',
        'font-variant-numeric:tabular-nums}',
        '.adox-row svg{width:1.1rem;height:1.1rem;flex:0 0 auto;opacity:.75}',
        // every option in the advanced box carries a live mini example, so the choice is seen, not read
        '.adox-demo{position:relative;display:block;width:1.9rem;height:1.45rem;flex:0 0 auto;',
        'border-radius:.22rem;background:var(--adox-field);isolation:isolate;overflow:hidden}',
        '.adox-demo b,.adox-demo u{position:absolute;display:block;width:62%;height:78%;border-radius:50%}',
        '.adox-demo b{left:0;top:11%;background:#5bc0eb}',
        '.adox-demo u{right:0;top:11%;background:#f472b6}',
        '.adox-maskdemo b{left:0;top:0;width:100%;height:100%}',
        '.adox-maskdemo u{left:18%;top:20%;width:64%;height:60%;border-radius:.16rem;background:none;',
        'border:1px dashed rgba(255,255,255,.55);box-sizing:border-box}',
        '.adox-maskdemo.adox-masked b{clip-path:inset(20% 18% round .16rem)}',
        '.adox-row .adox-demo{margin-inline-end:.15rem}',
        '.adox-corner svg{width:100%;height:100%;display:block}',
        '.adox-corner path{fill:none;stroke:currentColor;stroke-width:3.4;stroke-linejoin:miter}',
        '.adox-tag{flex:0 0 5.4rem;font-size:.65rem;font-weight:700;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.adox-panel input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:.55rem;',
        'border-radius:.25rem;background:var(--adox-track,var(--adox-field));border:0;cursor:pointer;transition:.2s}',
        '.adox-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:1rem;height:1rem;',
        'border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.2);box-shadow:0 1px 3px rgba(0,0,0,.35)}',
        '.adox-panel input[type=range]::-moz-range-thumb{width:1rem;height:1rem;border-radius:50%;background:#fff;',
        'border:1px solid rgba(0,0,0,.2);box-shadow:0 1px 3px rgba(0,0,0,.35)}',
        '.adox-panel input[type=range]:focus-visible{outline:2px solid var(--adox-accent);outline-offset:2px}',
        '.adox-panel input[type=checkbox]{accent-color:var(--adox-accent);width:.9rem;height:.9rem}',
        // segmented control: the editor uses flat chips with a 4px radius and a 0.25s ease-out field transition
        '.adox-seg{display:flex;gap:.15rem}',
        '.adox-seg button{flex:1;font:inherit;font-size:.68rem;font-weight:700;padding:.3rem 0;border:0;',
        'border-radius:.25rem;background:var(--adox-field);color:inherit;cursor:pointer;transition:.25s ease-out}',
        '.adox-seg button:hover{background:var(--adox-hover)}',
        '.adox-seg button[aria-pressed=true]{background:var(--adox-accent);color:#fff}',
        '.adox-hex{flex:1;min-width:0;font:inherit;font-weight:700;font-size:.7rem;padding:.3rem .45rem;',
        'border-radius:.25rem;border:1px solid var(--adox-field-border);background:var(--adox-field);',
        'color:inherit;transition:.25s ease-out}',
        '.adox-sw{width:2rem;height:2rem;flex:0 0 auto;border-radius:.25rem;border:1px solid var(--adox-field-border)}',
        '.adox-bar{height:.55rem;border-radius:.25rem;position:relative;cursor:pointer;flex:1}',
        '.adox-bar b{position:absolute;top:-.2rem;width:.3rem;height:.95rem;border-radius:.15rem;background:#fff;',
        'box-shadow:0 1px 3px rgba(0,0,0,.4);transform:translateX(-50%)}',
        // the gradient strip sits inside the editor's own dialog, so it keeps the dialog's metrics
        // (150px content width, 4px radius) and never reaches for a border of its own
        '.adox-gwrap{direction:ltr;margin:.45rem 0 .1rem}',
        '.adox-gbar{height:.7rem;margin-bottom:.3rem;box-shadow:inset 0 0 0 1px rgba(128,128,128,.4)}',
        '.adox-gbar b.adox-pick{background:var(--adox-accent)}',
        '.adox-gfoot{display:flex;align-items:center;gap:.15rem}',
        '.adox-gcounts{flex:0 0 auto}',
        '.adox-gcounts button{width:1.45rem;flex:0 0 auto;padding:.22rem 0;font-size:.65rem}',
        '.adox-gwell{width:1.5rem;height:1.5rem;flex:0 0 auto;padding:0;border:1px solid var(--adox-field-border);',
        'border-radius:.25rem;background:transparent;cursor:pointer}',
        '.adox-gwell::-webkit-color-swatch-wrapper{padding:0}',
        '.adox-gwell::-webkit-color-swatch{border:0;border-radius:.15rem}',
        '.adox-gapply{flex:1;min-width:0;font:inherit;font-size:.68rem;font-weight:700;padding:.25rem 0;border:0;',
        'border-radius:.25rem;background:var(--adox-field);color:inherit;cursor:pointer;transition:.25s ease-out}',
        '.adox-gapply:hover{background:var(--adox-hover)}',
        '.adox-gapply:disabled{opacity:.4;cursor:default}',
        '.adox-keys{display:flex;align-items:center;gap:.22rem;margin-top:.45rem;opacity:.75}',
        '.adox-keys kbd{font:inherit;font-size:.6rem;line-height:1;padding:.1rem .25rem;border-radius:.2rem;',
        'border:1px solid var(--adox-field-border);background:var(--adox-field);color:inherit}',
        '.adox-keys svg{width:.95rem;height:.95rem;opacity:.7;display:block}',
        '.adox-close{position:absolute;top:.25rem;right:.35rem;cursor:pointer;opacity:.45;padding:0 .15rem;',
        'border:0;background:transparent;color:inherit;font:inherit;line-height:1;transition:.2s}',
        '.adox-close:hover{opacity:1}',
        // the anchor box reads one measured number, then one row per costume
        '.adox-jump{display:flex;align-items:baseline;justify-content:center;gap:.25rem;margin:.35rem 0 .1rem}',
        '.adox-jump strong{font-size:1.4rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;',
        'color:var(--adox-accent)}',
        '.adox-jump span{font-size:.6rem;font-weight:700;opacity:.55}',
        '.adox-sub{text-align:center;font-size:.65rem;opacity:.65;margin:0 0 .35rem}',
        '.adox-alist{display:flex;flex-direction:column;gap:.1rem;margin:.15rem 0 .3rem}',
        '.adox-arow{display:flex;align-items:center;gap:.3rem;padding:.1rem .2rem;border-radius:.2rem;',
        'background:var(--adox-field)}',
        '.adox-athumb{width:1.8rem;height:1.8rem;flex:0 0 auto;border-radius:.25rem;background-repeat:no-repeat;',
        'background-position:center;background-size:82% 82%;border:1px solid var(--adox-field-border);',
        'box-sizing:border-box}',
        '.adox-aname{flex:1;min-width:0;font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.adox-adelta{font-size:.62rem;font-weight:700;font-variant-numeric:tabular-nums;opacity:.7}',
        '.adox-actions{display:flex;gap:.15rem;margin-top:.35rem}',
        '.adox-primary{flex:2;font:inherit;font-size:.7rem;font-weight:700;padding:.35rem 0;border:0;',
        'border-radius:.25rem;background:var(--adox-accent);color:#fff;cursor:pointer;transition:.25s ease-out}',
        '.adox-primary:hover{filter:brightness(1.08)}',
        '.adox-primary:disabled{opacity:.4;cursor:default}',
        '.adox-ghost{flex:1;font:inherit;font-size:.68rem;font-weight:700;padding:.35rem 0;border:0;',
        'border-radius:.25rem;background:var(--adox-field);color:inherit;cursor:pointer;transition:.25s ease-out}',
        '.adox-ghost:hover{background:var(--adox-hover)}',
        '.adox-ghost:disabled{opacity:.35;cursor:default}',
        // the pixel box: two measured numbers, one honest switch, two actions
        '.adox-kv{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;',
        'padding:.28rem .4rem;border-radius:.25rem;background:var(--adox-field);margin:.2rem 0}',
        '.adox-kv span{font-size:.64rem;opacity:.75}',
        '.adox-kv b{font-size:.8rem;font-variant-numeric:tabular-nums}',
        '.adox-check{display:flex;align-items:center;gap:.5rem;padding:.4rem .1rem;cursor:pointer}',
        '.adox-check input{margin:0;accent-color:var(--adox-accent)}',
        '.adox-check span{display:flex;flex-direction:column;gap:.05rem;min-width:0}',
        '.adox-check small{font-size:.62rem;opacity:.62;line-height:1.25}',
        '.adox-note{font-size:.63rem;opacity:.7;line-height:1.35;min-height:1.2rem;margin:.3rem 0 0}',
        // pixel art is its own mode, not a popover in the tool rail: a card centred over the editor,
        // sized so the canvas gets the room and the tools stay a column, never a stretched sheet
        '.adox-px-btn{margin-inline-end:.5rem}',
        '.adox-px-btn + [class*="paint-editor_bitmap-button"]{margin-inline-end:auto}',
        '.adox-px{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:1.2rem;',
        'background:rgba(18,23,33,.42);font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;',
        'font-size:.75rem;line-height:1.45;color:var(--adox-text);animation:adox-in .14s ease-out}',
        '.adox-px-win{width:min(60rem,94vw);height:min(41rem,90vh);display:grid;box-sizing:border-box;',
        'grid-template-columns:auto minmax(0,1fr) 12.5rem;grid-template-rows:auto minmax(0,1fr) auto;',
        'grid-template-areas:"head head head" "tools stage side" "foot foot foot";',
        'background:var(--adox-surface);border:1px solid var(--adox-field-border);border-radius:.5rem;',
        'box-shadow:0 18px 48px rgba(0,0,0,.35);overflow:hidden}',
        '.adox-px-head{grid-area:head;display:flex;align-items:center;gap:.5rem;padding:.55rem .7rem;',
        'border-bottom:1px solid var(--adox-field-border)}',
        '.adox-px-head strong{font-size:.9rem;font-weight:700;white-space:nowrap}',
        '.adox-px-sub{flex:1;min-width:0;font-size:.68rem;opacity:.62;white-space:nowrap;overflow:hidden;',
        'text-overflow:ellipsis}',
        '.adox-px-tools{grid-area:tools;display:flex;flex-direction:column;gap:.28rem;padding:.55rem .45rem;',
        'border-inline-end:1px solid var(--adox-field-border);overflow:auto}',
        '.adox-px-tool{width:2rem;height:2rem;display:grid;place-items:center;padding:.35rem;border:1px solid transparent;',
        'border-radius:.25rem;background:transparent;color:inherit;cursor:pointer;transition:background .15s}',
        '.adox-px-tool svg{width:1.15rem;height:1.15rem;display:block}',
        '.adox-px-tool:hover{background:var(--adox-hover)}',
        '.adox-px-tool.adox-on{background:var(--adox-accent);color:#fff}',
        '.adox-px-stage{grid-area:stage;min-width:0;min-height:0;display:grid;place-items:center;padding:.8rem;',
        'overflow:auto;background:var(--adox-surface)}',
        '.adox-px-paper{line-height:0;background:repeating-conic-gradient(#e9edf4 0 25%,#fff 0 50%) 0 0/12px 12px;',
        'box-shadow:0 0 0 1px var(--adox-field-border)}',
        '.adox-px-canvas{display:block;image-rendering:pixelated;touch-action:none;cursor:crosshair}',
        '.adox-px-side{grid-area:side;display:flex;flex-direction:column;gap:.55rem;padding:.6rem;min-height:0;',
        'border-inline-start:1px solid var(--adox-field-border);overflow:auto}',
        '.adox-px-field{display:flex;align-items:center;gap:.4rem;font-size:.68rem;font-weight:700}',
        '.adox-px-field input[type=color]{width:2rem;height:1.6rem;padding:0;border:1px solid var(--adox-field-border);',
        'border-radius:.25rem;background:transparent;cursor:pointer}',
        '.adox-px-field input[type=color]::-webkit-color-swatch-wrapper{padding:.1rem}',
        '.adox-px-field input[type=color]::-webkit-color-swatch{border:0;border-radius:.15rem}',
        '.adox-px-field input[type=range]{flex:1;min-width:0;height:.9rem;accent-color:var(--adox-accent)}',
        '.adox-px-field output{min-width:1.1rem;text-align:end;font-weight:700;font-variant-numeric:tabular-nums;opacity:.7}',
        '.adox-px-palette{display:grid;grid-template-columns:repeat(5,1fr);gap:.25rem}',
        '.adox-px-palette button{aspect-ratio:1;padding:0;border:1px solid rgba(127,127,127,.35);border-radius:.2rem;',
        'cursor:pointer}',
        '.adox-px-palette button:hover{outline:2px solid var(--adox-accent);outline-offset:1px}',
        '.adox-px-check{display:flex;align-items:center;gap:.4rem;font-size:.68rem;cursor:pointer}',
        '.adox-px-check input{margin:0;accent-color:var(--adox-accent)}',
        '.adox-px-help{margin:auto 0 0;font-size:.62rem;line-height:1.45;opacity:.6}',
        '.adox-px-foot{grid-area:foot;display:flex;align-items:center;gap:.35rem;padding:.5rem .6rem;',
        'border-top:1px solid var(--adox-field-border)}',
        '.adox-px-note{flex:1;min-width:0;font-size:.66rem;opacity:.7;white-space:nowrap;overflow:hidden;',
        'text-overflow:ellipsis}',
        '.adox-px-zoom{width:1.7rem;height:1.7rem;flex:0 0 auto;font:inherit;font-size:.9rem;line-height:1;',
        'border:1px solid var(--adox-field-border);border-radius:.25rem;background:var(--adox-field);color:inherit;',
        'cursor:pointer}',
        '.adox-px-zoom:hover{background:var(--adox-hover)}',
        '.adox-px-zoomval{min-width:2.2rem;text-align:center;font-size:.68rem;font-weight:700;',
        'font-variant-numeric:tabular-nums;opacity:.75}',
        '.adox-px-fit{width:auto;padding:0 .45rem;font-size:.66rem;font-weight:700}',
        '.adox-px-cancel,.adox-px-apply{flex:0 0 auto;font:inherit;font-size:.7rem;font-weight:700;padding:.4rem .8rem;',
        'border:0;border-radius:.25rem;cursor:pointer}',
        '.adox-px-cancel{background:var(--adox-field);color:inherit}',
        '.adox-px-cancel:hover{background:var(--adox-hover)}',
        '.adox-px-apply{background:var(--adox-accent);color:#fff;padding:.4rem 1rem}',
        '.adox-px-apply:hover{filter:brightness(1.08)}',
        '.adox-px-icon{width:1.7rem;height:1.7rem;flex:0 0 auto;display:grid;place-items:center;padding:.3rem;',
        'border:0;border-radius:.25rem;background:transparent;color:inherit;cursor:pointer}',
        '.adox-px-icon svg{width:1.05rem;height:1.05rem;display:block}',
        '.adox-px-icon:hover{background:var(--adox-hover)}',
        '.adox-px-icon:disabled{opacity:.3;cursor:default;background:transparent}',
        '.adox-px-close{margin-inline-start:.15rem;font-size:.9rem;line-height:1}',
        '.adox-toast{position:fixed;left:50%;bottom:1.6rem;z-index:10001;padding:.5rem .8rem;border-radius:.3rem;',
        'background:#2b3445;color:#fff;font:600 .72rem/1.3 "Helvetica Neue",Helvetica,Arial,sans-serif;',
        'box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;pointer-events:none;',
        'transform:translate(-50%,.6rem);transition:opacity .18s,transform .18s}',
        '.adox-toast.adox-on{opacity:1;transform:translate(-50%,0)}',
        '.adox-toast.adox-bad{background:#c4342e}',
        '@media (max-width:720px){.adox-px-win{grid-template-columns:auto minmax(0,1fr);height:min(44rem,94vh);',
        'grid-template-areas:"head head" "tools stage" "side side" "foot foot"}',
        '.adox-px-side{flex-flow:row wrap;align-items:center;border-inline-start:0;',
        'border-top:1px solid var(--adox-field-border)}.adox-px-help{display:none}}',
        // the plan board: same surface, border and radius as every other editor popover
        '.adox-board{position:fixed;top:4.4rem;right:1rem;bottom:1rem;width:27rem;',
        'max-width:calc(100vw - 2rem);z-index:9999;display:flex;flex-direction:column;',
        'border-radius:.35rem;background:var(--adox-surface);color:var(--adox-text);',
        'border:1px solid var(--adox-field-border);box-shadow:var(--adox-shadow);',
        'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.75rem;overflow:hidden}',
        '.adox-bhead{display:flex;align-items:center;gap:.4rem;padding:.5rem .6rem;flex:0 0 auto;',
        'border-bottom:1px solid var(--adox-field-border)}',
        '.adox-bhead strong{font-size:.85rem;white-space:nowrap}',
        '.adox-board .adox-close{position:static;margin-inline-start:.1rem}',
        '.adox-bsub{flex:1;min-width:0;font-size:.62rem;opacity:.62;white-space:nowrap;overflow:hidden;',
        'text-overflow:ellipsis}',
        '.adox-bcols{flex:1;min-height:0;display:flex;gap:.4rem;padding:.5rem;overflow:auto;align-items:flex-start}',
        '.adox-bcol{flex:1 1 7.4rem;min-width:6.6rem;display:flex;flex-direction:column;gap:.3rem;max-height:100%;',
        'min-height:5rem;background:var(--adox-field);border-radius:.3rem;padding:.3rem;',
        'transition:outline-color .15s;outline:2px solid transparent;outline-offset:-2px}',
        '.adox-bcol.adox-over{outline-color:var(--adox-accent)}',
        '.adox-bch{display:flex;align-items:center;gap:.1rem;flex:0 0 auto}',
        '.adox-bch.adox-drag{cursor:grab}',
        '.adox-bch.adox-drag:active{cursor:grabbing}',
        '.adox-bname{flex:1;min-width:0;font:inherit;font-size:.66rem;font-weight:700;background:transparent;',
        'border:0;color:inherit;padding:.15rem .2rem;border-radius:.2rem}',
        '.adox-bname:focus-visible{outline:1px solid var(--adox-accent)}',
        '.adox-bcard{background:var(--adox-surface);border:1px solid var(--adox-field-border);',
        'border-radius:.28rem;padding:.25rem;display:flex;flex-direction:column;gap:.1rem;cursor:grab}',
        '.adox-bcard:active{cursor:grabbing}',
        '.adox-bcard textarea{width:100%;resize:none;border:0;background:transparent;color:inherit;',
        'font:inherit;font-size:.65rem;line-height:1.35;padding:.1rem;border-radius:.2rem;outline:none}',
        '.adox-bcard textarea.adox-ctitle{font-weight:700}',
        '.adox-bcard textarea:focus-visible{background:var(--adox-field)}',
        '.adox-badd{font:inherit;font-size:.64rem;font-weight:700;padding:.3rem 0;border:0;',
        'border-radius:.25rem;background:transparent;color:inherit;opacity:.6;cursor:pointer}',
        '.adox-badd:hover{background:var(--adox-hover);opacity:1}',
        '.adox-bfoot{display:flex;align-items:center;gap:.3rem;padding:.4rem .55rem;flex:0 0 auto;',
        'border-top:1px solid var(--adox-field-border)}',
        '.adox-bfoot button{flex:0 0 5.4rem;font:inherit;font-size:.66rem;font-weight:700;padding:.3rem 0;',
        'border:0;border-radius:.25rem;background:var(--adox-field);color:inherit;cursor:pointer}',
        '.adox-bfoot button:hover{background:var(--adox-hover)}',
        '.adox-board-btn{position:fixed;z-index:30;width:2rem;height:2rem;padding:.32rem;',
        'border:1px solid rgba(127,127,127,.22);border-radius:.25rem;background:rgba(127,127,127,.1);',
        'cursor:pointer;display:grid;place-items:center;transition:background .2s,border-color .2s}',
        '.adox-board-btn:hover{background:rgba(127,127,127,.24);border-color:rgba(127,127,127,.4)}',
        '.adox-board-btn:focus-visible{outline:2px solid #4c97ff;outline-offset:-2px}',
        '.adox-board-btn img{width:1.35rem;height:1.35rem;display:block}',
        '.adox-wide{width:27rem}',
        '.adox-fxbox{width:23rem}',
        '@media (max-width:560px){.adox-panel{width:min(19rem,92vw)}.adox-wide{width:min(27rem,92vw)}',
        '.adox-fxbox{width:min(19rem,92vw)}}',
        '@media (prefers-reduced-motion:reduce){.adox-panel,.adox-px{animation:none}.adox-cell,.adox-dot,.adox-close,',
        '.adox-seg button,.adox-toast{transition:none}}'
    ].join('');

    // ---------------------------------------------------------------------- ui
    var openPanel = null;
    var openAnchor = null;
    var toolButtons = [];

    // Our button borrows the editor's own "active tool" class, so the accent colour, the press
    // tint and a custom TurboWarp theme all come from the site stylesheet instead of from us.
    function markTool (btn, on, fragment) {
        // only our own buttons may be marked: the editor owns the state of its native tools
        if (!btn || !btn.classList.contains('adox-tool')) return;
        var cls = nativeClass(fragment);
        if (!cls) return;
        if (on) btn.classList.add(cls); else btn.classList.remove(cls);
    }

    function closePanel () {
        if (openPanel) {
            markTool(openAnchor, false, 'tool-select-base_is-selected');
            openPanel.remove();
        }
        openPanel = null;
        openAnchor = null;
        clearShapePreview();
    }

    // the drawing surface, in page coordinates: a floating box that sits on top of it is not a
    // decoration, it is the thing the pen hits instead of the art
    function artRect () {
        var c = document.querySelector('canvas[class*="paper-canvas"]');
        if (!c) return null;
        var r = c.getBoundingClientRect();
        if (r.width < 8) return null;
        return r;
    }
    function overlapArea (a, b) {
        if (!a || !b) return 0;
        var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 0 && h > 0 ? w * h : 0;
    }
    function boxOf (left, top, w, h) {
        return {left: left, top: top, right: left + w, bottom: top + h};
    }

    function fitPanel (panel) {
        var rect = panel._adoxAnchor.getBoundingClientRect();
        var box = panel.getBoundingClientRect();
        var art = artRect();
        var vw = window.innerWidth, vh = window.innerHeight;
        var fits = function (x, y) {
            return x >= 8 && y >= 8 && x + box.width <= vw - 8 && y + box.height <= vh - 8;
        };
        var tops = [clamp(rect.top, 8, Math.max(8, vh - box.height - 8)),
            art ? art.bottom + 8 : 0, art ? art.top - box.height - 8 : 0];
        // beside the button, on its other side, and hugging the page edge on either side: the tool
        // column is narrower than the box, so the edge is what is actually left over beside it
        var xs = [rect.right + 10, rect.left - box.width - 10, vw - box.width - 8, 8];
        var cands = [];
        xs.forEach(function (x) {
            // a menu that flies to the far side of the window is not a menu, so the box may only
            // leave the column its button stands in
            if (Math.abs(x - rect.left) > box.width + rect.width + 60) return;
            tops.forEach(function (y) {
                if (!fits(x, y)) return;
                cands.push({x: x, y: y, d: Math.abs(x - rect.left),
                    hit: overlapArea(boxOf(x, y, box.width, box.height), art)});
            });
        });
        if (!cands.length) cands.push({x: xs[0], y: tops[0], d: 0, hit: 0});
        // a box that covers a third of the canvas is worse than a box that sits a few pixels short
        // of its button, so staying off the art wins and nearness only breaks the tie
        cands.sort(function (a, b) {
            return a.hit !== b.hit ? a.hit - b.hit : a.d - b.d;
        });
        var best = cands[0];
        panel.style.setProperty('--adox-origin', best.x > rect.left ? 'left center' : 'right center');
        panel.style.left = best.x + 'px';
        panel.style.top = best.y + 'px';
    }

    function toggleFor (anchor, kind, extraClass) {
        if (openPanel && openAnchor === anchor) {
            closePanel();
            return null;
        }
        closePanel();
        readLocale();
        var panel = document.createElement('div');
        panel.className = 'adox-panel' + (extraClass ? ' ' + extraClass : '');
        panel.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
        panel._adoxAnchor = anchor;
        panel._adoxKind = kind;
        var theme = readTheme();
        applyTheme(panel, theme);
        // the armed tool button needs the same accent the editor paints on its selected tool
        if (anchor.parentElement) anchor.parentElement.style.setProperty('--adox-hl', theme.accent);
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'adox-close';
        close.setAttribute('aria-label', t('close'));
        close.textContent = '✕';
        close.addEventListener('click', closePanel);
        panel.appendChild(close);
        var rect = anchor.getBoundingClientRect();
        panel.style.left = rect.right + 10 + 'px';
        panel.style.top = rect.top + 'px';
        document.body.appendChild(panel);
        openPanel = panel;
        openAnchor = anchor;
        markTool(anchor, true, 'tool-select-base_is-selected');
        // callers fill the panel after this returns, so the real size is only known on the next tick
        window.setTimeout(function () {
            if (openPanel === panel) fitPanel(panel);
        }, 0);
        return panel;
    }

    // The editor draws its tool icons as an <img> holding a 20x20 svg with a #575E75 fill, and the site's
    // own CSS turns that image white on the selected (accent) background. Reusing the same element and the
    // same palette means every theme, including a custom TurboWarp one, colours our icons for us.
    var ICON_FILL = '#575E75';
    // the rail's geometric tools (square, circle, line) are drawn as 1.6px outlines, so ours are too;
    // the earlier filled set sat heavier than every neighbour and read as a different icon family
    function lineIcon (inner) {
        return 'data:image/svg+xml;base64,' + window.btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 20 20">' +
            '<g fill="none" stroke="' + ICON_FILL + '" stroke-width="1.6" stroke-linecap="round" ' +
            'stroke-linejoin="round">' + inner + '</g></svg>');
    }
    var SHAPE_TOOL_ICON = lineIcon('<path d="M6.6 8 11.6 16.2H1.6z"/><circle cx="14.2" cy="6.2" r="3.9"/>');
    var PEN_TOOL_ICON = lineIcon('<path d="M10 2.4c2.7 3 4 5.4 4 7.6a4 4 0 0 1-8 0c0-2.2 1.3-4.6 4-7.6z"/>' +
        '<path d="M10 7.6v3.4"/><circle cx="10" cy="13.6" r=".9" fill="' + ICON_FILL + '" stroke="none"/>');
    // two circles that overlap: masking and blending, not another shape picker
    var FX_TOOL_ICON = lineIcon('<circle cx="7.8" cy="10" r="4.9"/><circle cx="12.2" cy="10" r="4.9"/>');
    // a registration point: the crosshair of the editor's own pivot tool, with the mass of the
    // drawing sitting inside it
    var ANCHOR_TOOL_ICON = lineIcon('<circle cx="10" cy="10" r="3.5"/>' +
        '<path d="M10 1.9v2.8M10 15.3v2.8M1.9 10h2.8M15.3 10h2.8"/>' +
        '<circle cx="10" cy="10" r=".95" fill="' + ICON_FILL + '" stroke="none"/>');
    // two cards side by side: the project board, not another drawing tool. The same three shapes
    // draw the tool button and the card header, so the outline is written once
    var BOARD_PATH = '<rect x="2.6" y="3.6" width="8.2" height="12.8" rx="1.2"/>' +
        '<rect x="12.6" y="3.6" width="4.8" height="7.2" rx="1.2"/><path d="M12.6 13.6h4.8"/>';
    var BOARD_TOOL_ICON = lineIcon(BOARD_PATH);
    var TOOL_ICON = {shapes: SHAPE_TOOL_ICON, pen: PEN_TOOL_ICON, fx: FX_TOOL_ICON, anchor: ANCHOR_TOOL_ICON,
        board: BOARD_TOOL_ICON};
    var BOARD_GLYPH = icon(BOARD_PATH);

    function icon (paths) {
        return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
    }
    var GLYPH = {
        size: icon('<path d="M2.5 10h15"/><path d="M5.5 7 2.5 10l3 3"/><path d="M14.5 7l3 3-3 3"/>'),
        round: icon('<path d="M3 6.5A3.5 3.5 0 0 1 6.5 3h11v14h-11A3.5 3.5 0 0 1 3 13.5z"/>'),
        nib: icon('<path d="M10 3c2.4 2.7 3.6 5 3.6 7.2A3.6 3.6 0 0 1 6.4 10.2C6.4 8 7.6 5.7 10 3z"/>' +
            '<path d="M10 16.4v1.6"/>'),
        undo: icon('<path d="M4 8.5h8.5a4 4 0 1 1 0 8H7"/><path d="M4 8.5 7 5.5M4 8.5l3 3"/>'),
        wheel: icon('<rect x="6.5" y="2.5" width="7" height="15" rx="3.5"/><path d="M10 5.2v2.6"/>'),
        plus: icon('<path d="M10 4v12M4 10h12"/>'),
        trash: icon('<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>')
    };
    function shapeIcon (shape) {
        return '<svg viewBox="-8 -8 116 116"><path d="' + (shape.d || shape.path) + '" fill="currentColor" fill-rule="' +
            (shape.fillRule || 'nonzero') + '"/></svg>';
    }

    function addToolButton (grid, key, iconUrl, onClick) {
        var proto = grid.querySelector('[class*="tool-select-base_mod-tool-select"]');
        if (!proto) return null;
        var btn = proto.cloneNode(false);
        btn.className = btn.className.replace(/tool-select-base_is-selected\S*/g, '').replace(/\s+/g, ' ').trim() +
            ' adox-tool';
        if (!btn.hasAttribute('tabindex')) btn.setAttribute('tabindex', '0');
        if (!btn.getAttribute('role')) btn.setAttribute('role', 'button');
        btn._adoxKey = key;
        btn.dataset.adoxKey = key;
        btn.setAttribute('title', t(key));
        btn.setAttribute('aria-label', t(key));
        var imgClass = nativeClass('tool-select-base_tool-select-icon') || 'adox-icon';
        var img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.className = imgClass;
        img.src = iconUrl;
        btn.textContent = '';
        btn.appendChild(img);
        btn.addEventListener('click', onClick);
        btn.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                btn.click();
            }
        });
        grid.appendChild(btn);
        toolButtons.push(btn);
        return btn;
    }
    // the armed pen is a state the editor does not have, so it borrows the editor's own selected look:
    // the accent background and the white icon come from the values measured off the selected tool
    function markArmed (btn, on) {
        if (btn && btn.classList.contains('adox-tool')) btn.classList.toggle('adox-armed', !!on);
    }
    function refreshToolLabels () {
        toolButtons.forEach(function (btn) {
            if (!btn.isConnected) return;
            var armed = btn === pen.button && pen.active && pen.profile;
            var stamp = btn === shaper.button && shaper.shape;
            var text = armed ? nameOf(pen.profile) : stamp ? nameOf(shaper.shape) : t(btn._adoxKey);
            btn.setAttribute('title', text);
            btn.setAttribute('aria-label', text);
        });
    }

    var SLIDER_TEXT = {shapeSize: 'size', shapeRound: 'round', penSize: 'size'};
    function sliderValueText (key, value) {
        return key === 'shapeRound' ? String(value) : value + ' px';
    }
    function sliderRow (glyph, min, max, step, key, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'adox-row';
        var symbol = document.createElement('span');
        symbol.innerHTML = glyph;
        var input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = settings[key];
        input.setAttribute('aria-label', t(SLIDER_TEXT[key] || key));
        var out = document.createElement('output');
        out.textContent = sliderValueText(key, settings[key]);
        input.addEventListener('input', function () {
            settings[key] = Number(input.value);
            out.textContent = sliderValueText(key, settings[key]);
            saveSettings();
            if (onChange) onChange();
        });
        wrap.appendChild(symbol);
        wrap.appendChild(input);
        wrap.appendChild(out);
        return wrap;
    }
    function keyRow (chips) {
        var row = document.createElement('div');
        row.className = 'adox-keys';
        chips.forEach(function (chip) {
            if (chip.charAt(0) === '<') {
                var glyph = document.createElement('span');
                glyph.innerHTML = chip;
                row.appendChild(glyph);
                return;
            }
            var k = document.createElement('kbd');
            k.textContent = chip;
            row.appendChild(k);
        });
        return row;
    }

    // ---------------------------------------------------------------- insert
    function viewCenter () {
        try {
            return paper().project.view.center.clone();
        } catch (e) {
            // no view yet (the editor had barely mounted): the middle of the artboard is what
            // a click there means, and paper reads a plain {x, y} as a point
            return {x: ART_CENTER.x, y: ART_CENTER.y};
        }
    }

    function buildShapePath (shape, where) {
        var p = paper();
        var radius = shape.points ? Math.max(settings.shapeRound, shape.minRound || 0) : 0;
        var d = shape.points ? cornerPath(shape.points, radius) : shape.path;
        var path = new p.Path(d);
        path.closed = true;
        if (shape.fillRule) path.fillRule = shape.fillRule;
        var scale = settings.shapeSize / 100;
        path.scale(scale);
        path.applyMatrix = true;
        // the gradient is measured against the finished bounds, so the style comes after the position
        if (where && typeof where.width === 'number') path.bounds = where;
        else path.position = where || viewCenter();
        styleShapePath(path);
        return path;
    }

    function insertShape (shape, where) {
        var p = paper();
        var layer = paintingLayer();
        var color = (paintState() || {}).color || {};
        // with neither a fill nor an outline the editor's own shape tools draw nothing, so we do too
        // instead of leaving an invisible path and a phantom undo entry behind
        var paints = function (style, key) {
            style = style || {};
            return adoxGradient(key) || usable(style.primary) || usable(style.secondary) || !!lastPaint[key];
        };
        if (!p || !layer || (!paints(color.fillColor, 'fill') && !paints(color.strokeColor, 'stroke'))) return false;
        var path = buildShapePath(shape, where);
        try {
            return isBitmapFormat() ? bakeIntoRaster(path) : addVectorShape(path, layer);
        } catch (e) {
            path.remove();
            if (window.console) window.console.warn('ScratchDream şekil: ' + e.message);
            return false;
        }
    }

    function bakeIntoRaster (path) {
        var raster = rasterItem();
        if (!raster || !raster.canvas) {
            path.remove();
            return false;
        }
        var temp = path.rasterize(72);
        path.remove();
        var ctx = raster.canvas.getContext('2d');
        ctx.save();
        ctx.drawImage(temp.canvas, Math.round(temp.bounds.x), Math.round(temp.bounds.y));
        ctx.restore();
        temp.remove();
        return commit();
    }

    function addVectorShape (path, layer) {
        var p = paper();
        layer.activate();
        layer.addChild(path);
        path.selected = true;
        dispatch({type: 'scratch-paint/select/CHANGE_SELECTED_ITEMS', selectedItems: [path], bitmapMode: false});
        p.view.update();
        if (!commit()) {
            path.remove();
            return false;
        }
        return true;
    }

    // A hovered shape is drawn into the editor's guide layer, which the export step already
    // hides, so a preview can never leak into the costume.
    var shapePreview = null;
    var previewed = null;

    function clearShapePreview () {
        previewed = null;
        if (!shapePreview) return;
        shapePreview.remove();
        shapePreview = null;
        var art = paintingLayer();
        if (art) art.activate();
    }

    // The guide layer is shared with the editor's own selection handles, so only the items we
    // tagged are touched. Anything left there after both tools let go is a stuck ghost.
    function sweepGhosts () {
        if (shaper.shape || pen.active || shapePreview) return;
        var layer = findLayer('isGuideLayer');
        if (!layer) return;
        for (var i = layer.children.length - 1; i >= 0; i--) {
            if (layer.children[i]._adoxGhost) layer.children[i].remove();
        }
    }
    function previewShape (shape, box) {
        var p = paper();
        var layer = guideLayer();
        if (!p || !layer) return;
        if (shapePreview) {
            shapePreview.remove();
            shapePreview = null;
        }
        var path = buildShapePath(shape, box);
        path.fillColor = null;
        path.strokeColor = new p.Color((openPanel && openPanel._adoxAccent) || '#575e75');
        path.strokeWidth = 1.2 / p.view.zoom;
        path.dashArray = [5 / p.view.zoom, 4 / p.view.zoom];
        path.locked = true;
        path._adoxGhost = true;
        layer.addChild(path);
        var art = paintingLayer();
        if (art) art.activate();
        p.view.update();
        shapePreview = path;
        previewed = shape;
    }
    function refreshPreview () {
        if (!previewed) return;
        // previewShape() drops the previous path itself; clearing shapePreview first orphans one
        // dashed path per slider event in the guide layer
        previewShape(previewed);
    }

    // A picked shape is armed, not stamped. The editor's own rectangle tool is the model: press,
    // drag the box you want, release, and the tool stays armed for the next one. Nothing enters
    // the costume before that release, so a wrong click costs nothing and needs no undo.
    var shaper = {
        button: null,
        shape: null,
        start: null,
        cursor: function (on) {
            var canvas = document.querySelector('canvas[class*="paper-canvas"]');
            if (canvas) canvas.style.cursor = on ? 'crosshair' : '';
        },
        // a press that never left its own pixel is a stamp, and the panel's size slider decides it
        boxOf: function (from, to) {
            var p = paper();
            var w = Math.abs(to.x - from.x);
            var h = Math.abs(to.y - from.y);
            if (!p || w < 3 || h < 3) return null;
            return new p.Rectangle(Math.min(from.x, to.x), Math.min(from.y, to.y), w, h);
        },
        arm: function (shape) {
            this.disarm();
            pen.deactivate();
            this.shape = shape;
            this.start = null;
            markArmed(this.button, true);
            document.addEventListener('pointerdown', this.onDown, true);
            document.addEventListener('pointermove', this.onMove, true);
            this.cursor(true);
            refreshToolLabels();
        },
        disarm: function () {
            document.removeEventListener('pointerdown', this.onDown, true);
            document.removeEventListener('pointermove', this.onMove, true);
            document.removeEventListener('pointerup', this.onUp, true);
            document.removeEventListener('pointercancel', this.onUp, true);
            markArmed(this.button, false);
            this.cursor(false);
            if (!this.shape) return;
            this.shape = null;
            this.start = null;
            clearShapePreview();
            refreshToolLabels();
        },
        onDown: function (e) {
            if (!shaper.shape || e.button !== 0) return;
            var canvas = e.target && e.target.closest ? e.target.closest('canvas[class*="paper-canvas"]') : null;
            if (!canvas) return;
            var point = pen.toProject(e);
            if (!point) return;
            // the editor never sees this press: its own select box would jump under the ghost
            e.stopPropagation();
            e.preventDefault();
            shaper.start = point;
            document.addEventListener('pointermove', shaper.onMove, true);
            document.addEventListener('pointerup', shaper.onUp, true);
            document.addEventListener('pointercancel', shaper.onUp, true);
        },
        onMove: function (e) {
            if (!shaper.shape) return;
            var point = pen.toProject(e);
            if (!point) return;
            if (!shaper.start) {
                previewShape(shaper.shape, point);
                return;
            }
            previewShape(shaper.shape, shaper.boxOf(shaper.start, point) || shaper.start);
        },
        onUp: function (e) {
            document.removeEventListener('pointermove', shaper.onMove, true);
            document.removeEventListener('pointerup', shaper.onUp, true);
            document.removeEventListener('pointercancel', shaper.onUp, true);
            if (!shaper.shape || !shaper.start) return;
            var point = pen.toProject(e) || shaper.start;
            var where = shaper.boxOf(shaper.start, point) || point;
            shaper.start = null;
            var placed = insertShape(shaper.shape, where);
            // the native rectangle tool hands the canvas back to the select arrow after one shape;
            // staying armed left a dashed ghost over the artwork and a stuck badge on the button
            if (placed) shaper.disarm();
        }
    };

    function cell (label, html) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'adox-cell';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.innerHTML = html;
        return b;
    }

    // the previews are drawn by the browser, not by us: the top disc carries the blend mode it
    // advertises, the mask disc is clipped by the very window the dashed square shows
    function demoBlend (mode) {
        return '<i class="adox-demo"><b></b><u style="mix-blend-mode:' + mode + '"></u></i>';
    }
    function demoMask (masked) {
        return '<i class="adox-demo adox-maskdemo' + (masked ? ' adox-masked' : '') +
            '"><b></b><u></u></i>';
    }

    // the editor ships translations for its own words, so its colour dialog's vocabulary is read
    // from its message catalogue instead of being written out again in 36 languages
    function msg (id, fallback) {
        var s = store();
        try {
            return (s.getState().locales.messages || {})[id] || fallback;
        } catch (e) {
            return fallback;
        }
    }
    function selectedPaths () {
        var layer = paintingLayer();
        var out = [];
        if (!layer) return out;
        // the painting layer is the only place the editor keeps selectable art, and walking it
        // works on every paper build; Project#items does not. paper reports a container as selected
        // as soon as its children are, so the walk starts below the layer, pushing the layer itself
        // would style every item in the costume instead of the ones the editor has picked.
        (function walk (node) {
            if (node.locked) return;
            if (node !== layer && node.selected) {
                out.push(node);
                return;
            }
            if (node.children) node.children.forEach(walk);
        })(layer);
        return out;
    }
    // z-order lives in the children arrays, so the last match is the item on top
    function topOf (items) {
        var layer = paintingLayer();
        var top = null;
        if (layer) {
            (function find (node) {
                if (node.locked) return;
                if (items.indexOf(node) >= 0) {
                    top = node;
                    return;
                }
                if (node.children) node.children.forEach(find);
            })(layer);
        }
        return top || items[items.length - 1];
    }
    // every real drawing item, bottom to top; the editor's locked guide shape is not art
    function artItems () {
        var layer = paintingLayer(), out = [];
        if (!layer) return out;
        (function walk (node) {
            // locked art is still art: only the editor's guide shape is not
            if (node.guide || !node.visible) return;
            if (node !== layer && (!node.children || !node.children.length)) {
                out.push(node);
                return;
            }
            if (node.children) node.children.forEach(walk);
        })(layer);
        return out;
    }
    // a blank costume has nothing to rasterise, so the PNG buttons grey out instead of handing
    // back an empty download; both the vector and the bitmap layer count as art
    function hasArt () {
        var p = paper();
        if (!p) return false;
        return Array.prototype.some.call(p.project.layers, function (layer) {
            var data = layer.data || {};
            if (!data.isPaintingLayer && !data.isRasterLayer) return false;
            return Array.prototype.some.call(layer.children, function (item) {
                return !item.guide && item.visible;
            });
        });
    }
    function applyGradientToSelection () {
        var p = paper();
        var items = selectedPaths();
        if (!p || !items.length || !gradStops(gradTarget)) return false;
        var stroke = gradTarget === 'stroke';
        var styleKey = stroke ? 'strokeColor' : 'fillColor';
        // with the picker still on a flat colour there is no type to read, but the strip was
        // asked for by name, vertical is the direction every neighbour of this control assumes
        var type = gradType(gradTarget) || 'VERTICAL';
        items.forEach(function (item) {
            item[styleKey] = adoxPaint(gradTarget, item.bounds, stroke ? item.strokeWidth : 0, type);
        });
        p.view.update();
        return commit();
    }

    // ------------------------------------------------------------------ effects
    // Three things the editor has no UI for, measured against its own exporter:
    // a clip mask writes <clipPath> + clip-path, a blend mode writes style="mix-blend-mode",
    // and a miter limit writes stroke-miterlimit, all three survive the costume the project stores.
    // stroke-linejoin is the one paper never exports, so the spike fix goes through the miter limit:
    // under ~1.6 a sharp corner falls back to a flat bevel instead of drawing a needle.
    var BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
        'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
        'hue', 'saturation', 'color', 'luminosity'];

    function eachSelected (fn, live) {
        var p = paper();
        var items = selectedPaths();
        if (!p || !items.length) return false;
        items.forEach(fn);
        p.view.update();
        // a range input fires one event per pixel step while dragging, and commit() re-encodes the
        // whole costume (measured 8 ms per export) plus an undo entry, so a live drag only paints,
        // and the release is what lands in the editor's undo stack as one step
        return live ? true : commit();
    }
    function applyBlend (mode) {
        // blendMode is a prototype accessor: `delete` leaves the value in place (measured), and
        // assigning "normal" is what clears the style the exporter writes
        return eachSelected(function (item) {
            item.blendMode = mode;
        });
    }
    function blendOfSelection () {
        var items = selectedPaths();
        return items.length ? String(items[0].blendMode || 'normal') : '';
    }
    function stepBlend (dir) {
        var at = BLENDS.indexOf(blendOfSelection());
        if (at < 0) at = 0;
        var next = BLENDS[(at + dir + BLENDS.length) % BLENDS.length];
        if (applyBlend(next)) markFx();
        return next;
    }
    // One shape defines the cut, the way a clipping mask works everywhere else: when several items are
    // selected, the newest (topmost) one becomes the mask and the others are clipped into it.
    // paper writes no <clipPath> at all when more than one sibling claims to be a mask, so this is not
    // a stylistic choice, measured, with all eight items of the default ball costume selected.
    // A mask is never drawn itself, so on a one-shape costume "Mask" would empty the canvas and look
    // like lost art; the button stays greyed out until there is a second shape to cut.
    function canMask () {
        return selectedPaths().length > 0 && artItems().length > 1;
    }
    function setMask (on) {
        var p = paper();
        var items = selectedPaths();
        if (!p || !items.length || (on && !canMask())) return false;
        var top = topOf(items);
        // an older mask outside the current selection would silence the whole clip, so release it
        artItems().forEach(function (item) {
            if (item.clipMask && items.indexOf(item) < 0) item.clipMask = false;
        });
        items.forEach(function (item) {
            item.clipMask = on && item === top;
        });
        p.view.update();
        return commit();
    }
    function isMasked () {
        return selectedPaths().some(function (item) {
            return !!item.clipMask;
        });
    }
    function setMiter (limit, live) {
        return eachSelected(function (item) {
            item.miterLimit = limit;
        }, live);
    }
    function miterOfSelection () {
        var items = selectedPaths();
        return items.length ? Number(items[0].miterLimit) || 10 : 10;
    }

    // Only the layers that really hold art are kept: the editor paints its selection outlines and
    // handles into layers of their own, and those must never end up inside an exported file.
    function artLayers (p, on) {
        var names = [];
        Array.prototype.forEach.call(p.project.layers, function (layer) {
            var data = layer.data || {};
            var art = !!(data.isPaintingLayer || data.isRasterLayer);
            if (on) {
                layer.__adoxWas = layer.visible;
                layer.visible = art;
            } else layer.visible = layer.__adoxWas;
            if (art) names.push(layer);
        });
        return names;
    }
    function artBox (p) {
        var art = artLayers(p, true);
        var box = null;
        // the editor keeps a locked guide shape inside the painting layer, so the box has to
        // be built from the real art items, layer.bounds would always report the whole canvas
        art.forEach(function (layer) {
            Array.prototype.forEach.call(layer.children, function (item) {
                if (item.guide || !item.visible) return;
                var b = item.bounds;
                if (b && b.width && b.height) box = box ? box.unite(b) : b.clone();
            });
        });
        return box;
    }
    function artSvg () {
        var p = paper();
        if (!p) return null;
        var svg = null;
        // paper exports the *viewport* by default: its root <g> carries the pan offset and the zoom
        // scale, so patching a project-space viewBox onto that string crops empty canvas (measured:
        // 0 ink pixels). Asking for the art box keeps the output view-independent.
        try {
            var box = artBox(p);
            if (box) svg = p.project.exportSVG({asString: true, bounds: [box.x, box.y, box.width, box.height]});
        } finally {
            artLayers(p, false);
        }
        return svg;
    }
    // Scratch can hand out an SVG for a vector costume, never a transparent PNG. Rasterising our own
    // keeps the alpha channel: the empty corners of the drawing come out as alpha 0.
    function exportPng (scale) {
        var svg = artSvg();
        if (!svg) return false;
        var url = window.URL.createObjectURL(new window.Blob([svg], {type: 'image/svg+xml;charset=utf-8'}));
        var img = new window.Image();
        img.onload = function () {
            // a browser canvas past ~16000 px a side comes out blank, so a 4x on huge art is
            // stepped down instead of handing the person an empty file
            var side = Math.max(img.width, img.height) * scale;
            var fit = side > 16000 ? 16000 / side : 1;
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale * fit));
            canvas.height = Math.max(1, Math.round(img.height * scale * fit));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            window.URL.revokeObjectURL(url);
            var link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = 'adox' + (scale > 1 ? '-' + scale + 'x' : '') + '.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
        };
        img.onerror = function () {
            window.URL.revokeObjectURL(url);
            if (window.console) window.console.warn('ScratchDream PNG: taranamadı');
        };
        img.src = url;
        return true;
    }

    function gradientCss (p, stops, type) {
        var list = stops.map(function (s) {
            var c = new p.Color(s.c);
            return c.toCSS() + ' ' + Math.round(s.p * 1000) / 10 + '%';
        }).join(',');
        if (type === 'RADIAL') return 'radial-gradient(circle at 50% 50%,' + list + ')';
        return 'linear-gradient(' + (type === 'VERTICAL' ? '180deg' : '90deg') + ',' + list + ')';
    }

    function labelEl (text) {
        var l = document.createElement('div');
        l.className = 'adox-label';
        l.textContent = text;
        return l;
    }

    // ------------------------------------------- gradient strip inside the colour dialog
    // The dialog already owns the gradient type, the two end colours, the HSV sliders and the hex
    // field, so the strip adds only what it has no room for: a third and fourth colour, and stops
    // that sit away from the ends. One bar, three chips, one colour well, one apply.
    var gradStrip = null;
    var gradTarget = 'fill';
    var gradPick = 0;

    function pickerBody () {
        var body = document.querySelector('[class*="Popover-body"]');
        // the popover element is shared by every dialog; only the paint colour one carries this row
        if (!body || !body.querySelector('[class*="color-picker_gradient-picker-row"]')) return null;
        return body;
    }
    function gradBarCss () {
        var p = paper();
        var stops = gradStops(gradTarget);
        if (!p || !stops) return '';
        return gradientCss(p, stops, gradType(gradTarget) || 'VERTICAL');
    }
    function hex6 (css) {
        var p = paper();
        try {
            var c = new p.Color(css);
            return '#' + [c.red, c.green, c.blue].map(function (v) {
                var n = Math.round(clamp(v, 0, 1) * 255);
                return ('0' + n.toString(16)).slice(-2);
            }).join('');
        } catch (e) {
            return '#8899aa';
        }
    }

    // thumbs hold their own offsets, so crossing two of them must carry the middle colours along
    function orderOffsets (dragged) {
        var g = settings.grad;
        var rows = g.offsets.map(function (p, i) {
            return {p: p, i: i, extra: i > 0 && i < g.count - 1 ? i - 1 : -1};
        });
        rows.sort(function (a, b) { return a.p - b.p; });
        var extras = [];
        rows.forEach(function (row) {
            if (row.extra >= 0) extras.push(g.extras[row.extra]);
        });
        g.offsets = rows.map(function (row) { return row.p; });
        g.extras = extras;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].i === dragged) { gradPick = i; break; }
        }
    }

    function setStopCount (n) {
        var g = settings.grad;
        if (n === g.count || n < 2 || n > 4) return;
        var middles = [];
        for (var i = 1; i < g.count - 1; i++) middles.push({p: g.offsets[i], c: g.extras[i - 1]});
        if (n > g.count) {
            while (middles.length < n - 2) {
                // a new stop belongs in the widest gap; stacking two on one offset flattens the ramp
                var all = [g.offsets[0]].concat(middles.map(function (m) { return m.p; }),
                    [g.offsets[g.count - 1]]);
                var at = 0, gap = -1;
                for (i = 0; i < all.length - 1; i++) {
                    if (all[i + 1] - all[i] > gap) { gap = all[i + 1] - all[i]; at = i; }
                }
                middles.push({p: all[at] + gap / 2, c: '#8899aa'});
            }
            middles.sort(function (a, b) { return a.p - b.p; });
        }
        middles = middles.slice(0, n - 2);
        var first = g.offsets[0];
        var last = g.offsets[g.count - 1];
        g.count = n;
        g.offsets = [first].concat(middles.map(function (m) { return m.p; }), [last]);
        g.extras = middles.map(function (m) { return m.c; });
        gradPick = clamp(gradPick, 0, n - 1);
        saveSettings();
        buildThumbs();
        applyGradientToSelection();
        paintGradStrip();
    }

    function thumbDown (e) {
        e.preventDefault();
        e.stopPropagation();
        var g = settings.grad;
        var bar = gradStrip.bar;
        var thumb = e.currentTarget;
        var i = Number(thumb.dataset.i);
        var rect = bar.getBoundingClientRect();
        gradPick = i;
        paintGradStrip();
        var move = function (ev) {
            g.offsets[i] = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
            thumb.style.left = (g.offsets[i] * 100) + '%';
            bar.style.background = gradBarCss();
        };
        var up = function () {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            orderOffsets(i);
            saveSettings();
            // the dialog recolours the selection the moment a slider moves, so the strip does too
            applyGradientToSelection();
            buildThumbs();
            paintGradStrip();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    }

    function buildThumbs () {
        var g = settings.grad;
        var bar = gradStrip.bar;
        bar.textContent = '';
        for (var i = 0; i < g.count; i++) {
            var b = document.createElement('b');
            b.dataset.i = i;
            b.setAttribute('role', 'slider');
            b.setAttribute('aria-label', t('stops') + ' ' + (i + 1));
            b.addEventListener('pointerdown', thumbDown);
            bar.appendChild(b);
        }
    }

    function paintGradStrip () {
        if (!gradStrip || !gradStrip.el.isConnected) return;
        var g = settings.grad;
        gradStrip.bar.style.background = gradBarCss();
        Array.prototype.forEach.call(gradStrip.bar.childNodes, function (b, i) {
            b.style.left = (g.offsets[i] * 100) + '%';
            b.classList.toggle('adox-pick', i === gradPick);
        });
        Array.prototype.forEach.call(gradStrip.counts.children, function (b, i) {
            b.setAttribute('aria-pressed', String(g.count === i + 2));
        });
        var middle = gradPick > 0 && gradPick < g.count - 1;
        gradStrip.well.hidden = !middle;
        if (middle) gradStrip.well.value = hex6(g.extras[gradPick - 1]);
        gradStrip.apply.disabled = !selectedPaths().length;
    }

    function buildGradStrip (body) {
        var wrap = document.createElement('div');
        wrap.className = 'adox-gwrap';

        var bar = document.createElement('div');
        bar.className = 'adox-bar adox-gbar';
        bar.setAttribute('aria-label', t('gradient'));
        wrap.appendChild(bar);

        var foot = document.createElement('div');
        foot.className = 'adox-gfoot';
        var counts = document.createElement('div');
        counts.className = 'adox-seg adox-gcounts';
        [2, 3, 4].forEach(function (n) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = n;
            b.setAttribute('aria-label', t('stops') + ' ' + n);
            b.title = t('stops') + ' · ' + n;
            b.addEventListener('click', function () { setStopCount(n); });
            counts.appendChild(b);
        });
        var well = document.createElement('input');
        well.type = 'color';
        well.className = 'adox-gwell';
        well.setAttribute('aria-label', t('stops'));
        well.addEventListener('input', function () {
            settings.grad.extras[gradPick - 1] = well.value;
            saveSettings();
            gradStrip.bar.style.background = gradBarCss();
        });
        well.addEventListener('change', function () { applyGradientToSelection(); });
        var apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'adox-gapply';
        apply.textContent = t('apply');
        apply.addEventListener('click', function () {
            if (applyGradientToSelection()) paintGradStrip();
        });
        foot.appendChild(counts);
        foot.appendChild(well);
        foot.appendChild(apply);
        wrap.appendChild(foot);

        var row = body.querySelector('[class*="color-picker_gradient-picker-row"]');
        row.parentNode.insertBefore(wrap, row.nextSibling);
        gradStrip = {el: wrap, body: body, bar: bar, counts: counts, well: well, apply: apply};
        buildThumbs();
    }

    function syncGradStrip () {
        var body = pickerBody();
        if (!body) {
            gradStrip = null;
            return;
        }
        if (gradStrip && gradStrip.el.isConnected && gradStrip.body === body) {
            paintGradStrip();
            return;
        }
        gradStrip = null;
        buildGradStrip(body);
        applyTheme(gradStrip.el, readTheme());
        paintGradStrip();
    }

    function dropGradStrip () {
        if (gradStrip && gradStrip.el.isConnected) gradStrip.el.remove();
        gradStrip = null;
    }

    // the dialog opens on the fill or the outline chip, and that already says which channel the
    // stops belong to, no target switch of our own
    function watchColorTarget () {
        if (document.__adoxGrad) return;
        document.__adoxGrad = true;
        document.addEventListener('pointerdown', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('[class*="color-button_outline-swatch"]')) gradTarget = 'stroke';
            else if (t.closest('[class*="color-button_color-button-swatch"]')) gradTarget = 'fill';
            else return;
            gradPick = 0;
            window.setTimeout(syncGradStrip, 60);
        }, true);
    }


    // ------------------------------------------------------------- advanced box
    function showFxPanel (anchor) {
        var panel = toggleFor(anchor, 'fx', 'adox-fxbox');
        if (!panel) return;

        panel.appendChild(labelEl(t('mask')));
        var masks = document.createElement('div');
        masks.className = 'adox-grid adox-maskrow';
        [['on', t('mask')], ['off', t('maskOff')]].forEach(function (row) {
            var b = cell(row[1], demoMask(row[0] === 'on') + '<span>' + row[1] + '</span>');
            b.dataset.mask = row[0];
            b.addEventListener('click', function () {
                setMask(row[0] === 'on');
                markFx();
            });
            masks.appendChild(b);
        });
        panel.appendChild(masks);

        panel.appendChild(labelEl(t('blend')));
        var grid = document.createElement('div');
        grid.className = 'adox-grid adox-blends';
        BLENDS.forEach(function (mode) {
            var b = cell(mode, demoBlend(mode) + '<span>' + mode.replace(/-/g, ' ') + '</span>');
            b.dataset.blend = mode;
            b.addEventListener('click', function () {
                applyBlend(mode);
                markFx();
            });
            grid.appendChild(b);
        });
        panel.appendChild(grid);

        var row = document.createElement('div');
        row.className = 'adox-row';
        row.innerHTML = '<span class="adox-tag">' + t('joint') + '</span>' +
            '<i class="adox-demo adox-corner"><svg viewBox="0 0 30 24" aria-hidden="true">' +
            '<path d="M3 21 15 3 27 21"/></svg></i>';
        var corner = row.querySelector('path');
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 1;
        slider.max = 10;
        slider.step = 0.1;
        slider.value = miterOfSelection();
        slider.setAttribute('aria-label', t('joint'));
        var out = document.createElement('output');
        out.textContent = Number(slider.value).toFixed(1);
        slider.addEventListener('input', function () {
            out.textContent = Number(slider.value).toFixed(1);
            corner.setAttribute('stroke-miterlimit', slider.value);
            setMiter(Number(slider.value), true);
        });
        slider.addEventListener('change', function () {
            setMiter(Number(slider.value));
        });
        corner.setAttribute('stroke-miterlimit', slider.value);
        row.appendChild(slider);
        row.appendChild(out);
        panel.appendChild(row);

        var div = document.createElement('div');
        div.className = 'adox-div';
        panel.appendChild(div);

        panel.appendChild(labelEl(t('png')));
        var pngs = document.createElement('div');
        pngs.className = 'adox-seg';
        pngs.style.marginTop = '.3rem';
        [1, 2, 4].forEach(function (scale) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = scale === 1 ? '1×' : scale + '×';
            b.dataset.scale = scale;
            b.title = t('png') + ' ' + scale + '×';
            b.addEventListener('click', function () {
                settings.pngScale = scale;
                saveSettings();
                exportPng(scale);
                markFx();
            });
            pngs.appendChild(b);
        });
        panel.appendChild(pngs);
        panel.appendChild(keyRow(['Alt+M', 'Alt+B', 'Alt+J', 'Alt+X']));
        markFx();
    }

    // the box mirrors the selection, and the selection changes while the panel sits open
    function markFx () {
        if (!openPanel || openPanel._adoxKind !== 'fx') return;
        var some = selectedPaths().length > 0;
        var blend = blendOfSelection();
        var masked = isMasked();
        var maskable = canMask();
        var vector = !isBitmapFormat();
        Array.prototype.forEach.call(openPanel.querySelectorAll('[data-blend]'), function (b) {
            var on = some && b.dataset.blend === blend;
            b.classList.toggle('adox-on', on);
            b.setAttribute('aria-pressed', String(on));
        });
        Array.prototype.forEach.call(openPanel.querySelectorAll('[data-mask]'), function (b) {
            var on = some && (b.dataset.mask === 'on') === masked;
            b.classList.toggle('adox-on', on);
            b.setAttribute('aria-pressed', String(on));
        });
        var art = hasArt();
        Array.prototype.forEach.call(openPanel.querySelectorAll('[data-scale]'), function (b) {
            b.setAttribute('aria-pressed', String(Number(b.dataset.scale) === settings.pngScale));
            b.disabled = !art;
            b.title = art ? t('png') + ' ' + b.dataset.scale + '×' : t('empty');
        });
        var slider = openPanel.querySelector('.adox-row input[type=range]');
        if (slider && document.activeElement !== slider) {
            slider.value = miterOfSelection();
            slider.nextSibling.textContent = Number(slider.value).toFixed(1);
            var corner = openPanel.querySelector('.adox-corner path');
            if (corner) corner.setAttribute('stroke-miterlimit', slider.value);
        }
        Array.prototype.forEach.call(openPanel.querySelectorAll('[data-blend], [data-mask]'), function (b) {
            var ready = some && (b.dataset.mask !== 'on' || maskable);
            // a bitmap costume has no selectable vector items, so "select a shape" would be a lie
            var why = !vector ? t('vectorOnly') : some ? t('maskAlone') : t('nothing');
            b.disabled = !ready;
            b.title = ready ? b.textContent : why;
        });
    }

    // the editor changes the selection without telling us. waiting for the 900 ms poll would leave
    // the mask and blend buttons greyed out right after Ctrl+A, so re-read on the key or click that
    // caused the change; the colour panel is left alone because repainting it mid-drag moves handles.
    function refreshPanels () {
        // the box is placed against the drawing surface, so whenever anything is touched it is
        // asked again: the canvas rect moves with the editor's own zoom and with a window resize
        if (openPanel && document.contains(openPanel._adoxAnchor)) fitPanel(openPanel);
        if (openPanel && openPanel._adoxKind === 'fx') window.setTimeout(markFx, 0);
        if (railEl) window.setTimeout(markObjects, 0);
    }

    // ------------------------------------------------------------------ objects
    // A Scratch costume keeps every vector item in one painting layer, so this box lists that
    // layer's contents the way Illustrator lists a layer: top of the drawing first.
    function objectList () {
        var layer = paintingLayer(), out = [];
        if (!layer) return out;
        (function walk (node) {
            if (node.guide) return;                       // the editor's locked 1440x1080 guide shape
            if (node.className === 'CompoundPath') {
                out.push(node);
                return;
            }
            if (node !== layer && (!node.children || !node.children.length)) {
                out.push(node);
                return;
            }
            if (node.children) node.children.forEach(walk);
        })(layer);
        out.reverse();
        return out;
    }
    function kindName (item) {
        var cls = item.className;
        if (cls === 'Group') return t('group');
        if (cls === 'PointText' || cls === 'Text') return t('text');
        if (cls === 'Raster') return t('raster');
        if (cls === 'CompoundPath') return t('compound');
        return t('path');
    }
    function objectName (item, index, total) {
        return item.name || (kindName(item) + ' ' + (total - index));
    }
    // a row that selects has to leave the editor in its select tool, otherwise the next brush
    // stroke drops the selection the row just made. The selector answers with every tool button in
    // the row and the editor owns their order; measured on the live editor the select tool is the
    // first of them, which is the only reason picking the first match is the right one.
    function useSelectTool () {
        if (/^SELECT/.test((paintState() || {}).mode || '')) return;
        var native = document.querySelector('[class*="mode-selector"] [class*="mod-tool-select"]');
        if (native && !native.classList.contains('adox-tool')) native.click();
    }
    function selectObject (item) {
        var p = paper();
        if (!p) return false;
        // paper selects a locked item when asked, but selectedPaths() skips locked, so the row
        // would light up with every action button dead and no reason given
        if (item.locked) return false;
        useSelectTool();
        objectList().forEach(function (it) { it.selected = false; });
        item.selected = true;
        p.view.update();
        return true;
    }
    function toggleSelectObject (item) {
        var p = paper();
        if (!p) return false;
        if (item.locked) return false;
        useSelectTool();
        item.selected = !item.selected;
        p.view.update();
        return true;
    }
    function reorderObjects (dir) {
        var p = paper();
        var items = selectedPaths();
        if (!p || !items.length) return false;
        var list = objectList();
        if (!list.length) return false;
        if (dir === 'front') {
            items.forEach(function (it) { it.bringToFront(); });
        } else if (dir === 'back') {
            var bottomItem = list[list.length - 1];
            if (bottomItem) {
                for (var bIdx = items.length - 1; bIdx >= 0; bIdx--) {
                    var it = items[bIdx];
                    if (it !== bottomItem) {
                        it.insertBelow(bottomItem);
                        bottomItem = it;
                    }
                }
            }
        } else if (dir === 'forward') {
            items.forEach(function (it) {
                var idx = list.indexOf(it);
                if (idx > 0) {
                    var above = list[idx - 1];
                    if (items.indexOf(above) < 0) it.insertAbove(above);
                }
            });
        } else if (dir === 'backward') {
            for (var i = items.length - 1; i >= 0; i--) {
                var it = items[i];
                var idx = list.indexOf(it);
                if (idx >= 0 && idx < list.length - 1) {
                    var below = list[idx + 1];
                    if (items.indexOf(below) < 0) it.insertBelow(below);
                }
            }
        }
        p.view.update();
        commit();
        markObjects();
        return true;
    }
    function toggleObject (item, flag) {
        item[flag] = !item[flag];
        var p = paper();
        if (p) p.view.update();
        return commit();
    }
    function duplicateObjects () {
        var p = paper();
        var items = selectedPaths();
        if (!p || !items.length) return false;
        items.forEach(function (it) { it.selected = false; });
        var copies = items.map(function (item) {
            var copy = item.clone(false);
            copy.insertAbove(item);
            return copy;
        });
        copies.forEach(function (it) { it.selected = true; });
        p.view.update();
        return commit();
    }
    function deleteObjects () {
        var items = selectedPaths();
        if (!items.length) return false;
        items.forEach(function (item) { item.remove(); });
        var p = paper();
        if (p) p.view.update();
        return commit();
    }
    // align to the canvas, the way "align to artboard" works: one shape or ten, the selection's own
    // box lands on the canvas edge or centre
    // the stage is 480x360 and the paint project runs at 2x, so the artboard is always
    // 960x720 at the origin (measured: the raster layer's own bounds and the outline guide's
    // 965x725 rect). p.view.viewSize is the *visible* canvas in CSS pixels, it moves with the
    // window and ignores the artboard, which is why right/bottom alignment landed mid-costume.
    function artboardRect (p) {
        return new p.Rectangle(0, 0, 960, 720);
    }
    function alignObjects (where) {
        var p = paper();
        var items = selectedPaths();
        if (!p || !items.length) return false;
        var box = artboardRect(p);
        var b = null;
        items.forEach(function (item) {
            var r = item.bounds;
            b = b ? b.unite(r) : r.clone();
        });
        if (!b) return false;
        var dx = 0, dy = 0;
        if (where === 'left') dx = box.x - b.x;
        if (where === 'hcenter' || where === 'center') dx = box.x + (box.width - b.width) / 2 - b.x;
        if (where === 'right') dx = box.x + box.width - (b.x + b.width);
        if (where === 'top') dy = box.y - b.y;
        if (where === 'vcenter' || where === 'center') dy = box.y + (box.height - b.height) / 2 - b.y;
        if (where === 'bottom') dy = box.y + box.height - (b.y + b.height);
        items.forEach(function (item) {
            item.position = item.position.add(new p.Point(dx, dy));
        });
        p.view.update();
        return commit();
    }
    function rotateObjects (deg) {
        return eachSelected(function (item) { item.rotate(deg); });
    }
    function setObjectOpacity (value, live) {
        return eachSelected(function (item) {
            item.opacity = value / 100;
        }, live);
    }
    function opacityOfSelection () {
        var items = selectedPaths();
        if (!items.length) return 100;
        var value = items[0].opacity;
        return Math.round((value === undefined ? 1 : value) * 100);
    }

    var OBJ_GLYPH = {
        eye: '<path d="M2.6 10S5.3 5.5 10 5.5 17.4 10 17.4 10 14.7 14.5 10 14.5 2.6 10 2.6 10z"/>' +
            '<circle cx="10" cy="10" r="2.1"/>',
        eyeOff: '<path d="M3.6 3.6 16.4 16.4"/><path d="M7.2 7.1C4.4 8.3 2.6 10 2.6 10s2.7 4.5 7.4 4.5' +
            'c1 0 1.9-.2 2.7-.6"/><path d="M10 5.5c4.7 0 7.4 4.5 7.4 4.5s-.8 1.4-2.3 2.6"/>',
        lock: '<rect x="4.6" y="8.8" width="10.8" height="7.8" rx="1.4"/>' +
            '<path d="M7.2 8.8V6.7a2.8 2.8 0 0 1 5.6 0v2.1"/>',
        unlock: '<rect x="4.6" y="8.8" width="10.8" height="7.8" rx="1.4"/>' +
            '<path d="M7.2 8.8V6.7a2.8 2.8 0 0 1 5.2-1.2"/>',
        left: '<path d="M3.2 2.6v14.8"/><rect x="6.4" y="6.2" width="10" height="7.6" rx="1"/>',
        hcenter: '<path d="M10 2.6v14.8"/><rect x="4.8" y="6.2" width="10.4" height="7.6" rx="1"/>',
        right: '<path d="M16.8 2.6v14.8"/><rect x="3.6" y="6.2" width="10" height="7.6" rx="1"/>',
        top: '<path d="M2.6 3.2h14.8"/><rect x="6.2" y="6.4" width="7.6" height="10" rx="1"/>',
        vcenter: '<path d="M2.6 10h14.8"/><rect x="6.2" y="4.8" width="7.6" height="10.4" rx="1"/>',
        bottom: '<path d="M2.6 16.8h14.8"/><rect x="6.2" y="3.6" width="7.6" height="10" rx="1"/>',
        center: '<circle cx="10" cy="10" r="6.6"/><path d="M10 1.6v3.2M10 15.2v3.2M1.6 10h3.2M15.2 10h3.2"/>',
        rotL: '<path d="M4.8 10a5.2 5.2 0 1 1 5.2 5.2"/><path d="M4.8 6.4v3.6h3.6"/>',
        rotR: '<path d="M15.2 10A5.2 5.2 0 1 0 10 15.2"/><path d="M15.2 6.4v3.6h-3.6"/>',
        front: '<path d="M4 3.5h12M10 7.5v9M6.5 11l3.5-3.5 3.5 3.5"/>',
        forward: '<path d="M10 4.5v11M6.5 8l3.5-3.5 3.5 3.5"/>',
        backward: '<path d="M10 15.5v-11M6.5 12l3.5 3.5 3.5-3.5"/>',
        back: '<path d="M4 16.5h12M10 12.5v-9M6.5 9l3.5 3.5 3.5-3.5"/>',
        dup: '<rect x="3.4" y="3.4" width="8.8" height="8.8" rx="1.4"/>' +
            '<path d="M7.4 13.4v1.6a1.6 1.6 0 0 0 1.6 1.6h4.4a1.6 1.6 0 0 0 1.6-1.6v-4.4a1.6 1.6 0 0 0-1.6-1.6h-1.6"/>',
        del: '<path d="M3.4 5.8h13.2"/><path d="M6.6 5.8V4h6.8v1.8"/>' +
            '<path d="M5 5.8 5.9 16.4h8.2L15 5.8"/><path d="M8.4 8.6v5M11.6 8.6v5"/>',
        pin: '<path d="M7.4 3.4h5.2l-1 4.4 2.4 2.8H6l2.4-2.8z"/><path d="M10 10.6v6"/>'
    };
    function miniButton (inner, title) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'adox-mini';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = icon(inner);
        return b;
    }
    function objectRow (item, index, total) {
        var row = document.createElement('div');
        row.className = 'adox-obj' + (item.selected ? ' adox-on' : '') + (item.visible ? '' : ' adox-dim');
        var eye = miniButton(item.visible ? OBJ_GLYPH.eye : OBJ_GLYPH.eyeOff,
            t(item.visible ? 'hide' : 'show'));
        eye.addEventListener('click', function () {
            toggleObject(item, 'visible');
            markObjects();
        });
        var lock = miniButton(item.locked ? OBJ_GLYPH.lock : OBJ_GLYPH.unlock,
            t(item.locked ? 'unlock' : 'lock'));
        if (item.locked) lock.classList.add('adox-strong');
        lock.addEventListener('click', function () {
            toggleObject(item, 'locked');
            markObjects();
        });
        var name = document.createElement('button');
        name.type = 'button';
        name.className = 'adox-objname';
        name.textContent = objectName(item, index, total);
        name.title = name.textContent;
        name.addEventListener('click', function (e) {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                toggleSelectObject(item);
            } else {
                selectObject(item);
            }
            markObjects();
        });
        name.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            var input = railEl && railEl.querySelector('.adox-rname');
            if (input && !input.disabled) {
                input.focus();
                input.select();
            }
        });
        // the drawing is the label: picture first, then the name, then the two switches
        row.appendChild(objectThumb(item, 'adox-thumb'));
        row.appendChild(name);
        row.appendChild(eye);
        row.appendChild(lock);
        return row;
    }
    // a colour chip is how you find the shape you mean in a list of "Path 1..9"
    function objectColor (item) {
        // the rail can ask again after the editor dropped an item, and that used to be the
        // "Cannot read properties of null (reading 'fillColor')" in the console
        if (!item) return '';
        var color = item.fillColor || item.strokeColor;
        var css = '';
        if (color && color.gradient && color.gradient.stops) {
            try {
                css = 'linear-gradient(135deg, ' + color.gradient.stops.map(function (s) {
                    return s.color && s.color.toCSS ? s.color.toCSS() : '#855cd6';
                }).join(', ') + ')';
            } catch (e) { css = ''; }
        }
        if (!css) {
            try {
                css = color && color.toCSS ? color.toCSS() : '';
            } catch (e) { css = ''; }
        }
        return css;
    }
    // the thumbnail is the shape itself, not its colour: a single-item export is bare geometry, or an
    // <svg> carrying its own <defs> when the fill is a gradient, so the viewBox is the item's bounds
    // and the paint scales into the box.
    function objectThumb (item, cls) {
        var el = document.createElement('i');
        el.className = cls;
        el.setAttribute('aria-hidden', 'true');
        var one = '';
        try { one = item.exportSVG({asString: true}); } catch (e) { one = ''; }
        if (one) {
            var b = item.bounds;
            var box = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"' +
                ' viewBox="' + [b.x, b.y, Math.max(b.width, 1), Math.max(b.height, 1)].join(' ') +
                '" preserveAspectRatio="xMidYMid meet">';
            one = /^<svg/i.test(one) ? one.replace(/^<svg[^>]*>/i, box) : box + one + '</svg>';
            el.style.backgroundImage = 'url("data:image/svg+xml;charset=utf-8,' +
                encodeURIComponent(one) + '")';
        } else {
            var css = objectColor(item);
            if (css) el.style.background = css; else el.classList.add('adox-swatch-empty');
        }
        el.classList.toggle('adox-off', !item.visible);
        return el;
    }
    function objectChip (item) {
        return objectThumb(item, 'adox-chip');
    }

    // ---------------------------------------------------------------- layer rail
    // A costume keeps every vector in one painting layer, so a layers panel has no room of its own
    // to ask for. The rail sits on the canvas's right edge as a thin spine of colour chips and opens
    // into the full list when the pointer reaches it, it never resizes the canvas, and it holds
    // every per-object action now that the box is gone.
    var railEl = null;

    function railRect () {
        var canvas = document.querySelector('canvas[class*="paper-canvas"]');
        var host = document.querySelector('[class*="paint-editor_canvas-container"]');
        var r = (host && host.getBoundingClientRect()) || (canvas && canvas.getBoundingClientRect());
        return r && r.width > 40 && r.height > 40 ? r : null;
    }

    function railRow (children, cls) {
        var row = document.createElement('div');
        row.className = cls || 'adox-rtools';
        children.forEach(function (b) { row.appendChild(b); });
        return row;
    }

    function buildRail () {
        var rail = document.createElement('div');
        rail.className = 'adox-rail';
        rail.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
        rail.setAttribute('aria-label', t('objects'));

        var spine = document.createElement('div');
        spine.className = 'adox-spine';
        spine.setAttribute('aria-hidden', 'true');
        rail.appendChild(spine);

        var head = document.createElement('div');
        head.className = 'adox-rhead';
        var title = document.createElement('span');
        title.textContent = t('objects');
        var count = document.createElement('span');
        count.className = 'adox-count';
        head.appendChild(title);
        head.appendChild(count);
        // hover alone is too easy to lose: the pin keeps the drawer open while you work
        var pin = miniButton(OBJ_GLYPH.pin, t('pin'));
        pin.setAttribute('aria-pressed', 'false');
        pin.addEventListener('click', function () {
            var on = rail.classList.toggle('adox-pin');
            pin.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        head.appendChild(pin);
        rail.appendChild(head);

        var list = document.createElement('div');
        list.className = 'adox-objs';
        rail.appendChild(list);

        // one line does the z-order and the two edits that need no numbers
        var acts = [];
        [['front', 'bringToFront', OBJ_GLYPH.front, function () { reorderObjects('front'); }],
            ['forward', 'bringForward', OBJ_GLYPH.forward, function () { reorderObjects('forward'); }],
            ['backward', 'sendBackward', OBJ_GLYPH.backward, function () { reorderObjects('backward'); }],
            ['back', 'sendToBack', OBJ_GLYPH.back, function () { reorderObjects('back'); }],
            ['dup', 'duplicate', OBJ_GLYPH.dup, duplicateObjects],
            ['del', 'Delete', OBJ_GLYPH.del, deleteObjects]].forEach(function (row) {
            var b = miniButton(row[2], row[0] === 'del'
                ? msg('paint.paintEditor.delete', 'Delete') : t(row[1]));
            b.dataset.order = row[0];
            b.addEventListener('click', function () {
                row[3]();
                markObjects();
            });
            acts.push(b);
        });
        rail.appendChild(railRow(acts));

        var aligns = [];
        [['left', 'alignLeft', OBJ_GLYPH.left], ['hcenter', 'alignCenterH', OBJ_GLYPH.hcenter],
            ['right', 'alignRight', OBJ_GLYPH.right], ['top', 'alignTop', OBJ_GLYPH.top],
            ['vcenter', 'alignCenterV', OBJ_GLYPH.vcenter], ['bottom', 'alignBottom', OBJ_GLYPH.bottom],
            ['center', 'alignCenter', OBJ_GLYPH.center]].forEach(function (row) {
            var b = miniButton(row[2], t(row[1]));
            b.dataset.align = row[0];
            b.addEventListener('click', function () {
                alignObjects(row[0]);
                markObjects();
            });
            aligns.push(b);
        });
        rail.appendChild(railRow(aligns));

        var last = [];
        [[-90, 'rotateLeft', OBJ_GLYPH.rotL], [90, 'rotateRight', OBJ_GLYPH.rotR]].forEach(function (row) {
            var b = miniButton(row[2], t(row[1]));
            b.dataset.rotate = row[0];
            b.addEventListener('click', function () {
                rotateObjects(row[0]);
                markObjects();
            });
            last.push(b);
        });
        // the name becomes the SVG id, so it survives in the file the project stores
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'adox-text adox-rname';
        nameInput.setAttribute('aria-label', t('name'));
        nameInput.addEventListener('change', function () {
            var items = selectedPaths();
            if (!items.length) return;
            var value = nameInput.value.replace(/\s+/g, ' ').trim();
            items.forEach(function (item) { item.name = value; });
            if (paper()) paper().view.update();
            commit();
            markObjects();
        });
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameInput.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                var s = selectedPaths()[0];
                nameInput.value = s ? (s.name || '') : '';
                nameInput.blur();
            }
        });
        last.push(nameInput);
        rail.appendChild(railRow(last, 'adox-rtools adox-rspin'));

        var opRange = document.createElement('input');
        opRange.type = 'range';
        opRange.min = 0;
        opRange.max = 100;
        opRange.step = 1;
        opRange.setAttribute('aria-label', t('opacity'));
        var opOut = document.createElement('output');
        opRange.addEventListener('input', function () {
            opOut.textContent = opRange.value + '%';
            if (selectedPaths().length) setObjectOpacity(Number(opRange.value), true);
        });
        opRange.addEventListener('change', function () {
            if (selectedPaths().length) setObjectOpacity(Number(opRange.value));
        });
        rail.appendChild(railRow([opRange, opOut], 'adox-rops'));

        document.body.appendChild(rail);
        return rail;
    }

    function destroyRail () {
        if (!railEl) return;
        railEl.remove();
        railEl = null;
    }

    function syncRail () {
        var r = feat('rail') && paintEditorOpen() && paper() && !isBitmapFormat() ? railRect() : null;
        if (!r) {
            destroyRail();
            return;
        }
        if (!railEl) railEl = buildRail();
        applyTheme(railEl, readTheme());
        railEl.style.top = Math.round(r.top) + 'px';
        // the drawer is as tall as its own rows, never a full-canvas column of empty space
        railEl.style.maxHeight = Math.round(r.height) + 'px';
        railEl.style.right = Math.round(window.innerWidth - r.right) + 'px';
        markObjects();
    }

    // the rail follows the drawing: rows, spine chips, count, name field, opacity, enabled actions
    function colorSig (col) {
        if (!col) return '-';
        if (col.gradient && col.gradient.stops) {
            try {
                return col.gradient.stops.map(function (s) {
                    return s.color && s.color.toCSS ? s.color.toCSS() : '?';
                }).join(',');
            } catch (e) { return '?'; }
        }
        try { return col.toCSS() || '?'; } catch (e) { return '?'; }
    }
    function markObjects () {
        if (!railEl || !railEl.isConnected) return;
        var items = objectList();
        var total = items.length;
        var list = railEl.querySelector('.adox-objs');
        var spine = railEl.querySelector('.adox-spine');
        if (list) {
            // the signature is what a thumbnail is drawn from; selection is not in it, because
            // clicking a row must not re-export every shape in the costume
            var sig = items.map(function (it) {
                var b = it.bounds;
                return it.id + '|' + (it.name || '') + '|' + (it.visible ? 1 : 0) + '|' +
                    (it.locked ? 1 : 0) + '|' + colorSig(it.fillColor) + '>' + colorSig(it.strokeColor) +
                    '|' + Math.round(b.x) + ' ' + Math.round(b.y) + ' ' +
                    Math.round(b.width) + ' ' + Math.round(b.height);
            }).join('/');
            if (list._adoxSig !== sig) {
                var prevScroll = list.scrollTop;
                list._adoxSig = sig;
                list.textContent = '';
                if (spine) spine.textContent = '';
                items.forEach(function (item, i) {
                    list.appendChild(objectRow(item, i, total));
                    if (spine) spine.appendChild(objectChip(item));
                });
                list.scrollTop = prevScroll;
            }
            Array.prototype.forEach.call(list.children, function (row, i) {
                var it = items[i];
                if (!it) return;
                row.classList.toggle('adox-on', !!it.selected);
                row.classList.toggle('adox-dim', !it.visible);
            });
            if (spine) Array.prototype.forEach.call(spine.children, function (chip, i) {
                chip.classList.toggle('adox-on', !!(items[i] && items[i].selected));
            });
        }
        var count = railEl.querySelector('.adox-count');
        if (count) count.textContent = String(total);
        var sel = selectedPaths()[0];
        var some = !!sel;
        var nameInput = railEl.querySelector('.adox-rname');
        if (nameInput) {
            nameInput.disabled = !some;
            if (document.activeElement !== nameInput) nameInput.value = sel ? (sel.name || '') : '';
        }
        var opRange = railEl.querySelector('.adox-rops input[type=range]');
        if (opRange) {
            opRange.disabled = !some;
            if (document.activeElement !== opRange) {
                opRange.value = opacityOfSelection();
                if (opRange.nextSibling) opRange.nextSibling.textContent = opRange.value + '%';
            }
        }
        Array.prototype.forEach.call(railEl.querySelectorAll('.adox-rtools .adox-mini'), function (b) {
            b.disabled = !some;
        });
    }

    function showShapePanel (anchor) {
        var panel = toggleFor(anchor, 'shape', 'adox-wide');
        if (!panel) return;

        // size and rounding first: they must stay visible while picking a shape
        panel.appendChild(sliderRow(GLYPH.size, 40, 400, 4, 'shapeSize', refreshPreview));
        panel.appendChild(sliderRow(GLYPH.round, 0, 40, 1, 'shapeRound', refreshPreview));

        var grid = document.createElement('div');
        grid.className = 'adox-grid';
        SHAPES.forEach(function (shape) {
            var b = cell(nameOf(shape), shapeIcon(shape));
            b.dataset.shape = shape.id;
            b.addEventListener('click', function () {
                // nothing is drawn yet: the shape is armed and the canvas takes over from here
                shaper.arm(shape);
                closePanel();
                previewShape(shape);
            });
            b.addEventListener('mouseenter', function () {
                previewShape(shape);
            });
            b.addEventListener('focus', function () {
                previewShape(shape);
            });
            b.addEventListener('mouseleave', clearShapePreview);
            b.addEventListener('blur', clearShapePreview);
            grid.appendChild(b);
        });
        panel.appendChild(grid);
        panel.appendChild(keyRow([GLYPH.undo, 'Ctrl', 'Z']));
    }

    function refreshNibUi () {
        if (!openPanel) return;
        var cells = openPanel.querySelectorAll('.adox-nib');
        if (!cells.length) return;
        var size = currentNibSize();
        var eraser = isEraserMode();
        for (var i = 0; i < cells.length; i++) {
            var on = Number(cells[i].dataset.size) === size;
            cells[i].classList.toggle('adox-on', on);
            var mark = cells[i].firstChild;
            mark.className = eraser ? 'adox-ring' : 'adox-dot';
            var px = clamp(Number(cells[i].dataset.size) * (eraser ? 0.34 : 0.28), 4, 22);
            mark.style.width = px + 'px';
            mark.style.height = px + 'px';
        }
        var slider = openPanel.querySelector('.adox-nib-slider');
        if (slider && document.activeElement !== slider) {
            slider.value = size;
            slider.nextSibling.textContent = size;
        }
    }

    function showNibPanel (anchor) {
        var panel = toggleFor(anchor, 'nib');
        if (!panel) return;

        var grid = document.createElement('div');
        grid.className = 'adox-grid adox-nibs';
        NIBS.forEach(function (nib) {
            var b = cell(nameOf(nib) + ' · ' + nib.size, '');
            b.className = 'adox-cell adox-nib';
            b.dataset.size = nib.size;
            var dot = document.createElement('span');
            dot.className = isEraserMode() ? 'adox-ring' : 'adox-dot';
            var num = document.createElement('span');
            num.className = 'adox-nib-num';
            num.textContent = nib.size;
            b.appendChild(dot);
            b.appendChild(num);
            b.addEventListener('click', function () {
                applyNib(nib.size);
            });
            grid.appendChild(b);
        });
        panel.appendChild(grid);

        var row = document.createElement('div');
        row.className = 'adox-row';
        row.innerHTML = GLYPH.nib;
        var input = document.createElement('input');
        input.type = 'range';
        input.min = 1;
        input.max = 100;
        input.className = 'adox-nib-slider';
        input.value = currentNibSize();
        input.setAttribute('aria-label', t('size'));
        var out = document.createElement('output');
        out.textContent = currentNibSize();
        input.addEventListener('input', function () {
            out.textContent = input.value;
            applyNib(Number(input.value));
        });
        row.appendChild(input);
        row.appendChild(out);
        panel.appendChild(row);
        panel.appendChild(keyRow(['[', ']', GLYPH.wheel, 'Alt']));
        refreshNibUi();
    }

    // ------------------------------------------------------------------- pen
    var pen = {
        active: false,
        profile: null,
        button: null,
        points: [],
        preview: null,

        activate: function (profile) {
            this.deactivate();
            shaper.disarm();
            if (!paper()) return;
            this.active = true;
            this.profile = profile;
            this.armedInMode = (paintState() || {}).mode;
            document.addEventListener('pointerdown', this.onDown, true);
            markArmed(this.button, true);
            refreshToolLabels();
        },
        deactivate: function () {
            document.removeEventListener('pointerdown', this.onDown, true);
            markArmed(this.button, false);
            if (!this.active) return;
            this.active = false;
            this.endStroke();
            this.clearPreview();
            this.points = [];
            refreshToolLabels();
        },
        clearPreview: function () {
            if (this.preview) {
                this.preview.remove();
                this.preview = null;
            }
        },
        widthAt: function (t, pressure, angle) {
            var prof = this.profile;
            var base = settings.penSize;
            var pr = settings.penPressure ? clamp(pressure, 0.05, 1) : 0.6;
            var width = base * (prof.min + (1 - prof.min) * Math.pow(pr, prof.exponent));
            if (prof.chisel) {
                // broad-nib: strokes perpendicular to the nib are thick
                var nib = -Math.PI / 5;
                width *= 0.3 + 0.7 * Math.abs(Math.sin(angle - nib));
            }
            var taper = prof.taper * Math.sin(Math.PI * clamp(t, 0, 1));
            return Math.max(0.6, width * (1 - taper * 0.6));
        },
        toProject: function (e) {
            var p = paper();
            var canvas = document.querySelector('canvas[class*="paper-canvas"]');
            if (!p || !canvas) return null;
            var rect = canvas.getBoundingClientRect();
            return p.project.view.viewToProject(new p.Point(e.clientX - rect.left, e.clientY - rect.top));
        },
        onDown: function (e) {
            if (!pen.active) return;
            var canvas = e.target && e.target.closest ? e.target.closest('canvas[class*="paper-canvas"]') : null;
            if (!canvas) return;
            // the press means "draw now": the box that armed the pen has no business staying up
            closePanel();
            e.stopPropagation();
            e.preventDefault();
            var point = pen.toProject(e);
            if (!point) return;
            pen.points = [{x: point.x, y: point.y, p: e.pressure || 0.5}];
            document.addEventListener('pointermove', pen.onMove, true);
            document.addEventListener('pointerup', pen.onUp, true);
            document.addEventListener('pointercancel', pen.onUp, true);
        },
        onMove: function (e) {
            if (!pen.active || !pen.points.length) return;
            e.stopPropagation();
            var raw = pen.toProject(e);
            if (!raw) return;
            var last = pen.points[pen.points.length - 1];
            var k = 1 - pen.profile.smoothing;
            var x = last.x + (raw.x - last.x) * k;
            var y = last.y + (raw.y - last.y) * k;
            if (Math.hypot(x - last.x, y - last.y) < 1.2) return;
            pen.points.push({x: x, y: y, p: e.pressure || last.p});
            pen.drawPreview();
        },
        onUp: function (e) {
            if (e) e.stopPropagation();
            document.removeEventListener('pointermove', pen.onMove, true);
            document.removeEventListener('pointerup', pen.onUp, true);
            document.removeEventListener('pointercancel', pen.onUp, true);
            pen.endStroke();
        },
        outline: function () {
            var pts = this.points;
            if (pts.length < 2) return [];
            var left = [];
            var right = [];
            for (var i = 0; i < pts.length; i++) {
                var prev = pts[Math.max(0, i - 1)];
                var next = pts[Math.min(pts.length - 1, i + 1)];
                var dx = next.x - prev.x;
                var dy = next.y - prev.y;
                var angle = Math.atan2(dy, dx);
                var len = Math.hypot(dx, dy) || 1;
                var nx = -dy / len;
                var ny = dx / len;
                var half = this.widthAt(i / (pts.length - 1), pts[i].p, angle) / 2;
                left.push([pts[i].x + nx * half, pts[i].y + ny * half]);
                right.push([pts[i].x - nx * half, pts[i].y - ny * half]);
            }
            return left.concat(right.reverse());
        },
        drawPreview: function () {
            var p = paper();
            var pts = this.outline();
            if (!p || pts.length < 4) return;
            this.clearPreview();
            var layer = guideLayer();
            if (!layer) return;
            var accent = (openPanel && openPanel._adoxAccent) || '#575e75';
            var path = new p.Path(pts);
            path.closed = true;
            path.strokeColor = new p.Color(accent);
            path.strokeWidth = 1 / p.view.zoom;
            path.fillColor = new p.Color(accent).clone({alpha: 0.15});
            path.guide = true;
            path.locked = true;
            path._adoxGhost = true;
            layer.addChild(path);
            this.preview = path;
        },
        endStroke: function () {
            var p = paper();
            var pts = this.outline();
            this.clearPreview();
            if (!p || pts.length < 4) {
                this.points = [];
                return;
            }
            var path = new p.Path(pts);
            path.closed = true;
            path.strokeCap = 'round';
            path.strokeJoin = 'round';
            applyStyle(path, false);
            if (!path.fillColor) {
                var cFall = currentColors();
                if (cFall.stroke) path.fillColor = cFall.stroke;
                else {
                    var sSt = store();
                    var pcol = (sSt && sSt.getState().scratchPaint && sSt.getState().scratchPaint.color) || {};
                    path.fillColor = colorOf(pcol.fillColor) || colorOf(pcol.strokeColor) || (p ? new p.Color('#855cd6') : null);
                }
            }
            if (!path.fillColor) {
                path.remove();
                this.points = [];
                return;
            }
            // the bitmap costume has no vector layer to hold a path, so the stroke is flattened
            if (isBitmapFormat()) {
                bakeIntoRaster(path);
                this.points = [];
                return;
            }
            var layer = paintingLayer();
            if (!layer) {
                path.remove();
                this.points = [];
                return;
            }
            layer.activate();
            layer.addChild(path);
            path.selected = true;
            dispatch({type: 'scratch-paint/select/CHANGE_SELECTED_ITEMS', selectedItems: [path], bitmapMode: false});
            p.view.update();
            if (!commit()) path.remove();
            this.points = [];
        }
    };

    function showPenPanel (anchor) {
        var panel = toggleFor(anchor, 'pen');
        if (!panel) return;

        var grid = document.createElement('div');
        grid.className = 'adox-grid adox-pens';
        PENS.forEach(function (profile) {
            var b = cell(nameOf(profile), nibSwatch(profile));
            b.className = 'adox-cell adox-pen';
            b.dataset.pen = profile.id;
            b.addEventListener('click', function () {
                settings.pen = profile.id;
                saveSettings();
                pen.activate(profile);
                markPens();
            });
            grid.appendChild(b);
        });
        panel.appendChild(grid);

        var off = document.createElement('button');
        off.type = 'button';
        off.className = 'adox-cell adox-off';
        off.textContent = t('off');
        off.addEventListener('click', function () {
            pen.deactivate();
            markPens();
        });
        panel.appendChild(off);

        panel.appendChild(sliderRow(GLYPH.nib, 2, 120, 1, 'penSize', function () {
            pen.drawPreview();
        }));

        var press = document.createElement('label');
        press.className = 'adox-row';
        var text = document.createElement('span');
        text.className = 'adox-name';
        text.textContent = t('pressure');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = settings.penPressure;
        box.addEventListener('change', function () {
            settings.penPressure = box.checked;
            saveSettings();
        });
        press.appendChild(text);
        press.appendChild(box);
        panel.appendChild(press);

        panel.appendChild(keyRow([GLYPH.undo, 'Ctrl', 'Z']));

        function markPens () {
            var buttons = grid.querySelectorAll('.adox-pen');
            for (var i = 0; i < buttons.length; i++) {
                buttons[i].classList.toggle('adox-on', pen.active && buttons[i].dataset.pen === settings.pen);
            }
        }
        markPens();
    }

    // ------------------------------------------------------------------- pixel
    // A separate mode, not a popover squeezed into the tool rail. The costume is rasterised once,
    // the artist paints on an integer grid, and Apply writes back filled vector squares. Because
    // every move is whole-pixel, the two-sided alpha halo cannot be created; the same halo that a
    // bitmap move may already have left behind is detected and cleaned when the mode opens.
    // above this side length the mode samples the costume down first: painting a 4k grid
    // repainted whole on every stroke is not something a laptop survives
    var PX_MAX_SIDE = 1024;
    var pxEd = null;
    var pxBtn = null;
    var pageToastEl = null;
    var pageToastTimer = 0;

    function pageToast (text, bad) {
        if (!text) return;
        if (!pageToastEl) {
            pageToastEl = document.createElement('div');
            pageToastEl.className = 'adox-toast';
            document.body.appendChild(pageToastEl);
        }
        pageToastEl.textContent = text;
        pageToastEl.classList.toggle('adox-bad', !!bad);
        pageToastEl.classList.add('adox-on');
        window.clearTimeout(pageToastTimer);
        pageToastTimer = window.setTimeout(function () {
            if (pageToastEl) pageToastEl.classList.remove('adox-on');
        }, 2400);
    }

    function pxNativeButton () {
        // the icon <img> shares the button prefix; only the container with the underscore suffix
        // is the clickable convert control, and our clone sits before it in the same row
        var all = document.querySelectorAll('[class*="paint-editor_bitmap-button"]');
        for (var i = 0; i < all.length; i++) {
            var node = all[i], cls = String(node.className || '');
            if (node.classList.contains('adox-px-btn') || /-icon/.test(cls)) continue;
            return node.tagName === 'BUTTON' ? node : (node.querySelector('button') || node);
        }
        return null;
    }

    // Scratch rasterises vector art at 960x720 with soft edges, so zooming a freshly converted
    // bitmap shows a gradient instead of pixels. The grid is chosen from the art itself, not from
    // a fixed 2x2: the thinnest visible stroke decides how coarse one pixel may be, the way
    // pixel-art rasterisers keep a one-pixel line alive. Everything below that ratio is hardened.
    function pxStrokeWidth (d, w, minX, minY, maxX, maxY) {
        var gaps = [];
        var strong = function (i, j) {
            return Math.max(Math.abs(d[i] - d[j]), Math.abs(d[i + 1] - d[j + 1]),
                Math.abs(d[i + 2] - d[j + 2])) >= 64 && d[i + 3] > 20 && d[j + 3] > 20;
        };
        for (var y = minY; y <= maxY; y++) {
            var last = -99;
            for (var x = minX; x < maxX; x++) {
                var i = (y * w + x) * 4;
                if (!strong(i, i + 4)) continue;
                var g = x - last;
                if (g >= 2 && g <= 32) gaps.push(g);
                last = x;
            }
        }
        for (var xx = minX; xx <= maxX; xx++) {
            var lastY = -99;
            for (var yy = minY; yy < maxY; yy++) {
                var j = (yy * w + xx) * 4;
                if (!strong(j, j + w * 4)) continue;
                var gy = yy - lastY;
                if (gy >= 2 && gy <= 32) gaps.push(gy);
                lastY = yy;
            }
        }
        if (gaps.length < 8) return 8;
        gaps.sort(function (a, b) { return a - b; });
        // the lower quartile: one stray whisker must not force the whole costume to 1:1, but a
        // costume made of thin strokes must not be ground down either
        return gaps[Math.floor(gaps.length * 0.25)];
    }

    function snapBitmapPixels () {
        var t0 = anchorTarget();
        var raster = rasterItem();
        if (!t0 || !raster || !raster.canvas) return null;
        var cv = raster.canvas, w = cv.width, h = cv.height;
        if (!w || !h) return null;
        var ctx, img;
        try {
            ctx = cv.getContext('2d', {willReadFrequently: true});
            img = ctx.getImageData(0, 0, w, h);
        } catch (e) {
            return null;
        }
        var d = img.data;
        var minX = w, minY = h, maxX = -1, maxY = -1;
        var freq = {};
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var i0 = (y * w + x) * 4;
                if (!d[i0 + 3]) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                var fk = (d[i0] << 16) | (d[i0 + 1] << 8) | d[i0 + 2];
                freq[fk] = (freq[fk] || 0) + 1;
            }
        }
        if (maxX < 0) return null;

        // The raster is always twice the costume's own units (2x import on the 960x720 artboard),
        // so only two ratios are exact: 1:1 keeps the raster resolution while hairline strokes
        // need it, and 2:2 is one costume unit per pixel once every stroke is at least two units
        // thick. Coarser buckets have no basis in the source grid and start dropping detail.
        var stroke = pxStrokeWidth(d, w, minX, minY, maxX, maxY);
        var res = stroke >= 5 ? 2 : 1;
        var ratio = res === 1 ? '1:1' : '2x2';
        var changed = 0;

        if (res === 1) {
            // no resampling at all: keep every pixel, remove the transparent rim and the blends,
            // then pull the anti-aliased colours back to the art's own palette
            changed = pxFixAlpha(img);
            changed += pxHardColors(img, freq);
        } else {
            minX -= minX % res;
            minY -= minY % res;
            maxX = Math.min(w - 1, maxX + (res - 1 - (maxX % res)));
            maxY = Math.min(h - 1, maxY + (res - 1 - (maxY % res)));
            for (var by = minY; by <= maxY; by += res) {
                for (var bx = minX; bx <= maxX; bx += res) {
                    // A thin dark stroke that only grazes a block must not vanish into the fill:
                    // following the thin-line rule, the block takes the stroke colour instead of
                    // the majority, so contours stay continuous instead of turning into dots.
                    var buckets = {}, bucketList = [];
                    for (var yy = by; yy < Math.min(by + res, h); yy++) {
                        for (var xx = bx; xx < Math.min(bx + res, w); xx++) {
                            var bi = (yy * w + xx) * 4;
                            if (!d[bi + 3]) continue;
                            var bk = ((d[bi] >> 3) << 10) | ((d[bi + 1] >> 3) << 5) | (d[bi + 2] >> 3);
                            var bucket = buckets[bk];
                            if (!bucket) {
                                bucket = buckets[bk] = {n: 0, i: bi, a: 0};
                                bucketList.push(bucket);
                            }
                            bucket.n++;
                            if (d[bi + 3] > bucket.a) { bucket.a = d[bi + 3]; bucket.i = bi; }
                        }
                    }
                    bucketList.sort(function (a, b) { return b.n - a.n; });
                    var best = bucketList.length ? bucketList[0].i : -1;
                    var bestA = bucketList.length ? bucketList[0].a : -1;
                    if (bucketList.length > 1 && best >= 0) {
                        var second = bucketList[1], total = 0;
                        bucketList.forEach(function (b) { total += b.n; });
                        var lum = function (i) { return d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; };
                        var contrast = Math.max(Math.abs(d[best] - d[second.i]),
                            Math.abs(d[best + 1] - d[second.i + 1]), Math.abs(d[best + 2] - d[second.i + 2]));
                        if (second.n <= total * .55 && contrast >= 96 && lum(second.i) + 16 < lum(best)) {
                            best = second.i;
                        }
                    }
                    var solid = bestA > 20;
                    var r = solid ? d[best] : 0, g = solid ? d[best + 1] : 0, b = solid ? d[best + 2] : 0;
                    var alpha = solid ? 255 : 0;
                    for (yy = by; yy < Math.min(by + res, h); yy++) {
                        for (xx = bx; xx < Math.min(bx + res, w); xx++) {
                            var j = (yy * w + xx) * 4;
                            if (d[j] === r && d[j + 1] === g && d[j + 2] === b && d[j + 3] === alpha) continue;
                            d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = alpha;
                            changed++;
                        }
                    }
                }
            }
        }
        if (changed) {
            ctx.putImageData(img, 0, 0);
            commit();
        }
        return {changed: changed, ratio: ratio};
    }

    function waitForBitmap (tries) {
        if (!feat('pixel')) return;
        var raster = rasterItem();
        if (!isBitmapFormat() || !raster || !raster.canvas || !raster.canvas.width) {
            if (tries < 80) window.setTimeout(function () { waitForBitmap(tries + 1); }, 100);
            return;
        }
        window.setTimeout(function () {
            if (!isBitmapFormat()) return;
            var snap = snapBitmapPixels();
            if (snap && snap.changed) pageToast(t('bitmapSnapped').replace('{ratio}', snap.ratio));
        }, 160);
    }

    function hookConversion (native) {
        if (!native || native._adoxSnap) return;
        native._adoxSnap = true;
        native.addEventListener('click', function () {
            // only vector -> bitmap; bitmap -> vector is our own conversion path
            if (!feat('pixel') || isBitmapFormat()) return;
            window.setTimeout(function () { waitForBitmap(0); }, 120);
        });
    }

    // The third option beside Convert to Bitmap / Convert to Vector. It is a clone of the editor's
    // own button, so its size, radius, accent and hover come from the site stylesheet.
    function syncPixelButton () {
        var native = pxNativeButton();
        if (!feat('pixel') || !paintEditorOpen() || !native) {
            if (pxBtn) { pxBtn.remove(); pxBtn = null; }
            if (!feat('pixel')) closePixelEditor();
            return;
        }
        if (!pxBtn || !pxBtn.isConnected) {
            // keep the site's own button class so padding, radius, font and hover come with it
            pxBtn = native.cloneNode(true);
            pxBtn.classList.add('adox-px-btn');
            pxBtn.removeAttribute('data-testid');
            pxBtn.removeAttribute('aria-pressed');
            if (!pxBtn.getAttribute('tabindex')) pxBtn.setAttribute('tabindex', '0');
            var img = pxBtn.querySelector('img');
            if (img) img.src = PX_BUTTON_ICON;
            var span = pxBtn.querySelector('span');
            if (!span) {
                span = document.createElement('span');
                pxBtn.appendChild(span);
            }
            pxBtn.addEventListener('click', openPixelEditor);
            pxBtn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPixelEditor();
                }
            });
            native.parentElement.insertBefore(pxBtn, native);
        }
        hookConversion(native);
        var label = pxBtn.querySelector('span');
        if (label) label.textContent = t('pixelOpen');
        pxBtn.title = t('pixelArt');
        pxBtn.setAttribute('aria-label', t('pixelArt'));
        pxBtn.dataset.adoxPixel = '1';
    }

    function ensureVectorCostume () {
        if (!isBitmapFormat()) return Promise.resolve(true);
        var native = pxNativeButton();
        if (!native) return Promise.resolve(false);
        native.click();
        var tries = 0;
        return new Promise(function (res) {
            var iv = window.setInterval(function () {
                tries++;
                if (!isBitmapFormat()) {
                    window.clearInterval(iv);
                    res(true);
                } else if (tries > 60) {
                    window.clearInterval(iv);
                    res(false);
                }
            }, 100);
        });
    }

    // The costume's own SVG, drawn at its own float size (capped), so one grid pixel is exactly
    // one costume unit and the vector squares can be written back without a coordinate guess.
    function rasterizeCostume () {
        var target = anchorTarget();
        if (!target) return Promise.resolve(null);
        var costume = target.getCostumes()[target.currentCostume];
        if (!costume) return Promise.resolve(null);
        var raw = costume.asset && (costume.asset.data !== undefined ? costume.asset.data : costume.asset);
        var txt = typeof raw === 'string' ? raw : (raw ? new TextDecoder().decode(raw) : '');
        if (!txt) return Promise.resolve(null);
        var w = Number((/\swidth="([\d.]+)"/.exec(txt) || [])[1]) || 0;
        var h = Number((/\sheight="([\d.]+)"/.exec(txt) || [])[1]) || 0;
        var s = Math.min(1, PX_MAX_SIDE / Math.max(w, h, 1));
        return new Promise(function (res) {
            var img = new Image();
            img.onload = function () {
                var W = Math.max(1, Math.round((w || img.naturalWidth) * s));
                var H = Math.max(1, Math.round((h || img.naturalHeight) * s));
                var cv = document.createElement('canvas');
                cv.width = W;
                cv.height = H;
                var ctx = cv.getContext('2d', {willReadFrequently: true});
                ctx.clearRect(0, 0, W, H);
                ctx.imageSmoothingEnabled = s < 1;
                ctx.drawImage(img, 0, 0, W, H);
                res({canvas: cv, ctx: ctx, W: W, H: H, s: s, target: target, costume: costume,
                    costumeW: w || (costume.size && costume.size[0]) || W,
                    costumeH: h || (costume.size && costume.size[1]) || H});
            };
            img.onerror = function () { res(null); };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
        });
    }

    function pxBounds (data, w, h) {
        var minX = w, minY = h, maxX = -1, maxY = -1;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if (!data[(y * w + x) * 4 + 3]) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        return maxX < 0 ? null : {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1};
    }

    // Faint alpha around a moved or resized bitmap is the residue the Discord report described.
    // Below the threshold it is invisible, so it becomes 0; the opaque core snaps to 255; and a
    // faint pixel touching at least two empty neighbours is a halo ring, not art, so it goes too.
    function pxFixAlpha (img) {
        var d = img.data, w = img.width, h = img.height;
        var before = new Uint8Array(w * h);
        var semi = [];
        var p, i;
        for (p = 0; p < w * h; p++) before[p] = d[p * 4 + 3];
        for (p = 0; p < w * h; p++) {
            var a = before[p];
            if (!a) continue;
            // pixel art has no half-transparent edge: anything above the halo threshold is solid
            if (a <= 20) {
                d[p * 4 + 3] = 0;
            } else {
                d[p * 4 + 3] = 255;
                if (a < 235) semi.push(p);
            }
        }
        // A moved bitmap selection leaves a one-pixel halo of half-alpha outside its own edge. A
        // pixel that is faint and touches at least two empty neighbours is that halo, not art.
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var k = y * w + x;
                var pa = before[k];
                if (!pa || pa >= 200) continue;
                var empty = 0;
                if (x === 0 || !before[k - 1]) empty++;
                if (x === w - 1 || !before[k + 1]) empty++;
                if (y === 0 || !before[k - w]) empty++;
                if (y === h - 1 || !before[k + w]) empty++;
                if (empty >= 2) d[k * 4 + 3] = 0;
            }
        }
        // What survives is an anti-aliased fringe along the art's own edge. Its RGB was blended
        // with the transparent pixels beside it, so turning it opaque would paint a dark rim.
        // Copying the nearest truly opaque neighbour keeps the silhouette and drops the rim.
        var R1 = [-1, 0, 1, -1, 1, -1, 0, 1];
        var C1 = [-1, -1, -1, 0, 0, 1, 1, 1];
        for (i = 0; i < semi.length; i++) {
            p = semi[i];
            if (!d[p * 4 + 3]) continue;
            var sx = p % w, sy = (p - sx) / w;
            var found = -1;
            for (var radius = 1; radius <= 2 && found < 0; radius++) {
                for (var q = 0; q < 8; q++) {
                    var nx = sx + R1[q] * radius, ny = sy + C1[q] * radius;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    var nk = ny * w + nx;
                    if (before[nk] >= 235 && d[nk * 4 + 3]) { found = nk; break; }
                }
            }
            if (found >= 0) {
                d[p * 4] = d[found * 4];
                d[p * 4 + 1] = d[found * 4 + 1];
                d[p * 4 + 2] = d[found * 4 + 2];
            }
        }
        var changed = 0;
        for (p = 0; p < w * h; p++) {
            if (before[p] !== d[p * 4 + 3]) changed++;
        }
        return changed;
    }

    function pxNearColor (d, j, r, g, b) {
        return d[j + 3] === 255 && Math.abs(d[j] - r) <= 12 &&
            Math.abs(d[j + 1] - g) <= 12 && Math.abs(d[j + 2] - b) <= 12;
    }

    // Hard alpha is not enough for line art: a 1.4-unit stroke imported at 2x has no fully
    // opaque core, so at high zoom the line fades into a dotted gradient. The palette is rebuilt
    // from flat interior pixels only (an anti-aliased blend never has four matching neighbours),
    // then every blended pixel returns to the nearest palette colour. A pixel that is at least
    // 35% stroke keeps the stroke colour, the thin-line rule used by line-art pixelators, so a
    // hairline stays continuous instead of breaking into dots.
    function pxHardColors (img, freq) {
        var d = img.data, w = img.width, h = img.height, n = w * h;
        var flat = {}, x, y, i, key;
        for (y = 1; y < h - 1; y++) {
            for (x = 1; x < w - 1; x++) {
                i = (y * w + x) * 4;
                if (d[i + 3] !== 255) continue;
                var r = d[i], g = d[i + 1], b = d[i + 2];
                if (!pxNearColor(d, i - 4, r, g, b) || !pxNearColor(d, i + 4, r, g, b) ||
                    !pxNearColor(d, i - w * 4, r, g, b) || !pxNearColor(d, i + w * 4, r, g, b)) continue;
                key = (r << 16) | (g << 8) | b;
                flat[key] = (flat[key] || 0) + 1;
            }
        }
        var list = [];
        for (key in flat) {
            if (flat[key] >= 12 && freq[key]) list.push({c: Number(key), n: freq[key]});
        }
        if (list.length < 2) {
            for (key in freq) if (freq[key] >= 12) list.push({c: Number(key), n: freq[key]});
        }
        if (list.length < 2) return 0;
        list.sort(function (a, b) { return b.n - a.n; });
        list = list.slice(0, 24);
        var pal = [], q;
        for (q = 0; q < list.length; q++) {
            pal.push({r: (list[q].c >> 16) & 255, g: (list[q].c >> 8) & 255, b: list[q].c & 255});
        }
        var changed = 0, cache = {};
        for (var p = 0; p < n; p++) {
            i = p * 4;
            if (!d[i + 3]) continue;
            r = d[i]; g = d[i + 1]; b = d[i + 2];
            key = (r << 16) | (g << 8) | b;
            var choice = cache[key];
            if (choice === undefined) {
                var best = -1, second = -1, d1 = Infinity, d2 = Infinity;
                for (q = 0; q < pal.length; q++) {
                    var P = pal[q];
                    var dd = (r - P.r) * (r - P.r) + (g - P.g) * (g - P.g) + (b - P.b) * (b - P.b);
                    if (dd < d1) { d2 = d1; second = best; d1 = dd; best = q; }
                    else if (dd < d2) { d2 = dd; second = q; }
                }
                var pick = best;
                if (best === 0 && second > 0) {
                    var A = pal[0], B = pal[second];
                    var ux = B.r - A.r, uy = B.g - A.g, uz = B.b - A.b;
                    var len = ux * ux + uy * uy + uz * uz;
                    if (len > 900) {
                        var tt = ((r - A.r) * ux + (g - A.g) * uy + (b - A.b) * uz) / len;
                        var ox = r - (A.r + tt * ux), oy = g - (A.g + tt * uy), oz = b - (A.b + tt * uz);
                        if (tt >= 0.35 && ox * ox + oy * oy + oz * oz < len * 0.05) pick = second;
                    }
                }
                choice = (best < 0 || d1 === 0) ? -1 : pick;
                cache[key] = choice;
            }
            if (choice < 0) continue;
            var C = pal[choice];
            if (r !== C.r || g !== C.g || b !== C.b) {
                d[i] = C.r; d[i + 1] = C.g; d[i + 2] = C.b; d[i + 3] = 255;
                changed++;
            }
        }
        return changed;
    }

    function pxHasArt (img) {
        var d = img.data;
        for (var i = 3; i < d.length; i += 4) if (d[i]) return true;
        return false;
    }

    function pxPalette (img, count) {
        var d = img.data, hits = {}, out = [];
        for (var i = 0; i < d.length; i += 40) {
            if (d[i + 3] < 64) continue;
            var key = (d[i] >> 4) + '.' + (d[i + 1] >> 4) + '.' + (d[i + 2] >> 4);
            var hit = hits[key] || (hits[key] = {n: 0, r: d[i], g: d[i + 1], b: d[i + 2]});
            hit.n++;
        }
        Object.keys(hits).sort(function (a, b) { return hits[b].n - hits[a].n; }).slice(0, count)
            .forEach(function (k) {
                var h = hits[k];
                var hex = '#' + [h.r, h.g, h.b].map(function (v) {
                    var s = v.toString(16);
                    return s.length < 2 ? '0' + s : s;
                }).join('');
                out.push(hex);
            });
        return out;
    }

    // the convert row sits on the editor's accent blue, so this icon is drawn in white like theirs
    var PX_BUTTON_ICON = 'data:image/svg+xml;base64,' + window.btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 20 20">' +
        '<g fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>' +
        '<rect x="7.3" y="7.3" width="5.4" height="5.4" rx=".4"/></g></svg>');

    var PX_ICONS = {
        t_brush: icon('<path d="M4.5 15.6c1.4-4.7 5.4-9.1 11.1-10.1-1.3 5.7-5.7 9.5-11.1 10.1z"/>' +
            '<path d="M4.5 15.6l2.5-2.5"/>'),
        t_pencil: icon('<path d="M4 16l1.7-4.5L13 4.2l2.8 2.8-7.3 7.3z"/><path d="M11.6 5.6l2.8 2.8"/>'),
        t_eraser: icon('<path d="M4.2 13.6l6.1-6.1 4.1 4.1-6.1 6.1H5.6z"/><path d="M9.4 16.1h6.2"/>'),
        t_fill: icon('<path d="M8.4 3.6l6.4 6.4-5.1 5.1a1.9 1.9 0 0 1-2.7 0L3.1 11.2z"/>' +
            '<path d="M4.4 10h9.4"/><path d="M16.2 12.9c.8 1.2 1.2 2 1.2 2.6a1.2 1.2 0 1 1-2.4 0c0-.6.4-1.4 1.2-2.6z"/>'),
        t_line: icon('<path d="M4 16L16 4"/>'),
        t_rect: icon('<rect x="4" y="5.5" width="12" height="9" rx=".6"/>'),
        t_ellipse: icon('<ellipse cx="10" cy="10" rx="6.2" ry="4.6"/>'),
        t_picker: icon('<path d="M13.4 3.4l3.2 3.2-8.8 8.8-3.8.7.7-3.8z"/><path d="M11.8 5l3.2 3.2"/>'),
        t_move: icon('<path d="M10 3v14M3 10h14M7.2 5.8L10 3l2.8 2.8M7.2 14.2L10 17l2.8-2.8"/>' +
            '<path d="M5.8 7.2L3 10l2.8 2.8M14.2 7.2L17 10l-2.8 2.8"/>')
    };
    var PX_TOOLS = [
        ['brush', 't_brush', 'brush'], ['pencil', 't_pencil', 'pencil'], ['eraser', 't_eraser', 'eraser'],
        ['fill', 't_fill', 'fill'], ['line', 't_line', 'line'], ['rect', 't_rect', 'rect'],
        ['ellipse', 't_ellipse', 'ellipse'], ['picker', 't_picker', 'picker'], ['move', 't_move', 'move']
    ];

    function pxSnapshot (ed) {
        return new ImageData(new Uint8ClampedArray(ed.grid.data), ed.w, ed.h);
    }
    function pxPush (ed) {
        ed.undo.push(pxSnapshot(ed));
        if (ed.undo.length > 40) ed.undo.shift();
        ed.redo = [];
        pxUpdateButtons(ed);
    }
    function pxUpdateButtons (ed) {
        if (ed.btnUndo) ed.btnUndo.disabled = !ed.undo.length;
        if (ed.btnRedo) ed.btnRedo.disabled = !ed.redo.length;
    }
    function pxGet (ed, x, y) {
        if (x < 0 || y < 0 || x >= ed.w || y >= ed.h) return null;
        var i = (y * ed.w + x) * 4, d = ed.grid.data;
        return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }
    function pxSet (ed, x, y, c) {
        if (x < 0 || y < 0 || x >= ed.w || y >= ed.h) return;
        var i = (y * ed.w + x) * 4, d = ed.grid.data;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
    function pxSame (a, b) {
        return a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    function pxStamp (ed, x, y, size, c) {
        var half = Math.floor((size - 1) / 2);
        for (var dy = 0; dy < size; dy++) {
            for (var dx = 0; dx < size; dx++) pxSet(ed, x - half + dx, y - half + dy, c);
        }
    }
    function pxLine (ed, x0, y0, x1, y1, c) {
        var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        var err = dx + dy;
        for (;;) {
            pxStamp(ed, x0, y0, ed.size, c);
            if (x0 === x1 && y0 === y1) break;
            var e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
        }
    }
    function pxFlood (ed, x, y, c) {
        var target = pxGet(ed, x, y);
        if (!target || pxSame(target, c)) return;
        var stack = [[x, y]], seen = new Uint8Array(ed.w * ed.h);
        while (stack.length) {
            var point = stack.pop(), px = point[0], py = point[1];
            if (px < 0 || py < 0 || px >= ed.w || py >= ed.h) continue;
            var k = py * ed.w + px;
            if (seen[k]) continue;
            if (!pxSame(pxGet(ed, px, py), target)) continue;
            seen[k] = 1;
            pxSet(ed, px, py, c);
            stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
        }
    }
    function pxEllipse (ed, x0, y0, x1, y1, c, filled) {
        var left = Math.min(x0, x1), right = Math.max(x0, x1);
        var top = Math.min(y0, y1), bottom = Math.max(y0, y1);
        var cx = (left + right) / 2, cy = (top + bottom) / 2;
        var rx = Math.max(0.5, (right - left + 1) / 2), ry = Math.max(0.5, (bottom - top + 1) / 2);
        for (var y = top; y <= bottom; y++) {
            var dy = (y - cy) / ry;
            var span = Math.sqrt(Math.max(0, 1 - dy * dy));
            var xa = Math.round(cx - span * rx), xb = Math.round(cx + span * rx);
            if (filled) {
                for (var x = xa; x <= xb; x++) pxSet(ed, x, y, c);
            } else {
                pxSet(ed, xa, y, c);
                pxSet(ed, xb, y, c);
            }
        }
        if (!filled) {
            for (var ix = left; ix <= right; ix++) {
                var dx = (ix - cx) / rx;
                var sp = Math.sqrt(Math.max(0, 1 - dx * dx));
                pxSet(ed, ix, Math.round(cy - sp * ry), c);
                pxSet(ed, ix, Math.round(cy + sp * ry), c);
            }
        }
    }
    function pxBox (ed, x0, y0, x1, y1, c, filled) {
        var left = Math.min(x0, x1), right = Math.max(x0, x1);
        var top = Math.min(y0, y1), bottom = Math.max(y0, y1);
        for (var y = top; y <= bottom; y++) {
            for (var x = left; x <= right; x++) {
                if (filled || x === left || x === right || y === top || y === bottom) pxSet(ed, x, y, c);
            }
        }
    }

    function pxRender (ed) {
        if (!ed || !ed.root.isConnected) return;
        var zoom = ed.zoom, w = ed.w, h = ed.h;
        var cv = ed.canvas;
        cv.width = Math.max(1, w * zoom);
        cv.height = Math.max(1, h * zoom);
        var ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ed.tmp.width = w;
        ed.tmp.height = h;
        ed.tmp.getContext('2d').putImageData(ed.grid, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(ed.tmp, 0, 0, cv.width, cv.height);
        if (ed.gridOn && zoom >= 4) {
            ctx.beginPath();
            ctx.strokeStyle = ed.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
            ctx.lineWidth = 1;
            for (var x = 0; x <= w; x++) {
                var vx = x * zoom + 0.5;
                ctx.moveTo(vx, 0);
                ctx.lineTo(vx, h * zoom);
            }
            for (var y = 0; y <= h; y++) {
                var vy = y * zoom + 0.5;
                ctx.moveTo(0, vy);
                ctx.lineTo(w * zoom, vy);
            }
            ctx.stroke();
        }
        if (ed.zoomOut) ed.zoomOut.textContent = zoom + '×';
    }

    function pxFit (ed) {
        var stage = ed.stage.getBoundingClientRect();
        var fit = Math.floor(Math.min((stage.width - 30) / ed.w, (stage.height - 30) / ed.h));
        ed.zoom = Math.max(1, Math.min(32, fit || 1));
        pxRender(ed);
    }
    function pxZoom (ed, dir) {
        var steps = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32];
        var i = 0;
        while (i < steps.length - 1 && steps[i] < ed.zoom) i++;
        if (dir > 0) i = Math.min(steps.length - 1, i + 1);
        else i = Math.max(0, i - 1);
        ed.zoom = steps[i];
        pxRender(ed);
    }

    function pxPoint (ed, e) {
        var r = ed.canvas.getBoundingClientRect();
        var x = Math.floor((e.clientX - r.left) / ed.zoom);
        var y = Math.floor((e.clientY - r.top) / ed.zoom);
        if (x < 0 || y < 0 || x >= ed.w || y >= ed.h) return null;
        return {x: x, y: y};
    }

    function pxToolColor (ed, tool) {
        if (tool === 'eraser') return [0, 0, 0, 0];
        return ed.rgba;
    }

    function pxDown (ed, e) {
        if (e.button !== 0 || ed.busy) return;
        var p = pxPoint(ed, e);
        if (!p) return;
        e.preventDefault();
        ed.canvas.setPointerCapture(e.pointerId);
        var tool = ed.tool;
        if (tool === 'picker') {
            var c = pxGet(ed, p.x, p.y);
            if (c && c[3]) {
                ed.color = '#' + [c[0], c[1], c[2]].map(function (v) {
                    var s = v.toString(16);
                    return s.length < 2 ? '0' + s : s;
                }).join('');
                ed.colorInput.value = ed.color;
                ed.rgba = [c[0], c[1], c[2], 255];
                ed.note.textContent = ed.color.toUpperCase();
            }
            return;
        }
        pxPush(ed);
        ed.gesture = {tool: tool, start: p, last: p, base: pxSnapshot(ed)};
        if (tool === 'move') {
            ed.gesture.box = pxBounds(ed.grid.data, ed.w, ed.h);
            ed.note.textContent = t('pixelHelp');
            return;
        }
        var color = pxToolColor(ed, tool);
        if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
            pxLine(ed, p.x, p.y, p.x, p.y, color);
        } else if (tool === 'fill') {
            pxFlood(ed, p.x, p.y, color);
        }
        pxRender(ed);
    }

    function pxMove (ed, e) {
        if (!ed.gesture) return;
        var p = pxPoint(ed, e);
        if (!p) return;
        var g = ed.gesture;
        var tool = g.tool;
        if (tool === 'move') {
            if (!g.box) return;
            var dx = p.x - g.start.x, dy = p.y - g.start.y;
            dx = clamp(dx, -g.box.x, ed.w - g.box.x - g.box.w);
            dy = clamp(dy, -g.box.y, ed.h - g.box.y - g.box.h);
            var out = new Uint8ClampedArray(ed.w * ed.h * 4);
            var src = g.base.data;
            for (var y = 0; y < ed.h; y++) {
                for (var x = 0; x < ed.w; x++) {
                    var i = (y * ed.w + x) * 4;
                    if (!src[i + 3]) continue;
                    var tx = x + dx, ty = y + dy;
                    if (tx < 0 || ty < 0 || tx >= ed.w || ty >= ed.h) continue;
                    var j = (ty * ed.w + tx) * 4;
                    out[j] = src[i]; out[j + 1] = src[i + 1]; out[j + 2] = src[i + 2]; out[j + 3] = src[i + 3];
                }
            }
            ed.grid.data.set(out);
            pxRender(ed);
            return;
        }
        var color = pxToolColor(ed, tool);
        if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
            pxLine(ed, g.last.x, g.last.y, p.x, p.y, color);
            g.last = p;
        } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
            ed.grid.data.set(g.base.data);
            if (tool === 'line') pxLine(ed, g.start.x, g.start.y, p.x, p.y, color);
            else if (tool === 'rect') pxBox(ed, g.start.x, g.start.y, p.x, p.y, color, ed.filled);
            else pxEllipse(ed, g.start.x, g.start.y, p.x, p.y, color, ed.filled);
            g.last = p;
        }
        pxRender(ed);
    }

    function pxUp (ed) {
        if (!ed.gesture) return;
        var g = ed.gesture;
        ed.gesture = null;
        if (g.tool === 'move') return;
        if (g.tool === 'line' || g.tool === 'rect' || g.tool === 'ellipse') {
            // the shape was drawn from the pre-gesture copy on every move; keep the last frame
            pxRender(ed);
        }
        pxUpdateButtons(ed);
        ed.note.textContent = g.tool === 'brush' || g.tool === 'pencil' ? t('pixelHelp') : ed.note.textContent;
    }

    function pxUndo (ed) {
        if (!ed.undo.length) return;
        ed.redo.push(pxSnapshot(ed));
        ed.grid = ed.undo.pop();
        pxRender(ed);
        pxUpdateButtons(ed);
    }
    function pxRedo (ed) {
        if (!ed.redo.length) return;
        ed.undo.push(pxSnapshot(ed));
        ed.grid = ed.redo.pop();
        pxRender(ed);
        pxUpdateButtons(ed);
    }
    function pxNudge (ed, dx, dy) {
        var box = pxBounds(ed.grid.data, ed.w, ed.h);
        if (!box) return;
        dx = clamp(dx, -box.x, ed.w - box.x - box.w);
        dy = clamp(dy, -box.y, ed.h - box.y - box.h);
        if (!dx && !dy) return;
        pxPush(ed);
        var out = new Uint8ClampedArray(ed.w * ed.h * 4);
        var src = ed.grid.data;
        for (var y = 0; y < ed.h; y++) {
            for (var x = 0; x < ed.w; x++) {
                var i = (y * ed.w + x) * 4;
                if (!src[i + 3]) continue;
                var tx = x + dx, ty = y + dy;
                if (tx < 0 || ty < 0 || tx >= ed.w || ty >= ed.h) continue;
                var j = (ty * ed.w + tx) * 4;
                out[j] = src[i]; out[j + 1] = src[i + 1]; out[j + 2] = src[i + 2]; out[j + 3] = src[i + 3];
            }
        }
        ed.grid.data.set(out);
        pxRender(ed);
    }

    // One compound path per colour. Equal horizontal runs that continue on the next row are merged
    // vertically first, so a flat fill becomes a handful of tall rectangles instead of one row each.
    function pxVectorPaths (ed) {
        var d = ed.grid.data, w = ed.w, h = ed.h;
        var groups = {}, last = {}, rects = 0;
        for (var y = 0; y < h; y++) {
            var x = 0;
            while (x < w) {
                var i = (y * w + x) * 4;
                var a = d[i + 3];
                if (!a) { x++; continue; }
                var r = d[i], g = d[i + 1], b = d[i + 2];
                var x2 = x + 1;
                while (x2 < w) {
                    var j = (y * w + x2) * 4;
                    if (d[j + 3] !== a || d[j] !== r || d[j + 1] !== g || d[j + 2] !== b) break;
                    x2++;
                }
                var key = r + ',' + g + ',' + b + ',' + a;
                var group = groups[key] || (groups[key] = {r: r, g: g, b: b, a: a, rects: []});
                var runKey = key + '|' + x + '|' + (x2 - x);
                var open = last[runKey];
                if (open && open.y + open.h === y) {
                    open.h++;
                } else {
                    open = {x: x, y: y, w: x2 - x, h: 1};
                    group.rects.push(open);
                    last[runKey] = open;
                    rects++;
                }
                x = x2;
            }
        }
        var unit = ed.unit, offX = ed.offX, offY = ed.offY, x0 = ed.x0, y0 = ed.y0;
        return {count: rects, paths: Object.keys(groups).map(function (key) {
            var group = groups[key];
            var boxes = group.rects.map(function (rect) {
                return {
                    x: x0 + (offX + rect.x) * unit,
                    y: y0 + (offY + rect.y) * unit,
                    w: rect.w * unit,
                    h: rect.h * unit
                };
            });
            return {boxes: boxes, color: group, runs: group.rects.length};
        }).sort(function (a, b) { return a.runs - b.runs; })};
    }

    // The editor keeps its own selection in Redux; clearing the paper items under it would leave
    // stale ids behind, so the selection is dropped before the costume is rewritten.
    function pxClearSelection () {
        try {
            var state = store() && store().getState();
            var sel = state && state.scratchPaint && state.scratchPaint.selectedItems;
            if (sel && sel.length) {
                dispatch({type: 'scratch-paint/select/CHANGE_SELECTED_ITEMS', selectedItems: []});
            }
        } catch (e) { /* the editor owns its selection; failing to clear is not fatal */ }
    }

    function pxApply () {
        var ed = pxEd;
        if (!ed) return;
        if (ed.autoFixInput.checked) pxFixAlpha(ed.grid);
        if (!pxHasArt(ed.grid)) {
            ed.note.textContent = t('pixelEmpty');
            return;
        }
        var p = paper(), layer = paintingLayer();
        if (!p || !layer) {
            ed.note.textContent = t('pxFail');
            return;
        }
        var vector = pxVectorPaths(ed);
        if (!vector.paths.length) {
            ed.note.textContent = t('pixelEmpty');
            return;
        }
        // a single Path from multi-subpath data joins the rectangles into one connected outline, so
        // each colour is a CompoundPath whose children are the real rectangles
        // past roughly this many rectangles the write-back outlasts anyone's patience, so the
        // mode says so instead of holding the tab frozen while paper tries to build them
        if (vector.count > 30000) {
            ed.note.textContent = t('pxHeavy');
            return;
        }
        ed.busy = true;
        pxClearSelection();
        layer.children.slice().forEach(function (child) {
            if (!child.guide) child.remove();
        });
        var raster = findLayer('isRasterLayer');
        if (raster) raster.removeChildren();
        var added = [];
        vector.paths.forEach(function (g) {
            var kids = g.boxes.map(function (box) {
                return new p.Path({
                    segments: [[box.x, box.y], [box.x + box.w, box.y],
                        [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]],
                    closed: true,
                    insert: false
                });
            });
            var path = new p.CompoundPath({children: kids, insert: false});
            path.fillColor = new p.Color(g.color.r / 255, g.color.g / 255, g.color.b / 255, 1);
            path.strokeColor = null;
            path.strokeWidth = 0;
            path.fillRule = 'nonzero';
            layer.addChild(path);
            added.push(path);
        });
        layer.activate();
        p.view.update();
        if (!commit()) {
            added.forEach(function (a) { a.remove(); });
            ed.busy = false;
            ed.note.textContent = t('pxFail');
            return;
        }
        var target = ed.target;
        closePixelEditor();
        refreshAnchorView(target);
        pageToast(t('pxApplied'));
    }

    function closePixelEditor () {
        if (!pxEd) return;
        window.removeEventListener('keydown', pxEd.onKey, true);
        window.removeEventListener('resize', pxEd.onResize);
        pxEd.root.remove();
        pxEd = null;
    }

    function pxKeyDown (ed, e) {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) pxRedo(ed); else pxUndo(ed);
            }
            return;
        }
        var k = e.key.toLowerCase();
        if (k === 'escape') {
            e.preventDefault();
            closePixelEditor();
            return;
        }
        var map = {b: 'brush', p: 'pencil', e: 'eraser', g: 'fill', l: 'line', r: 'rect',
            o: 'ellipse', i: 'picker', v: 'move'};
        if (map[k]) {
            e.preventDefault();
            ed.setTool(map[k]);
            return;
        }
        if (k === '[' || k === ']') {
            e.preventDefault();
            ed.size = clamp(ed.size + (k === ']' ? 1 : -1), 1, 8);
            ed.sizeInput.value = ed.size;
            ed.sizeOut.textContent = ed.size;
            return;
        }
        if (k === '+' || k === '=') { e.preventDefault(); pxZoom(ed, 1); return; }
        if (k === '-') { e.preventDefault(); pxZoom(ed, -1); return; }
        if (e.key.indexOf('Arrow') === 0) {
            e.preventDefault();
            var dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
            var dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
            pxNudge(ed, dx, dy);
        }
    }

    function buildPixelEditor (src) {
        readLocale();
        var bounds = pxBounds(src.ctx.getImageData(0, 0, src.W, src.H).data, src.W, src.H);
        var offX, offY, w, h, grid;
        if (!bounds) {
            w = 64; h = 64;
            offX = Math.round((src.W - w) / 2);
            offY = Math.round((src.H - h) / 2);
            grid = new ImageData(w, h);
        } else {
            offX = bounds.x; offY = bounds.y; w = bounds.w; h = bounds.h;
            grid = src.ctx.getImageData(bounds.x, bounds.y, w, h);
        }
        var theme = readTheme();
        // scratch-paint imports a costume at twice its own units and centres it on a 960x720
        // artboard (view centre 480,360). Writing raw 0..w coordinates put the art in the top-left
        // corner; this is the same placement the editor itself used for the art we just measured.
        var unit = 2 / src.s;
        var x0 = 480 - src.costumeW;
        var y0 = 360 - src.costumeH;
        var root = document.createElement('div');
        root.className = 'adox-px';
        root.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
        applyTheme(root, theme);

        var ed = {
            root: root, src: src, target: src.target, costume: src.costume && src.costume.name,
            w: w, h: h, offX: offX, offY: offY, unit: unit, x0: x0, y0: y0,
            grid: grid, undo: [], redo: [], zoom: 1, tool: 'brush', color: '#4c97ff',
            rgba: [76, 151, 255, 255], size: 3, filled: true, gridOn: true, dark: theme.dark, gesture: null, busy: false,
            tmp: document.createElement('canvas')
        };

        // header
        var head = document.createElement('div');
        head.className = 'adox-px-head';
        var title = document.createElement('strong');
        title.textContent = t('pixelArt');
        var sub = document.createElement('span');
        sub.className = 'adox-px-sub';
        sub.textContent = t('pixelSub') + ' · ' + w + '×' + h;
        var undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'adox-px-icon';
        undo.title = t('undo');
        undo.setAttribute('aria-label', t('undo'));
        undo.innerHTML = GLYPH.undo;
        undo.addEventListener('click', function () { pxUndo(ed); });
        var redo = document.createElement('button');
        redo.type = 'button';
        redo.className = 'adox-px-icon';
        redo.title = t('redo');
        redo.setAttribute('aria-label', t('redo'));
        redo.innerHTML = icon('<path d="M16 8.5H7.5a4 4 0 1 0 0 8H13"/><path d="M16 8.5 13 5.5M16 8.5l-3 3"/>');
        redo.addEventListener('click', function () { pxRedo(ed); });
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'adox-px-icon adox-px-close';
        close.setAttribute('aria-label', t('close'));
        close.title = t('close');
        close.textContent = '✕';
        close.addEventListener('click', closePixelEditor);
        head.append(title, sub, undo, redo, close);

        // tools
        var tools = document.createElement('div');
        tools.className = 'adox-px-tools';
        var toolButtons = {};
        var setTool = function (id) {
            ed.tool = id;
            Object.keys(toolButtons).forEach(function (key) {
                toolButtons[key].classList.toggle('adox-on', key === id);
            });
            ed.canvas.style.cursor = id === 'move' ? 'grab' : id === 'picker' ? 'copy' : 'crosshair';
        };
        ed.setTool = setTool;
        PX_TOOLS.forEach(function (row) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'adox-px-tool';
            b.title = t(row[2]);
            b.setAttribute('aria-label', t(row[2]));
            b.dataset.tool = row[0];
            b.innerHTML = PX_ICONS[row[1]];
            b.addEventListener('click', function () { setTool(row[0]); });
            tools.appendChild(b);
            toolButtons[row[0]] = b;
        });

        // stage
        var stage = document.createElement('div');
        stage.className = 'adox-px-stage';
        var paperBox = document.createElement('div');
        paperBox.className = 'adox-px-paper';
        var canvas = document.createElement('canvas');
        canvas.className = 'adox-px-canvas';
        paperBox.appendChild(canvas);
        stage.appendChild(paperBox);
        canvas.addEventListener('pointerdown', function (e) { pxDown(ed, e); });
        canvas.addEventListener('pointermove', function (e) { pxMove(ed, e); });
        canvas.addEventListener('pointerup', function () { pxUp(ed); });
        canvas.addEventListener('pointercancel', function () { pxUp(ed); });
        ed.canvas = canvas;
        ed.stage = stage;

        // side
        var side = document.createElement('aside');
        side.className = 'adox-px-side';
        var palette = pxPalette(grid, 10);
        if (palette.length) {
            ed.color = palette[0];
            ed.rgba = [parseInt(palette[0].slice(1, 3), 16), parseInt(palette[0].slice(3, 5), 16),
                parseInt(palette[0].slice(5, 7), 16), 255];
        }
        var colorLabel = document.createElement('label');
        colorLabel.className = 'adox-px-field';
        colorLabel.textContent = t('color');
        var colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = ed.color;
        colorInput.addEventListener('input', function () {
            ed.color = colorInput.value;
            ed.rgba = [parseInt(ed.color.slice(1, 3), 16), parseInt(ed.color.slice(3, 5), 16),
                parseInt(ed.color.slice(5, 7), 16), 255];
        });
        colorLabel.appendChild(colorInput);
        side.appendChild(colorLabel);
        if (palette.length) {
            var swatches = document.createElement('div');
            swatches.className = 'adox-px-palette';
            palette.forEach(function (hex) {
                var b = document.createElement('button');
                b.type = 'button';
                b.style.background = hex;
                b.title = hex;
                b.addEventListener('click', function () {
                    ed.color = hex;
                    colorInput.value = hex;
                    ed.rgba = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
                        parseInt(hex.slice(5, 7), 16), 255];
                });
                swatches.appendChild(b);
            });
            side.appendChild(swatches);
        }
        var sizeLabel = document.createElement('label');
        sizeLabel.className = 'adox-px-field';
        var sizeText = document.createElement('span');
        sizeText.textContent = t('size');
        var sizeInput = document.createElement('input');
        sizeInput.type = 'range';
        sizeInput.min = 1;
        sizeInput.max = 8;
        sizeInput.value = ed.size;
        var sizeOut = document.createElement('output');
        sizeOut.textContent = ed.size;
        sizeInput.addEventListener('input', function () {
            ed.size = Number(sizeInput.value);
            sizeOut.textContent = ed.size;
        });
        sizeLabel.append(sizeText, sizeInput, sizeOut);
        side.appendChild(sizeLabel);
        var fillLabel = document.createElement('label');
        fillLabel.className = 'adox-px-check';
        var fillInput = document.createElement('input');
        fillInput.type = 'checkbox';
        fillInput.checked = true;
        fillInput.addEventListener('change', function () { ed.filled = fillInput.checked; });
        fillLabel.append(fillInput, document.createTextNode(t('filled')));
        side.appendChild(fillLabel);
        var gridLabel = document.createElement('label');
        gridLabel.className = 'adox-px-check';
        var gridInput = document.createElement('input');
        gridInput.type = 'checkbox';
        gridInput.checked = true;
        gridInput.addEventListener('change', function () {
            ed.gridOn = gridInput.checked;
            pxRender(ed);
        });
        gridLabel.append(gridInput, document.createTextNode(t('gridOn')));
        side.appendChild(gridLabel);
        var fixLabel = document.createElement('label');
        fixLabel.className = 'adox-px-check';
        var fixInput = document.createElement('input');
        fixInput.type = 'checkbox';
        fixInput.checked = true;
        fixLabel.append(fixInput, document.createTextNode(t('autoFix')));
        side.appendChild(fixLabel);
        var help = document.createElement('p');
        help.className = 'adox-px-help';
        help.textContent = t('pixelHelp');
        side.appendChild(help);

        // footer
        var foot = document.createElement('div');
        foot.className = 'adox-px-foot';
        var note = document.createElement('span');
        note.className = 'adox-px-note';
        var zoomOut = document.createElement('button');
        zoomOut.type = 'button';
        zoomOut.className = 'adox-px-zoom';
        zoomOut.textContent = '−';
        zoomOut.title = t('zoom');
        zoomOut.addEventListener('click', function () { pxZoom(ed, -1); });
        var zoomLabel = document.createElement('span');
        zoomLabel.className = 'adox-px-zoomval';
        var zoomIn = document.createElement('button');
        zoomIn.type = 'button';
        zoomIn.className = 'adox-px-zoom';
        zoomIn.textContent = '+';
        zoomIn.title = t('zoom');
        zoomIn.addEventListener('click', function () { pxZoom(ed, 1); });
        var fit = document.createElement('button');
        fit.type = 'button';
        fit.className = 'adox-px-zoom adox-px-fit';
        fit.textContent = t('fit');
        fit.addEventListener('click', function () { pxFit(ed); });
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'adox-px-cancel';
        cancel.textContent = t('cancel');
        cancel.addEventListener('click', closePixelEditor);
        var apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'adox-px-apply';
        apply.textContent = t('applyVector');
        apply.addEventListener('click', pxApply);
        foot.append(note, zoomOut, zoomLabel, zoomIn, fit, cancel, apply);

        var win = document.createElement('div');
        win.className = 'adox-px-win';
        win.append(head, tools, stage, side, foot);
        root.appendChild(win);
        document.body.appendChild(root);
        ed.note = note;
        ed.colorInput = colorInput;
        ed.sizeInput = sizeInput;
        ed.sizeOut = sizeOut;
        ed.autoFixInput = fixInput;
        ed.zoomOut = zoomLabel;
        ed.btnUndo = undo;
        ed.btnRedo = redo;
        setTool('brush');
        pxUpdateButtons(ed);
        pxEd = ed;
        window.requestAnimationFrame(function () {
            if (pxEd === ed) {
                ed.autoFixInput = fixInput;
                if (fixInput.checked) {
                    var fixed = pxFixAlpha(ed.grid);
                    if (fixed) note.textContent = fixed + ' ' + t('autoFixed');
                }
                pxFit(ed);
            }
        });
        ed.onKey = function (e) { pxKeyDown(ed, e); };
        ed.onResize = function () { if (pxEd === ed) pxFit(ed); };
        window.addEventListener('keydown', ed.onKey, true);
        window.addEventListener('resize', ed.onResize);
    }

    function openPixelEditor () {
        if (pxEd) return;
        var target = anchorTarget();
        if (!target) {
            pageToast(t('pixelNoTarget'));
            return;
        }
        var wasBitmap = isBitmapFormat();
        if (wasBitmap) pageToast(t('converting'));
        ensureVectorCostume().then(function (ok) {
            if (!ok) {
                pageToast(t('pixelNoTarget'), true);
                return;
            }
            rasterizeCostume().then(function (src) {
                if (!src) {
                    pageToast(t('pixelNoTarget'), true);
                    return;
                }
                buildPixelEditor(src);
            });
        });
    }

    // ------------------------------------------------------------------- board
    // Magic Code (the block generator and its AI bridge) is gone. The slot it held is now a plan
    // board that lives inside the costume editor: the same cards-and-columns idea as a paper GDD,
    // wearing the editor's own colours, saved per project and never leaving the browser.
    var BOARD_KEY = 'adox-board-v1';
    var boardEl = null;
    var boardBtn = null;
    var boardData = null;
    var boardDrag = null;
    var boardSaveTimer = 0;
    var boardFootNote = null;

    // one board per project. The hash is deliberately left out: the single-page router rewrites
    // it constantly, and a board that changes key mid-edit reads as if the cards were deleted.
    function boardProjectKey () {
        var path = location.pathname.replace(/\/+$/, '');
        var m = path.match(/projects\/(\d+)/);
        return m ? 'p' + m[1] : 'e' + path;
    }
    function boardDefault () {
        return {cols: [{id: 'c1', name: t('todo')}, {id: 'c2', name: t('doing')}, {id: 'c3', name: t('done')}],
            cards: []};
    }
    function boardLoad () {
        try {
            var raw = localStorage.getItem(BOARD_KEY + ':' + boardProjectKey());
            if (raw) {
                var b = JSON.parse(raw);
                if (b && Array.isArray(b.cols) && b.cols.length && Array.isArray(b.cards)) {
                    b.cols = b.cols.filter(function (c) { return c && typeof c.id === 'string'; })
                        .map(function (c) { return {id: c.id, name: String(c.name || '').slice(0, 40)}; });
                    b.cards = b.cards.filter(function (c) {
                        return c && typeof c.id === 'string' && typeof c.col === 'string';
                    }).map(function (c) {
                        return {id: c.id, col: c.col, title: String(c.title || '').slice(0, 200),
                            note: String(c.note || '').slice(0, 2000)};
                    });
                    if (!b.cols.length) b.cols = boardDefault().cols;
                    return b;
                }
            }
        } catch (e) { /* corrupt board: fall through to a fresh one */ }
        return boardDefault();
    }
    function boardSave () {
        if (!boardData) return;
        window.clearTimeout(boardSaveTimer);
        boardSaveTimer = window.setTimeout(function () {
            try {
                localStorage.setItem(BOARD_KEY + ':' + boardProjectKey(), JSON.stringify(boardData));
            } catch (e) { /* private mode or quota: the board still works this session */ }
        }, 250);
    }
    function boardId () {
        return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    function boardSay (text) {
        if (boardFootNote) boardFootNote.textContent = text;
    }
    function boardClose () {
        if (boardEl) boardEl.remove();
        boardEl = null;
        boardFootNote = null;
    }
    function boardCard (card, col) {
        var box = document.createElement('div');
        box.className = 'adox-bcard';
        box.dataset.card = card.id;

        var title = document.createElement('textarea');
        title.className = 'adox-ctitle';
        title.rows = 1;
        title.value = card.title;
        title.placeholder = t('cardTitle');
        title.setAttribute('aria-label', t('cardTitle'));
        title.addEventListener('input', function () {
            card.title = title.value;
            title.rows = Math.max(1, Math.min(4, title.value.split('\n').length));
            boardSave();
        });

        var note = document.createElement('textarea');
        note.rows = 2;
        note.value = card.note;
        note.placeholder = t('cardNote');
        note.setAttribute('aria-label', t('cardNote'));
        note.addEventListener('input', function () {
            card.note = note.value;
            note.rows = Math.max(2, Math.min(6, note.value.split('\n').length + 1));
            boardSave();
        });

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'adox-mini';
        del.title = t('delCard');
        del.setAttribute('aria-label', t('delCard'));
        del.innerHTML = GLYPH.trash;
        del.addEventListener('click', function () {
            boardData.cards = boardData.cards.filter(function (c) { return c.id !== card.id; });
            boardSave();
            boardRender();
        });

        var bar = document.createElement('div');
        bar.className = 'adox-bch adox-drag';
        bar.draggable = true;
        bar.appendChild(del);
        bar.addEventListener('dragstart', function (e) {
            boardDrag = card.id;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', card.id); } catch (err) { /* firefox needs no data */ }
            }
        });
        bar.addEventListener('dragend', function () { boardDrag = null; });
        box.append(bar, title, note);
        return box;
    }
    function boardRender () {
        if (!boardEl || !boardData) return;
        var body = boardEl.querySelector('.adox-bcols');
        if (!body) return;
        body.textContent = '';
        boardData.cols.forEach(function (col) {
            var column = document.createElement('div');
            column.className = 'adox-bcol';
            column.dataset.col = col.id;

            var head = document.createElement('div');
            head.className = 'adox-bch';
            var name = document.createElement('input');
            name.className = 'adox-bname';
            name.value = col.name;
            name.placeholder = t('colName');
            name.setAttribute('aria-label', t('colName'));
            name.addEventListener('input', function () {
                col.name = name.value.slice(0, 40);
                boardSave();
            });
            var drop = document.createElement('button');
            drop.type = 'button';
            drop.className = 'adox-mini';
            drop.title = t('delCol');
            drop.setAttribute('aria-label', t('delCol'));
            drop.innerHTML = GLYPH.trash;
            drop.disabled = boardData.cols.length < 2;
            drop.addEventListener('click', function () {
                var rest = boardData.cols.filter(function (c) { return c.id !== col.id; });
                if (!rest.length) return;
                boardData.cards.forEach(function (c) { if (c.col === col.id) c.col = rest[0].id; });
                boardData.cols = rest;
                boardSave();
                boardRender();
            });
            head.append(name, drop);
            column.appendChild(head);

            boardData.cards.filter(function (c) { return c.col === col.id; }).forEach(function (card) {
                column.appendChild(boardCard(card, col));
            });

            var add = document.createElement('button');
            add.type = 'button';
            add.className = 'adox-badd';
            add.textContent = '+ ' + t('addCard');
            add.addEventListener('click', function () {
                boardData.cards.push({id: boardId(), col: col.id, title: '', note: ''});
                boardSave();
                boardRender();
                window.setTimeout(function () {
                    var list = boardEl && boardEl.querySelectorAll('[data-col="' + col.id + '"] .adox-bcard');
                    var last = list && list[list.length - 1];
                    if (last) last.querySelector('textarea').focus();
                }, 0);
            });
            column.appendChild(add);

            column.addEventListener('dragover', function (e) {
                if (!boardDrag) return;
                e.preventDefault();
                column.classList.add('adox-over');
            });
            column.addEventListener('dragleave', function () { column.classList.remove('adox-over'); });
            column.addEventListener('drop', function (e) {
                e.preventDefault();
                column.classList.remove('adox-over');
                var id = boardDrag || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
                var card = boardData.cards.filter(function (c) { return c.id === id; })[0];
                if (!card || card.col === col.id) return;
                card.col = col.id;
                boardDrag = null;
                boardSave();
                boardRender();
            });

            body.appendChild(column);
        });

    }
    function boardExport () {
        try {
            var blob = new Blob([JSON.stringify({app: 'ScratchDream', version: 2, board: boardData}, null, 2)],
                {type: 'application/json'});
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'scratchdream-board.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
            boardSay(t('boardExported'));
        } catch (e) {
            boardSay(t('boardFail'));
        }
    }
    function boardImport (file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var parsed = JSON.parse(String(reader.result || ''));
                var b = parsed && parsed.board ? parsed.board : parsed;
                if (!b || !Array.isArray(b.cols) || !b.cols.length || !Array.isArray(b.cards)) throw new Error('shape');
                boardData = {
                    cols: b.cols.map(function (c, i) { return {id: String(c.id || 'c' + i), name: String(c.name || '').slice(0, 40)}; }),
                    cards: b.cards.map(function (c, i) {
                        return {id: String(c.id || 'k' + i), col: String(c.col || ''), title: String(c.title || '').slice(0, 200),
                            note: String(c.note || '').slice(0, 2000)};
                    })
                };
                var ids = boardData.cols.map(function (c) { return c.id; });
                boardData.cards.forEach(function (c) { if (ids.indexOf(c.col) < 0) c.col = ids[0]; });
                boardSave();
                boardRender();
                boardSay(t('boardImported'));
            } catch (e) {
                boardSay(t('boardBad'));
            }
        };
        reader.readAsText(file);
    }
    function openBoard () {
        if (boardEl) {
            boardClose();
            return;
        }
        readLocale();
        boardData = boardLoad();
        var panel = document.createElement('div');
        panel.className = 'adox-board';
        panel.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
        applyTheme(panel, readTheme());

        var head = document.createElement('div');
        head.className = 'adox-bhead';
        var title = document.createElement('strong');
        title.textContent = t('boardTitle');
        var sub = document.createElement('span');
        sub.className = 'adox-bsub';
        sub.textContent = t('boardSub');
        var addCol = document.createElement('button');
        addCol.type = 'button';
        addCol.className = 'adox-mini';
        addCol.title = t('addCol');
        addCol.setAttribute('aria-label', t('addCol'));
        addCol.innerHTML = GLYPH.plus;
        addCol.addEventListener('click', function () {
            var col = {id: boardId(), name: t('newCol')};
            boardData.cols.push(col);
            boardSave();
            boardRender();
        });
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'adox-close';
        close.setAttribute('aria-label', t('close'));
        close.textContent = '✕';
        close.addEventListener('click', boardClose);
        head.append(title, sub, addCol, close);

        var body = document.createElement('div');
        body.className = 'adox-bcols';

        var foot = document.createElement('div');
        foot.className = 'adox-bfoot';
        var out = document.createElement('button');
        out.type = 'button';
        out.textContent = t('exportB');
        out.addEventListener('click', boardExport);
        var into = document.createElement('button');
        into.type = 'button';
        into.textContent = t('importB');
        var files = document.createElement('input');
        files.type = 'file';
        files.accept = '.json,application/json';
        files.hidden = true;
        into.addEventListener('click', function () { files.click(); });
        files.addEventListener('change', function () {
            boardImport(files.files && files.files[0]);
            files.value = '';
        });
        var note = document.createElement('span');
        note.className = 'adox-bsub';
        note.style.padding = '.2rem .1rem';
        boardFootNote = note;
        foot.append(out, into, files, note);

        panel.append(head, body, foot);
        document.body.appendChild(panel);
        boardEl = panel;
        boardRender();
    }

    // The board button sits in the empty corner above the canvas, the spot the editor left unused.
    function syncBoardButton () {
        var host = document.querySelector('[class*="asset-panel_detail-area"]');
        if (!feat('board') || !host || !paintEditorOpen()) {
            if (boardBtn) { boardBtn.remove(); boardBtn = null; }
            if (!feat('board')) boardClose();
            return;
        }
        if (!boardBtn || !boardBtn.isConnected) {
            boardBtn = document.createElement('button');
            boardBtn.type = 'button';
            boardBtn.className = 'adox-board-btn';
            boardBtn.innerHTML = BOARD_GLYPH;
            boardBtn.addEventListener('click', openBoard);
            document.body.appendChild(boardBtn);
        }
        var theme = readTheme();
        boardBtn.style.color = theme.text;
        var r = host.getBoundingClientRect();
        boardBtn.style.left = Math.round(r.right - 40) + 'px';
        boardBtn.style.top = Math.round(r.top + 10) + 'px';
        boardBtn.title = t('boardTitle');
        boardBtn.setAttribute('aria-label', t('boardTitle'));
    }

    // -------------------------------------------------------------------- boot
    var lastMode = null;
    var lastFormat = null;
    var lastColorSig = null;
    // Two different colour shapes reach here: the editor's own descriptor ({primary, secondary,
    // gradientType}) and a paper item's fillColor, which is a Color, a gradient Pattern or null.
    function colorSig (color) {
        if (!color) return '-';
        if (color.gradient) {
            var stops = color.gradient.stops || [];
            return 'g|' + color.gradient.type + '|' + stops.map(function (s) {
                return Math.round(s.offset * 1000) + '@' + (s.color && s.color.toCSS ? s.color.toCSS(true) : s.color);
            }).join(',');
        }
        if (color.toCSS) return color.toCSS(true);
        var f = color.fillColor || {};
        var s = color.strokeColor || {};
        return [f.gradientType, f.primary, f.secondary, s.gradientType, s.primary, s.secondary].join('|');
    }
    function isBrushFamily (mode) {
        return /^(BRUSH|ERASER|BIT_BRUSH|BIT_ERASER)$/.test(mode || '');
    }
    // the editor is the boss of the mode: when it moves on, the Adox pen must let go of the canvas
    function onStateChange () {
        var p = paintState();
        if (!p) return;
        // the picker owns the two end colours, so its sliders move the strip's ends with them
        var sig = colorSig(p.color || {});
        if (sig !== lastColorSig) {
            lastColorSig = sig;
            if (gradStrip) paintGradStrip();
        }
        if (p.mode !== lastMode) {
            var switched = lastMode !== null;
            lastMode = p.mode;
            if (switched) {
                if (pen.active && p.mode !== pen.armedInMode) pen.deactivate();
                // the editor answered a click of its own, so the stamp is no longer what is armed
                if (shaper.shape) shaper.disarm();
                if (openPanel && openPanel._adoxKind === 'nib' && !isBrushFamily(p.mode)) closePanel();
                else if (openPanel && openPanel._adoxKind === 'nib') refreshNibUi();
                // drawing on a new object means the list on screen is out of date
                if (railEl) markObjects();
            }
        }
        if (p.format !== lastFormat) {
            var changed = lastFormat !== null;
            lastFormat = p.format;
            if (changed && openPanel && openPanel._adoxKind === 'nib') closePanel();
            // a bitmap costume has no vector objects, so the rail has nothing to show
            if (changed) syncRail();
        }
    }

    // ------------------------------------------------------- the animation anchor
    // The one complaint every Scratch animator has and no editor answers: the costumes of a walk
    // cycle were each given a registration point by hand, so on every frame the drawing lands a few
    // pixels away from the frame before it and the character trembles. The number that describes it
    // does not exist anywhere in the project, it only appears once you know where the *pixels* of
    // every costume actually sit. So we measure them: rasterise each costume, take the alpha
    // weighted centre, and compare that with the registration point. Then the fix is arithmetic.
    var vmRef = null;
    function findVM () {
        if (vmRef && typeof vmRef.getTargetForId === 'function') return vmRef;
        if (window.vm && window.vm.editingTarget) {
            vmRef = window.vm;
            return vmRef;
        }
        // Scratch itself does not publish the vm; the GUI hands it down as a prop, so the fiber
        // tree holds it. Walking the tree is how the same feature reaches all three editors.
        var host = document.getElementById('app') || document.body.firstElementChild;
        var key = host ? Object.keys(host).filter(function (k) {
            return /reactContainer/i.test(k);
        })[0] : null;
        var fiber = key ? host[key] : null;
        if (!fiber && host && host._reactRootContainer) {
            // react 16 keeps the tree on the root instead of on the container
            var root = host._reactRootContainer._internalRoot || host._reactRootContainer;
            fiber = root && root.current;
        }
        var queue = [];
        if (fiber) queue.push(fiber);
        for (var i = 0; i < queue.length && i < 6000; i++) {
            var f = queue[i];
            if (!f) continue;
            var p = f.memoizedProps;
            var sp = f.stateNode && f.stateNode.props;
            if (p && p.vm && p.vm.editingTarget) {
                vmRef = p.vm;
                return vmRef;
            }
            if (sp && sp.vm && sp.vm.editingTarget) {
                vmRef = sp.vm;
                return sp.vm;
            }
            if (f.child) queue.push(f.child);
            if (f.sibling) queue.push(f.sibling);
        }
        return null;
    }
    function anchorTarget () {
        var vm = findVM();
        var t = vm && vm.editingTarget;
        return (t && !t.isStage && typeof t.getCostumes === 'function') ? t : null;
    }

    var anchorCache = {};
    var anchorState = {busy: false, list: null, spriteId: '', n: 0, mode: 'match', undo: null, result: null};

    function alphaStats (img, w, h, scale) {
        // one factor for both axes. clamping width and height apart would squash the drawing
        // inside the raster and move the centre that gets measured, visible on wide backdrops.
        var s = Math.min(scale, 1400 / Math.max(w, h, 1));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * s));
        cv.height = Math.max(1, Math.round(h * s));
        var ctx = cv.getContext('2d', {willReadFrequently: true});
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        var sum = 0, sx = 0, sy = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
        for (var y = 0; y < cv.height; y++) {
            for (var x = 0; x < cv.width; x++) {
                var a = d[(y * cv.width + x) * 4 + 3];
                // every alpha counts, weighted: dropping the faint edge pixels moves the centre
                if (!a) continue;
                sum += a;
                sx += x * a;
                sy += y * a;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        var out = {area: sum, w: cv.width / s, h: cv.height / s, thumb: ''};
        if (!sum) return out;
        out.cx = sx / sum / s;
        out.cy = sy / sum / s;
        out.box = [(minX + maxX) / 2 / s, (minY + maxY) / 2 / s];
        var fit = Math.min(1, 56 / Math.max(1, out.w), 56 / Math.max(1, out.h));
        var pv = document.createElement('canvas');
        pv.width = Math.max(1, Math.round(out.w * fit));
        pv.height = Math.max(1, Math.round(out.h * fit));
        pv.getContext('2d').drawImage(img, 0, 0, pv.width, pv.height);
        out.thumb = pv.toDataURL('image/png');
        return out;
    }

    function costumeRaster (c) {
        var raw = c.asset && (c.asset.data !== undefined ? c.asset.data : c.asset);
        if (c.dataFormat === 'svg' || typeof raw === 'string') {
            var txt = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
            var w = Number((/\swidth="([\d.]+)"/.exec(txt) || [])[1]) || 0;
            var h = Number((/\sheight="([\d.]+)"/.exec(txt) || [])[1]) || 0;
            return new Promise(function (res, rej) {
                var img = new Image();
                img.onload = function () {
                    // the svg's own float size, not naturalWidth: chrome rounds that to an integer,
                    // and drawing 61.5 wide art into 61 columns tilts every centre by a tenth of a px
                    res(alphaStats(img, w || img.naturalWidth, h || img.naturalHeight, 4));
                };
                img.onerror = function () { rej(new Error('svg raster')); };
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
            });
        }
        var bytes = raw instanceof ArrayBuffer ? raw : (raw && raw.buffer ? raw.buffer : raw);
        return createImageBitmap(new Blob([bytes], {type: 'image/' + (c.dataFormat || 'png')}))
            .then(function (bmp) {
                var s = alphaStats(bmp, bmp.width, bmp.height, 1);
                // a bitmap pivot may be written in pixels or in stage units, and the record does not
                // say which. The point the artist already chose answers it: whichever reading of the
                // measured centre sits closer to it is the unit this costume is stored in.
                var res = Math.max(1, Number(c.bitmapResolution) || 1);
                if (s.area && res > 1) {
                    var inUnits = Math.hypot(s.cx / res - c.rotationCenterX, s.cy / res - c.rotationCenterY);
                    var inPixels = Math.hypot(s.cx - c.rotationCenterX, s.cy - c.rotationCenterY);
                    if (inUnits <= inPixels) {
                        s.cx /= res;
                        s.cy /= res;
                        s.w /= res;
                        s.h /= res;
                    }
                }
                return s;
            });
    }

    function measureOne (c) {
        var key = (c.md5 || c.assetId || '') + '|' + c.dataFormat + '|' + c.name;
        if (anchorCache[key]) return Promise.resolve(anchorCache[key]);
        return costumeRaster(c).then(function (s) {
            anchorCache[key] = s;
            // every entry keeps a base64 thumbnail of its costume, so a long session that walks
            // through sprite after sprite cannot be allowed to keep all of them
            var keys = Object.keys(anchorCache);
            if (keys.length > 48) delete anchorCache[keys[0]];
            return s;
        });
    }

    function measureAnchor () {
        var t = anchorTarget();
        if (!t) return Promise.resolve(null);
        var costumes = t.getCostumes();
        if (costumes.length < 2) return Promise.resolve({short: true, n: costumes.length});
        anchorState.busy = true;
        return Promise.all(costumes.map(measureOne)).then(function (stats) {
            anchorState.list = stats.map(function (s, i) {
                return {index: i, name: costumes[i].name, area: s.area || 0, cx: s.cx || 0, cy: s.cy || 0,
                    w: s.w || 0, h: s.h || 0, thumb: s.thumb || '',
                    pivot: [costumes[i].rotationCenterX, costumes[i].rotationCenterY]};
            });
            anchorState.spriteId = t.id;
            anchorState.n = costumes.length;
            anchorState.busy = false;
            return anchorState.list;
        }).catch(function (e) {
            anchorState.busy = false;
            if (window.console) window.console.warn('ScratchDream anchor:', e);
            return null;
        });
    }

    function anchorPlan (mode, list) {
        var live = list.filter(function (s) { return s.area > 0; });
        if (!live.length) return null;
        var out = list.map(function (s) { return [s.pivot[0], s.pivot[1]]; });
        if (mode === 'own') {
            list.forEach(function (s, i) { if (s.area > 0) out[i] = [s.cx, s.cy]; });
            return out;
        }
        if (mode === 'body') {
            var w = 0, x = 0, y = 0;
            live.forEach(function (s) { w += s.area; x += s.cx * s.area; y += s.cy * s.area; });
            list.forEach(function (s, i) { if (s.area > 0) out[i] = [x / w, y / w]; });
            return out;
        }
        var base = live[0];
        var d = [base.pivot[0] - base.cx, base.pivot[1] - base.cy];
        list.forEach(function (s, i) { if (s.area > 0) out[i] = [s.cx + d[0], s.cy + d[1]]; });
        return out;
    }

    // where the drawing sits on the stage = its own centre, minus the registration point.
    // the jump is how far that landing spot moves from one costume to the next.
    function anchorJump (list, pivots) {
        var pts = [];
        list.forEach(function (s, i) {
            if (s.area > 0) pts.push([s.cx - pivots[i][0], s.cy - pivots[i][1]]);
        });
        var tot = 0, max = 0;
        for (var i = 1; i < pts.length; i++) {
            var j = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            tot += j;
            if (j > max) max = j;
        }
        return {mean: pts.length > 1 ? tot / (pts.length - 1) : 0, max: max, steps: pts.length - 1};
    }

    function px (v) {
        return (Math.round(v * 10) / 10).toFixed(1);
    }

    function refreshAnchorView (t) {
        // the shown costume holds a skin built from the old point, and so does the paint editor.
        // one real costume switch makes both rebuild themselves from the records just written.
        try {
            var idx = t.currentCostume, n = t.getCostumes().length;
            if (n < 2) return;
            t.setCostume((idx + 1) % n);
            t.setCostume(idx);
            t.updateAllDrawableProperties();
            var vm = findVM();
            if (vm && typeof vm.emitTargetsUpdate === 'function') vm.emitTargetsUpdate();
            if (vm && typeof vm.emitProjectChanged === 'function') vm.emitProjectChanged();
        } catch (e) { /* the records are already correct; the view catches up on the next switch */ }
    }

    function applyAnchor (mode) {
        var t = anchorTarget();
        if (!t || !anchorState.list) return null;
        var costumes = t.getCostumes();
        if (costumes.length !== anchorState.n) {
            anchorState.list = null;
            return null;
        }
        // the artist may have moved a registration point while the box was open
        anchorState.list.forEach(function (s, i) {
            s.pivot = [costumes[i].rotationCenterX, costumes[i].rotationCenterY];
        });
        var plan = anchorPlan(mode, anchorState.list);
        if (!plan) return null;
        var before = anchorJump(anchorState.list, anchorState.list.map(function (s) { return s.pivot; }));
        var snapshot = costumes.map(function (c) { return [c.rotationCenterX, c.rotationCenterY]; });
        var written = 0;
        anchorState.list.forEach(function (s, i) {
            if (s.area <= 0) return;
            costumes[i].rotationCenterX = Math.round(plan[i][0] * 1000) / 1000;
            costumes[i].rotationCenterY = Math.round(plan[i][1] * 1000) / 1000;
            s.pivot = [costumes[i].rotationCenterX, costumes[i].rotationCenterY];
            written++;
        });
        anchorState.undo = {spriteId: t.id, n: snapshot.length, list: snapshot, mode: mode};
        anchorState.result = {before: before.mean, after: anchorJump(anchorState.list,
            anchorState.list.map(function (s) { return s.pivot; })).mean, written: written};
        refreshAnchorView(t);
        return anchorState.result;
    }

    function undoAnchor () {
        var t = anchorTarget();
        var u = anchorState.undo;
        if (!t || !u || u.spriteId !== t.id) return false;
        var costumes = t.getCostumes();
        if (costumes.length !== u.n) return false;
        costumes.forEach(function (c, i) {
            c.rotationCenterX = u.list[i][0];
            c.rotationCenterY = u.list[i][1];
        });
        anchorState.undo = null;
        anchorState.result = null;
        if (anchorState.list) {
            anchorState.list.forEach(function (s, i) {
                s.pivot = [costumes[i].rotationCenterX, costumes[i].rotationCenterY];
            });
        }
        refreshAnchorView(t);
        return true;
    }

    function anchorBody (panel) {
        var jump = document.createElement('div');
        jump.className = 'adox-jump';
        jump.innerHTML = '<strong>—</strong><span>px</span>';
        panel.appendChild(jump);
        var sub = document.createElement('div');
        sub.className = 'adox-sub';
        sub.textContent = t('anchorSub');
        panel.appendChild(sub);

        var seg = document.createElement('div');
        seg.className = 'adox-seg';
        [['body', t('anchorBody')], ['own', t('anchorOwn')], ['match', t('anchorFirst')]].forEach(function (row) {
            var b = document.createElement('button');
            b.type = 'button';
            b.dataset.mode = row[0];
            b.textContent = row[1];
            b.addEventListener('click', function () {
                anchorState.mode = row[0];
                markAnchor();
            });
            seg.appendChild(b);
        });
        panel.appendChild(seg);

        var list = document.createElement('div');
        list.className = 'adox-alist';
        panel.appendChild(list);

        var act = document.createElement('div');
        act.className = 'adox-actions';
        var go = document.createElement('button');
        go.type = 'button';
        go.className = 'adox-primary';
        go.textContent = t('anchorApply');
        go.addEventListener('click', function () {
            var r = applyAnchor(anchorState.mode);
            if (r) {
                markAnchor();
                if (railEl) markObjects();
            }
        });
        var back = document.createElement('button');
        back.type = 'button';
        back.className = 'adox-ghost';
        back.textContent = t('anchorUndo');
        back.disabled = !anchorState.undo;
        back.addEventListener('click', function () {
            if (undoAnchor()) markAnchor();
        });
        act.appendChild(go);
        act.appendChild(back);
        panel.appendChild(act);
        panel.appendChild(keyRow(['Alt+D']));
        markAnchor();
    }

    // the numbers the box shows are recomputed on every read, so a hand moved registration point
    // or an applied plan is reflected before the next click
    function markAnchor () {
        if (!openPanel || openPanel._adoxKind !== 'anchor') return;
        var panel = openPanel;
        var strong = panel.querySelector('.adox-jump strong');
        var sub = panel.querySelector('.adox-sub');
        var list = panel.querySelector('.adox-alist');
        var go = panel.querySelector('.adox-primary');
        var back = panel.querySelector('.adox-ghost');
        Array.prototype.forEach.call(panel.querySelectorAll('[data-mode]'), function (b) {
            var on = b.dataset.mode === anchorState.mode;
            b.setAttribute('aria-pressed', String(on));
            b.classList.toggle('adox-on', on);
        });
        var tgt = anchorTarget();
        if (!tgt || anchorState.busy) {
            strong.textContent = anchorState.busy ? '…' : '—';
            if (sub) sub.textContent = tgt ? t('anchorBusy') : t('anchorNone');
            if (go) go.disabled = true;
            return;
        }
        var costumes = tgt.getCostumes();
        if (costumes.length < 2 || !anchorState.list || anchorState.n !== costumes.length) {
            strong.textContent = '—';
            if (sub) sub.textContent = costumes.length < 2 ? t('anchorNone') : t('anchorBusy');
            if (list) { list.textContent = ''; list.dataset.sig = ''; }
            if (go) go.disabled = true;
            if (back) back.disabled = true;
            // one probe at a time: the box is re-read on every tick and measuring costs a raster
            if (costumes.length > 1 && !anchorState.probing) {
                anchorState.probing = true;
                measureAnchor().then(function () {
                    anchorState.probing = false;
                    markAnchor();
                }, function () {
                    anchorState.probing = false;
                });
            }
            return;
        }
        anchorState.list.forEach(function (s, i) {
            s.pivot = [costumes[i].rotationCenterX, costumes[i].rotationCenterY];
        });
        var now = anchorJump(anchorState.list, anchorState.list.map(function (s) { return s.pivot; }));
        var plan = anchorPlan(anchorState.mode, anchorState.list);
        var next = plan ? anchorJump(anchorState.list, plan) : now;
        strong.textContent = px(now.mean);
        if (sub) {
            sub.textContent = (anchorState.result ? t('anchorDone') + ' ' + anchorState.result.written + ' · ' : '') +
                px(now.mean) + ' → ' + px(next.mean) + ' px';
        }
        if (go) go.disabled = !plan || now.mean < .05;
        if (back) back.disabled = !anchorState.undo;
        if (!list || !plan) return;
        // the box is re-read on every tick, so the rows are only rebuilt when a number on them
        // actually moved; rewriting six rows four times a second costs layout for nothing
        var sig = lang + ';' + anchorState.list.map(function (s, i) {
            return [s.name, s.area <= 0 ? '-' : px(s.pivot[0]) + ',' + px(s.pivot[1]) +
                '>' + px(plan[i][0]) + ',' + px(plan[i][1])].join('|');
        }).join(';');
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.textContent = '';
        anchorState.list.forEach(function (s, i) {
            var row = document.createElement('div');
            row.className = 'adox-arow';
            var th = document.createElement('i');
            th.className = 'adox-athumb';
            if (s.thumb) th.style.backgroundImage = 'url(' + s.thumb + ')';
            var nm = document.createElement('span');
            nm.className = 'adox-aname';
            nm.textContent = s.name;
            var d = document.createElement('span');
            d.className = 'adox-adelta';
            if (s.area <= 0) {
                d.textContent = t('anchorSkipped');
            } else {
                var shift = Math.hypot(plan[i][0] - s.pivot[0], plan[i][1] - s.pivot[1]);
                d.textContent = (shift < .05 ? '=' : '→ ') + px(s.pivot[0]) + ',' + px(s.pivot[1]) +
                    (shift < .05 ? '' : ' → ' + px(plan[i][0]) + ',' + px(plan[i][1]));
            }
            row.appendChild(th);
            row.appendChild(nm);
            row.appendChild(d);
            list.appendChild(row);
        });
    }

    function showAnchorPanel (anchor) {
        var panel = toggleFor(anchor, 'anchor', 'adox-wide');
        if (!panel) return;
        panel.appendChild(labelEl(t('anchorTitle')));
        anchorBody(panel);
    }

    function toolButton (key) {
        for (var i = 0; i < toolButtons.length; i++) {
            // the editor re-renders its tool row when the costume switches between vector and
            // bitmap, which throws our clones away; a disconnected button is not "there"
            if (toolButtons[i]._adoxKey === key && toolButtons[i].isConnected) return toolButtons[i];
        }
        return null;
    }

    // every switch in the popup maps to one of these four buttons, so the list is rebuilt from the
    // flags instead of being created once at mount
    function syncToolButtons () {
        var grid = document.querySelector('[class*="paint-editor_mode-selector"]');
        toolButtons = toolButtons.filter(function (b) { return b.isConnected; });
        ['shapes', 'pen', 'fx', 'anchor'].forEach(function (key) {
            var btn = toolButton(key);
            if (!feat(key)) {
                if (key === 'shapes') shaper.disarm();
                if (key === 'pen') pen.deactivate();
                if ((key === 'fx' || key === 'anchor') && openPanel && openPanel._adoxKind === key) closePanel();
                if (btn) {
                    btn.remove();
                    toolButtons.splice(toolButtons.indexOf(btn), 1);
                }
                return;
            }
            if (btn || !grid) return;
            addToolButton(grid, key, TOOL_ICON[key], function () {
                var self = toolButton(key);
                if (!self) return;
                if (key === 'shapes') showShapePanel(self);
                else if (key === 'pen') showPenPanel(self);
                else if (key === 'anchor') showAnchorPanel(self);
                else showFxPanel(self);
            });
        });
        shaper.button = toolButton('shapes');
        pen.button = toolButton('pen');
        refreshToolLabels();
    }

    function applyFeatures (flags) {
        var changed = false;
        Object.keys(FEATURES).forEach(function (key) {
            var on = !flags || flags[key] !== false;
            if (FEATURES[key] !== on) {
                FEATURES[key] = on;
                changed = true;
            }
        });
        if (!changed) return;
        if (paintEditorOpen()) syncToolButtons();
        if (!feat('gradient')) dropGradStrip();
        if (!feat('rail')) destroyRail();
        if (!feat('board')) {
            boardClose();
            if (boardBtn) { boardBtn.remove(); boardBtn = null; }
        }
        if (!feat('pixel')) {
            closePixelEditor();
            if (pxBtn) { pxBtn.remove(); pxBtn = null; }
        }
    }

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        var data = event.data;
        if (!data || data.source !== 'adox-bridge' || data.type !== 'features') return;
        applyFeatures(data.flags);
    });

    function mount () {
        var grid = document.querySelector('[class*="paint-editor_mode-selector"]');
        if (!grid || grid.dataset.adoxMounted || !paper() || !store()) return;
        grid.dataset.adoxMounted = '1';
        readLocale();
        syncToolButtons();
        watchColorTarget();
        syncRail();
        if (pen.active) markArmed(pen.button, true);

        var s = store();
        if (!s.__adoxWatch) {
            s.__adoxWatch = true;
            lastMode = (paintState() || {}).mode;
            lastFormat = (paintState() || {}).format;
            s.subscribe(onStateChange);
        }

        // clicking the editor's own brush or eraser opens the nib box. TurboWarp writes "Brush (B)"
        // in the tooltip, plain Scratch only writes "Brush", so the mode is read from the store instead.
        var buttons = grid.querySelectorAll('[class*="tool-select-base_mod-tool-select"]');
        Array.prototype.forEach.call(buttons, function (btn) {
            if (btn.classList.contains('adox-tool')) return;
            btn.addEventListener('click', function () {
                window.setTimeout(function () {
                    if (!feat('pen')) return;
                    pen.deactivate();
                    var p = paintState();
                    if (!p || !isBrushFamily(p.mode)) return;
                    showNibPanel(btn);
                }, 60);
            });
        });

        var host = document.querySelector('[class*="paint-editor_canvas-container"]');
        if (host && !host.dataset.adoxWheel) {
            host.dataset.adoxWheel = '1';
            host.addEventListener('wheel', function (e) {
                if (!e.altKey || !feat('pen')) return;
                e.preventDefault();
                stepNib(e.deltaY < 0 ? 1 : -1);
            }, {passive: false});
        }
    }

    function paintEditorOpen () {
        return !!document.querySelector('[class*="paint-editor_mode-selector"]');
    }

    function onKeyDown (e) {
        if (pxEd) return;
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (!paintEditorOpen()) return;
        if (e.key === 'Escape') {
            // first press puts the panel away, second one hands the canvas back to the editor
            if (openPanel) closePanel();
            else if (pen.active) pen.deactivate();
            else if (shaper.shape) shaper.disarm();
            return;
        }
        if (e.key === '[' && feat('pen')) stepNib(-1);
        if (e.key === ']' && feat('pen')) stepNib(1);
        // Alt + letter is free in both editors, so the three effects and the export get a key each.
        // e.code is used because Alt already rewrites e.key into accents on several layouts.
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            if (e.code === 'KeyM' && feat('fx')) {
                e.preventDefault();
                if (setMask(!isMasked())) markFx();
            } else if (e.code === 'KeyB' && feat('fx')) {
                e.preventDefault();
                stepBlend(e.shiftKey ? -1 : 1);
                markFx();
            } else if (e.code === 'KeyJ' && feat('fx')) {
                e.preventDefault();
                if (setMiter(1.2)) markFx();
            } else if (e.code === 'KeyD' && feat('anchor')) {
                // one gesture for the whole fix: the box opens, and while it is open it applies
                e.preventDefault();
                var anchorBtn = toolButton('anchor');
                if (openPanel && openPanel._adoxKind === 'anchor') {
                    applyAnchor(anchorState.mode);
                    markAnchor();
                } else if (anchorBtn) {
                    showAnchorPanel(anchorBtn);
                }
            } else if (e.code === 'KeyP' && feat('pixel')) {
                e.preventDefault();
                openPixelEditor();
            } else if (e.code === 'KeyX') {
                e.preventDefault();
                exportPng(settings.pngScale || 1);
            }
        }
    }

    function tick () {
        try {
            ensureStyle();
            if (!paintEditorOpen()) {
                closePanel();
                closePixelEditor();
                pen.deactivate();
                shaper.disarm();
                destroyRail();
                boardClose();
                if (boardBtn) { boardBtn.remove(); boardBtn = null; }
                if (pxBtn) { pxBtn.remove(); pxBtn = null; }
                return;
            }
            mount();
            sweepGhosts();
            syncPixelButton();
            if (pxEd) {
                var nowTarget = anchorTarget();
                var nowCostume = nowTarget && nowTarget.getCostumes()[nowTarget.currentCostume];
                if (!feat('pixel') || !nowCostume || nowCostume.name !== pxEd.costume) closePixelEditor();
            }
            if (feat('gradient')) syncGradStrip(); else dropGradStrip();
            syncRail();
            syncToolButtons();
            syncBoardButton();
            var before = lang;
            readLocale();
            if (before !== lang) {
                refreshToolLabels();
                closePanel();
            } else if (openPanel && !openAnchor.isConnected) {
                closePanel();
            }
            // the box mirrors the selection, which the editor can change under us
            if (openPanel && openPanel._adoxKind === 'fx') markFx();
            else if (openPanel && openPanel._adoxKind === 'anchor') markAnchor();
        } catch (e) {
            if (window.console) window.console.warn('ScratchDream:', e);
        }
    }

    var styleInjected = false;
    function ensureStyle () {
        if (styleInjected || !document.head) return;
        // a constructed sheet is not an inline <style>, so a strict site CSP cannot block it
        if (window.CSSStyleSheet && CSSStyleSheet.prototype.replaceSync && document.adoptedStyleSheets !== undefined) {
            try {
                var sheet = new CSSStyleSheet();
                sheet.replaceSync(CSS);
                document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
                styleInjected = true;
                return;
            } catch (e) { /* fall through to the <style> tag */ }
        }
        var tag = document.createElement('style');
        tag.textContent = CSS;
        document.head.appendChild(tag);
        styleInjected = true;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', function () {
        if (openPanel) fitPanel(openPanel);
    });
    window.addEventListener('pointerdown', function (e) {
        // the nib box is the one panel the product opens by itself, the moment the editor's own
        // brush or eraser is clicked, and it floats over the left half of the art, so a stroke
        // that lands on it is gone. The fx, shape and anchor boxes only open on a click of ours
        // and stay; this one answers to what the user was reaching for instead.
        if (openPanel && openPanel._adoxKind === 'nib' &&
            /paper-canvas/.test(String(e.target && e.target.className))) closePanel();
        refreshPanels();
    }, true);
    window.addEventListener('keyup', refreshPanels, true);

    // ------------------------------------------------------- the stroke repaint
    // A fold of the repaint path used to sit here: while the pointer was down it held paper's
    // update() and let one repaint through per frame. It is gone because the numbers say it could
    // never fire. Chrome coalesces a fast mouse or pen into at most one pointermove per frame
    // before the page sees it (61 moves sent as one burst arrived as 22 events), and 61 delivered
    // moves gave 62 repaints with the switch off. The repaint count already follows the frame
    // count on its own; what was left behind was a patch on paper's view prototype that could hold
    // a repaint back from anything reading the canvas or exporting it.

    // --------------------------------------------------------------- load diet
    // This loop used to ask "is the paint editor open?" every 900 ms at the same rate in every
    // situation: in a background tab, on the Code tab and while the hand was flying across a heavy
    // costume. The diet keeps the job and spends the ticks where they matter, a fast lane while
    // the pointer works, a slow lane when nothing moves, nothing at all while the tab is out of
    // sight. The toolbar switch puts the flat 900 ms loop back, which is also how the saving is
    // measured against the old behaviour.
    // A longtask observer used to sit here and open a fifth lane for the moment the page froze.
    // It is gone: it woke the loop at 400 ms against an idle lane that already sleeps 1400 ms, so
    // it made the loop louder while the page was struggling, and the 600 ms window it checked was
    // narrower than the jitter of its own wake-up, the measured trace showed the lane after a
    // freeze landing everywhere except the one it was supposed to land in.
    var diet = {ticks: 0, fast: 0, slow: 0, slept: 0, tickMs: 0, worstMs: 0, lane: 0};
    window.__adoxDiet = diet;
    var touched = 0, wasOpen = null, beatTimer = 0;

    function touch () { touched = performance.now(); }
    ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'wheel', 'click'].forEach(function (name) {
        window.addEventListener(name, touch, {passive: true, capture: true});
    });
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { wasOpen = null; touch(); }
    });

    function beat () {
        var next;
        if (!feat('speed')) {
            diet.ticks++; diet.lane = 9;
            runTick();
            next = 900;
        } else if (document.hidden) {
            diet.slept++; diet.lane = 0;
            wasOpen = null;
            next = 1500;
        } else {
            var open = paintEditorOpen();
            var changed = open !== wasOpen;
            wasOpen = open;
            if (changed) {
                diet.ticks++; diet.lane = 1;
                runTick();
                next = 240;
            } else if (!open) {
                diet.slept++; diet.lane = 2;
                next = 2000;
            } else {
                var quick = performance.now() - touched < 2200;
                diet.ticks++;
                diet.lane = quick ? 3 : 4;
                if (quick) diet.fast++; else diet.slow++;
                runTick();
                next = quick ? 240 : 1400;
            }
        }
        beatTimer = window.setTimeout(beat, next);
    }
    function runTick () {
        var t0 = performance.now();
        tick();
        var ms = performance.now() - t0;
        diet.tickMs += ms;
        if (ms > diet.worstMs) diet.worstMs = ms;
    }

    beatTimer = window.setTimeout(beat, 400);
})();
