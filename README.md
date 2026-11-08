# ScratchDream

Costume editor tools for Scratch, TurboWarp and PenguinMod. Chrome extension, no build step.

![ScratchDream](docs/assets/banner.png)

## Install

`chrome://extensions` → turn on Developer mode → **Load unpacked** → pick the `extension` folder.
`F5` on the editor tab, open Costumes. Chrome, Edge, Brave, Opera. Not Firefox.

## What's in it

Vector pixel editor that writes real vector paths (`Alt+P`) · 31 shapes · pressure pen ·
animation anchor (`Alt+D`) · layer rail · masks + 16 blend modes · transparent PNG ·
2/3/4-stop gradients · plan board · sprite folders · load diet · forum / Explore / profile /
comment panels · **users2**, a boosted profile API.

Keys: `Alt+P` `Alt+D` `Alt+M` `Alt+B` `Alt+J` `Alt+X`, `[` and `]` for the nib, `Esc` backs out.
Nothing is grabbed while you're typing in a field.

More: [Kurulum.md](Kurulum.md) (Türkçe) · [docs/users2.md](docs/users2.md)

## Privacy

Two permissions (`storage`, `declarativeNetRequest`), no background worker, no analytics, no
account. Your art never leaves the browser.

The site panels do make requests: Scratch's own pages and API, `fonts.googleapis.com` for the
forum skin, `forumfind.evof.cc` for forum search. Posting a reply uses your own session.
users2 reads only what Scratch already serves to the page and caches it for 15 minutes.

## Dev

```bash
cd dev && npm install
node verify.mjs        # 47 checks, real Chrome, live editor
node users2-test.mjs   # users2 dashboard, fetch intercept, comment trace
```

The costume editor code is one 6,200-line file in the page's own world, `adox-kostum.js`.
Sorry.

MIT. Not affiliated with Scratch, TurboWarp or PenguinMod.
