# ScratchDream

Scratch's costume editor is fine for putting a hat on a cat. It falls apart the moment you
draw something on purpose: no pixel grid, no masks, no blend modes, a layer list you can't
see, and a pivot point you set by hand on every single frame.

This adds the drawing half. It doesn't replace the editor — same canvas, same panels, same
undo stack, same `.sb3`. The buttons borrow the editor's own colours, so on a custom
TurboWarp theme they recolour themselves. We never hardcode a colour.

There is also a one-click **Optimize** button in the menu bar: it shrinks the project without
touching behaviour or visual quality, and one click of **Undo** puts every byte back. Details
and measured numbers are below.

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

## One-click optimizer

The purple menu bar has an **Optimize** button. It opens a Scratch-style dialog, runs only the
safe passes, and then reports what changed. The interface follows the editor language (English
and Turkish).

- **Vector costumes** lose editor metadata, unused definitions, empty groups and number noise.
  Every SVG is rasterised before and after at the same size; a change that moves the pixels is
  rejected. All 76 SVGs on the benchmark still decode in the editor.
- **Bitmap costumes** are recompressed only when the decoded pixels are identical, and hidden
  PNG/JPEG metadata is stripped.
- **Sounds** keep their format when that is already the smaller one. WAV becomes high-quality
  MP3 (192 kbps stereo at 44.1 kHz, scaled down for lower rates) only after both files decode
  to the same duration, peak and loudness. Existing MP3s are never re-encoded; only removable
  ID3/APE tags are dropped.
- **Code** loses empty scripts and comments, unused variables, lists and broadcasts, and orphan
  blocks. Variable/list/broadcast declarations are alphabetised, and top-level scripts are laid
  out on a 576 px grid. Block IDs, fields, order and behaviour are untouched.
- **Sprite folders** are derived from the sprite names and the folders that already exist.
  Custom folder names stay, generic `Folder N` names are renamed from their contents, empty
  folders are removed, and every sprite is filed into Main, World, Interface, Audio, System or
  Other. Folder metadata stays in `localStorage`; it is not written into the project file.
- **Undo** is one click. It restores the original asset bytes, WAV formats, blocks, declarations,
  block positions, comment geometry and folder state.

Measured on the 47.4 MB benchmark (project 811805586, Scratch and TurboWarp): **41.8 MB after
a 5.61 MB reduction (-11.8%)**. 76 vector costumes and 317 bitmap costumes were optimised, 38 of
45 WAVs became MP3, 33,667 blocks and 511 scripts stayed, 697 declarations were sorted, 516
blocks were arranged and 32 sprites were filed into 5 folders. Undo returned the project JSON
byte-for-byte and the non-stage assets to 44,483,970 bytes on both hosts.

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
node users2-test.mjs   # raw JSON page, fetch intercept, comment trace
node optimize-test.mjs # SVG, PNG, WAV, code cleanup, folders, undo
node optimize-folders-test.mjs # custom, generic, empty folders and exact undo
node optimize-benchmark.mjs  # 47.4 MB project, exact undo and asset totals
node optimize-gui-smoke.mjs  # every sprite and costume thumbnail after optimize
node optimize-live-smoke.mjs <url> <lang> [full|dialog] [scratchlanguage]
node probe-undo-json.mjs     # project JSON must be byte-identical after undo
```

The costume editor half is one file, `adox-kostum.js`, in the page's own world because it
needs Scratch's Paper.js scope and Redux store. 6,200 lines. Sorry. The project optimizer is
`optimizer.js`, also in the page's world so it can reach the same VM; `lame.min.js` is the
vendored MP3 encoder.

MIT. Scratch, TurboWarp and PenguinMod don't endorse this and get nothing from it.
