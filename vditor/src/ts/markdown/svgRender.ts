import { svgRenderAdapter } from "./adapterRender";
import { ensureSvgChrome } from "./svgChrome";

const SVG_PROCESSED_ATTR = "data-vditor-svg-processed";
const SVG_SOURCE_ATTR = "data-svg";
const DANGEROUS_TAGS = new Set(["script", "iframe", "object", "embed"]);

const extractSvgBody = (raw: string): string => {
    const trimmed = raw
        .replace(/^\uFEFF/, "")
        .replace(/<\?xml[\s\S]*?\?>/gi, "")
        .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
        .trim();
    const match = trimmed.match(/<svg\b[\s\S]*<\/svg>/i);
    return match ? match[0] : trimmed;
};

const cleanSvgDom = (svgEl: Element) => {
    if (!svgEl.getAttribute("xmlns")) {
        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    const walk = (el: Element) => {
        const children = Array.from(el.children);
        for (const child of children) {
            if (DANGEROUS_TAGS.has(child.tagName.toLowerCase())) {
                child.remove();
                continue;
            }
            for (const attr of Array.from(child.attributes)) {
                const name = attr.name.toLowerCase();
                const val = attr.value.trim().toLowerCase();
                if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && val.startsWith("javascript:"))) {
                    child.removeAttribute(attr.name);
                }
            }
            walk(child);
        }
    };
    for (const attr of Array.from(svgEl.attributes)) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && val.startsWith("javascript:"))) {
            svgEl.removeAttribute(attr.name);
        }
    }
    walk(svgEl);
};

export const sanitizeSvgMarkup = (raw: string): { svg: string; error?: string } => {
    const candidate = extractSvgBody(raw);
    if (!candidate || !/<svg\b/i.test(candidate)) {
        return { svg: "", error: "No <svg> element found" };
    }
    if (typeof DOMParser !== "undefined") {
        const xmlDoc = new DOMParser().parseFromString(candidate, "image/svg+xml");
        const parserError = xmlDoc.querySelector("parsererror");
        if (!parserError && xmlDoc.documentElement?.tagName.toLowerCase() === "svg") {
            const svgEl = xmlDoc.documentElement;
            cleanSvgDom(svgEl);
            return { svg: new XMLSerializer().serializeToString(svgEl) };
        }
        const htmlDoc = new DOMParser().parseFromString(candidate, "text/html");
        const htmlSvg = htmlDoc.body?.querySelector("svg");
        if (htmlSvg) {
            cleanSvgDom(htmlSvg);
            return { svg: htmlSvg.outerHTML };
        }
        const errText = parserError?.textContent?.trim() || "Invalid SVG markup";
        return { svg: "", error: errText };
    }
    return { svg: candidate };
};

const storeSvgSource = (item: Element, code: string) => {
    if (!item.getAttribute(SVG_SOURCE_ATTR) && code.trim()) {
        item.setAttribute(SVG_SOURCE_ATTR, code);
    }
};

const getSvgSource = (item: Element) => {
    return item.getAttribute(SVG_SOURCE_ATTR) || svgRenderAdapter.getCode(item) || "";
};

const clearSvgElement = (item: HTMLElement) => {
    item.removeAttribute(SVG_PROCESSED_ATTR);
    item.classList.remove("vditor-reset--error");
    const source = item.getAttribute(SVG_SOURCE_ATTR);
    if (source) {
        item.textContent = source;
        return;
    }
    item.innerHTML = "";
};

export const svgRender = (
    element: HTMLElement | Document = document,
    vditor?: IVditor,
) => {
    const svgElements = svgRenderAdapter.getElements(element);
    if (svgElements.length === 0) {
        return;
    }
    for (let i = 0; i < svgElements.length; i++) {
        const item = svgElements[i] as HTMLElement;
        if (
            item.parentElement?.classList.contains("vditor-wysiwyg__pre") ||
            item.parentElement?.classList.contains("vditor-ir__marker--pre")
        ) {
            continue;
        }
        if (item.getAttribute(SVG_PROCESSED_ATTR) === "true") {
            continue;
        }
        const code = getSvgSource(item).trim();
        if (!code) {
            continue;
        }
        storeSvgSource(item, code);
        clearSvgElement(item);
        const { svg, error } = sanitizeSvgMarkup(code);
        if (svg) {
            item.innerHTML = svg;
            item.setAttribute(SVG_PROCESSED_ATTR, "true");
            ensureSvgChrome(vditor, item);
        } else {
            item.className = "language-svg vditor-reset--error";
            item.textContent = `svg render error: ${error || "Invalid SVG"}`;
            item.setAttribute(SVG_PROCESSED_ATTR, "true");
        }
    }
};
