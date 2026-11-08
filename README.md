# ScratchDream

A Chrome extension that puts real drawing tools inside the Scratch costume editor.
Works on Scratch, TurboWarp and PenguinMod with the same code.

It doesn't replace the editor. Same canvas, same panels, same undo stack, same project file.
The tools borrow the editor's own colours and fonts, so they look like they belong there.
On a custom TurboWarp theme they follow it, because we never hardcode a colour.

![ScratchDream in the costume editor](docs/assets/banner.png)

## What it adds

**Vector bitmapping** (`Alt+P`) — a pixel editor in its own window. It writes real vector
paths instead of a bitmap, so a sprite can be scaled on stage without going blurry.
Nine tools, a palette pulled from your own drawing, whole-pixel moves only.

**Animation anchor** (`Alt+D`) — measures how far the artwork actually jumps from one
costume to the next and writes a shared pivot for all of them. One number, then the fix.
Only the rotation centre changes; nothing is redrawn.

**31 shapes**, arm one and drag it like the native rectangle tool. **Pressure pen** with 6
nib profiles and 11 tips, `[` and `]` for thickness. **Layer rail** on the right edge of the
canvas: pick, hide, lock, rename, reorder, align, rotate, opacity. **Masks and 16 blend
modes**, the corner-spike fix, transparent PNG export. **2, 3 and 4-stop gradients** inside
the editor's own colour dialog.

Plus three things that aren't drawing: a **plan board** in the costume tab, **sprite
folders** above the sprite list, and a **load diet** that polls slower when you're idle and
drops analytics requests.

On scratch.mit.edu itself it also rewrites the home page, the forums, Explore, the profile
grid and the comment reply box, and adds **users2**, a boosted profile API. That part is
separate code and it does make network requests; see Privacy.

## Install

No build step, no package manager.

1. Download the repo (Code → Download ZIP) or `git clone https://github.com/Syron01/ScratchDream.git`
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder — the one holding
   `manifest.json`. Not the repo root.
4. Press `F5` on your editor tab and open **Costumes**.

Four buttons show up in the tool column. **Vector bitmapping** sits next to
Convert to Bitmap / Convert to Vector.

Updating is the same three files: replace the folder contents, hit the reload icon on the
ScratchDream card, `F5`. The version in the panel is read from `manifest.json`, so it can't
lie to you.

Chrome, Edge, Brave and Opera. Not Firefox — this needs `world: "MAIN"` content scripts and
`declarativeNetRequest`.

If the buttons don't appear: you're probably on the Code tab, or the switch for that tool is
off in the toolbar panel, or the costume is a bitmap and the tool wants a vector.

## Shortcuts

| Key | What |
|---|---|
| `Alt+P` | open / close Vector bitmapping |
| `Alt+D` | open Animation anchor; applies the current plan when it's already open |
| `Alt+M` | mask / release the selected shape |
| `Alt+B` | next blend mode (`Alt+Shift+B` goes back) |
| `Alt+J` | kill a corner spike (miter limit 1.2) |
| `Alt+X` | transparent PNG |
| `[` / `]` | thinner / thicker nib |
| `Alt` + wheel | pen thickness |
| `Esc` | put the panel away, then let go of the armed tool |

Nothing is grabbed while you're typing in a text field.

## users2 API

Scratch's `/users/{name}` answers with a bio and four avatar sizes. **users2** answers with
the rest of the public footprint in one JSON: every shared project and its stats, followers,
following, favourites, curated studios, recent profile comments, engagement maths, a
publishing timeline, a language/fingerprint block, and a ranked scan for the last place the
account commented.

Open [`scratch.mit.edu/users2/griffpatch`](https://scratch.mit.edu/users2/griffpatch) for the
rendered dashboard, or call it from any script on a Scratch page:

```js
const profile = await (await fetch('https://scratch.mit.edu/users2/griffpatch')).json();
profile.counts.followers;          // exact, enumerated
profile.stats.views;               // sum over every shared project
profile.analytics.rates;           // lovePerView, favoritePerView, engagementIndex
profile.trace.last;                // { location, text, timestamp, source } or null
profile.coverage.unavailable;      // what Scratch does not publish, and why
```

The head of the response is the same `id`, `username`, `scratchteam`, `history` and `profile`
pair as the official endpoint, so swapping the URL usually needs no other change.

| URL | Returns |
|---|---|
| `/users2/{name}` | everything below in one call |
| `/users2/{name}/projects` | projects only, no comment crawl |
| `/users2/{name}/favorites` | favourited projects |
| `/users2/{name}/network` | followers, following, mutuals |
| `/users2/{name}/studios` | curated and followed studios |
| `/users2/{name}/comments` | newest profile comment threads |
| `/users2/{name}/trace` | comment-location scan only |
| `/users2/{name}/timeline` | publishing months and gaps |
| `/users2/{name}/insights` | language hints, links, mentions, fingerprint |
| `/users2/{name}/analytics` | totals, rates, top projects, hidden gems |
| `/users2/{name}/raw` | upstream user object and id lists |

Switches: `depth=quick|standard|deep`, `scan=0..240` (surfaces read by the comment scan),
`refresh=1` (skip the 15-minute cache), `pretty=0` (compact JSON). Responses are cached in
`localStorage` for 15 minutes and are assembled with a bounded number of parallel requests.

**How the comment trace works.** Scratch has no comment-search endpoint and its comment lists
ignore pagination — a browser can only read the newest ~25 threads of a profile or project.
users2 therefore ranks the surfaces the account most likely wrote on (people it replied to,
people it follows, followers, authors/projects it favourited, everyone who commented on its
projects), scans that list within the request budget, and reports every comment it found by
the account with a confidence number and the exact coverage. `trace.last` is the newest of
those; the prior weights and the confidence formula are in `trace.algorithm`. Nothing is
guessed when the scan comes up empty.

**What it cannot do.** Who loved a project, view history, private projects, deleted comments
and comment history older than the last 25 threads are not published by Scratch. They are
listed in `coverage.unavailable` instead of being filled with invented values.

## Privacy

Two permissions: `storage` and `declarativeNetRequest`. No background worker, no account,
no analytics, no AI keys. No artwork ever leaves the browser.

Where requests do go: `scratch.mit.edu`, `api.scratch.mit.edu` and `cdn2.scratch.mit.edu`
for the site panels and users2, `fonts.googleapis.com` for the forum skin's web fonts, and
`forumfind.evof.cc` for the forum's search box. Posting a reply sends what you typed to
Scratch, with your own session. No other host. users2 reads only data Scratch already serves
to the page and keeps its answer in `localStorage` for 15 minutes.

The costume editor tools work entirely on your machine. Plan board notes and sprite folders
live in the site's `localStorage` and are never written into the `.sb3`.

## Development

`dev/` holds the harness we actually use: real Chrome, the unpacked extension, the live
editor. It needs Chrome and a network connection; the Chrome path is at the top of
`dev/harness.mjs`.

```bash
cd dev
npm install
node verify.mjs    # 47 end-to-end checks
node users2-test.mjs # users2 dashboard, fetch intercept and comment trace
node diet.mjs      # load diet measurements and proof the blocklist fires
node shots.mjs     # regenerate the screenshots
node banner.mjs    # regenerate the banner above
```

`node dev/probes/_locale.mjs` checks the Turkish and Arabic layouts, which is how we caught
a panel eating real brush strokes.

Everything for the costume editor is one file, `extension/adox-kostum.js`, running in the
page's own world because it needs Scratch's Paper.js scope and Redux store. It's around
6,200 lines. Better to know that before you open it. The site panels are separate scripts
in the isolated world, and a tiny `bridge.js` carries the switches across.

## License

MIT. Scratch is a Scratch Foundation project; TurboWarp and PenguinMod are separate
community forks. Nobody here endorses this extension and it endorses nobody.
