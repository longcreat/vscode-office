import { sanitizeSvgMarkup } from "./svgRender";

const MD_SOURCE_ESC_NEWLINE = "_esc_newline_";
const SVG_ATTR_SPACE_TOKEN = "__vditor_svg_sp__";

const encodeSvgOpenTagSpaces = (svgOpenTag: string): string =>
    svgOpenTag.replace(/=(["'])(.*?)\1/g, (_m, quote: string, val: string) =>
        `=${quote}${val.replace(/ /g, SVG_ATTR_SPACE_TOKEN)}${quote}`,
    );

/**
 * 规避 CommonMark / Lute 对裸 <svg>...</svg> 块的两个解析缺陷：
 * 1. Lute Type-7 HTML 块起始标签检测不识别属性值内部带空格的标签（如 viewBox="0 0 100 100"），会误判为 html-inline 并拆碎内部节点；
 * 2. CommonMark HTML 块遇到空行会提前闭合。
 */
const normalizeRawSvgBlocksInMd = (md: string): string => {
    if (!md || !/<svg\b/i.test(md)) {
        return md;
    }
    const fenceRegex = /(^\s*(?:`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\s*(?:`{3,}|~{3,})\s*$)/gm;
    const parts = md.split(fenceRegex);
    for (let i = 0; i < parts.length; i += 2) {
        if (/<svg\b/i.test(parts[i])) {
            parts[i] = parts[i].replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, (svgBlock) => {
                const withoutBlankLines = svgBlock.replace(/\r?\n[ \t]*(?:\r?\n)+/g, "\n");
                return withoutBlankLines.replace(/^<svg\b[^>]*>/i, (openTag) =>
                    encodeSvgOpenTagSpaces(openTag),
                );
            });
        }
    }
    return parts.join("");
};

/**
 * Lute.Sanitize 会剥离 <svg> 内部的 <style> 标签并将 viewBox/linearGradient 等属性名转小写，
 * 利用 html-block 上保留的 data-md-source 还原空白占位符并用安全 SVG 净化器渲染完整 SVG 预览。
 */
const restoreSvgInHtmlBlocks = (html: string): string => {
    if (!html || !html.includes("vditor-html-block__display") || !/svg/i.test(html)) {
        return html;
    }
    const decodedHtml = html.replaceAll(SVG_ATTR_SPACE_TOKEN, " ");
    if (typeof document === "undefined") {
        return decodedHtml;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = decodedHtml;
    let mutated = decodedHtml !== html;
    wrapper.querySelectorAll("[data-type='html-block'][data-md-source]").forEach((block) => {
        const cleanAttr = block.getAttribute("data-md-source") || "";
        const source = cleanAttr.replaceAll(MD_SOURCE_ESC_NEWLINE, "\n").trim();
        if (!/<svg\b[\s\S]*<\/svg>/i.test(source)) {
            return;
        }
        const display = block.querySelector(".vditor-html-block__display");
        if (!display) {
            return;
        }
        const { svg } = sanitizeSvgMarkup(source);
        if (svg) {
            display.innerHTML = svg;
            mutated = true;
        }
    });
    return mutated ? wrapper.innerHTML : html;
};

export const setLute = (options: ILuteOptions) => {
    const lute: Lute = Lute.New();
    lute.SetHeadingAnchor(options.headingAnchor);
    lute.SetInlineMathAllowDigitAfterOpenMarker(options.inlineMathDigit);
    lute.SetAutoSpace(options.autoSpace);
    lute.SetToC(options.toc);
    lute.SetFootnotes(options.footnotes);
    lute.SetFixTermTypo(options.fixTermTypo);
    lute.SetVditorCodeBlockPreview(options.codeBlockPreview);
    lute.SetVditorMathBlockPreview(options.mathBlockPreview);
    lute.SetSanitize(options.sanitize);
    lute.SetChineseParagraphBeginningSpace(options.paragraphBeginningSpace);
    lute.SetRenderListStyle(options.listStyle);
    lute.SetLinkBase(options.linkBase);
    lute.SetLinkPrefix(options.linkPrefix);
    lute.SetMark(options.mark);
    if (options.obsidian) {
        lute.SetObsidian(true);
    } else {
        lute.SetCallout(options.callout ?? false);
        lute.SetObsidianWikiLink(options.obsidianWikiLink ?? false);
        lute.SetObsidianTag(options.obsidianTag ?? false);
    }
    if (options.lazyLoadImage) {
        lute.SetImageLazyLoading(options.lazyLoadImage);
    }

    const origMd2VditorDOM = lute.Md2VditorDOM.bind(lute);
    lute.Md2VditorDOM = (markdown: string) =>
        restoreSvgInHtmlBlocks(origMd2VditorDOM(normalizeRawSvgBlocksInMd(markdown)));

    const origMd2VditorIRDOM = lute.Md2VditorIRDOM.bind(lute);
    lute.Md2VditorIRDOM = (markdown: string) =>
        restoreSvgInHtmlBlocks(origMd2VditorIRDOM(normalizeRawSvgBlocksInMd(markdown)));

    const origSpinVditorDOM = lute.SpinVditorDOM.bind(lute);
    lute.SpinVditorDOM = (html: string) =>
        restoreSvgInHtmlBlocks(origSpinVditorDOM(html));

    const origSpinVditorIRDOM = lute.SpinVditorIRDOM.bind(lute);
    lute.SpinVditorIRDOM = (html: string) =>
        restoreSvgInHtmlBlocks(origSpinVditorIRDOM(html));

    return lute;
};
