import {
    HEADING_NUMBERING_STYLES,
    HEADING_NUMBERING_STYLE_KEY,
    resolveHeadingNumberingStyle,
    setGlobalLocalStorageSetting,
} from "../util/globalLocalStorageSettings";
import { syncHeadingNumbering } from "../ui/headingNumbering";
import {getEventName} from "../util/compatibility";
import {getToolbarCodicon} from "../util/codicon";
import {MenuItem} from "./MenuItem";
import {toggleSubMenu} from "./setToolbar";

const buildPanelHTML = (currentId: string) => {
    const i18n = window.VditorI18n;
    const item = (id: string, label: string) => `
        <button type="button" data-hn-style="${id}" class="${id === currentId ? "vditor-hn-menu__current" : ""}">
            <span>${label}</span>
        </button>`;
    return `<div class="vditor-hn-menu" role="menu">
        ${HEADING_NUMBERING_STYLES.map((style) => item(style.id, style.label)).join("")}
        ${item("custom", i18n.headingNumberingCustom ?? "Custom…")}
    </div>`;
};

const parseCustomLevelsInput = (raw: string): string[] | null => {
    const parts = raw.split(/[,，]/).map((p) => p.replace(/^\s+/, "").replace(/\s+$/, " ")).filter(Boolean);
    if (!parts.length) {
        return null;
    }
    return parts.slice(0, 6).map((part) => {
        let p = part.replace(/\{[cCaArR][1-6]\}|\{/g, (m) => (m === "{" ? "\\{" : m));
        if (!/[ \u00a0、）)\]】:]$/.test(p)) {
            p += " ";
        }
        return p;
    });
};

export class HeadingNumbering extends MenuItem {
    public element: HTMLElement;

    constructor(vditor: IVditor, menuItem: IMenuItem) {
        super(vditor, menuItem);

        const actionBtn = this.element.children[0] as HTMLElement;
        const iconHtml = menuItem.icon || getToolbarCodicon("heading-numbering");
        actionBtn.innerHTML = `${iconHtml}<span class="vditor-hn-style-label" data-hn-style-label style="display:none"></span>`;

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
            this.refreshStyleLabel();
            panelElement.style.display = "none";
            event.preventDefault();
            event.stopPropagation();
        });
        this.element.appendChild(panelElement);

        this.refreshStyleLabel();
        // 面板打开时重建以反映最新设置
        actionBtn.addEventListener(getEventName(), () => {
            panelElement.innerHTML = buildPanelHTML(resolveHeadingNumberingStyle().id);
        }, true);

        toggleSubMenu(vditor, panelElement, actionBtn, menuItem.level);
    }

    private refreshStyleLabel() {
        const label = this.element.querySelector("[data-hn-style-label]");
        if (label) {
            label.textContent = resolveHeadingNumberingStyle().levels[0] ?? "";
        }
    }

    private openCustomDialog(vditor: IVditor, panelElement: HTMLElement) {
        panelElement.style.display = "none";
        const i18n = window.VditorI18n;
        const current = resolveHeadingNumberingStyle();
        const tip = i18n.headingNumberingCustomTip
            ?? "Level 1-6 templates, comma separated. Placeholders: {c1} 1, {C1} 一, {A1} A, {a1} a, {R1} I, {r1} i";
        const title = (i18n.headingNumberingCustom ?? "Custom…").replace(/[….]+$/, "");
        const cancelLabel = i18n.aiCancel ?? "Cancel";
        const okLabel = i18n.confirm ?? i18n.aiSave ?? "OK";
        const defaultValue = current.levels.map((l) => l.trimEnd()).join(", ");

        const overlay = document.createElement("div");
        overlay.className = "vditor-confirm-overlay";
        overlay.style.zIndex = "30000";
        overlay.innerHTML = `
            <div class="vditor-confirm" role="dialog" aria-modal="true" style="max-width: 440px;">
                <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${title}</div>
                <p class="vditor-confirm__message" style="margin-bottom: 12px; font-size: 12px; opacity: 0.85; line-height: 1.5;">${tip}</p>
                <input type="text" data-hn-input class="vditor-input" style="width: 100%; box-sizing: border-box; margin-bottom: 16px; padding: 6px 10px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border-color, #ccc); background: var(--textarea-background-color, transparent); color: var(--textarea-text-color, inherit); outline: none;" />
                <div class="vditor-confirm__footer">
                    <button type="button" class="vditor-confirm__btn vditor-confirm__btn--cancel" data-cancel>${cancelLabel}</button>
                    <button type="button" class="vditor-confirm__btn vditor-confirm__btn--ok" style="background: var(--toolbar-icon-hover-color, #0969da); border-color: var(--toolbar-icon-hover-color, #0969da);" data-ok>${okLabel}</button>
                </div>
            </div>`;

        const inputEl = overlay.querySelector<HTMLInputElement>("[data-hn-input]")!;
        // 模板是用户数据，走属性赋值避免拼进 innerHTML 时被引号破坏标记
        inputEl.value = defaultValue;
        const close = () => {
            overlay.remove();
            document.removeEventListener("keydown", onKey, true);
        };
        const submit = () => {
            const raw = inputEl.value.trim();
            const levels = parseCustomLevelsInput(raw);
            if (levels) {
                while (levels.length > 0 && levels.length < 6) {
                    levels.push(levels[levels.length - 1]);
                }
                setGlobalLocalStorageSetting(HEADING_NUMBERING_STYLE_KEY, JSON.stringify({ levels }));
                syncHeadingNumbering(vditor);
                panelElement.innerHTML = buildPanelHTML(resolveHeadingNumberingStyle().id);
                this.refreshStyleLabel();
            }
            close();
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                close();
            } else if (e.key === "Enter") {
                e.stopPropagation();
                submit();
            }
        };

        overlay.querySelector("[data-cancel]")!.addEventListener("click", (e) => {
            e.stopPropagation();
            close();
        });
        overlay.querySelector("[data-ok]")!.addEventListener("click", (e) => {
            e.stopPropagation();
            submit();
        });
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                e.stopPropagation();
                close();
            }
        });
        document.addEventListener("keydown", onKey, true);

        document.body.appendChild(overlay);
        inputEl.focus();
        inputEl.select();
    }
}
