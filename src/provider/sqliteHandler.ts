import { basename } from 'path';
import { Handler } from '@/common/handler';
import { isUriReadOnly } from '@/common/fileReadOnly';
import { isWebExtensionHost } from '@/common/extensionHost';
import { i18n } from '@/common/global';
import { Uri, window, workspace } from 'vscode';
import { setDirty } from './compress/commonHandler';
import {
    canUseRowid,
    deleteRows,
    dropRowidColumn,
    execQuery,
    exportDatabase,
    getSqlJs,
    insertRow,
    listTables,
    quoteIdent,
    runStatement,
    tableColumns,
    tablePage,
    tableStructure,
    toCsv,
    toJson,
    toMarkdown,
    updateCell,
    type SqliteColumnInfo,
    type SqliteTableInfo,
} from './sqliteCore';

interface EditPayload {
    table?: string;
    rowid?: number;
    column?: string;
    value?: string | number | null;
}

const asRowid = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

export async function handleSqlite(uri: Uri, handler: Handler): Promise<void> {
    handler.on('init', async () => {
        if (isWebExtensionHost()) {
            handler.emit('sqliteError', i18n('ext.sqlite.webUnsupported'));
            return;
        }
        try {
            const SQL = await getSqlJs();
            const bytes = await workspace.fs.readFile(uri);
            const db = new SQL.Database(bytes);
            const readOnly = await isUriReadOnly(uri);
            const markDirty = () => {
                setDirty(handler, uri, true);
                handler.emit('sqliteDirty');
            };

            handler.emit('sqliteOpen', {
                fileName: basename(uri.fsPath),
                readOnly,
                tables: listTables(db),
            });

            handler.on('query', async (payload: { sql?: string }) => {
                const sql = typeof payload?.sql === 'string' ? payload.sql.trim() : '';
                if (!sql) return;
                try {
                    const outcome = runStatement(db, sql);
                    // webview 期望扁平的 {columns, rows, elapsedMs}，附加写语句信息
                    handler.emit('sqliteResult', {
                        ...outcome.result,
                        rowsModified: outcome.rowsModified,
                        isWrite: outcome.isWrite,
                    });
                    if (outcome.isWrite) {
                        // DDL 后表列表可能变化，写语句后同步最新表清单
                        handler.emit('sqliteTables', listTables(db));
                        markDirty();
                    }
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('tableInfo', async (payload: { table?: string }) => {
                const table = payload?.table;
                if (!table) return;
                try {
                    const columns = tableColumns(db, table);
                    const editable = !readOnly && canUseRowid(db, table);
                    handler.emit('sqliteTableInfo', {
                        table,
                        columns,
                        editable,
                        structure: tableStructure(db, table),
                    });
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('tablePage', async (payload: { table?: string; sortColumn?: string | null; sortDir?: string; page?: number; pageSize?: number; withRowid?: boolean }) => {
                const table = payload?.table;
                if (!table) return;
                try {
                    const pageSize = Math.min(Math.max(Number(payload.pageSize) || 200, 1), 1000);
                    const page = Math.max(Number(payload.page) || 0, 0);
                    const out = tablePage(db, table, {
                        sortColumn: payload.sortColumn || null,
                        sortDir: payload.sortDir === 'DESC' ? 'DESC' : 'ASC',
                        limit: pageSize,
                        offset: page * pageSize,
                        withRowid: payload.withRowid !== false,
                    });
                    const start = Date.now();
                    handler.emit('sqliteResult', { ...out, elapsedMs: Date.now() - start });
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('sqliteExport', async (payload: { format?: string; sql?: string; dropRowid?: boolean; baseName?: string }) => {
                const sql = typeof payload?.sql === 'string' ? payload.sql.trim() : '';
                if (!sql) return;
                try {
                    const query = execQuery(db, sql);
                    const data = payload.dropRowid ? dropRowidColumn(query.columns, query.rows) : { columns: query.columns, rows: query.rows };
                    const format = payload.format === 'json' ? 'json' : payload.format === 'md' ? 'md' : 'csv';
                    const content = format === 'json' ? toJson(data.columns, data.rows)
                        : format === 'md' ? toMarkdown(data.columns, data.rows)
                            : toCsv(data.columns, data.rows);
                    const base = (payload.baseName || 'query').replace(/[\\/:*?"<>|]/g, '_');
                    const target = await window.showSaveDialog({
                        defaultUri: Uri.joinPath(uri, '..', `${base}.${format}`),
                        filters: { [format.toUpperCase()]: [format] },
                    });
                    if (!target) return;
                    await workspace.fs.writeFile(target, new TextEncoder().encode(content));
                    window.showInformationMessage(i18n('ext.sqlite.exportDone', target.fsPath));
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('sqliteEdit', async (payload: EditPayload) => {
                const { table, column } = payload ?? {};
                const rowid = asRowid(payload?.rowid);
                if (!table || !column || rowid === undefined || readOnly) return;
                try {
                    updateCell(db, table, rowid, column, payload.value ?? null);
                    markDirty();
                    handler.emit('sqliteEditDone', { table, rowid, column, value: payload.value ?? null });
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('sqliteInsertRow', async (payload: { table?: string }) => {
                const table = payload?.table;
                if (!table || readOnly) return;
                try {
                    const rowid = insertRow(db, table);
                    markDirty();
                    handler.emit('sqliteRowInserted', { table, rowid });
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('sqliteDeleteRows', async (payload: { table?: string; rowids?: number[] }) => {
                const table = payload?.table;
                const rowids = (payload?.rowids ?? []).map(asRowid).filter((n): n is number => n !== undefined);
                if (!table || rowids.length === 0 || readOnly) return;
                try {
                    deleteRows(db, table, rowids);
                    markDirty();
                    handler.emit('sqliteRowsDeleted', { table, count: rowids.length });
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });

            handler.on('sqliteSave', async () => {
                try {
                    await workspace.fs.writeFile(uri, exportDatabase(db));
                    setDirty(handler, uri, false);
                    handler.emit('sqliteSaved');
                } catch (error) {
                    handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
                }
            });
        } catch (error) {
            handler.emit('sqliteError', error instanceof Error ? error.message : String(error));
        }
    });
}

export type { SqliteTableInfo, SqliteColumnInfo };
export { execQuery, quoteIdent };
