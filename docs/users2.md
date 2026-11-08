# users2 API

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
