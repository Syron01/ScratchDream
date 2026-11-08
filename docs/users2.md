# users2 API

Scratch's `/users/{name}` answers with a bio and four avatar sizes. **users2** answers with
the rest of the public footprint in one JSON: every shared project and its stats, followers,
following, favourites, curated studios, recent profile comments, engagement maths, a
publishing timeline, a language/fingerprint block, and a ranked scan for the last place the
account commented.

Open [`scratch.mit.edu/users2/griffpatch`](https://scratch.mit.edu/users2/griffpatch) and the tab
prints the response itself — no dashboard, no cards, just the JSON. Call the same URL from any
script on a Scratch page:

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
| `/users2/{name}/insights` | language hints, links, mentions, fingerprint, palette |
| `/users2/{name}/analytics` | totals, rates, top projects, hidden gems |
| `/users2/{name}/conversations` | reply latency, reply rate, conversation partners |
| `/users2/{name}/style` | vocabulary, series detection, comment habits |
| `/users2/{name}/taste` | favourite authors, recurring words, themes |
| `/users2/{name}/remix` | sampled remix graph, top remixers, lift |
| `/users2/{name}/palette` | dominant thumbnail and avatar colours |
| `/users2/{name}/signals` | last activity, dormancy, hub ratio, self-remixes |
| `/users2/{name}/provenance` | every block with its endpoint and method |
| `/users2/{name}/raw` | upstream user object and id lists |

Switches: `depth=quick|standard|deep`, `scan=0..240` (surfaces read by the comment scan),
`refresh=1` (skip the 15-minute cache), `pretty=0` (compact JSON). Responses are cached in
`localStorage` for 15 minutes and are assembled with a bounded number of parallel requests.
Long lists are capped at 2,000 entries; `coverage.truncated` names any list that hit the cap
and `coverage.complete` turns false with it.

### Forensics

Fourteen blocks in the response are inferred rather than copied, and every one is listed in
`provenance` with the endpoint that fed it and the method (`read`, `enumerated`,
`visible window`, `heuristic`, `derived`, `sampled`, `canvas pixel sample`):

- **conversations** — reply latency in minutes (median, p90, fastest), reply rate and the
  partners the account answers most. Computed from the parsed comment threads, including every
  reply under them.
- **style** — vocabulary size, lexical richness, top words, detected series, title habits and
  emoji/punctuation rates in the comments it wrote.
- **taste** — favourite authors, recurring words and keyword themes across favourites, next to
  the average views of favourites and of its own projects.
- **remix** — a sampled remix graph: who remixed it, which remix outperformed the original
  (lift), self-remixes, and the top remixes of the most-remixed projects.
- **palette** — dominant colours, brightness, saturation and temperature from project
  thumbnails and the avatar, sampled through a canvas. The CDN's `cdn2` host blocks that read
  with a CORS-less redirect, so the same path is requested from `uploads.scratch.mit.edu`.
- **signals** — last project, last traced comment, last activity, dormancy, hub ratio and
  project-to-comment density.

`palette` never downloads anything into a file; it draws a 24×18 thumbnail into an off-screen
canvas and keeps only the colour shares. `remix` and `palette` run at every depth except
`quick`.

**How the comment trace works.** Scratch has no comment-search endpoint and its comment lists
ignore pagination — a browser can only read the newest ~25 threads of a profile or project.
users2 therefore ranks the surfaces the account most likely wrote on (people it replied to,
people it follows, followers, authors/projects it favourited, everyone who commented on its
projects), scans that list within the request budget, and then spends a second hop on the
newest projects of the strongest candidates, where comments on other people's projects
actually live. It reports every comment it found by the account with a confidence number and
the exact coverage. `trace.last` is the newest of those; the prior weights, the second-hop
count and the confidence formula are in `trace.algorithm`. Nothing is guessed when the scan
comes up empty.

**What it cannot do.** Who loved a project, view history, private projects, deleted comments
and comment history older than the last 25 threads are not published by Scratch. They are
listed in `coverage.unavailable` instead of being filled with invented values.
