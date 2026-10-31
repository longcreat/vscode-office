import { App, Input, Modal, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { $t } from '../../i18n/i18nConfig.ts';
import { handler } from '../../util/vscode.ts';
import { formatCellView, type JsonValue } from '../../../provider/jsonCore.ts';
import { extractSanitizedSvg, isColorString, resolveJsonNodeByPath, tryParseNestedJson } from './jsonUtils.ts';
import { JsonInspectorPanel } from './JsonInspectorAndCode.tsx';

const PAGE_SIZE = 200;

interface JsonlOpenPayload {
    fileName: string;
    fileSize?: number;
    readOnly: boolean;
    total: number;
    columns: string[];
    sampleBad?: number;
}

function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

type TableRow = Record<string, string | number | boolean | null> & {
    key: string;
    __index__: number;
    __row__: (string | number | boolean | null)[];
    __bad__: boolean;
};

function parseRowToJsonObject(row: TableRow, columns: string[]): JsonValue {
    const obj: Record<string, JsonValue> = {};
    for (const col of columns) {
        const raw = row[col];
        if (typeof raw === 'string') {
            const nested = tryParseNestedJson(raw);
            obj[col] = nested !== null ? nested : raw;
        } else {
            obj[col] = (raw ?? null) as JsonValue;
        }
    }
    return obj;
}

function JsonlTable() {
    const { message, modal } = App.useApp();
    const [fileName, setFileName] = useState('');
    const [fileSize, setFileSize] = useState(0);
    const [columns, setColumns] = useState<string[]>([]);
    const [rows, setRows] = useState<(string | number | boolean | null)[][]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [pageBad, setPageBad] = useState(0);
    const [badRowIdx, setBadRowIdx] = useState<Set<number>>(() => new Set());
    const [sampleBad, setSampleBad] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [loading, setLoading] = useState(false);
    const [hasData, setHasData] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewCell, setViewCell] = useState<{ column: string; text: string } | null>(null);

    const [filterText, setFilterText] = useState('');
    const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
    const [selectedSubPath, setSelectedSubPath] = useState<(string | number)[]>([]);
    const [showInspector, setShowInspector] = useState(true);
    const seqRef = useRef(0);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const requestPage = useCallback((nextPage: number) => {
        setPage(nextPage);
        setSelectedRowIndex(0);
        setSelectedSubPath([]);
        const seq = ++seqRef.current;
        setLoading(true);
        handler.emit('jsonlPage', { page: nextPage, pageSize: PAGE_SIZE });
        window.setTimeout(() => {
            if (seq === seqRef.current) setLoading(false);
        }, 15000);
    }, []);

    useEffect(() => {
        handler
            .on('jsonlOpen', (payload: JsonlOpenPayload) => {
                setFileName(payload.fileName);
                setFileSize(payload.fileSize ?? 0);
                setColumns(payload.columns ?? []);
                setTotal(payload.total ?? 0);
                setSampleBad(payload.sampleBad ?? 0);
                requestPage(0);
            })
            .on('jsonlResult', (payload: { columns: string[]; rows: (string | number | boolean | null)[][]; total: number; badRows: number[]; elapsedMs: number }) => {
                setLoading(false);
                setError(null);
                setColumns(payload.columns);
                setRows(payload.rows);
                setTotal(payload.total);
                setPageBad(payload.badRows?.length ?? 0);
                setBadRowIdx(new Set(payload.badRows ?? []));
                setElapsed(payload.elapsedMs ?? 0);
                setHasData(true);
            })
            .on('jsonlError', (msg: string) => {
                setLoading(false);
                setError(msg);
                message.error(msg);
            });
    }, [message, requestPage]);

    const handleCopy = useCallback(async (text: string, label?: string) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success(`${$t('json.copied')} ${label ?? (text.length > 48 ? `${text.slice(0, 48)}…` : text)}`);
        } catch {
            message.error($t('json.copyFailed'));
        }
    }, [message]);

    const handleExport = (format: 'csv' | 'json' | 'md') => {
        const doExport = () => handler.emit('jsonlExport', { format });
        if (total > 500000) {
            modal.confirm({
                title: $t('json.exportLargeTitle'),
                content: $t('json.exportLargeBody', { count: total.toLocaleString() }),
                onOk: doExport,
            });
            return;
        }
        doExport();
    };

    const dataSource = useMemo<TableRow[]>(() => rows.map((row, index) => ({
        ...Object.fromEntries(columns.map((c, ci) => [c, row[ci] ?? null])),
        key: String(index),
        __index__: index,
        __row__: row,
        __bad__: badRowIdx.has(index),
    })), [rows, columns, badRowIdx]);

    const filteredDataSource = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        if (!q) return dataSource;
        return dataSource.filter((row) =>
            columns.some((col) => {
                const val = row[col];
                return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
            }),
        );
    }, [dataSource, columns, filterText]);

    const selectedRowObj = useMemo<JsonValue | undefined>(() => {
        const row = dataSource[selectedRowIndex];
        if (!row) return undefined;
        const base = parseRowToJsonObject(row, columns);
        if (selectedSubPath.length === 0) return base;
        return resolveJsonNodeByPath(base, selectedSubPath);
    }, [dataSource, selectedRowIndex, columns, selectedSubPath]);

    const tableColumns = useMemo<ColumnsType<TableRow>>(() => {
        const cols: ColumnsType<TableRow> = [
            {
                title: '#',
                key: '__index',
                width: 72,
                align: 'center',
                fixed: 'left',
                render: (_v, row) => (row.__bad__
                    ? <span title={$t('json.badLine')} className="json-viewer__bad-mark">⚠</span>
                    : <span className="json-table-idx">{page * PAGE_SIZE + row.__index__ + 1}</span>),
            },
        ];
        for (const column of columns) {
            cols.push({
                title: column,
                dataIndex: column,
                key: column,
                ellipsis: true,
                minWidth: 130,
                sorter: (a, b) => {
                    const va = a[column];
                    const vb = b[column];
                    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
                    return String(va ?? '').localeCompare(String(vb ?? ''));
                },
                render: (value: string | number | boolean | null) => {
                    if (value === null || value === undefined) {
                        return <em className="json-viewer__null">NULL</em>;
                    }
                    if (typeof value === 'boolean') {
                        return <span className={`json-cell-bool json-cell-bool--${value}`}>{String(value)}</span>;
                    }
                    if (typeof value === 'number') {
                        return <span className="json-cell-num">{value}</span>;
                    }
                    const text = String(value);
                    const canView = text.length >= 200 || /^0x[0-9a-f]+$/i.test(text);
                    const svg = (text.includes('<svg') || text.startsWith('data:image/svg+xml'))
                        ? extractSanitizedSvg(text)
                        : null;
                    const isColor = isColorString(text);

                    return (
                        <span className="json-viewer__cell" title={text}>
                            {svg && (
                                <span
                                    className="json-inline-svg-thumb"
                                    dangerouslySetInnerHTML={{ __html: svg }}
                                />
                            )}
                            {isColor && (
                                <span className="json-color-swatch" style={{ backgroundColor: text.trim() }} />
                            )}
                            <span className={text.startsWith('{') || text.startsWith('[') ? 'json-cell-complex' : 'json-cell-str'}>
                                {text}
                            </span>
                            {canView && (
                                <button
                                    type="button"
                                    className="sqlite-viewer__cell-view-btn"
                                    title={$t('json.viewCell')}
                                    onClick={(e) => { e.stopPropagation(); setViewCell({ column, text }); }}
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
    }, [columns, page]);

    const inspectorPath = useMemo<(string | number)[]>(
        () => [page * PAGE_SIZE + selectedRowIndex, ...selectedSubPath],
        [page, selectedRowIndex, selectedSubPath],
    );

    return (
        <div className="json-viewer">
            {loading && !hasData && <div className="json-viewer__overlay"><Spin /></div>}
            {error && (
                <div className="json-viewer__error">
                    <span className="codicon codicon-error" />
                    <span>{error}</span>
                </div>
            )}
            <div className="json-viewer__toolbar">
                <div className="json-viewer__brand">
                    <span className="codicon codicon-list-flat json-viewer__file-icon" />
                    <span className="json-viewer__file" title={fileName}>{fileName || 'JSONL'}</span>
                    {fileSize > 0 && <span className="json-viewer__size">{formatSize(fileSize)}</span>}
                    <span className="json-viewer__stat-pill">{$t('sqlite.rows', { count: total.toLocaleString() })}</span>
                </div>
                {pageBad > 0 && (
                    <span className="json-viewer__badge json-viewer__badge--warn" title={$t('json.badLinesTip')}>
                        {$t('json.badLines', { count: String(pageBad) })}
                    </span>
                )}
                {elapsed > 0 && <span className="json-viewer__size">{$t('sqlite.elapsed', { ms: String(elapsed) })}</span>}
                {loading && <span className="codicon codicon-loading codicon-modifier-spin sqlite-viewer__refreshing" />}
                <span className="json-viewer__toolbar-spacer" />
                <Input
                    className="json-viewer__search"
                    allowClear
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder={$t('json.tableSearchPlaceholder')}
                    prefix={<span className="codicon codicon-filter" />}
                />
                <span className="sqlite-viewer__export">
                    <button type="button" className="sqlite-viewer__export-btn" title={$t('sqlite.exportCsv')} onClick={() => handleExport('csv')}>CSV</button>
                    <button type="button" className="sqlite-viewer__export-btn" title={$t('sqlite.exportJson')} onClick={() => handleExport('json')}>JSON</button>
                    <button type="button" className="sqlite-viewer__export-btn" title={$t('sqlite.exportMd')} onClick={() => handleExport('md')}>MD</button>
                </span>
                <div className="json-viewer__actions">
                    <button
                        type="button"
                        className={`json-tool-btn${showInspector ? ' json-tool-btn--active' : ''}`}
                        title={$t('json.inspector')}
                        onClick={() => setShowInspector((s) => !s)}
                    >
                        <span className="codicon codicon-layout-sidebar-right" />
                    </button>
                    <button
                        type="button"
                        className="json-tool-btn"
                        title={$t('json.openInEditor')}
                        onClick={() => handler.emit('editInVSCode', false)}
                    >
                        <span className="codicon codicon-go-to-file" />
                    </button>
                </div>
            </div>

            <div className="json-viewer__workspace">
                <div className="sqlite-viewer__table-wrap json-viewer__content">
                    <Table<TableRow>
                        className="sqlite-table json-table"
                        dataSource={filteredDataSource}
                        columns={tableColumns}
                        pagination={false}
                        size="small"
                        rowClassName={(row) => {
                            const classes: string[] = [];
                            if (row.__bad__) classes.push('json-table__row--bad');
                            if (row.__index__ === selectedRowIndex) classes.push('json-table__row--selected');
                            return classes.join(' ');
                        }}
                        onRow={(row) => ({
                            onClick: () => {
                                setSelectedRowIndex(row.__index__);
                                setSelectedSubPath([]);
                            },
                        })}
                        scroll={{ y: 'calc(100vh - 128px)', x: 'max-content' }}
                    />
                </div>
                {showInspector && hasData && (
                    <JsonInspectorPanel
                        selectedPath={inspectorPath}
                        selectedValue={selectedRowObj}
                        onSelectPath={(nextPath) => {
                            setSelectedSubPath(nextPath.slice(1));
                        }}
                        onCopy={handleCopy}
                        onClose={() => setShowInspector(false)}
                    />
                )}
            </div>

            <div className="json-viewer__statusbar">
                <span className="codicon codicon-list-flat" />
                <code>{page + 1}/{totalPages}</code>
                <span className="json-viewer__toolbar-spacer" />
                <div className="sqlite-viewer__pager">
                    <button
                        type="button"
                        className="sqlite-viewer__pager-btn"
                        disabled={page <= 0 || loading}
                        onClick={() => requestPage(page - 1)}
                        aria-label="Previous page"
                    >
                        <span className="codicon codicon-chevron-left" />
                    </button>
                    <button
                        type="button"
                        className="sqlite-viewer__pager-btn"
                        disabled={page >= totalPages - 1 || loading}
                        onClick={() => requestPage(page + 1)}
                        aria-label="Next page"
                    >
                        <span className="codicon codicon-chevron-right" />
                    </button>
                </div>
                {sampleBad > 0 && pageBad === 0 && (
                    <span className="json-viewer__badge json-viewer__badge--dim">{$t('json.sampleBad', { count: String(sampleBad) })}</span>
                )}
            </div>
            <Modal
                open={viewCell !== null}
                title={viewCell?.column}
                footer={null}
                width={760}
                onCancel={() => setViewCell(null)}
            >
                <pre className="json-viewer__cell-view">{viewCell ? formatCellView(viewCell.text) : ''}</pre>
            </Modal>
        </div>
    );
}

export default JsonlTable;
