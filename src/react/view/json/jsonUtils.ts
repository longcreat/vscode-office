import { buildJsonPath, getJsonNodeKind, type JsonValue } from '../../../provider/jsonCore.ts';

export interface JsonStats {
    rootType: 'object' | 'array' | 'value';
    topCount: number;
    totalNodes: number;
    maxDepth: number;
}

export function computeJsonStats(root: JsonValue | null, maxWalk = 25000): JsonStats {
    if (root === null || root === undefined) {
        return { rootType: 'value', topCount: 0, totalNodes: 1, maxDepth: 0 };
    }
    const rootType = getJsonNodeKind(root);
    const topCount = rootType === 'array'
        ? (root as JsonValue[]).length
        : rootType === 'object'
            ? Object.keys(root as Record<string, JsonValue>).length
            : 0;

    let totalNodes = 0;
    let maxDepth = 0;

    const walk = (node: JsonValue, depth: number) => {
        if (totalNodes >= maxWalk) return;
        totalNodes += 1;
        if (depth > maxDepth) maxDepth = depth;
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                if (totalNodes >= maxWalk) break;
                walk(node[i], depth + 1);
            }
        } else if (typeof node === 'object' && node !== null) {
            const values = Object.values(node);
            for (let i = 0; i < values.length; i++) {
                if (totalNodes >= maxWalk) break;
                walk(values[i], depth + 1);
            }
        }
    };

    walk(root, 0);
    return { rootType, topCount, totalNodes, maxDepth };
}

export function buildJsAccessor(path: (string | number)[], rootVar = 'data'): string {
    let out = rootVar;
    for (const seg of path) {
        if (typeof seg === 'number' || /^\d+$/.test(String(seg))) {
            out += `[${seg}]`;
        } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(seg))) {
            out += `.${seg}`;
        } else {
            out += `[${JSON.stringify(String(seg))}]`;
        }
    }
    return out;
}

export function resolveJsonNodeByPath(root: JsonValue | null, path: (string | number)[]): JsonValue | undefined {
    if (root === null) return path.length === 0 ? null : undefined;
    let cur: unknown = root;
    for (const seg of path) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        if (Array.isArray(cur)) {
            const idx = typeof seg === 'number' ? seg : Number(seg);
            if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
            cur = cur[idx];
        } else {
            cur = (cur as Record<string, unknown>)[String(seg)];
        }
    }
    return cur as JsonValue | undefined;
}

export function formatShortScalar(val: JsonValue, maxLen = 28): string {
    if (val === null) return 'null';
    if (typeof val === 'string') {
        const clean = val.replace(/\s+/g, ' ');
        return `"${clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean}"`;
    }
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return `[${val.length}]`;
    if (typeof val === 'object') return `{${Object.keys(val).length}}`;
    return String(val);
}

/** 生成折叠或展开节点的简洁内联预览 */
export function formatBranchInlineSummary(value: JsonValue, maxEntries = 4): {
    badge: string;
    preview: string;
} {
    if (Array.isArray(value)) {
        const len = value.length;
        const badge = `[${len}]`;
        if (len === 0) return { badge, preview: '[]' };
        const items: string[] = [];
        for (let i = 0; i < Math.min(len, maxEntries); i++) {
            const item = value[i];
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                const keys = Object.keys(item);
                const firstKey = keys[0];
                if (firstKey !== undefined) {
                    items.push(`{ ${firstKey}: ${formatShortScalar((item as Record<string, JsonValue>)[firstKey], 16)}${keys.length > 1 ? ', …' : ''} }`);
                } else {
                    items.push('{}');
                }
            } else {
                items.push(formatShortScalar(item, 22));
            }
        }
        if (len > maxEntries) items.push(`… +${len - maxEntries}`);
        return { badge, preview: `[ ${items.join(', ')} ]` };
    }

    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, JsonValue>);
        const len = entries.length;
        const badge = `{${len}}`;
        if (len === 0) return { badge, preview: '{}' };
        const parts: string[] = [];
        for (let i = 0; i < Math.min(len, maxEntries); i++) {
            const [k, v] = entries[i];
            parts.push(`${k}: ${formatShortScalar(v, 22)}`);
        }
        if (len > maxEntries) parts.push(`… +${len - maxEntries}`);
        return { badge, preview: `{ ${parts.join(', ')} }` };
    }

    return { badge: '', preview: String(value) };
}

const COLOR_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FN_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%]+[\s,]+[\d.%]+[\s,]+[\d.%]+(?:\s*[,/]\s*[\d.%]+)?\s*\)$/i;
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function isColorString(val: string): boolean {
    const trimmed = val.trim();
    return COLOR_HEX_RE.test(trimmed) || COLOR_FN_RE.test(trimmed);
}

export function isUrlString(val: string): boolean {
    return URL_RE.test(val.trim());
}

export function isIsoDateString(val: string): boolean {
    if (!ISO_DATE_RE.test(val.trim())) return false;
    const t = Date.parse(val);
    return !Number.isNaN(t);
}

/** 提取并净化内联 SVG 字符串（支持 <svg>...</svg> 或 data:image/svg+xml） */
export function extractSanitizedSvg(val: string): string | null {
    if (!val || typeof val !== 'string') return null;
    let raw = val.trim();

    if (/^data:image\/svg\+xml/i.test(raw)) {
        const commaIdx = raw.indexOf(',');
        if (commaIdx === -1) return null;
        const meta = raw.slice(0, commaIdx);
        const payload = raw.slice(commaIdx + 1);
        try {
            if (/;base64/i.test(meta)) {
                raw = atob(payload);
            } else {
                raw = decodeURIComponent(payload);
            }
        } catch {
            return null;
        }
    }

    const startIdx = raw.search(/<svg[\s>]/i);
    if (startIdx === -1) return null;
    const endMatch = /<\/svg\s*>/i.exec(raw.slice(startIdx));
    if (!endMatch) return null;
    const svgSlice = raw.slice(startIdx, startIdx + endMatch.index + endMatch[0].length);

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgSlice, 'image/svg+xml');
        if (doc.querySelector('parsererror')) {
            const htmlDoc = parser.parseFromString(svgSlice, 'text/html');
            const htmlSvg = htmlDoc.querySelector('svg');
            if (!htmlSvg) return null;
            return cleanSvgElement(htmlSvg);
        }
        const svgEl = doc.documentElement;
        if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') return null;
        return cleanSvgElement(svgEl);
    } catch {
        return null;
    }
}

function cleanSvgElement(svgEl: Element): string {
    const clone = svgEl.cloneNode(true) as Element;
    clone.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove());
    const walk = (el: Element) => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
            } else if ((name === 'href' || name === 'xlink:href') && value.startsWith('javascript:')) {
                el.removeAttribute(attr.name);
            }
        }
        for (const child of Array.from(el.children)) {
            walk(child);
        }
    };
    walk(clone);
    if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    return new XMLSerializer().serializeToString(clone);
}

export function tryParseNestedJson(val: string): JsonValue | null {
    const trimmed = val.trim();
    if (trimmed.length < 2) return null;
    if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed) as JsonValue;
        if (parsed && typeof parsed === 'object') return parsed;
        return null;
    } catch {
        return null;
    }
}

export interface ArraySourceOption {
    pathKey: string;
    path: (string | number)[];
    jsonPath: string;
    count: number;
    isObjectEntries?: boolean;
}

/** 自动扫描 JSON 中可用于表格视图的数组或顶层对象 */
export function collectArraySources(root: JsonValue | null): ArraySourceOption[] {
    if (root === null || root === undefined || typeof root !== 'object') return [];
    const results: ArraySourceOption[] = [];

    const walk = (node: JsonValue, path: (string | number)[], depth: number) => {
        if (results.length >= 25 || depth > 4) return;
        if (Array.isArray(node)) {
            if (node.length > 0 || path.length === 0) {
                results.push({
                    pathKey: JSON.stringify(path),
                    path,
                    jsonPath: buildJsonPath(path),
                    count: node.length,
                });
            }
            // 也检查前几个元素的子数组
            for (let i = 0; i < Math.min(node.length, 3); i++) {
                if (node[i] && typeof node[i] === 'object') {
                    walk(node[i], [...path, i], depth + 1);
                }
            }
        } else if (typeof node === 'object' && node !== null) {
            for (const [k, v] of Object.entries(node)) {
                if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
                    walk(v, [...path, k], depth + 1);
                }
            }
        }
    };

    walk(root, [], 0);

    // 如果整个文档中没有任何数组，或者根节点是对象，也允许把根对象的键值表或子对象字典当作表格查看
    if (!Array.isArray(root) && typeof root === 'object' && root !== null) {
        const keys = Object.keys(root);
        if (keys.length > 0) {
            results.push({
                pathKey: '__root_object__',
                path: [],
                jsonPath: '$ (Object)',
                count: keys.length,
                isObjectEntries: true,
            });
        }
    }

    return results;
}
