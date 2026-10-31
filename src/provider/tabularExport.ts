/** 表格数据导出格式化器：SQLite 与 JSONL 查看器共用 */

export type CellValue = string | number | boolean | null;

/** UTF-8 BOM 开头，保证 Excel 直接打开不乱码 */
export function toCsv(columns: string[], rows: CellValue[][]): string {
    const lines = [columns.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))];
    return `\ufeff${lines.join('\r\n')}`;
}

function csvEscape(value: CellValue): string {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toJson(columns: string[], rows: CellValue[][]): string {
    const objects = rows.map((row) => {
        const obj: Record<string, CellValue> = {};
        columns.forEach((column, i) => {
            obj[column] = row[i] ?? null;
        });
        return obj;
    });
    return JSON.stringify(objects, null, 2);
}

function mdEscape(value: CellValue): string {
    const s = value === null || value === undefined ? '' : String(value);
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function toMarkdown(columns: string[], rows: CellValue[][]): string {
    const head = `| ${columns.map(mdEscape).join(' | ')} |`;
    const sep = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.map(mdEscape).join(' | ')} |`);
    return [head, sep, ...body].join('\n');
}

export function dropRowidColumn(columns: string[], rows: CellValue[][]): { columns: string[]; rows: CellValue[][] } {
    const idx = columns.indexOf('__rowid__');
    if (idx === -1) return { columns, rows };
    return {
        columns: columns.filter((_, i) => i !== idx),
        rows: rows.map((row) => row.filter((_, i) => i !== idx)),
    };
}
