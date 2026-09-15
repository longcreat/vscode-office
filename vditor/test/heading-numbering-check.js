const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, urlPath === '/' ? '/vditor/test/test-heading-numbering.html' : urlPath);
    fs.readFile(file, (err, data) => {
        if (err) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.end(data);
    });
});

const readDoc = () => Array.from(document.querySelectorAll('.vditor-wysiwyg .vditor-reset > h1, .vditor-wysiwyg .vditor-reset > h2, .vditor-wysiwyg .vditor-reset > h3'))
    .map((el) => ({ tag: el.tagName, num: el.getAttribute('data-hn-num'), text: (el.textContent || '').trim().slice(0, 10) }));
const readToc = () => Array.from(document.querySelectorAll('.vditor-outline__content li'))
    .map((li) => ({ level: li.getAttribute('data-hn-level'), num: li.querySelector(':scope > span > span:last-child')?.getAttribute('data-hn-num'), text: (li.textContent || '').trim().slice(0, 10) }));
const fmt = (rows) => rows.map((r) => `${r.num ?? '∅'} ${r.text}`).join(' | ');

(async () => {
    await new Promise((r) => server.listen(8931, '127.0.0.1', r));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));

    const DOC = '# Doc Title\n\n## Intro\n\n### Pre\n\n## First\n\n### Sub1\n\n### Sub2\n\n## Second\n\n';
    const ANCHOR_DOC = '# Doc Title\n\n<!-- heading-numbering-start -->\n\n## First\n\n### Sub1\n\n## Second\n\n';
    await page.addInitScript((v) => { window.__TEST_VALUE__ = v; localStorage.setItem('vditor-global-settings', JSON.stringify({ headingNumbering: true })); }, DOC);
    await page.goto('http://127.0.0.1:8931/');
    await page.waitForSelector('.vditor-wysiwyg .vditor-reset > h2', { timeout: 15000 });
    

    const setStyle = (value) => page.evaluate((v) => {
        const s = JSON.parse(localStorage.getItem('vditor-global-settings') || '{}');
        if (v === undefined) delete s.headingNumberingStyle; else s.headingNumberingStyle = v;
        localStorage.setItem('vditor-global-settings', JSON.stringify(s));
        window.vditor.vditor && window.dispatchEvent(new Event('resize'));
        return window.vditor && true;
    }, value).then(() => page.evaluate(() => window.vditor.switchEditMode('ir'))).then(() => page.evaluate(() => window.vditor.switchEditMode('wysiwyg')));

    console.log('--- numeric (default) ---');
    await setStyle(undefined);
    await page.waitForTimeout(400);
    console.log('doc:', fmt(await page.evaluate(readDoc)));
    console.log('toc:', fmt(await page.evaluate(readToc)));

    console.log('--- chinese ---');
    await setStyle('chinese');
    await page.waitForTimeout(400);
    console.log('doc:', fmt(await page.evaluate(readDoc)));
    console.log('toc:', fmt(await page.evaluate(readToc)));

    console.log('--- chineseHier ---');
    await setStyle('chineseHier');
    await page.waitForTimeout(400);
    console.log('doc:', fmt(await page.evaluate(readDoc)));

    console.log('--- alpha / roman ---');
    await setStyle('alpha');
    await page.waitForTimeout(400);
    console.log('alpha doc:', fmt(await page.evaluate(readDoc)));
    await setStyle('roman');
    await page.waitForTimeout(400);
    console.log('roman doc:', fmt(await page.evaluate(readDoc)));

    console.log('--- custom: 第{C1}章 / {C1}.{c2} ---');
    await setStyle(JSON.stringify({ levels: ['第{C1}章 ', '{C1}.{c2} '] }));
    await page.waitForTimeout(400);
    console.log('doc:', fmt(await page.evaluate(readDoc)));

    console.log('--- toolbar dropdown ---');
    const tb = await page.evaluate(() => {
        const item = window.vditor.vditor.toolbar.elements['heading-numbering'];
        return { exists: !!item, label: item?.querySelector('[data-hn-style-label]')?.textContent ?? null };
    });
    console.log('toolbar item:', JSON.stringify(tb));
    // 点开下拉选择 chinese
    await page.evaluate(() => window.vditor.vditor.toolbar.elements['heading-numbering'].querySelector('button[data-type="heading-numbering"]').click());
    await page.waitForSelector('button[data-hn-style="chinese"]');
    await page.click('button[data-hn-style="chinese"]');
    await page.waitForTimeout(400);
    console.log('after toolbar pick chinese, doc:', fmt(await page.evaluate(readDoc)));

    console.log('--- anchor scenario ---');
    await page.evaluate((v) => { window.vditor.setValue(v); }, ANCHOR_DOC);
    await page.waitForTimeout(600);
    console.log('doc:', fmt(await page.evaluate(readDoc)));
    console.log('toc:', fmt(await page.evaluate(readToc)));
    const roundTrip = await page.evaluate(() => window.vditor.getValue());
    console.log('round-trip keeps anchor:', roundTrip.includes('<!-- heading-numbering-start -->'));

await page.screenshot({ path: path.join(__dirname, 'hn-final.png') });
    await browser.close();
    server.close();
})().catch((e) => { console.error(e); process.exit(1); });
