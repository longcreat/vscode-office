import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { memo, useMemo, useState } from 'react';
import { $t } from '../../i18n/i18nConfig.ts';
import { inferJsonlColumns, toCellText, type JsonValue } from '../../../provider/jsonCore.ts';
import {
    extractSanitizedSvg,
    isColorString,
    resolveJsonNodeByPath,
    type ArraySourceOption,
} from './jsonUtils.ts';

interface JsonArrayTableViewProps {
    root: JsonValue | null;
    sources: ArraySourceOption[];
    activeSourceKey: string;
    onChangeSourceKey: (key: string) => void;
    selectedPathKey: string;
    onSelectPath: (path: (string | number)[]) => void;
}

type FlatRow = Record<string, unknown> & {
    __key: string;
    __index: number;
    __path: (string | number)[];
};

export const JsonArrayTableView = memo(({
    root,
    sources,
    activeSourceKey,
    onChangeSourceKey,
    selectedPathKey,
    onSelectPath,
}: JsonArrayTableViewProps) => {
    const [filterText, setFilterText] = useState('');

    const currentSource = useMemo(() => {
        return sources.find((s) => s.pathKey === activeSourceKey) ?? sources[0] ?? null;
    }, [sources, activeSourceKey]);

    const targetNode = useMemo(() => {
        if (!root || !currentSource) return null;
        return resolveJsonNodeByPath(root, currentSource.path) ?? null;
    }, [root, currentSource]);

    const { columns, rows } = useMemo(() => {
        if (!currentSource || targetNode === null || targetNode === undefined) {
            return { columns: [] as string[], rows: [] as FlatRow[] };
        }

        if (Array.isArray(targetNode)) {
            const hasObjectItems = targetNode.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
            if (hasObjectItems) {
                const cols = inferJsonlColumns(targetNode, 200, 60);
                const dataRows: FlatRow[] = targetNode.map((item, idx) => {
                    const rowObj: FlatRow = {
                        __key: String(idx),
                        __index: idx,
                        __path: [...currentSource.path, idx],
                    };
                    if (item && typeof item === 'object' && !Array.isArray(item)) {
                        for (const col of cols) {
                            rowObj[col] = (item as Record<string, JsonValue>)[col] ?? null;
                        }
                    } else {
                        rowObj[cols[0] ?? 'value'] = item;
                    }
                    return rowObj;
                });
                return { columns: cols, rows: dataRows };
            }

            // 标量或子数组构成的数组
            const dataRows: FlatRow[] = targetNode.map((item, idx) => ({
                __key: String(idx),
                __index: idx,
                __path: [...currentSource.path, idx],
                value: item,
            }));
            return { columns: ['value'], rows: dataRows };
        }

        if (typeof targetNode === 'object') {
            const entries = Object.entries(targetNode as Record<string, JsonValue>);
            const dataRows: FlatRow[] = entries.map(([k, v], idx) => ({
                __key: k,
                __index: idx,
                __path: [...currentSource.path, k],
                key: k,
                type: v === null ? 'null' : Array.isArray(v) ? `array[${v.length}]` : typeof v,
                value: v,
            }));
            return { columns: ['key', 'type', 'value'], rows: dataRows };
        }

        return { columns: [] as string[], rows: [] as FlatRow[] };
    }, [currentSource, targetNode]);

    const filteredRows = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) =>
            columns.some((col) => {
                const cell = toCellText(r[col]);
                return cell !== null && String(cell).toLowerCase().includes(q);
            }),
        );
    }, [rows, columns, filterText]);

    const antColumns = useMemo<ColumnsType<FlatRow>>(() => {
        const result: ColumnsType<FlatRow> = [
            {
                title: '#',
                key: '__index',
                width: 64,
                align: 'center',
                fixed: 'left',
                render: (_v, row) => <span className="json-table-idx">{row.__index + 1}</span>,
            },
        ];

        for (const col of columns) {
            result.push({
                title: col,
                dataIndex: col,
                key: col,
                ellipsis: true,
                minWidth: 130,
                sorter: (a, b) => {
                    const va = toCellText(a[col]);
                    const vb = toCellText(b[col]);
                    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
                    return String(va ?? '').localeCompare(String(vb ?? ''));
                },
                render: (val: JsonValue) => {
                    if (val === null || val === undefined) {
                        return <span className="json-cell-null">null</span>;
                    }
                    if (typeof val === 'boolean') {
                        return <span className={`json-cell-bool json-cell-bool--${val}`}>{String(val)}</span>;
                    }
                    if (typeof val === 'number') {
                        return <span className="json-cell-num">{val}</span>;
                    }
                    if (typeof val === 'string') {
                        const svg = extractSanitizedSvg(val);
                        if (svg) {
                            return (
                                <span className="json-cell-svg-wrap">
                                    <span
                                        className="json-inline-svg-thumb"
                                        dangerouslySetInnerHTML={{ __html: svg }}
                                    />
                                    <span className="json-cell-str">{val}</span>
                                </span>
                            );
                        }
                        if (isColorString(val)) {
                            return (
                                <span className="json-cell-color-wrap">
                                    <span className="json-color-swatch" style={{ backgroundColor: val.trim() }} />
                                    <span className="json-cell-str">{val}</span>
                                </span>
                            );
                        }
                        return <span className="json-cell-str" title={val}>{val}</span>;
                    }
                    if (Array.isArray(val)) {
                        return <span className="json-cell-complex">[{val.length}] {JSON.stringify(val)}</span>;
                    }
                    if (typeof val === 'object') {
                        return <span className="json-cell-complex">{`{${Object.keys(val).length}}`} {JSON.stringify(val)}</span>;
                    }
                    return String(val);
                },
            });
        }
        return result;
    }, [columns]);

    if (sources.length === 0) {
        return <div className="json-table-empty">{$t('json.noTableData')}</div>;
    }

    return (
        <div className="json-array-table">
            <div className="json-array-table__bar">
                <span className="json-array-table__label">
                    <span className="codicon codicon-symbol-array" />
                    <span>{$t('json.arraySource')}:</span>
                </span>
                <div className="json-array-table__sources">
                    {sources.map((src) => (
                        <button
                            key={src.pathKey}
                            type="button"
                            className={`json-source-pill${src.pathKey === currentSource?.pathKey ? ' json-source-pill--active' : ''}`}
                            onClick={() => onChangeSourceKey(src.pathKey)}
                        >
                            <code>{src.jsonPath}</code>
                            <span className="json-source-pill__count">{src.count}</span>
                        </button>
                    ))}
                </div>
                <div className="json-array-table__filter">
                    <span className="codicon codicon-filter" />
                    <input
                        type="text"
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder={$t('json.tableSearchPlaceholder')}
                    />
                    {filterText && (
                        <button type="button" onClick={() => setFilterText('')}>
                            <span className="codicon codicon-close" />
                        </button>
                    )}
                </div>
            </div>
            <div className="json-array-table__wrap">
                <Table<FlatRow>
                    className="sqlite-table json-table"
                    rowKey="__key"
                    dataSource={filteredRows}
                    columns={antColumns}
                    size="small"
                    pagination={{
                        defaultPageSize: 100,
                        showSizeChanger: true,
                        pageSizeOptions: [50, 100, 200, 500],
                        size: 'small',
                    }}
                    rowClassName={(row) =>
                        JSON.stringify(row.__path) === selectedPathKey ? 'json-table__row--selected' : ''
                    }
                    onRow={(row) => ({
                        onClick: () => onSelectPath(row.__path),
                    })}
                    scroll={{ y: 'calc(100vh - 195px)', x: 'max-content' }}
                />
            </div>
        </div>
    );
});
JsonArrayTableView.displayName = 'JsonArrayTableView';
