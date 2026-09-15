import {
    HEADING_NUMBERING_STYLES,
    HEADING_NUMBERING_STYLE_KEY,
    resolveHeadingNumberingStyle,
    setGlobalLocalStorageSetting,
} from "../util/globalLocalStorageSettings";
import { syncHeadingNumbering } from "../ui/headingNumbering";
import {getEventName} from "../util/compatibility";
import {MenuItem} from "./MenuItem";
import {toggleSubMenu} from "./setToolbar";

const renderStyleSample = (levels: string[], depth = 0): string => {
    const counters = [1, 1, 1, 1, 1, 1];
    return levels[depth]
        ?.replace(/\{([cCaArR])([1-6])\}/g, (_m, system: string) => {
            if (system === "C") {
                return "一";
            }
            if (system === "A") {
                return "A";
            }
            if (system === "R") {
                return "I";
            }
            if (system === "a") {
                return "a";
            }
            if (system === "r") {
                return "i";
            }
            return String(counters[0]);
        })
        .replace(/ /g, "\u00a0") ?? "";
};

const buildPanelHTML = (currentId: string) => {
    const i18n = window.VditorI18n;
    const item = (id: string, label: string) => `
        <button type="button" data-hn-style="${id}" class="${id === currentId ? "vditor-hn-menu__current" : ""}">
            <span>${label}</span>
            <span>${id === "custom" ? "" : renderStyleSample(HEADING_NUMBERING_STYLES.find((s) => s.id === id)?.levels ?? [])}</span>
        </button>`;
    return `<div class="vditor-hn-menu" role="menu">
        ${HEADING_NUMBERING_STYLES.map((style) => item(style.id, style.label)).join("")}
        ${item("custom", i18n.headingNumberingCustom ?? "Custom…")}
    </div>`;
};

const parseCustomLevelsInput = (raw: string): string[] | null => {
    const parts = raw.split(/\s*[,，]\s*/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) {
        return null;
    }
    return parts.slice(0, 6).map((part) =>
        // 逐字符转义：占位符 {c1} 保留，其余字符原样
        part.replace(/\{[cCaArR][1-6]\}|\{/g, (m) => (m === "{" ? "\\{" : m)));
};

export class HeadingNumbering extends MenuItem {
    public element: HTMLElement;

    constructor(vditor: IVditor, menuItem: IMenuItem) {
        super(vditor, menuItem);

        const actionBtn = this.element.children[0] as HTMLElement;
        actionBtn.innerHTML = `<span class="vditor-hn-style-label" data-hn-style-label></span>`;

        const panelElement = document.createElement("div");
        panelElement.className = `vditor-hint${menuItem.level === 2 ? "" : " vditor-panel--arrow"}`;
        panelElement.innerHTML = buildPanelHTML(resolveHeadingNumberingStyle().id);

        panelElement.addEventListener(getEventName(), (event: MouseEvent & { target: HTMLElement }) => {
            const button = event.target.closest("button[data-hn-style]") as HTMLElement | null;
            if (!button) {
                return;
            }
            const id = button.getAttribute("data-hn-style") || "";
            if (id === "custom") {
                this.openCustomDialog(vditor, panelElement);
            } else {
                setGlobalLocalStorageSetting(HEADING_NUMBERING_STYLE_KEY, id === HEADING_NUMBERING_STYLES[0].id ? undefined : id);
                syncHeadingNumbering(vditor);
            }
            panelElement.innerHTML = buildPanelHTML(resolveHeadingNumberingStyle().id);
            panelElement.style.display = "none";
            event.preventDefault();
            event.stopPropagation();
        });
        this.element.appendChild(panelElement);

        const label = actionBtn.querySelector("[data-hn-style-label]");
        if (label) {
            label.textContent = renderStyleSample(resolveHeadingNumberingStyle().levels);
        }
        // 置灰状态与编号样式标签由 syncHeadingNumbering 统一维护；面板打开时重建以反映最新设置
        actionBtn.addEventListener(getEventName(), () => {
            panelElement.innerHTML = buildPanelHTML(resolveHeadingNumberingStyle().id);
        }, true);

        toggleSubMenu(vditor, panelElement, actionBtn, menuItem.level);
    }

    private openCustomDialog(vditor: IVditor, panelElement: HTMLElement) {
        const i18n = window.VditorI18n;
        const current = resolveHeadingNumberingStyle();
        const placeholders = i18n.headingNumberingCustomTip
            ?? "Level 1-6 templates, comma separated. Placeholders: {c1} 1, {C1} 一, {A1} A, {a1} a, {R1} I, {r1} i";
        const input = window.prompt(placeholders, current.levels.join(","));
        if (input === null) {
            return;
        }
        const levels = parseCustomLevelsInput(input);
        if (!levels) {
            panelElement.style.display = "none";
            return;
        }
        while (levels.length > 0 && levels.length < 6) {
            levels.push(levels[levels.length - 1]);
        }
        setGlobalLocalStorageSetting(HEADING_NUMBERING_STYLE_KEY, JSON.stringify({ levels }));
        syncHeadingNumbering(vditor);
    }
}
