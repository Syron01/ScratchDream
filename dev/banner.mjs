// Renders docs/banner.html to docs/assets/banner.png with the local Chrome.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', '--disable-sync']
});
try {
    const page = await browser.newPage();
    await page.setViewport({width: 1280, height: 440, deviceScaleFactor: 1});
    await page.goto(pathToFileURL(path.join(ROOT, 'docs', 'banner.html')).href, {waitUntil: 'networkidle0'});
    await page.evaluate(async () => {
        await Promise.all([...document.images].map(img => img.complete ? null : new Promise(r => {
            img.addEventListener('load', r, {once: true});
            img.addEventListener('error', r, {once: true});
        })));
        await document.fonts.ready;
    });
    await page.screenshot({path: path.join(ROOT, 'docs', 'assets', 'banner.png')});
    console.log('saved docs/assets/banner.png');
} finally {
    await browser.close();
}
