const CLEANUP_SELECTOR = [
    '.vditor-block-handle',
    // ir syntax markers, but never the --pre variant: that pre is the code block host itself
    '.vditor-ir__marker:not(.vditor-ir__marker--pre)',
    '[data-type$="-open-marker"]',
    '[data-type$="-close-marker"]',
    '.vditor-cm-chrome',
    '.vditor-mermaid-chrome',
    '.vditor-hint',
    '.cm-tooltip',
    '.cm-cursor',
    '.cm-dropCursor',
    '.cm-selectionBackground',
    '.cm-selectionMatch',
    'wbr',
].join(',');

/**
 * vditor's own code-block locator (getCmBlockSelector): wysiwyg wraps blocks in
 * .vditor-wysiwyg__block, ir tags arbitrary elements with data-type directly.
 */
function blockSelectorOf(reset) {
    return reset.closest('.vditor-ir')
        ? '[data-type="code-block"], [data-type="math-block"]'
        : '.vditor-wysiwyg__block[data-type="code-block"], .vditor-wysiwyg__block[data-type="math-block"]';
}

/**
 * Code blocks mount CodeMirror lazily and only render the lines inside their own viewport, so the
 * document has to be stretched out and walked through before it can be cloned without losing text.
 */
const CAPTURE_CSS = `
html, body { height: auto !important; overflow: visible !important; }
#vditor, .vditor, .vditor-content, .vditor-wysiwyg, .vditor-ir, pre.vditor-reset {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
}
.vditor-cm-host .cm-editor, .vditor-cm-host .cm-scroller {
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
}
`;

const BLOCK_SETTLE_TIMEOUT = 1000;
const POLL_INTERVAL = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inlineImage(img) {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || /^https?:/i.test(src)) return;
    try {
        const res = await fetch(src);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
        if (dataUrl) img.setAttribute('src', dataUrl);
    } catch (e) {
        // keep original src when the resource cannot be fetched
    }
}

function serializeStylesheets() {
    let css = '';
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            for (const rule of Array.from(sheet.cssRules || [])) {
                css += rule.cssText + '\n';
            }
        } catch (e) {
            // skip stylesheets whose rules are not accessible
        }
    }
    return css;
}

/** the theme stylesheets are scoped to #vditor[data-*-theme], so the id has to survive the rebuild */
function capturedAttrs(el) {
    const attrs = {};
    for (const attr of Array.from(el.attributes || [])) {
        if (attr.name === 'id' || attr.name.startsWith('data-')) attrs[attr.name] = attr.value;
    }
    return attrs;
}

function collectCssVariables() {
    const pick = (style) => {
        const out = [];
        for (const prop of Array.from(style)) {
            if (prop.startsWith('--')) {
                out.push(`${prop}: ${style.getPropertyValue(prop).trim()}`);
            }
        }
        return out.join('; ');
    };
    const rootVars = pick(getComputedStyle(document.documentElement));
    const bodyVars = pick(getComputedStyle(document.body));
    let css = '';
    if (rootVars) css += `:root { ${rootVars} }`;
    if (bodyVars) css += `body { ${bodyVars} }`;
    return css;
}

function captureChain(reset) {
    const chain = [];
    let node = reset;
    while (node && node !== document.body && node !== document.documentElement) {
        chain.push({ tag: node.tagName, className: typeof node.className === 'string' ? node.className : '', attrs: capturedAttrs(node) });
        node = node.parentElement;
    }
    return chain.reverse();
}

function enterCaptureMode(reset) {
    const cover = document.createElement('div');
    cover.setAttribute('data-vscode-office-export', 'cover');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;'
        + 'background:var(--vscode-editor-background,#fff);color:var(--vscode-editor-foreground,#333);'
        + 'font:13px/1.6 var(--vscode-font-family,sans-serif);';
    cover.textContent = 'Exporting…';
    document.body.appendChild(cover);
    const style = document.createElement('style');
    style.setAttribute('data-vscode-office-export', 'capture');
    style.textContent = CAPTURE_CSS;
    document.head.appendChild(style);
    const saved = { x: window.scrollX, y: window.scrollY, top: reset.scrollTop };
    return () => {
        style.remove();
        reset.scrollTop = saved.top;
        window.scrollTo(saved.x, saved.y);
        cover.remove();
    };
}

function blockIsComplete(block) {
    if (block.classList.contains('vditor-code-block-placeholder')) return false;
    const content = block.querySelector('.cm-content');
    if (!content) return true;
    const sync = block.querySelector('pre > code');
    if (!sync) return true;
    const expected = sync.textContent.replace(/\n/g, '').replace(/\s+$/, '').length;
    return content.textContent.replace(/\n/g, '').length >= expected;
}

/**
 * Walk every code block into view so lazy placeholders mount and CodeMirror renders all of its
 * lines, snapshotting each block as it goes: the editor keeps at most 15 blocks mounted and
 * recycles the ones that scrolled away again.
 */
async function captureBlocks(reset, selector) {
    const blocks = Array.from(reset.querySelectorAll(selector));
    const captured = blocks.map((block) => block.outerHTML);
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (!blockIsComplete(block)) {
            block.scrollIntoView({ block: 'center' });
            const deadline = Date.now() + BLOCK_SETTLE_TIMEOUT;
            while (Date.now() < deadline && !blockIsComplete(block)) {
                await sleep(POLL_INTERVAL);
            }
            await sleep(POLL_INTERVAL);
        }
        captured[index] = block.outerHTML;
    }
    return captured;
}

function applyCapturedBlocks(clone, captured, selector) {
    if (!captured.length) return;
    const targets = Array.from(clone.querySelectorAll(selector));
    // the document may have been edited during the walk; a shifted index must not splice snapshots into the wrong blocks
    if (targets.length !== captured.length) return;
    captured.forEach((html, index) => {
        const target = targets[index];
        if (!target || !html) return;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const node = holder.firstElementChild;
        if (node) target.replaceWith(node);
    });
}

function stripEditorState(clone) {
    clone.querySelectorAll(CLEANUP_SELECTOR).forEach((el) => el.remove());
    // ir special blocks (mermaid/math) keep their source in a marker pre hidden only by width/height,
    // which the print css unclamps; drop it unless it is the visible code host or a plain placeholder
    clone.querySelectorAll('.vditor-ir__marker--pre').forEach((pre) => {
        if (!pre.querySelector('.cm-editor') && !pre.classList.contains('vditor-code-block-placeholder')) {
            pre.remove();
        }
    });
    clone.querySelectorAll('.cm-activeLine').forEach((el) => el.classList.remove('cm-activeLine'));
    clone.querySelectorAll('.cm-focused').forEach((el) => el.classList.remove('cm-focused'));
}

/**
 * Both mode containers exist in the DOM even though only the active one holds the document, so the
 * wysiwyg-first lookup would pick an empty shell in ir mode. Prefer the reset that is actually
 * laid out and has content.
 */
function findReset(vditorEl) {
    const candidates = [
        vditorEl.querySelector('.vditor-wysiwyg .vditor-reset'),
        vditorEl.querySelector('.vditor-ir .vditor-reset'),
    ].filter(Boolean);
    if (!candidates.length) return null;
    return candidates.find((el) => el.getClientRects().length > 0 && el.innerHTML.trim().length > 0)
        || candidates.find((el) => el.innerHTML.trim().length > 0)
        || candidates[0];
}

export async function collectExportPayload() {
    const vditorEl = document.getElementById('vditor') || document.querySelector('.vditor');
    const reset = vditorEl ? findReset(vditorEl) : null;
    if (!vditorEl || !reset) return null;

    let captured = [];
    const selector = blockSelectorOf(reset);
    const restore = enterCaptureMode(reset);
    try {
        captured = await captureBlocks(reset, selector);
    } finally {
        restore();
    }

    const clone = reset.cloneNode(true);
    applyCapturedBlocks(clone, captured, selector);
    stripEditorState(clone);
    await Promise.all(Array.from(clone.querySelectorAll('img[src]')).map(inlineImage));

    return {
        html: clone.innerHTML,
        bodyClass: document.body.className,
        css: serializeStylesheets(),
        cssVars: collectCssVariables(),
        chain: captureChain(reset),
    };
}
