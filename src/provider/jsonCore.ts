/** JSON/JSONL 查看器共享纯函数（无 vscode 依赖，webview 与主进程均可使用） */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 单元格显示：对象/数组压成单行紧凑 JSON，其余透传 */
export function toCellText(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Uint8Array) return `0x${Array.from(value.slice(0, 4096)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    return JSON.stringify(value);
}

/** 逐行解析 jsonl：返回每行解析结果（坏行为 null），空行直接跳过不计 */
export function parseJsonlLines(lines: string[]): (JsonValue | null)[] {
    const parsed: (JsonValue | null)[] = [];
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (line.trim() === '') continue;
        try {
            parsed.push(JSON.parse(line) as JsonValue);
        } catch {
            parsed.push(null);
        }
    }
    return parsed;
}

/** 抽样推断列：前 sampleSize 个可解析对象的顶层键并集（保序），上限 maxColumns */
export function inferJsonlColumns(parsed: (JsonValue | null)[], sampleSize = 100, maxColumns = 50): string[] {
    const columns: string[] = [];
    let sampled = 0;
    for (const value of parsed) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
        for (const key of Object.keys(value)) {
            if (!columns.includes(key)) columns.push(key);
        }
        sampled += 1;
        if (sampled >= sampleSize || columns.length >= maxColumns) break;
    }
    return columns.slice(0, maxColumns);
}

/** JSONPath：$.a.b[0]，特殊键名 $['a.b'] */
export function buildJsonPath(path: (string | number)[]): string {
    let out = '$';
    for (const segment of path) {
        if (typeof segment === 'number') {
            out += `[${segment}]`;
        } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
            out += `.${segment}`;
        } else {
            out += `[${JSON.stringify(segment)}]`;
        }
    }
    return out;
}

export type JsonNodeKind = 'object' | 'array' | 'value';

export function getJsonNodeKind(value: JsonValue): JsonNodeKind {
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object' && value !== null) return 'object';
    return 'value';
}

export interface JsonChildEntry {
    key: string;
    value: JsonValue;
}

/** 展开子节点：对象按键序，数组按索引；标量返回空 */
export function getJsonNodeChildren(value: JsonValue): JsonChildEntry[] {
    if (Array.isArray(value)) {
        return value.map((item, index) => ({ key: String(index), value: item as JsonValue }));
    }
    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).map(([key, item]) => ({ key, value: item as JsonValue }));
    }
    return [];
}

/** 树节点右侧摘要：{3} / [12] / 值截断预览 */
export function getJsonNodePreview(value: JsonValue): string {
    const kind = getJsonNodeKind(value);
    if (kind === 'object') return `{${Object.keys(value as object).length}}`;
    if (kind === 'array') return `[${(value as JsonValue[]).length}]`;
    if (value === null) return 'null';
    if (typeof value === 'string') {
        const preview = value.length > 120 ? `${value.slice(0, 120)}…` : value;
        return `"${preview}"`;
    }
    return String(value);
}

/** 单元格查看器内容：JSON 自动格式化，BLOB hex 附带 UTF-8 解码 */
export function formatCellView(text: string, truncatedLabel = '(truncated)'): string {
    if (/^0x[0-9a-f]+$/i.test(text)) {
        const hex = text.slice(2);
        const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
        let decoded = '';
        try {
            decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/[^\x20-\x7e\u4e00-\u9fa5\n\r\t]/g, '·');
        } catch { }
        const truncated = hex.length >= 8192 ? `${truncatedLabel}\n` : '';
        return `${truncated}${text}\n\n--- UTF-8 ---\n${decoded || '(binary)'}`;
    }
    const trimmed = text.trim();
    if (/^[{[]/.test(trimmed)) {
        try {
            return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch { }
    }
    return text;
}

/** 搜索匹配：键或值的包含匹配（不区分大小写），命中返回路径（供展开定位） */
export function collectJsonMatches(value: JsonValue, keyword: string, maxMatches = 500): { path: (string | number)[]; key: string }[] {
    const matches: { path: (string | number)[]; key: string }[] = [];
    const lower = keyword.toLowerCase();
    const walk = (node: JsonValue, path: (string | number)[], key: string) => {
        if (matches.length >= maxMatches) return;
        const keyHit = key.toLowerCase().includes(lower);
        const kind = getJsonNodeKind(node);
        if (kind === 'value') {
            if (keyHit || String(node ?? '').toLowerCase().includes(lower)) {
                matches.push({ path: [...path], key });
            }
            return;
        }
        if (keyHit) matches.push({ path: [...path], key });
        for (const child of getJsonNodeChildren(node)) {
            walk(child.value, [...path, child.key as string | number], child.key);
            if (matches.length >= maxMatches) return;
        }
    };
    walk(value, [], '');
    return matches;
}
