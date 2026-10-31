import { basename } from 'path';
import { Handler } from '@/common/handler';
import { isUriReadOnly } from '@/common/fileReadOnly';
import { isWebExtensionHost } from '@/common/extensionHost';
import { i18n } from '@/common/global';
import { Uri, window, workspace } from 'vscode';
import {
    inferJsonlColumns,
    parseJsonlLines,
    toCellText,
} from './jsonCore';
import { toCsv, toJson, toMarkdown } from './tabularExport';

const SAMPLE_SIZE = 200;

export async function handleJsonl(uri: Uri, handler: Handler): Promise<void> {
    handler.on('init', async () => {
        if (isWebExtensionHost()) {
            handler.emit('jsonlError', i18n('ext.jsonl.webUnsupported'));
            return;
        }
        try {
            const bytes = await workspace.fs.readFile(uri);
            const text = new TextDecoder('utf-8').decode(bytes);
            // 只 split 不 parse：大文件首次打开不再被全量解析卡住，
            // 行数立即可用；真正的 JSON.parse 延迟到每次请求的当前页
            const lines = text.split('\n');
            const parsedLines: (string | null)[] = lines.map((line) => {
                const trimmed = line.replace(/\r$/, '');
                return trimmed.trim() === '' ? null : trimmed;
            });
            // 抽样 parse 用于列推断与全局坏行估计（抽样内坏行精确计数）
            const sampleSlice = parsedLines.slice(0, SAMPLE_SIZE);
            const sampleParsed = parseJsonlLines(sampleSlice.filter((l): l is string => l !== null));
            const sampleBad = sampleSlice.filter((l) => l !== null).length - sampleParsed.filter((v) => v !== null).length;
            const columns = inferJsonlColumns(sampleParsed, SAMPLE_SIZE, 50);
            const readOnly = await isUriReadOnly(uri);

            handler.emit('jsonlOpen', {
                fileName: basename(uri.fsPath),
                fileSize: bytes.length,
                readOnly,
                total: parsedLines.filter((l) => l !== null).length,
                columns,
                sampleBad,
            });

            handler.on('jsonlPage', async (payload: { page?: number; pageSize?: number }) => {
                const pageSize = Math.min(Math.max(Number(payload?.pageSize) || 200, 1), 1000);
                const page = Math.max(Number(payload?.page) || 0, 0);
                const start = Date.now();
                // 只解析当前页：每页 200 次 parse，几十万行文件翻页仍是毫秒级
                const slice = parsedLines.slice(page * pageSize, (page + 1) * pageSize);
                const badRows: number[] = [];
                const pageRows: (string | number | boolean | null)[][] = [];
                slice.forEach((line, index) => {
                    if (line === null) {
                        badRows.push(index);
                        pageRows.push(columns.map(() => null));
                        return;
                    }
                    try {
                        const value = JSON.parse(line);
                        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
                            ? value as Record<string, unknown>
                            : { value };
                        pageRows.push(columns.map((c) => toCellText(record[c] ?? null)));
                    } catch {
                        badRows.push(index);
                        pageRows.push(columns.map(() => null));
                    }
                });
                handler.emit('jsonlResult', {
                    columns,
                    rows: pageRows,
                    total: parsedLines.filter((l) => l !== null).length,
                    badRows,
                    elapsedMs: Date.now() - start,
                });
            });

            handler.on('jsonlExport', async (payload: { format?: string }) => {
                const format = payload?.format === 'json' ? 'json' : payload?.format === 'md' ? 'md' : 'csv';
                try {
                    const start = Date.now();
                    const parsed = parseJsonlLines(lines);
                    const exportColumns = inferJsonlColumns(parsed, parsed.length, 200);
                    const rows = parsed
                        .filter((v): v is Exclude<typeof v, null> => v !== null)
                        .map((value) => {
                            const record = typeof value === 'object' && !Array.isArray(value)
                                ? value as Record<string, unknown>
                                : { value };
                            return exportColumns.map((c) => toCellText(record[c] ?? null));
                        });
                    const content = format === 'json' ? toJson(exportColumns, rows)
                        : format === 'md' ? toMarkdown(exportColumns, rows)
                            : toCsv(exportColumns, rows);
                    const base = basename(uri.fsPath).replace(/\.(jsonl|ndjson)$/i, '');
                    const target = await window.showSaveDialog({
                        defaultUri: Uri.joinPath(uri, '..', `${base}.${format}`),
                        filters: { [format.toUpperCase()]: [format] },
                    });
                    if (!target) return;
                    await workspace.fs.writeFile(target, new TextEncoder().encode(content));
                    window.showInformationMessage(i18n('ext.sqlite.exportDone', `${target.fsPath} (${Date.now() - start}ms)`));
                } catch (error) {
                    handler.emit('jsonlError', error instanceof Error ? error.message : String(error));
                }
            });
        } catch (error) {
            handler.emit('jsonlError', error instanceof Error ? error.message : String(error));
        }
    });
}
