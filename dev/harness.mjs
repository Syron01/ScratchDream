// Real end-to-end harness for the ScratchDream popup.
// Chrome ignores --load-extension on this build, so the extension is installed through the
// CDP Extensions.loadUnpacked command and every check below runs against the live editor.
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// a random port per launch: a crashed run leaves its Chrome behind, and reusing the
// fixed port silently connected the next run to that stale profile
const PORT = 9400 + Math.floor(Math.random() * 500);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// a synchronous sleep: teardown runs from a process exit handler, where nothing can be awaited
const idle = new Int32Array(new SharedArrayBuffer(4));

// the 14,7 GB did not come only from clean exits: a run that crashed, was interrupted or lost
// power leaves its profile behind forever. This takes those as well, but only after two hours,
// so a second check running in parallel keeps the folder it is still using
const STALE_MS = 2 * 60 * 60 * 1000;
function sweepProfiles() {
    const now = Date.now();
    let dirs;
    try {
        dirs = fs.readdirSync(os.tmpdir(), {withFileTypes: true});
    } catch (e) {
        return;
    }
    for (const d of dirs) {
        if (!d.isDirectory() || !d.name.startsWith('scratchdream-')) continue;
        const p = path.join(os.tmpdir(), d.name);
        try {
            if (now - fs.statSync(p).mtimeMs < STALE_MS) continue;
            fs.rmSync(p, {recursive: true, force: true});
        } catch (e) { /* still held, or somebody else already took it */ }
    }
}

// the editor picks its own language from the browser locale, so --lang is the only honest way to
// run a check in Turkish or Arabic; every caller that does not ask stays on the old en-US profile
export async function startExtension(extDir, opts) {
    const lang = (opts && opts.lang) || 'en-US';
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scratchdream-'));
    const child = spawn(CHROME, [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--window-position=-32000,-32000', '--window-size=1460,940',
        // Chrome decides a window is hidden when another window covers it — the owner's own
        // browser windows do exactly that, and a tab Chrome calls hidden stops painting, stops
        // rAF and parks the diet in its sleep lane, so every frame and lane number measured
        // against it describes the occlusion instead of the extension
        '--disable-features=CalculateNativeWinOcclusion',
        '--lang=' + lang
    ], {stdio: 'ignore'});

    let endpoint = '';
    for (let i = 0; i < 60 && !endpoint; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
            endpoint = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
        } catch (e) { /* chrome is still starting */ }
    }
    if (!endpoint) throw new Error('chrome devtools endpoint never opened');

    const id = await new Promise((resolve, reject) => {
        const ws = new WebSocket(endpoint);
        const timer = setTimeout(() => reject(new Error('Extensions.loadUnpacked timed out')), 20000);
        ws.onopen = () => ws.send(JSON.stringify({id: 1, method: 'Extensions.loadUnpacked', params: {path: extDir}}));
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id !== 1) return;
            clearTimeout(timer);
            ws.close();
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result.id);
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('cdp socket failed')); };
    });

    const browser = await puppeteer.connect({
        browserWSEndpoint: endpoint,
        protocolTimeout: 240000,
        targetFilter: t => t.type !== 'omnibox'
    });
    let closed = false;
    // every run used to leave its profile behind in TEMP and 301 of them became 14,7 GB of junk.
    // Killing the browser process alone does not clear the folder: the gpu, crashpad and the
    // extension's service worker outlive the parent, and Windows refuses to delete a file they
    // still hold, so the whole tree has to go before the folder can be taken away
    const close = () => {
        if (closed) return;
        closed = true;
        try { browser.disconnect(); } catch (e) {}
        try {
            if (process.platform === 'win32') {
                execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {stdio: 'ignore'});
            } else {
                child.kill();
            }
        } catch (e) { child.kill(); }
        sweepProfiles();
        // one locked file makes the whole recursive delete fail at once and nothing is removed,
        // so this polls rather than trusting rmSync's own retry option, which measured as never
        // retrying this error. the last handle is normally gone inside half a second
        const deadline = Date.now() + 15000;
        for (;;) {
            try {
                fs.rmSync(profile, {recursive: true, force: true});
                break;
            } catch (e) {
                if (Date.now() >= deadline) break;
                Atomics.wait(idle, 0, 0, 250);
            }
        }
    };
    // the pile came from runs that threw before their caller reached stop(), which is why the
    // cleanup is hung on the process itself and not only handed back to the caller
    process.once('exit', close);
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.once(sig, () => { close(); process.exit(130); });
    }
    return {
        browser, id, child, profile,
        stop: close
    };
}

export const shotPath = (name) => path.resolve(decodeURIComponent(new URL('.', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'out', name);
