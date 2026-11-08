# ScratchDream

Scratch's costume editor is fine for putting a hat on a cat. It falls apart the moment you
draw something on purpose: no pixel grid, no masks, no blend modes, a layer list you can't
see, and a pivot point you set by hand on every single frame.

This adds the drawing half. It doesn't replace the editor — same canvas, same panels, same
undo stack, same `.sb3`. The buttons borrow the editor's own colours, so on a custom
TurboWarp theme they recolour themselves. We never hardcode a colour.

![ScratchDream](docs/assets/banner.png)

## Stuff we measured before shipping it

**Costume jitter.** Every animator hits it: the walk cycle trembles because each frame's
registration point was placed by eye. The number doesn't exist anywhere in the project, so we
rasterise every costume, take the alpha-weighted centre, subtract the pivot, and print the
jump in pixels. `Alt+D`, choose a plan, apply. Only the rotation centre is written.

**A panel that ate brush strokes.** The nib box opened on a brush click and floated over the
left half of the art. In 14 of 17 logged rows the pen landed on the panel and the stroke was
gone. It now never sits on the canvas, and the first pointer that reaches the art closes it.

**Half-transparent halos.** Moving a bitmap selection leaves a one-pixel ring of faint alpha.
A faint pixel with two or more empty neighbours is that ring, not art, so it goes to 0; the
opaque core goes to 255. Anti-aliased fringe keeps its colour by copying the nearest truly
opaque neighbour, otherwise hardening it paints a dark rim.

**Pixel art without blur.** Applying the pixel editor writes one compound path per colour and
merges equal horizontal runs vertically, so a flat fill becomes a few tall rectangles instead
of one path per pixel. The grid comes from the thinnest stroke in the art: 1:1 when a line is
under one costume unit, 2:2 otherwise. 3x3 and 4x4 have no basis in the source grid, so they
aren't offered.

**Two ideas we threw away.** Coalescing paint events to one per frame: Chrome already folds
fast pointer moves before the page sees them (61 sent as one burst arrived as 22). A "the page
froze" fast lane: it woke the idle loop from 1400 ms to 400 ms, i.e. louder while the tab was
struggling. Both measured, both deleted.

## Install

`chrome://extensions` → Developer mode → **Load unpacked** → pick `extension/`. `F5` on the
editor tab, open Costumes. Chrome, Edge, Brave, Opera — not Firefox, it needs `MAIN`-world
content scripts and `declarativeNetRequest`.

Keys: `Alt+P` `Alt+D` `Alt+M` `Alt+B` `Alt+J` `Alt+X`, `[` and `]` for the nib, `Esc` backs
out of the panel then the tool. Nothing is grabbed while you're typing in a field.

Everything else is in [Kurulum.md](Kurulum.md) (Türkçe) and the toolbar panel, which is
searchable. The site panels rewrite the home page, forums, Explore, the profile grid and the
comment box; the profile API is [docs/users2.md](docs/users2.md).

## Privacy

No account, no analytics, no background worker, no AI keys. Two permissions: `storage` and
`declarativeNetRequest`. Your artwork never leaves the browser.

The site panels do make requests, and it would be nicer if they didn't: Scratch's own pages
and API, `fonts.googleapis.com` for the forum skin, `forumfind.evof.cc` for forum search. A
forum reply goes to Scratch with your own session. users2 reads only what Scratch already
serves to the page and caches it 15 minutes. Board notes and folders stay in `localStorage`
and are never written into the project file.

## Dev

```bash
cd dev && npm install
node verify.mjs        # 47 checks, real Chrome, live editor
node users2-test.mjs   # users2 dashboard, fetch intercept, comment trace
```

The costume editor half is one file, `adox-kostum.js`, in the page's own world because it
needs Scratch's Paper.js scope and Redux store. 6,200 lines. Sorry.

MIT. Scratch, TurboWarp and PenguinMod don't endorse this and get nothing from it.
