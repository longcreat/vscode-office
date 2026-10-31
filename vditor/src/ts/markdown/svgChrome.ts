import { codicon } from "../util/codicon";
import { svgAsPngUri } from "save-svg-as-png";
import { showToast } from "../ui/toast";

const SVG_HOST_CLASS = "vditor-svg-host";
const SVG_CHROME_CLASS = "vditor-svg-chrome";

const chromeMap = new WeakMap<HTMLElement, HTMLElement>();

const createSvgChrome = () => {
    const chromeRoot = document.createElement("div");
    chromeRoot.className = SVG_CHROME_CLASS;

    const toolbar = document.createElement("div");
    toolbar.className = "vditor-svg-chrome__toolbar";

    const spacer = document.createElement("div");
    spacer.className = "vditor-svg-chrome__spacer";
    toolbar.appendChild(spacer);

    const actions = document.createElement("div");
    actions.className = "vditor-svg-chrome__actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "vditor-svg-chrome__copy-btn";
    copyBtn.setAttribute("aria-label", "Copy as image");
    copyBtn.innerHTML = `<span class="vditor-svg-chrome__copy-icon">${codicon("copy")}</span>`;
    actions.appendChild(copyBtn);

    toolbar.appendChild(actions);
    chromeRoot.appendChild(toolbar);

    return { chromeRoot, copyBtn };
};

export const ensureSvgHost = (svgElement: HTMLElement) => {
    const parent = svgElement.parentElement;
    if (parent?.classList.contains(SVG_HOST_CLASS)) {
        return parent;
    }

    const host = document.createElement("div");
    host.className = SVG_HOST_CLASS;
    if (parent) {
        parent.insertBefore(host, svgElement);
        host.appendChild(svgElement);
    }
    return host;
};

export const ensureSvgChrome = (vditor: IVditor | undefined, svgElement: HTMLElement) => {
    const host = ensureSvgHost(svgElement);
    if (chromeMap.has(host)) {
        return;
    }

    const created = createSvgChrome();
    chromeMap.set(host, created.chromeRoot);
    host.insertBefore(created.chromeRoot, host.firstChild);

    created.copyBtn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    created.copyBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const svg = host.querySelector("svg");
        if (!svg) return;
        try {
            const scale = window.devicePixelRatio || 1;
            const uri = await svgAsPngUri(svg, { scale });
            const res = await fetch(uri);
            const blob = await res.blob();
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            const icon = created.copyBtn.querySelector(".codicon");
            if (icon) {
                icon.className = "codicon codicon-check";
                setTimeout(() => { icon.className = "codicon codicon-copy"; }, 1500);
            }
        } catch {
            if (vditor) {
                showToast(vditor, window.VditorI18n?.copyFailed || "Copy failed", 1000, "error");
            }
        }
    });
};

export const isInsideSvgChrome = (target: EventTarget | Node | null) => {
    if (!target) {
        return false;
    }
    const node = target instanceof Element ? target : (target as Node).parentElement;
    return !!node?.closest(`.${SVG_CHROME_CLASS}`);
};
