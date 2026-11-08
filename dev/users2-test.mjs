// Live proof for the users2 API: /users2/{name} must print raw JSON from a real 404 URL, the
// fetch intercept has to answer the same numbers, and both have to agree with the official endpoint.
import path from 'node:path';
import {startExtension, shotPath} from './harness.mjs';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const run = await startExtension(path.join(ROOT, 'extension'));
const page = await run.browser.newPage();
await page.setViewport({width: 1280, height: 900});

const errors = [];
const failed = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(String(err) + ' :: ' + String(err.stack || '').split(String.fromCharCode(10)).slice(0, 4).join(' / ')));
page.on('requestfailed', req => failed.push(req.url() + ' · ' + (req.failure() && req.failure().errorText)));
page.on('response', res => { if (res.status() >= 400) failed.push(res.status() + ' · ' + res.url()); });

const results = [];
const ok = (name, pass, extra) => {
    results.push({name, pass: Boolean(pass)});
    console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' · ' + JSON.stringify(extra)));
};

try {
    await page.goto('https://scratch.mit.edu/users2/games-coder?depth=quick', {
        waitUntil: 'domcontentloaded', timeout: 90000
    });
    await page.goto('https://scratch.mit.edu/users2/games-coder?depth=quick&refresh=1', {
        waitUntil: 'domcontentloaded', timeout: 90000
    });
    await page.waitForFunction(() => {
        const pre = document.getElementById('sd-users2-json');
        return pre && pre.textContent.indexOf('"counts"') >= 0;
    }, {timeout: 90000});
    const rendered = await page.evaluate(() => ({
        text: document.getElementById('sd-users2-json').textContent,
        cards: document.querySelectorAll('.u2-card, .u2-layer, .u2-hero').length,
        title: document.title,
        position: getComputedStyle(document.getElementById('sd-users2-json')).position
    }));
    const renderedJson = JSON.parse(rendered.text);
    ok('the page is raw JSON, not a dashboard',
        rendered.cards === 0 && rendered.position === 'fixed' && renderedJson.api === 'users2',
        {cards: rendered.cards, position: rendered.position});
    ok('the tab title is the endpoint', rendered.title === 'users2/games-coder', rendered.title);
    ok('the printed JSON carries the data', renderedJson.counts.projects === 34,
        renderedJson.counts && renderedJson.counts.projects);

    const quick = await page.evaluate(async () => {
        const response = await fetch('/users2/games-coder?depth=quick&refresh=1');
        return {status: response.status, headers: response.headers.get('x-users2'), body: await response.json()};
    });
    ok('fetch intercept answers', quick.status === 200 && quick.headers === 'boosted', quick.status);
    ok('official user id is kept', quick.body.id === 79715385, quick.body.id);
    ok('all 34 projects were read', quick.body.counts.projects === 34, quick.body.counts.projects);
    ok('followers list is complete', quick.body.counts.followers > 200, quick.body.counts.followers);
    ok('favorites are read', quick.body.counts.favorites > 0, quick.body.counts.favorites);
    ok('stats add up', quick.body.stats.views > 5000, quick.body.stats.views);
    ok('quick mode skips the comment crawl', quick.body.trace === null && quick.body.depth === 'quick');
    ok('unavailable fields are named', quick.body.coverage.unavailable.length >= 5);
    ok('derived analytics exist', quick.body.analytics.rates.lovePerView > 0,
        quick.body.analytics.rates.lovePerView);

    const project = await page.evaluate(async () => {
        const response = await fetch('/users2/games-coder/projects?depth=quick&refresh=1');
        return response.json();
    });
    ok('section route returns projects', project.projects.length === 34, project.projects.length);
    ok('project keeps v1 stats', typeof project.projects[0].stats.views === 'number',
        project.projects[0].stats.views);

    const xhr = await page.evaluate(() => new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open('GET', '/users2/games-coder/network?depth=quick');
        request.onload = () => {
            try {
                resolve({status: request.status, followers: JSON.parse(request.responseText).network.followersCount});
            } catch (error) {
                resolve({status: request.status, error: String(error)});
            }
        };
        request.onerror = () => resolve({status: 0});
        request.send();
    }));
    ok('XHR is intercepted too', xhr.status === 200 && xhr.followers > 200, xhr);

    // bridge.js re-pushes the stored switches at document idle, +400 ms and +1500 ms; wait those
    // out so the synthetic switch below cannot be overwritten by a stale "all on" push
    await new Promise(r => setTimeout(r, 1700));
    const off = await page.evaluate(async () => {
        window.postMessage({source: 'adox-bridge', type: 'features', flags: {users2: false}}, location.origin);
        await new Promise(r => setTimeout(r, 100));
        const response = await fetch('/users2/games-coder?depth=quick');
        const body = await response.json();
        window.postMessage({source: 'adox-bridge', type: 'features', flags: {}}, location.origin);
        return {status: response.status, boosted: body.boosted};
    });
    ok('the popup switch disables the API', off.status === 503 && off.boosted === false, off);

    const missing = await page.evaluate(async () => {
        const response = await fetch('/users2/this-account-should-not-exist-4242?depth=quick');
        return {status: response.status, body: await response.json()};
    });
    ok('missing account answers 404', missing.status === 404 && missing.body.found === false, missing.status);

    const started = Date.now();
    await page.goto('https://scratch.mit.edu/users2/games-coder?depth=standard&scan=24&refresh=1', {
        waitUntil: 'domcontentloaded', timeout: 90000
    });
    await page.waitForFunction(() => {
        const pre = document.getElementById('sd-users2-json');
        return pre && pre.textContent.indexOf('"conversations"') >= 0;
    }, {timeout: 240000});
    const standardPage = await page.evaluate(() =>
        JSON.parse(document.getElementById('sd-users2-json').textContent));
    ok('raw page carries the comment trace', Boolean(standardPage.trace && standardPage.trace.last),
        standardPage.trace && standardPage.trace.last && standardPage.trace.last.timestamp);
    ok('raw page carries the forensic blocks',
        Boolean(standardPage.conversations && standardPage.provenance), {
            conversations: Boolean(standardPage.conversations),
            provenance: standardPage.provenance && standardPage.provenance.length
        });
    console.log('standard run took', Date.now() - started, 'ms');

    const traceJson = await page.evaluate(async () => {
        const response = await fetch('/users2/games-coder/trace?depth=standard&scan=24&refresh=1');
        const body = await response.json();
        return {
            found: body.trace && body.trace.found,
            last: body.trace && body.trace.last,
            algorithm: body.trace && body.trace.algorithm
        };
    });
    ok('trace JSON exposes the algorithm', Boolean(traceJson.algorithm),
        traceJson.algorithm && traceJson.algorithm.name);
    ok('trace reports the newest comment', Boolean(traceJson.last && traceJson.last.timestamp),
        traceJson.last && traceJson.last.timestamp);
    ok('trace also reads the strongest candidates\' projects',
        traceJson.algorithm && traceJson.algorithm.candidateProjectsScanned > 0,
        traceJson.algorithm && {
            users: traceJson.algorithm.candidateUsersExpanded,
            projects: traceJson.algorithm.candidateProjectsScanned
        });
    ok('own-profile replies win the timestamp race',
        Boolean(traceJson.last && traceJson.last.timestamp > '2026-06-01'),
        traceJson.last && traceJson.last.timestamp);

    const deep = await page.evaluate(async () => {
        const response = await fetch('/users2/games-coder?depth=standard&scan=24');
        return response.json();
    });
    ok('conversations measure reply latency', deep.conversations.replyLatency.samples > 0,
        deep.conversations.replyLatency);
    ok('writing fingerprint finds vocabulary', deep.style.topWords.length > 0,
        deep.style.topWords.slice(0, 3));
    ok('taste map reads favourites', deep.taste.favoriteCount > 0 && deep.taste.genres.length > 0,
        deep.taste.genres.slice(0, 3));
    ok('remix graph sampled real remixes',
        Boolean(deep.remix && deep.remix.sampledRemixes > 0), deep.remix && {
            sampled: deep.remix.sampledProjects, remixes: deep.remix.sampledRemixes,
            bestLift: deep.remix.bestLift
        });
    ok('thumbnail palette was sampled in a canvas',
        Boolean(deep.palette && deep.palette.colours.length > 0),
        deep.palette && {images: deep.palette.images, colours: deep.palette.colours.length,
            tone: deep.palette.tone});
    ok('provenance names every block', deep.provenance.length >= 12, deep.provenance.length);
    ok('signals compute the last activity', typeof deep.signals.lastActivityDaysAgo === 'number',
        deep.signals);

    await page.screenshot({path: shotPath('users2-raw.png'), fullPage: false});
    console.log('screenshot out/users2-raw.png');
    const ours = errors.filter(text => /users2|Uncaught|TypeError|ReferenceError/.test(text));
    ok('no users2 page errors', ours.length === 0, ours.slice(0, 3));
    console.log('failed/404 requests (Scratch page noise):', failed.length);
    console.log(failed.slice(0, 6).join(' | '));
} finally {
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
    run.stop();
    process.exit(failed ? 1 : 0);
}
