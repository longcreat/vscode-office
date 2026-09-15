import {
    applyHeadingNumberingClass,
    resolveHeadingNumberingStyle,
    HeadingNumberingStyle,
} from "../util/globalLocalStorageSettings";

const HEADINGS_SELECTOR = "h1,h2,h3,h4,h5,h6";
const NUMBERED_HEADINGS_SELECTOR =
    ".vditor-reset > h1,.vditor-reset > h2,.vditor-reset > h3,.vditor-reset > h4,.vditor-reset > h5,.vditor-reset > h6";

/** 编号起点锚点：置于标题前的 HTML 注释，如 <!-- heading-numbering-start --> */
export const HEADING_NUMBERING_START_MARKER = "heading-numbering-start";

type HeadingNumberingBinding = {
    observer: MutationObserver;
    rafId: number;
};

const bindings = new WeakMap<IVditor, HeadingNumberingBinding>();

// ---- 编号模板渲染 ----

const cjkNumerals = (n: number): string => {
    if (!Number.isFinite(n) || n <= 0) {
        return String(n);
    }
    const digits = "零一二三四五六七八九";
    const units = ["", "十", "百", "千", "万"];
    if (n < 10) {
        return digits[n];
    }
    if (n < 20) {
        return "十" + (n % 10 ? digits[n % 10] : "");
    }
    let rest = "";
    let remaining = n;
    let unitIndex = 0;
    let hasZero = false;
    while (remaining > 0) {
        const digit = remaining % 10;
        if (digit === 0) {
            hasZero = hasZero || rest.length > 0;
        } else {
            if (hasZero) {
                rest = digits[0] + rest;
                hasZero = false;
            }
            rest = digits[digit] + units[unitIndex] + rest;
        }
        remaining = Math.floor(remaining / 10);
        unitIndex++;
    }
    return rest;
};

const romanNumerals = (n: number, upper: boolean): string => {
    if (!Number.isFinite(n) || n <= 0) {
        return String(n);
    }
    const pairs: [number, string][] = [
        [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
        [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
    ];
    let rest = "";
    let remaining = n;
    for (const [value, numeral] of pairs) {
        while (remaining >= value) {
            rest += numeral;
            remaining -= value;
        }
    }
    return upper ? rest.toUpperCase() : rest;
};

const alphaNumerals = (n: number, upper: boolean): string => {
    if (!Number.isFinite(n) || n <= 0) {
        return String(n);
    }
    let rest = "";
    let remaining = n;
    while (remaining > 0) {
        remaining -= 1;
        rest = String.fromCharCode(97 + (remaining % 26)) + rest;
        remaining = Math.floor(remaining / 26);
    }
    return upper ? rest.toUpperCase() : rest;
};

type NumeralSystem = "decimal" | "cjk" | "upperAlpha" | "lowerAlpha" | "upperRoman" | "lowerRoman";

const NUMERAL_SYSTEMS: Record<string, NumeralSystem> = {
    c: "decimal",
    C: "cjk",
    A: "upperAlpha",
    a: "lowerAlpha",
    R: "upperRoman",
    r: "lowerRoman",
};

const formatNumeral = (system: NumeralSystem, n: number): string => {
    switch (system) {
        case "cjk":
            return cjkNumerals(n);
        case "upperAlpha":
            return alphaNumerals(n, true);
        case "lowerAlpha":
            return alphaNumerals(n, false);
        case "upperRoman":
            return romanNumerals(n, true);
        case "lowerRoman":
            return romanNumerals(n, false);
        default:
            return String(n);
    }
};

/** 模板中的空格渲染为不换行空格，避免与标题文字之间的间隔被折叠 */
export const renderHeadingNumberTemplate = (template: string, counters: number[]): string =>
    template
        .replace(/\{([cCaArR])([1-6])\}/g, (_, system: string, level: string) =>
            formatNumeral(NUMERAL_SYSTEMS[system] ?? "decimal", counters[Number(level) - 1] ?? 0))
        .replace(/ /g, "\u00a0");

// ---- 起点锚点 ----

const isNumberingStartMarker = (el: Element): boolean => {
    const type = el.getAttribute("data-type") || "";
    if (type.includes("code") || type.includes("math")) {
        return false;
    }
    const source = el.getAttribute("data-md-source") || "";
    return source.includes(HEADING_NUMBERING_START_MARKER)
        || (el.textContent || "").includes(HEADING_NUMBERING_START_MARKER);
};

/** 返回锚点标题在 reset 直接子元素中的下标，未标记时为 -1 */
const findStartAnchorIndex = (reset: HTMLElement): number => {
    const children = Array.from(reset.children);
    for (let i = 0; i < children.length; i++) {
        if (isNumberingStartMarker(children[i])) {
            for (let j = i + 1; j < children.length; j++) {
                if (/^H[1-6]$/.test(children[j].tagName)) {
                    return j;
                }
            }
            return -1;
        }
    }
    return -1;
};

// ---- 编号应用 ----

const applyHeadingNumbers = (
    host: HTMLElement,
    style: HeadingNumberingStyle,
): number | undefined => {
    const reset = host.querySelector<HTMLElement>(".vditor-reset");
    if (!reset) {
        return undefined;
    }
    const children = Array.from(reset.children);
    const headings = children.filter((el): el is HTMLElement => /^H[1-6]$/.test(el.tagName));
    if (!headings.length) {
        return undefined;
    }
    const anchorIndex = findStartAnchorIndex(reset);
    let base = 6;
    if (anchorIndex >= 0) {
        base = Number(children[anchorIndex].tagName.substring(1));
    } else {
        for (const heading of headings) {
            base = Math.min(base, Number(heading.tagName.substring(1)));
        }
    }
    const counters = [0, 0, 0, 0, 0, 0];
    headings.forEach((heading) => {
        const index = children.indexOf(heading);
        const depth = Number(heading.tagName.substring(1)) - base;
        if ((anchorIndex >= 0 && index < anchorIndex) || depth < 0 || depth > 5) {
            if (heading.hasAttribute("data-hn-num")) {
                heading.removeAttribute("data-hn-num");
            }
            return;
        }
        counters[depth] += 1;
        for (let k = depth + 1; k < 6; k++) {
            counters[k] = 0;
        }
        const num = renderHeadingNumberTemplate(style.levels[depth] ?? "", counters);
        if (heading.getAttribute("data-hn-num") !== num) {
            heading.setAttribute("data-hn-num", num);
        }
    });
    return base;
};

/** 大纲镜像正文编号：按 data-target-id 回查标题的 data-hn-num，写到条目文本节点上 */
const syncOutlineNumbers = (vditor: IVditor, outline: HTMLElement) => {
    const hosts = [vditor.wysiwyg.element, vditor.ir.element];
    for (const li of Array.from(outline.querySelectorAll("li"))) {
        const textSpan = li.querySelector(":scope > span > span:last-child");
        if (!textSpan) {
            continue;
        }
        const id = li.querySelector(":scope > span[data-target-id]")?.getAttribute("data-target-id");
        let num = "";
        if (id) {
            for (const host of hosts) {
                const heading = host.querySelector(`#${CSS.escape(id)}`);
                if (heading) {
                    num = heading.getAttribute("data-hn-num") ?? "";
                    break;
                }
            }
        }
        if ((textSpan.getAttribute("data-hn-num") ?? "") !== num) {
            if (num) {
                textSpan.setAttribute("data-hn-num", num);
            } else {
                textSpan.removeAttribute("data-hn-num");
            }
        }
    }
};

/** 工具栏按钮：显示当前样式示例，编号总开关关闭时置灰 */
const syncToolbarState = (vditor: IVditor, style: HeadingNumberingStyle) => {
    const item = vditor.toolbar?.elements?.["heading-numbering"];
    if (!item) {
        return;
    }
    const actionBtn = item.querySelector<HTMLElement>("button[data-type='heading-numbering']");
    const label = item.querySelector("[data-hn-style-label]");
    if (actionBtn) {
        const enabled = actionBtn.closest(".vditor")?.querySelector(".vditor-wysiwyg")
            ?.classList.contains("vditor--heading-numbering") === true;
        actionBtn.classList.toggle("vditor-menu--disabled", !enabled);
    }
    if (label) {
        const sample = renderHeadingNumberTemplate(style.levels[0] ?? "", [1, 1, 1, 1, 1, 1]);
        if (label.textContent !== sample) {
            label.textContent = sample;
        }
    }
};

const clearHeadingNumbers = (host: HTMLElement) => {
    host.querySelectorAll(`${NUMBERED_HEADINGS_SELECTOR}[data-hn-num]`).forEach((el) => {
        el.removeAttribute("data-hn-num");
    });
};

export const syncHeadingNumbering = (vditor: IVditor) => {
    const style = resolveHeadingNumberingStyle();
    let enabled = false;
    for (const mode of ["wysiwyg", "ir"] as const) {
        // vditor[mode].element 是内部 pre.vditor-reset，class 挂在模式容器上
        const host = vditor[mode].element.parentElement;
        if (!host) {
            continue;
        }
        if (host.classList.contains("vditor--heading-numbering")) {
            enabled = true;
            applyHeadingNumbers(host, style);
        } else {
            clearHeadingNumbers(host);
        }
    }
    const outline = vditor.outline?.element;
    if (outline) {
        if (enabled) {
            syncOutlineNumbers(vditor, outline);
        } else {
            outline.querySelectorAll("[data-hn-num]").forEach((el) => {
                el.removeAttribute("data-hn-num");
            });
        }
    }
    syncToolbarState(vditor, style);
};

const scheduleSync = (vditor: IVditor, binding: HeadingNumberingBinding) => {
    if (binding.rafId) {
        return;
    }
    binding.rafId = window.requestAnimationFrame(() => {
        binding.rafId = 0;
        syncHeadingNumbering(vditor);
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
    // 大纲延迟渲染（打开/折叠/重绘），其内容变化同样需要同步编号
    if (vditor.outline?.element) {
        binding.observer.observe(vditor.outline.element, { childList: true, subtree: true });
    }
    bindings.set(vditor, binding);
    syncHeadingNumbering(vditor);
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
