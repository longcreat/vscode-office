/**
 * Copy as Lark: 向剪贴板写入飞书原生识别的 Markdown 纯文本。
 * 飞书只对 markdown 纯文本（管道表格、标题、行内代码等）做原生块转换；
 * 只要 text/html 非空就会退化成普通 HTML 表格，所以这里只写 plain。
 * 有选区时复用 vditor 自己的复制处理器（等价 Ctrl+C，产出选区 markdown 且 html 为空）；
 * 无选区时复制全文源码。
 */

/**
 * 飞书的粘贴转换逐行处理：源码里连续多个空行会各变成一个空段落，
 * 独立成行的 HTML 注释（如编号锚点）也会变成空块；渲染视图会折叠它们，
 * 所以本地看不出问题。写入前在代码围栏外做规范化。
 */
const QUOTE_LINE = /^(\s*)(>+)\s?(.*)$/;
const COMPLEX_INNER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BLOCK_INNER = /^\s*(?:#{1,6}\s|```|~~~)/;

export function normalizeMarkdown(markdown) {
    const lines = (markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inFence = false;
    let blankRun = 0;
    let quoteBuf = [];

    // 飞书只认"连续且内容简单"的引用块：空引用行会切断引用，引用内嵌套
    // 列表/标题会整块退化成字面 ">" 文本。纯文本引用保持引用形态；
    // 含嵌套结构的引用展平为普通块，让列表/段落以原生形态渲染。
    const flushQuote = () => {
        if (quoteBuf.length === 0) return;
        const complex = quoteBuf.some((item) => COMPLEX_INNER.test(item.inner) || BLOCK_INNER.test(item.inner));
        for (const item of quoteBuf) {
            out.push(complex ? item.raw.replace(/^(\s*)>+\s?/, '$1') : item.raw);
        }
        quoteBuf = [];
    };

    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        if (!inFence) {
            if (/^\s*<!--[\s\S]*-->\s*$/.test(line)) continue;
            const quote = QUOTE_LINE.exec(line);
            if (quote) {
                // 空引用行删除，使多段落引用连成一块
                if (quote[3].trim() !== '') {
                    blankRun = 0;
                    quoteBuf.push({ raw: line, inner: quote[3] });
                }
                continue;
            }
            flushQuote();
            if (line.trim() === '') {
                blankRun += 1;
                if (blankRun > 1) continue;
            } else {
                blankRun = 0;
            }
        } else {
            flushQuote();
        }
        out.push(line);
    }
    flushQuote();
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    while (out.length > 0 && out[0].trim() === '') out.shift();
    return out.join('\n');
}

export async function copyAsLark(editor) {
    const editorRoot = document.getElementById('vditor');
    const selection = document.getSelection();
    const hasSelection = !!selection
        && selection.rangeCount > 0
        && !selection.isCollapsed
        && !!editorRoot
        && editorRoot.contains(selection.anchorNode)
        && editorRoot.contains(selection.focusNode);
    if (hasSelection) {
        // vditor 的 copy 处理器会把选区转成 markdown 纯文本（text/html 留空），
        // 与 Ctrl+C 完全同路径，飞书侧即为原生表格/标题/代码芯片
        const ok = document.execCommand('copy');
        if (!ok) return false;
        // 读回做空行规范化再写回（readText 在本 webview 可用）；失败时保留原生复制结果
        try {
            const text = await navigator.clipboard.readText();
            const normalized = normalizeMarkdown(text);
            if (normalized && normalized !== text) {
                await navigator.clipboard.writeText(normalized);
            }
        } catch {
            // best effort: 原生复制已成功
        }
        return true;
    }
    const markdown = normalizeMarkdown(editor.getValue());
    if (!markdown) return false;
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
        return true;
    }
    return false;
}
