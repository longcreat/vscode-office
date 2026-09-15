/**
 * Rebuild a standalone, print-ready HTML document from the DOM already rendered inside the webview.
 * Shared by the extension (exportRendered) and the local export harness.
 */

const PRINT_CSS = `
html, body { height: auto !important; overflow: visible !important; }
body { margin: 0 !important; padding: 0 !important; }

.vscode-office-export .vditor,
.vscode-office-export .vditor-content,
.vscode-office-export .vditor-wysiwyg,
.vscode-office-export .vditor-ir,
.vscode-office-export .vditor-preview,
.vscode-office-export pre.vditor-reset {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
}

.vscode-office-export .vditor,
.vscode-office-export .vditor-content,
.vscode-office-export .vditor-wysiwyg,
.vscode-office-export .vditor-ir,
.vscode-office-export .vditor-preview {
    display: block !important;
    width: auto !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
}

.vscode-office-export pre.vditor-reset {
    display: block !important;
    box-sizing: border-box;
    width: auto !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 32px 40px !important;
}

/* editor chrome is stripped from the payload in exportPayload.js; these rules are the presentation backstop */
.vscode-office-export .vditor-block-handle,
.vscode-office-export .vditor-cm-chrome,
.vscode-office-export .vditor-mermaid-chrome { display: none !important; }

.vscode-office-export .cm-activeLine { background: transparent !important; }
.vscode-office-export .cm-selectionBackground,
.vscode-office-export .cm-selectionMatch,
.vscode-office-export .cm-matchingBracket { background: transparent !important; outline: none !important; box-shadow: none !important; }
.vscode-office-export .cm-cursor,
.vscode-office-export .cm-dropCursor { display: none !important; }

.vscode-office-export .vditor-cm-host,
.vscode-office-export .cm-editor,
.vscode-office-export .cm-scroller,
.vscode-office-export .cm-content,
.vscode-office-export .vditor-wysiwyg__preview,
.vscode-office-export .vditor-ir__preview,
.vscode-office-export .vditor-mermaid-host,
.vscode-office-export .language-mermaid,
.vscode-office-export .vditor-reset pre,
.vscode-office-export .vditor-reset table,
.vscode-office-export .vditor-reset blockquote {
    max-height: none !important;
    height: auto !important;
    overflow: visible !important;
}

.vscode-office-export .cm-line { white-space: pre-wrap !important; word-break: break-word !important; }
.vscode-office-export .cm-content { max-width: 100% !important; }
.vscode-office-export .vditor-reset pre > code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
    max-width: 100% !important;
}

.vscode-office-export .language-mermaid svg { max-width: 100% !important; height: auto !important; }
.vscode-office-export .vditor-reset img { max-width: 100% !important; height: auto !important; }

.vscode-office-export .vditor-reset table { display: table !important; width: 100% !important; table-layout: auto !important; }
.vscode-office-export .vditor-reset td,
.vscode-office-export .vditor-reset th { min-width: 0 !important; max-width: none !important; word-break: break-word !important; }

.vscode-office-export h1,
.vscode-office-export h2,
.vscode-office-export h3,
.vscode-office-export h4 { break-after: avoid-page; }
.vscode-office-export tr,
.vscode-office-export img,
.vscode-office-export .vditor-mermaid-host { break-inside: avoid; }

.vscode-office-export .table-of-contents { margin: 0 0 24px; }
.vscode-office-export .table-of-contents ol { margin: 0; padding-left: 22px; }
.vscode-office-export .table-of-contents li { margin: 2px 0; }
.vscode-office-export .table-of-contents a { text-decoration: none; color: inherit; }

@media print {
    .vscode-office-export pre.vditor-reset { padding: 0 !important; }
}
`;

function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

/** decode the entities a heading's inner HTML may carry, so the outline text stays readable */
function textOf(inner) {
    return String(inner)
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
}

/**
 * Give every heading a stable anchor and prepend the outline markup the pdf bookmark
 * builder (outline.js) understands: nav.table-of-contents > ol > li > a[href="#anchor"].
 */
function injectExportToc(root) {
    const items = [];
    let generated = 0;
    const withIds = root.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, attrs, inner) => {
        const text = textOf(inner);
        if (!text) {
            return match;
        }
        const existing = /\bid="([^"]*)"/i.exec(String(attrs));
        const id = existing && existing[1] ? existing[1] : `vditor-export-heading-${generated++}`;
        items.push({ level: Number(level), id, text });
        return existing && existing[1] ? match : `<h${level} id="${escapeAttr(id)}"${attrs}>${inner}</h${level}>`;
    });
    if (!items.length) {
        return withIds;
    }

    const roots = [];
    const stack = [];
    for (const item of items) {
        const node = { item, children: [] };
        while (stack.length && stack[stack.length - 1].item.level >= item.level) {
            stack.pop();
        }
        if (stack.length) {
            stack[stack.length - 1].children.push(node);
        } else {
            roots.push(node);
        }
        stack.push(node);
    }
    const renderList = (nodes) => `<ol>${nodes.map((node) => `<li><a href="#${escapeAttr(node.item.id)}">${escapeHtml(node.item.text)}</a>${node.children.length ? renderList(node.children) : ''}</li>`).join('')}</ol>`;
    return `<nav class="table-of-contents">${renderList(roots)}</nav>${withIds}`;
}

/** wrap the content in the same ancestor elements the webview used, outermost first */
function rebuildChain(chain, content) {
    return chain.reduceRight((inner, node) => {
        const attrs = Object.entries(node.attrs || {})
            .map(([name, value]) => `${name}="${escapeAttr(value)}"`).join(' ');
        const tag = /^[a-zA-Z][\w-]*$/.test(node.tag) ? node.tag.toLowerCase() : 'div';
        return `<${tag} class="${escapeAttr(node.className || '')}"${attrs ? ' ' + attrs : ''}>${inner}</${tag}>`;
    }, content);
}

export function buildRenderedExportHtml(payload, fileName, option = {}) {
    const content = option.withoutOutline ? payload.html : injectExportToc(payload.html);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(fileName)}</title>
<style>${payload.css}</style>
<style>${payload.cssVars || ''}</style>
<style>${PRINT_CSS}</style>
</head>
<body class="${escapeAttr(payload.bodyClass)} vscode-office-export">
${rebuildChain(payload.chain, content)}
</body>
</html>`;
}
