const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, urlPath === '/' ? '/vditor/test/test-heading-numbering.html' : urlPath);
    fs.readFile(file, (err, data) => {
        if (err) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.end(data);
    });
});
(async () => {
    await new Promise((r) => server.listen(8940, '127.0.0.1', r));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
    await page.addInitScript(() => localStorage.setItem('vditor-global-settings', JSON.stringify({ headingNumbering: true, headingNumberingStyle: 'chinese' })));
    await page.goto('http://127.0.0.1:8940/');
    await page.waitForSelector('.vditor-wysiwyg .vditor-reset > h2', { timeout: 15000 });
    await page.waitForTimeout(500);
    const read = () => page.evaluate(() => ({
        num: document.querySelector('.vditor-wysiwyg .vditor-reset > h2')?.getAttribute('data-hn-num'),
        toolbarLabel: window.vditor.vditor.toolbar.elements['heading-numbering']?.querySelector('[data-hn-style-label]')?.textContent,
        btnDisabled: window.vditor.vditor.toolbar.elements['heading-numbering']?.querySelector('button[data-type="heading-numbering"]')?.classList.contains('vditor-menu--disabled'),
    }));
    console.log('initial (chinese, on):', JSON.stringify(await read()));
    await page.click('button[data-type="settings"]');
    await page.waitForTimeout(300);
    await page.click('[data-toggle-key="headingNumbering"]');
    await page.waitForTimeout(400);
    const off = await read();
    console.log('after toggle off:', JSON.stringify(off), '(expect num=null btnDisabled=true)');
    await page.click('[data-toggle-key="headingNumbering"]');
    await page.waitForTimeout(400);
    const on = await read();
    console.log('after toggle on:', JSON.stringify(on), '(expect num=一、 btnDisabled=false)');
    await page.screenshot({ path: path.join(__dirname, 'hn-toggle-final.png') });
    await browser.close(); server.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
