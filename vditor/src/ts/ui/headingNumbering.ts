import {
    applyHeadingNumberingClass,
} from "../util/globalLocalStorageSettings";

const HEADINGS_SELECTOR = "h1,h2,h3,h4,h5,h6";

type HeadingNumberingBinding = {
    observer: MutationObserver;
    rafId: number;
};

const bindings = new WeakMap<IVditor, HeadingNumberingBinding>();

/** 文档实际使用的最小标题层级（编号基准），无标题时回退为 1 */
const computeBaseLevel = (editor: HTMLElement): number => {
    let base = 0;
    for (const heading of editor.querySelectorAll(HEADINGS_SELECTOR)) {
        const level = Number(heading.tagName.substring(1));
        if (level && (!base || level < base)) {
            base = level;
            if (base === 1) {
                break;
            }
        }
    }
    return base || 1;
};

/** lute ToC 只保留标题文本，li 上不带层级信息；按 data-target-id 回查编辑中标题并标注层级，供编号 CSS 使用 */
const syncOutlineLevels = (vditor: IVditor, outline: HTMLElement) => {
    const hosts = [vditor.wysiwyg.element, vditor.ir.element];
    for (const li of Array.from(outline.querySelectorAll("li"))) {
        const id = li.querySelector(":scope > span[data-target-id]")?.getAttribute("data-target-id");
        let level = 0;
        if (id) {
            for (const host of hosts) {
                const heading = host.querySelector(`#${CSS.escape(id)}`);
                if (heading) {
                    level = Number(heading.tagName.substring(1)) || 0;
                    break;
                }
            }
        }
        const marked = level ? String(level) : "";
        if (li.getAttribute("data-hn-level") !== marked) {
            if (marked) {
                li.setAttribute("data-hn-level", marked);
            } else {
                li.removeAttribute("data-hn-level");
            }
        }
    }
};

export const syncHeadingNumberingBase = (vditor: IVditor) => {
    for (const mode of ["wysiwyg", "ir"] as const) {
        // vditor[mode].element 是内部 pre.vditor-reset，而 class 挂在模式容器
        // （div.vditor-wysiwyg / div.vditor-ir）上，基准属性必须与 class 同元素
        const host = vditor[mode].element.parentElement;
        if (!host) {
            continue;
        }
        const base = String(computeBaseLevel(host));
        if (host.getAttribute("data-hn-base") !== base) {
            host.setAttribute("data-hn-base", base);
        }
    }
    // 大纲不克隆标题标签，基准取有内容的编辑器，层级由 syncOutlineLevels 标注到 li
    const outline = vditor.outline?.element;
    if (outline) {
        let docBase = 1;
        for (const mode of ["wysiwyg", "ir"] as const) {
            const host = vditor[mode].element.parentElement;
            if (host?.querySelector(HEADINGS_SELECTOR)) {
                docBase = computeBaseLevel(host);
                break;
            }
        }
        const base = String(docBase);
        if (outline.getAttribute("data-hn-base") !== base) {
            outline.setAttribute("data-hn-base", base);
        }
        syncOutlineLevels(vditor, outline);
    }
};

const scheduleSync = (vditor: IVditor, binding: HeadingNumberingBinding) => {
    if (binding.rafId) {
        return;
    }
    binding.rafId = window.requestAnimationFrame(() => {
        binding.rafId = 0;
        syncHeadingNumberingBase(vditor);
    });
};

export const bindHeadingNumbering = (vditor: IVditor) => {
    if (bindings.has(vditor) || typeof MutationObserver === "undefined") {
        return;
    }
    applyHeadingNumberingClass(vditor.element);
    const binding: HeadingNumberingBinding = {
        observer: new MutationObserver(() => scheduleSync(vditor, binding)),
        rafId: 0,
    };
    for (const mode of ["wysiwyg", "ir"] as const) {
        binding.observer.observe(vditor[mode].element, { childList: true, subtree: true });
    }
    // 大纲延迟渲染（打开/折叠/重绘），其内容变化同样需要重算基准
    if (vditor.outline?.element) {
        binding.observer.observe(vditor.outline.element, { childList: true, subtree: true });
    }
    bindings.set(vditor, binding);
    syncHeadingNumberingBase(vditor);
};

export const unbindHeadingNumbering = (vditor: IVditor) => {
    const binding = bindings.get(vditor);
    if (!binding) {
        return;
    }
    if (binding.rafId) {
        window.cancelAnimationFrame(binding.rafId);
    }
    binding.observer.disconnect();
    bindings.delete(vditor);
};
