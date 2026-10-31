import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/** wasm 随构建拷贝到 out/ 根，与打包后的 extension.js 同目录 */
function locateWasm(file: string): string {
    return `${__dirname}/${file}`;
}

let sqlPromise: Promise<SqlJsStatic> | undefined;

export function getSqlJs(): Promise<SqlJsStatic> {
    if (!sqlPromise) {
        sqlPromise = initSqlJs({ locateFile: locateWasm });
    }
    return sqlPromise;
}

export interface SqliteTableInfo {
    name: string;
    type: string;
}

export interface SqliteQueryResult {
    columns: string[];
    rows: (string | number | null)[][];
    elapsedMs: number;
}

/** db.exec 的行转成可 postMessage 的原始类型：BLOB 截断显示为 hex，其余直接透传 */
function toCellValue(value: unknown): string | number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) {
        return value.length === 0 ? '' : `0x${Array.from(value.slice(0, 4096)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
    return String(value);
}

export function execQuery(db: Database, sql: string): SqliteQueryResult {
    const start = Date.now();
    const results = db.exec(sql);
    const elapsedMs = Date.now() - start;
    const first = results[0];
    if (!first) return { columns: [], rows: [], elapsedMs };
    return {
        columns: first.columns ?? [],
        rows: first.values?.map((row) => row.map(toCellValue)) ?? [],
        elapsedMs,
    };
}

export function listTables(db: Database): SqliteTableInfo[] {
    const result = execQuery(db, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
    return result.rows.map((row) => ({
        name: String(row[0]),
        type: String(row[1]),
    }));
}

export interface SqliteColumnInfo {
    name: string;
    type: string;
    notnull: boolean;
    pk: number;
    dflt: string | null;
}

/** PRAGMA 不支持参数绑定，表名经 quoteIdent 转义后拼接 */
export function tableColumns(db: Database, table: string): SqliteColumnInfo[] {
    const result = execQuery(db, `PRAGMA table_info(${quoteIdent(table)})`);
    return result.rows.map((row) => ({
        name: String(row[1]),
        type: String(row[2] ?? '').toUpperCase(),
        notnull: row[3] === 1,
        pk: Number(row[5] ?? 0),
        dflt: row[4] === null ? null : String(row[4]),
    }));
}

/** 有 rowid 才能按行定位编辑；视图与 WITHOUT ROWID 表返回 false */
export function canUseRowid(db: Database, table: string): boolean {
    try {
        execQuery(db, `SELECT rowid FROM ${quoteIdent(table)} LIMIT 1`);
        return true;
    } catch {
        return false;
    }
}

export function updateCell(db: Database, table: string, rowid: number, column: string, value: string | number | null): void {
    db.run(`UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`, [value, rowid]);
}

/** DEFAULT VALUES 只适用于全部 NOT NULL 列都有默认值的表，
 * 常见表并不满足；为 NOT NULL 无默认值的列填充类型恰当的占位值 */
export function insertRow(db: Database, table: string): number {
    const columns = tableColumns(db, table);
    const fills: { name: string; value: string | number }[] = [];
    for (const column of columns) {
        if (!column.notnull || column.dflt !== null || column.pk > 0) continue;
        fills.push({ name: column.name, value: NUMERIC_COLUMN.test(column.type) ? 0 : '' });
    }
    if (fills.length === 0) {
        db.run(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`);
    } else {
        const names = fills.map((f) => quoteIdent(f.name)).join(', ');
        const placeholders = fills.map(() => '?').join(', ');
        db.run(`INSERT INTO ${quoteIdent(table)} (${names}) VALUES (${placeholders})`, fills.map((f) => f.value));
    }
    const result = execQuery(db, 'SELECT last_insert_rowid()');
    return Number(result.rows[0]?.[0] ?? 0);
}

const NUMERIC_COLUMN = /INT|REAL|FLOA|DOUB|DEC|NUM|BOOL|CURR/i;

export function deleteRows(db: Database, table: string, rowids: number[]): void {
    if (rowids.length === 0) return;
    const placeholders = rowids.map(() => '?').join(', ');
    db.run(`DELETE FROM ${quoteIdent(table)} WHERE rowid IN (${placeholders})`, rowids);
}

const READ_ONLY_PREFIX = /^\s*(select|with|explain|pragma)\b/i;

/** SELECT/WITH/EXPLAIN/PRAGMA 之外按写语句处理，用于 dirty 判定 */
export function isWriteStatement(sql: string): boolean {
    return !READ_ONLY_PREFIX.test(sql);
}

export interface SqliteRunOutcome {
    result: SqliteQueryResult;
    rowsModified: number;
    isWrite: boolean;
}

/** 统一执行入口：SELECT 出结果集，写语句返回受影响行数 */
export function runStatement(db: Database, sql: string): SqliteRunOutcome {
    const isWrite = isWriteStatement(sql);
    const result = execQuery(db, sql);
    return {
        result,
        rowsModified: isWrite ? db.getRowsModified() : 0,
        isWrite,
    };
}

export function exportDatabase(db: Database): Uint8Array {
    return db.export();
}

export function countRows(db: Database, table: string): number | undefined {
    const quoted = `"${table.replace(/"/g, '""')}"`;
    const result = execQuery(db, `SELECT COUNT(*) FROM ${quoted}`);
    const value = result.rows[0]?.[0];
    return typeof value === 'number' ? value : Number(value);
}

export function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

// 导出格式化器与 JSONL 查看器共用，re-export 保持既有导入路径不变
export { toCsv, toJson, toMarkdown, dropRowidColumn } from './tabularExport';

export interface SqliteIndexInfo {
    name: string;
    unique: boolean;
    columns: string[];
}

export interface SqliteForeignKeyInfo {
    from: string;
    table: string;
    to: string | null;
}

export interface SqliteStructure {
    ddl: string | null;
    columns: SqliteColumnInfo[];
    indexes: SqliteIndexInfo[];
    foreignKeys: SqliteForeignKeyInfo[];
}

export function tableStructure(db: Database, table: string): SqliteStructure {
    const ddlResult = execQuery(db, `SELECT sql FROM sqlite_master WHERE name = ${quoteIdent(table)}`);
    const ddl = ddlResult.rows[0]?.[0] == null ? null : String(ddlResult.rows[0][0]);
    const columns = tableColumns(db, table);
    const indexes: SqliteIndexInfo[] = [];
    const indexList = execQuery(db, `PRAGMA index_list(${quoteIdent(table)})`);
    for (const row of indexList.rows) {
        const name = String(row[1]);
        const info = execQuery(db, `PRAGMA index_info(${quoteIdent(name)})`);
        indexes.push({
            name,
            unique: row[2] === 1,
            columns: info.rows.map((r) => String(r[2])),
        });
    }
    const foreignKeys: SqliteForeignKeyInfo[] = [];
    const fkList = execQuery(db, `PRAGMA foreign_key_list(${quoteIdent(table)})`);
    for (const row of fkList.rows) {
        foreignKeys.push({
            from: String(row[3]),
            table: String(row[2]),
            to: row[4] == null ? null : String(row[4]),
        });
    }
    return { ddl, columns, indexes, foreignKeys };
}

export interface SqlitePageOptions {
    sortColumn?: string | null;
    sortDir?: 'ASC' | 'DESC';
    limit: number;
    offset: number;
    withRowid: boolean;
}

export interface SqlitePageResult {
    columns: string[];
    rows: (string | number | null)[][];
    total: number;
}

export function tablePage(db: Database, table: string, options: SqlitePageOptions): SqlitePageResult {
    const q = quoteIdent(table);
    const total = countRows(db, table) ?? 0;
    let sql = options.withRowid
        ? `SELECT rowid AS __rowid__, * FROM ${q}`
        : `SELECT * FROM ${q}`;
    if (options.sortColumn) {
        sql += ` ORDER BY ${quoteIdent(options.sortColumn)} ${options.sortDir === 'DESC' ? 'DESC' : 'ASC'}`;
    }
    sql += ` LIMIT ${Number(options.limit)} OFFSET ${Number(options.offset)}`;
    const result = execQuery(db, sql);
    return { columns: result.columns, rows: result.rows, total };
}

