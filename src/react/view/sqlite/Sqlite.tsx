import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { App, Checkbox, Input, Modal, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection } from 'antd/es/table/interface';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import { $t } from '../../i18n/i18nConfig.ts';
import { handler, vscodeApi } from '../../util/vscode.ts';
import './Sqlite.less';

const PAGE_SIZE = 200;
const SQLITE_VSCODE_THEME_KEY = 'sqlite-vscode-theme';
const SQLITE_HISTORY_KEY = 'sqlite-query-history';
const ROWID_ALIAS = '__rowid__';

interface SqliteTableInfo {
    name: string;
    type: string;
}

interface SqliteColumnInfo {
    name: string;
    type: string;
    notnull: boolean;
    pk: number;
    dflt: string | null;
}

interface SqliteIndexInfo {
    name: string;
    unique: boolean;
    columns: string[];
}

interface SqliteForeignKeyInfo {
    from: string;
    table: string;
    to: string | null;
}

interface SqliteStructure {
    ddl: string | null;
    columns: SqliteColumnInfo[];
    indexes: SqliteIndexInfo[];
    foreignKeys: SqliteForeignKeyInfo[];
}

interface QueryState {
    columns: string[];
    rows: (string | number | null)[][];
    elapsedMs: number;
    isWrite?: boolean;
    rowsModified?: number;
    total?: number;
}

interface TableMeta {
    table: string;
    editable: boolean;
    columns: SqliteColumnInfo[];
}

interface EditingCell {
    rowKey: string;
    column: string;
    rowid: number;
    value: string | number | null;
}

function loadSqliteVscodeTheme(): boolean {
    const state = vscodeApi?.getState?.() as { sqliteVscodeTheme?: boolean } | undefined;
    if (state?.sqliteVscodeTheme !== undefined) {
        return state.sqliteVscodeTheme;
    }
    try {
        const saved = localStorage.getItem(SQLITE_VSCODE_THEME_KEY);
        if (saved !== null) {
            return saved === '1';
        }
    } catch { }
    return true;
}

function saveSqliteVscodeTheme(vscodeTheme: boolean) {
    try {
        localStorage.setItem(SQLITE_VSCODE_THEME_KEY, vscodeTheme ? '1' : '0');
    } catch { }
    if (vscodeApi?.setState) {
        const prev = (vscodeApi.getState?.() ?? {}) as Record<string, unknown>;
        vscodeApi.setState({ ...prev, sqliteVscodeTheme: vscodeTheme });
    }
}

function loadQueryHistory(): string[] {
    try {
        const raw = localStorage.getItem(SQLITE_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

function saveQueryHistory(history: string[]) {
    try {
        localStorage.setItem(SQLITE_HISTORY_KEY, JSON.stringify(history));
    } catch { }
}

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

const NUMERIC_TYPE = /INT|REAL|FLOA|DOUB|DEC|NUM|BOOL|CURR/i;

function formatCell(value: string | number | null): string {
    if (value === null) return '';
    return String(value);
}

function parseCellInput(text: string, columnType: string, asNull: boolean): string | number | null | 'invalid' {
    if (asNull) return null;
    if (NUMERIC_TYPE.test(columnType)) {
        if (text.trim() === '') return null;
        const num = Number(text);
        return Number.isNaN(num) ? 'invalid' : num;
    }
    return text;
}

/** 单元格查看器内容：JSON 自动格式化，BLOB hex 附带 UTF-8 解码 */
function formatCellView(text: string): string {
    if (/^0x[0-9a-f]+$/i.test(text)) {
        const hex = text.slice(2);
        const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
        let decoded = '';
        try {
            decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/[^\x20-\x7e\u4e00-\u9fa5\n\r\t]/g, '·');
        } catch { }
        const truncated = hex.length >= 8192 ? $t('sqlite.truncated') + '\n' : '';
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

type TableRow = Record<string, string | number | null> & { key: string };

function SqliteViewer() {
    const { message } = App.useApp();
    const [fileName, setFileName] = useState('');
    const [tables, setTables] = useState<SqliteTableInfo[]>([]);
    const [activeTable, setActiveTable] = useState<string | null>(null);
    const [tableMeta, setTableMeta] = useState<TableMeta | null>(null);
    const [structure, setStructure] = useState<SqliteStructure | null>(null);
    const [viewTab, setViewTab] = useState<'data' | 'structure'>('data');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sqlText, setSqlText] = useState('');
    const [result, setResult] = useState<QueryState | null>(null);
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState<number | null>(null);
    const [sort, setSort] = useState<{ column: string; dir: 'ASC' | 'DESC' } | null>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
    const [editing, setEditing] = useState<EditingCell | null>(null);
    const [editText, setEditText] = useState('');
    const [editNull, setEditNull] = useState(false);
    const [history, setHistory] = useState<string[]>(loadQueryHistory);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [viewCell, setViewCell] = useState<{ column: string; text: string } | null>(null);
    const [hasData, setHasData] = useState(false);
    const [vscodeTheme, setVscodeTheme] = useState(loadSqliteVscodeTheme);

    const readOnlyRef = useRef(false);
    const tableMetaRef = useRef<TableMeta | null>(null);
    const activeTableRef = useRef<string | null>(null);
    const querySeqRef = useRef(0);
    const pageRef = useRef(0);
    const totalRef = useRef<number | null>(null);
    const sortRef = useRef<{ column: string; dir: 'ASC' | 'DESC' } | null>(null);
    const exportSqlRef = useRef('');
    const exportDropRowidRef = useRef(false);

    const readOnlyNow = readOnly;
    const editable = !readOnly && !!tableMeta?.editable;

    const totalPages = useMemo(() => {
        if (total !== null) return Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (!result) return 1;
        return Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
    }, [total, result]);

    const tableRows = useMemo<TableRow[]>(() => {
        if (!result) return [];
        const start = page * PAGE_SIZE;
        return result.rows.slice(start, start + PAGE_SIZE).map((row, index) => {
            const record: Record<string, string | number | null> = {};
            result.columns.forEach((column, ci) => {
                record[column] = row[ci] ?? null;
            });
            return { ...record, key: `${page}-${index}` };
        });
    }, [result, page]);

    const pushHistory = useCallback((sql: string) => {
        setHistory((prev) => {
            const next = [sql, ...prev.filter((item) => item !== sql)].slice(0, 20);
            saveQueryHistory(next);
            return next;
        });
    }, []);

    /** 表数据走服务端分页：一次请求返回当前页 + 总行数 */
    const requestTablePage = useCallback((nextPage: number, sortOverride?: { column: string; dir: 'ASC' | 'DESC' } | null) => {
        const table = activeTableRef.current;
        const meta = tableMetaRef.current;
        if (!table) return;
        const activeSort = sortOverride !== undefined ? sortOverride : sortRef.current;
        const withRowid = !!meta?.editable;
        const baseSql = `SELECT ${withRowid ? `rowid AS ${ROWID_ALIAS}, *` : '*'} FROM ${quoteIdent(table)}${activeSort ? ` ORDER BY ${quoteIdent(activeSort.column)} ${activeSort.dir}` : ''}`;
        exportSqlRef.current = baseSql;
        exportDropRowidRef.current = withRowid;
        pageRef.current = nextPage;
        setSqlText(baseSql);
        setSelectedRowKeys([]);
        setEditing(null);
        const seq = ++querySeqRef.current;
        setLoading(true);
        handler.emit('tablePage', {
            table,
            sortColumn: activeSort?.column ?? null,
            sortDir: activeSort?.dir ?? null,
            page: nextPage,
            pageSize: PAGE_SIZE,
            withRowid,
        });
        window.setTimeout(() => {
            if (seq === querySeqRef.current) setLoading(false);
        }, 15000);
    }, []);

    const selectTable = useCallback((table: SqliteTableInfo) => {
        setActiveTable(table.name);
        activeTableRef.current = table.name;
        setTableMeta(null);
        tableMetaRef.current = null;
        setStructure(null);
        setViewTab('data');
        setSort(null);
        sortRef.current = null;
        setTotal(null);
        totalRef.current = null;
        setEditing(null);
        setResult(null);
        handler.emit('tableInfo', { table: table.name });
    }, []);

    const runSql = useCallback((sql: string) => {
        const seq = ++querySeqRef.current;
        setLoading(true);
        handler.emit('query', { sql });
        window.setTimeout(() => {
            if (seq === querySeqRef.current) setLoading(false);
        }, 15000);
    }, []);

    const handleSave = useCallback(() => {
        if (!dirty || saving || readOnlyRef.current) return;
        setSaving(true);
        handler.emit('sqliteSave');
    }, [dirty, saving]);

    const toggleTheme = () => {
        setVscodeTheme((prev) => {
            const next = !prev;
            saveSqliteVscodeTheme(next);
            return next;
        });
    };

    useEffect(() => {
        handler
            .on('sqliteOpen', (payload: { fileName: string; readOnly: boolean; tables: SqliteTableInfo[] }) => {
                setFileName(payload.fileName);
                setTables(payload.tables ?? []);
                const ro = payload.readOnly === true;
                setReadOnly(ro);
                readOnlyRef.current = ro;
                if (payload.tables?.length > 0) {
                    selectTable(payload.tables[0]);
                }
            })
            .on('sqliteTables', (payload: SqliteTableInfo[]) => {
                setTables(payload ?? []);
            })
            .on('sqliteTableInfo', (payload: TableMeta & { structure?: SqliteStructure }) => {
                tableMetaRef.current = { table: payload.table, editable: payload.editable, columns: payload.columns };
                setTableMeta({ table: payload.table, editable: payload.editable, columns: payload.columns });
                setStructure(payload.structure ?? null);
                requestTablePage(0);
            })
            .on('sqliteResult', (payload: QueryState) => {
                setLoading(false);
                setError(null);
                setResult(payload);
                setHasData(true);
                setPage(0);
                if (payload.total !== undefined) {
                    totalRef.current = payload.total;
                    setTotal(payload.total);
                }
                if (payload.isWrite) {
                    message.info($t('sqlite.rowsModified', { count: String(payload.rowsModified ?? 0) }));
                }
            })
            .on('sqliteError', (msg: string) => {
                setLoading(false);
                setError(msg);
                message.error(msg);
            })
            .on('sqliteDirty', () => {
                setDirty(true);
            })
            .on('sqliteSaved', () => {
                setDirty(false);
                setSaving(false);
                message.success($t('sqlite.saveSuccess'));
            })
            .on('sqliteEditDone', () => {
                requestTablePage(pageRef.current);
            })
            .on('sqliteRowInserted', () => {
                const lastPage = Math.floor((totalRef.current ?? 0) / PAGE_SIZE);
                requestTablePage(lastPage);
            })
            .on('sqliteRowsDeleted', () => {
                requestTablePage(pageRef.current);
            })
            .emit('init');
    }, [message, requestTablePage, selectTable]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            handleSave();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleSave]);

    const startEdit = (row: TableRow, column: string) => {
        if (!editable || !tableMeta) return;
        const rowid = Number(row[ROWID_ALIAS]);
        if (!Number.isFinite(rowid)) return;
        const value = row[column];
        setEditing({ rowKey: row.key, column, rowid, value });
        setEditText(formatCell(value));
        setEditNull(value === null);
    };

    const cancelEdit = () => {
        setEditing(null);
        setEditText('');
        setEditNull(false);
    };

    const commitEdit = () => {
        if (!editing || !activeTableRef.current) return;
        const columnMeta = tableMeta?.columns.find((c) => c.name === editing.column);
        const parsed = parseCellInput(editText, columnMeta?.type ?? '', editNull);
        if (parsed === 'invalid') {
            message.warning($t('sqlite.invalidNumber'));
            return;
        }
        handler.emit('sqliteEdit', {
            table: activeTableRef.current,
            rowid: editing.rowid,
            column: editing.column,
            value: parsed,
        });
    };

    const insertRow = () => {
        if (!activeTableRef.current || !editable) return;
        handler.emit('sqliteInsertRow', { table: activeTableRef.current });
    };

    const deleteSelectedRows = () => {
        if (!activeTableRef.current || !editable || selectedRowKeys.length === 0) return;
        const rowids = tableRows
            .filter((row) => selectedRowKeys.includes(row.key))
            .map((row) => Number(row[ROWID_ALIAS]))
            .filter((n) => Number.isFinite(n));
        if (rowids.length === 0) return;
        handler.emit('sqliteDeleteRows', { table: activeTableRef.current, rowids });
    };

    const handleExport = (format: 'csv' | 'json' | 'md') => {
        const sql = exportSqlRef.current;
        if (!sql) return;
        const baseName = (fileName || 'query').replace(/\.(db|sqlite3?|db3)$/i, '') + (activeTableRef.current ? `-${activeTableRef.current}` : '');
        handler.emit('sqliteExport', { format, sql, dropRowid: exportDropRowidRef.current, baseName });
    };

    const toggleSort = (column: string) => {
        if (!activeTableRef.current) return;
        const next = !sortRef.current || sortRef.current.column !== column
            ? { column, dir: 'ASC' as const }
            : sortRef.current.dir === 'ASC' ? { column, dir: 'DESC' as const } : null;
        sortRef.current = next;
        setSort(next);
        setViewTab('data');
        requestTablePage(0, next);
    };

    const tableColumns = useMemo<ColumnsType<TableRow>>(() => {
        if (!result) return [];
        const cols: ColumnsType<TableRow> = [
            {
                title: '#',
                key: '__index',
                width: 64,
                align: 'center',
                fixed: 'left',
                render: (_value, _row, index) => page * PAGE_SIZE + index + 1,
            },
        ];
        for (const column of result.columns) {
            if (column === ROWID_ALIAS) continue;
            const columnMeta = tableMeta?.columns.find((c) => c.name === column);
            const icon = columnMeta?.pk
                ? 'codicon-key'
                : NUMERIC_TYPE.test(columnMeta?.type ?? '') ? 'codicon-symbol-numeric' : 'codicon-symbol-string';
            const sorted = sort?.column === column;
            const sortable = !!activeTable;
            cols.push({
                title: (
                    <span
                        className={`sqlite-viewer__col-title${sortable ? ' sqlite-viewer__col-title--sortable' : ''}`}
                        title={`${column} ${columnMeta?.type ?? ''}`}
                        onClick={() => { if (activeTable) toggleSort(column); }}
                    >
                        <span className={`codicon ${icon} sqlite-viewer__col-icon`} />
                        {column}
                        {sorted && <span className="sqlite-viewer__sort-arrow">{sort.dir === 'ASC' ? '▲' : '▼'}</span>}
                    </span>
                ),
                dataIndex: column,
                key: column,
                ellipsis: true,
                minWidth: 120,
                onHeaderCell: sortable ? () => ({ style: { cursor: 'pointer' } }) : undefined,
                render: (value: string | number | null, row: TableRow) => {
                    const isEditing = editing?.rowKey === row.key && editing?.column === column;
                    if (isEditing) {
                        return (
                            <span className="sqlite-viewer__editor">
                                <Input
                                    className="sqlite-viewer__editor-input"
                                    autoFocus
                                    size="small"
                                    value={editNull ? '' : editText}
                                    disabled={editNull}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onBlur={() => commitEdit()}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitEdit();
                                        }
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            cancelEdit();
                                        }
                                    }}
                                />
                                <Checkbox
                                    className="sqlite-viewer__editor-null"
                                    checked={editNull}
                                    onChange={(e) => setEditNull(e.target.checked)}
                                    onMouseDown={(e) => e.preventDefault()}
                                >
                                    NULL
                                </Checkbox>
                            </span>
                        );
                    }
                    const cellText = value === null ? '' : String(value);
                    const canView = cellText.length >= 200 || /^0x[0-9a-f]+$/i.test(cellText);
                    return (
                        <span
                            className={`sqlite-viewer__cell${editable ? ' sqlite-viewer__cell--editable' : ''}`}
                            title={value === null ? 'NULL' : cellText}
                            onDoubleClick={() => startEdit(row, column)}
                        >
                            {value === null ? <em className="sqlite-viewer__null">NULL</em> : cellText}
                            {canView && (
                                <button
                                    type="button"
                                    className="sqlite-viewer__cell-view-btn"
                                    title={$t('sqlite.viewCell')}
                                    onClick={(e) => { e.stopPropagation(); setViewCell({ column, text: cellText }); }}
                                >
                                    <span className="codicon codicon-expand-all" />
                                </button>
                            )}
                        </span>
                    );
                },
            });
        }
        return cols;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result, page, tableMeta, editing, editText, editNull, editable, sort, activeTable]);

    const rowSelection: TableRowSelection<TableRow> | undefined = editable
        ? {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
            columnWidth: 36,
            fixed: true,
        }
        : undefined;

    const handleRun = () => {
        const sql = sqlText.trim();
        if (!sql) return;
        setActiveTable(null);
        activeTableRef.current = null;
        setTableMeta(null);
        tableMetaRef.current = null;
        setStructure(null);
        setEditing(null);
        setSelectedRowKeys([]);
        setTotal(null);
        totalRef.current = null;
        setSort(null);
        sortRef.current = null;
        setViewTab('data');
        pushHistory(sql);
        exportSqlRef.current = sql;
        exportDropRowidRef.current = false;
        runSql(sql);
    };

    return (
        <div className={`sqlite-viewer${vscodeTheme ? '' : ' sqlite-viewer--light'}`}>
            {loading && !hasData && (
                <div className="sqlite-viewer__overlay">
                    <span className="codicon codicon-loading codicon-modifier-spin" />
                    <span>{$t('sqlite.loading')}</span>
                </div>
            )}
            <div className="sqlite-viewer__body">
                <aside className="sqlite-viewer__sider">
                    <div className="sqlite-viewer__sider-header">
                        <span className="codicon codicon-database" />
                        <span className="sqlite-viewer__sider-title" title={fileName}>{fileName || 'SQLite'}</span>
                        <span className="sqlite-viewer__sider-count">{tables.length}</span>
                    </div>
                    <div className="sqlite-viewer__list">
                        {tables.map((table) => (
                            <button
                                key={table.name}
                                type="button"
                                className={`sqlite-viewer__list-item${activeTable === table.name ? ' sqlite-viewer__list-item--active' : ''}`}
                                title={table.name}
                                onClick={() => selectTable(table)}
                            >
                                <span className={`codicon ${table.type === 'view' ? 'codicon-eye' : 'codicon-table'} sqlite-viewer__list-icon`} />
                                <span className="sqlite-viewer__list-name">{table.name}</span>
                                {table.type === 'view' && <span className="sqlite-viewer__list-badge">view</span>}
                            </button>
                        ))}
                    </div>
                </aside>
                <main className="sqlite-viewer__main">
                    {readOnly && !loading && (
                        <div className="sqlite-viewer__readonly-banner">
                            {$t('viewer.readOnly')}
                        </div>
                    )}
                    {error && (
                        <div className="sqlite-viewer__error">
                            <span className="codicon codicon-error" />
                            <span>{error}</span>
                        </div>
                    )}
                    <div className="sqlite-viewer__toolbar">
                        <div className="sqlite-viewer__sql-wrap">
                            <Input.TextArea
                                className="sqlite-viewer__sql-input"
                                value={sqlText}
                                spellCheck={false}
                                autoSize={{ minRows: 1, maxRows: 4 }}
                                placeholder="SELECT …"
                                onChange={(e) => setSqlText(e.target.value)}
                                onKeyDown={(e) => {
                                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                        e.preventDefault();
                                        handleRun();
                                    }
                                }}
                            />
                            {historyOpen && (
                                <div className="sqlite-viewer__history">
                                    {history.length === 0 && <div className="sqlite-viewer__history-empty">{$t('sqlite.noHistory')}</div>}
                                    {history.map((item, index) => (
                                        <button
                                            key={`${index}-${item}`}
                                            type="button"
                                            className="sqlite-viewer__history-item"
                                            title={item}
                                            onClick={() => { setSqlText(item); setHistoryOpen(false); }}
                                        >
                                            {item.length > 120 ? `${item.slice(0, 120)}…` : item}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            className="sqlite-viewer__icon-btn"
                            title={$t('sqlite.history')}
                            onClick={() => setHistoryOpen((v) => !v)}
                        >
                            <span className="codicon codicon-history" />
                        </button>
                        <button
                            type="button"
                            className="sqlite-viewer__run-btn"
                            disabled={loading || !sqlText.trim()}
                            onClick={handleRun}
                            title="Ctrl+Enter"
                        >
                            <span className="codicon codicon-play" />
                            {$t('sqlite.run')}
                        </button>
                        {activeTable && (
                            <span className="sqlite-viewer__row-actions">
                                <button
                                    type="button"
                                    className="sqlite-viewer__icon-btn"
                                    disabled={!editable || loading}
                                    title={$t('sqlite.insertRow')}
                                    onClick={insertRow}
                                >
                                    <span className="codicon codicon-add" />
                                </button>
                                <button
                                    type="button"
                                    className="sqlite-viewer__icon-btn"
                                    disabled={!editable || loading || selectedRowKeys.length === 0}
                                    title={$t('sqlite.deleteRows')}
                                    onClick={deleteSelectedRows}
                                >
                                    <span className="codicon codicon-trash" />
                                </button>
                            </span>
                        )}
                        <button
                            type="button"
                            className="sqlite-viewer__icon-btn sqlite-viewer__save-btn"
                            disabled={!dirty || saving || readOnly}
                            title={$t('sqlite.save')}
                            onClick={handleSave}
                        >
                            <span className={`codicon ${saving ? 'codicon-loading codicon-modifier-spin' : 'codicon-save'}`} />
                        </button>
                        <button
                            type="button"
                            className="sqlite-viewer__theme-toggle"
                            title={vscodeTheme ? $t('common.switchToLight') : $t('common.switchToDark')}
                            onClick={toggleTheme}
                            aria-label={vscodeTheme ? $t('common.switchToLight') : $t('common.switchToDark')}
                        >
                            {vscodeTheme ? <SunOutlined /> : <MoonOutlined />}
                        </button>
                    </div>
                    {activeTable && (
                        <div className="sqlite-viewer__tabs">
                            <button
                                type="button"
                                className={`sqlite-viewer__tab${viewTab === 'data' ? ' sqlite-viewer__tab--active' : ''}`}
                                onClick={() => setViewTab('data')}
                            >
                                {$t('sqlite.data')}
                            </button>
                            <button
                                type="button"
                                className={`sqlite-viewer__tab${viewTab === 'structure' ? ' sqlite-viewer__tab--active' : ''}`}
                                onClick={() => setViewTab('structure')}
                            >
                                {$t('sqlite.structure')}
                            </button>
                        </div>
                    )}
                    {result && (
                        <div className="sqlite-viewer__meta">
                            {loading && <span className="codicon codicon-loading codicon-modifier-spin sqlite-viewer__refreshing" />}
                            <span className="sqlite-viewer__rows-count">
                                {total !== null
                                    ? $t('sqlite.rows', { count: total.toLocaleString() })
                                    : $t('sqlite.rows', { count: result.rows.length.toLocaleString() })}
                            </span>
                            <span className="sqlite-viewer__elapsed">
                                {$t('sqlite.elapsed', { ms: String(result.elapsedMs) })}
                            </span>
                            {result.columns.length > 0 && !result.isWrite && (
                                <span className="sqlite-viewer__export">
                                    <button type="button" className="sqlite-viewer__export-btn" title={$t('sqlite.exportCsv')} onClick={() => handleExport('csv')}>CSV</button>
                                    <button type="button" className="sqlite-viewer__export-btn" title={$t('sqlite.exportJson')} onClick={() => handleExport('json')}>JSON</button>
                                    <button type="button" className="sqlite-viewer__export-btn" title={$t('sqlite.exportMd')} onClick={() => handleExport('md')}>MD</button>
                                </span>
                            )}
                            {dirty && <span className="sqlite-viewer__dirty-dot" title={$t('sqlite.unsaved')} />}
                        </div>
                    )}
                    {result && viewTab === 'data' && result.columns.length > 0 && (
                        <div className="sqlite-viewer__table-wrap">
                            <Table<TableRow>
                                className="sqlite-table"
                                dataSource={tableRows}
                                columns={tableColumns}
                                rowSelection={rowSelection}
                                pagination={false}
                                size="small"
                                scroll={{ y: 'calc(100vh - 260px)', x: 'max-content' }}
                            />
                        </div>
                    )}
                    {viewTab === 'structure' && structure && (
                        <div className="sqlite-viewer__structure">
                            {structure.ddl && (
                                <section className="sqlite-viewer__structure-section">
                                    <h4>DDL</h4>
                                    <pre className="sqlite-viewer__ddl">{structure.ddl}</pre>
                                </section>
                            )}
                            <section className="sqlite-viewer__structure-section">
                                <h4>{$t('sqlite.structureColumns')}</h4>
                                <Table
                                    className="sqlite-table"
                                    dataSource={structure.columns.map((c, i) => ({ ...c, key: i }))}
                                    columns={[
                                        { title: '#', dataIndex: 'key', key: 'key', width: 48, render: (v) => v + 1 },
                                        { title: 'name', dataIndex: 'name', key: 'name', ellipsis: true },
                                        { title: 'type', dataIndex: 'type', key: 'type', width: 110, render: (t) => t || '—' },
                                        { title: 'notnull', dataIndex: 'notnull', key: 'notnull', width: 80, render: (v) => (v ? '✓' : '') },
                                        { title: 'default', dataIndex: 'dflt', key: 'dflt', width: 120, ellipsis: true, render: (v) => v ?? '—' },
                                        { title: 'pk', dataIndex: 'pk', key: 'pk', width: 60, render: (v) => (v ? '✓' : '') },
                                    ]}
                                    pagination={false}
                                    size="small"
                                />
                            </section>
                            {structure.indexes.length > 0 && (
                                <section className="sqlite-viewer__structure-section">
                                    <h4>{$t('sqlite.structureIndexes')}</h4>
                                    {structure.indexes.map((index) => (
                                        <div key={index.name} className="sqlite-viewer__structure-line">
                                            <span className="codicon codicon-list-flat" />
                                            <strong>{index.name}</strong>
                                            {index.unique && <span className="sqlite-viewer__list-badge">UNIQUE</span>}
                                            <span className="sqlite-viewer__structure-dim">({index.columns.join(', ')})</span>
                                        </div>
                                    ))}
                                </section>
                            )}
                            {structure.foreignKeys.length > 0 && (
                                <section className="sqlite-viewer__structure-section">
                                    <h4>{$t('sqlite.structureForeignKeys')}</h4>
                                    {structure.foreignKeys.map((fk, i) => (
                                        <div key={i} className="sqlite-viewer__structure-line">
                                            <span className="codicon codicon-references" />
                                            {fk.from} → {fk.table}{fk.to ? `.${fk.to}` : ''}
                                        </div>
                                    ))}
                                </section>
                            )}
                        </div>
                    )}
                    {result && viewTab === 'data' && (
                        <div className="sqlite-viewer__footer">
                            <span className="sqlite-viewer__pager-info">
                                {page + 1} / {totalPages}
                                {total !== null && ` · ${$t('sqlite.pageOf', { size: String(PAGE_SIZE) })}`}
                            </span>
                            <div className="sqlite-viewer__pager">
                                <button
                                    type="button"
                                    className="sqlite-viewer__pager-btn"
                                    disabled={page <= 0}
                                    onClick={() => { setEditing(null); if (activeTableRef.current) requestTablePage(page - 1); else setPage((p) => Math.max(0, p - 1)); }}
                                    aria-label="Previous page"
                                >
                                    <span className="codicon codicon-chevron-left" />
                                </button>
                                <button
                                    type="button"
                                    className="sqlite-viewer__pager-btn"
                                    disabled={page >= totalPages - 1}
                                    onClick={() => { setEditing(null); if (activeTableRef.current) requestTablePage(page + 1); else setPage((p) => Math.min(totalPages - 1, p + 1)); }}
                                    aria-label="Next page"
                                >
                                    <span className="codicon codicon-chevron-right" />
                                </button>
                            </div>
                        </div>
                    )}
                </main>
            </div>
            <Modal
                open={viewCell !== null}
                title={viewCell?.column}
                footer={null}
                width={760}
                onCancel={() => setViewCell(null)}
            >
                <pre className="sqlite-viewer__cell-view">{viewCell ? formatCellView(viewCell.text) : ''}</pre>
            </Modal>
        </div>
    );
}

export default function Sqlite() {
    return (
        <App className="sqlite-app">
            <SqliteViewer />
        </App>
    );
}
