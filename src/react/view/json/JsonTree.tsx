import { App, Input, Modal, Spin } from 'antd';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { $t } from '../../i18n/i18nConfig.ts';
import { loadOfficeBuffer } from '../../util/loadOfficeContent.ts';
import { handler } from '../../util/vscode.ts';
import {
    buildJsonPath,
    collectJsonMatches,
    formatCellView,
    getJsonNodeChildren,
    getJsonNodePreview,
    type JsonValue,
} from '../../../provider/jsonCore.ts';
import {
    buildJsAccessor,
    collectArraySources,
    computeJsonStats,
    extractSanitizedSvg,
    formatBranchInlineSummary,
    isColorString,
    isIsoDateString,
    isUrlString,
    resolveJsonNodeByPath,
} from './jsonUtils.ts';
import {
    JsonCodeView,
    JsonInspectorPanel,
    renderHighlightedText,
} from './JsonInspectorAndCode.tsx';
import { JsonArrayTableView } from './JsonArrayTableView.tsx';

const CHILD_PAGE = 200;
const SEARCH_DEBOUNCE = 200;
const FULL_VALUE_LIMIT = 128 * 1024;

interface TreeProps {
    payload: { path?: string; buffer?: number[]; ext?: string; fileName?: string } | null;
}

interface ExpandCommand {
    maxDepth: number;
    seq: number;
}

function pk(path: (string | number)[]): string {
    return JSON.stringify(path);
}

function valueTypeClass(value: JsonValue): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    switch (typeof value) {
        case 'string': return 'string';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'object': return 'object';
        default: return 'value';
    }
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

interface NodeProps {
    value: JsonValue;
    label: string;
    isArrayItem?: boolean;
    pathArr: (string | number)[];
    path: string;
    depth: number;
    expandCmd: ExpandCommand;
    selectedPathKey: string;
    searchTerm: string;
    filterOnlyMatches: boolean;
    hitKeys: Set<string> | null;
    hitTree: Set<string> | null;
    onSelectPath: (pathArr: (string | number)[]) => void;
    onCopy: (text: string, label?: string) => void;
    onOpenInTable: (pathArr: (string | number)[]) => void;
}

const TreeNode = memo((props: NodeProps) => {
    const {
        value,
        label,
        isArrayItem,
        pathArr,
        path,
        depth,
        selectedPathKey,
        searchTerm,
        filterOnlyMatches,
        hitKeys,
        hitTree,
        onSelectPath,
        onCopy,
    } = props;

    const searching = hitTree !== null;
    const isHit = hitKeys?.has(path) === true;
    const isSelected = selectedPathKey === path;

    if (searching && filterOnlyMatches && !hitTree!.has(path)) {
        return null;
    }

    const kind = value === null ? 'value' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : 'value';

    if (kind === 'value') {
        const preview = getJsonNodePreview(value);
        const full = JSON.stringify(value) ?? '';
        const expandable = full.length >= 200;
        const jsonPath = buildJsonPath(pathArr);
        const typeCls = valueTypeClass(value);

        const strVal = typeof value === 'string' ? value : null;
        const svgMarkup = strVal && (strVal.includes('<svg') || strVal.startsWith('data:image/svg+xml'))
            ? extractSanitizedSvg(strVal)
            : null;
        const isColor = strVal ? isColorString(strVal) : false;
        const isUrl = strVal ? isUrlString(strVal) : false;
        const isDate = strVal ? isIsoDateString(strVal) : false;

        return (
            <div
                className={`json-tree__row${isHit ? ' json-tree__row--hit' : ''}${isSelected ? ' json-tree__row--selected' : ''}`}
                data-path={jsonPath}
                data-path-key={path}
                data-full={expandable ? full.slice(0, FULL_VALUE_LIMIT) : undefined}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelectPath(pathArr);
                }}
            >
                <span className="json-tree__dot" />
                {label !== '' && (
                    <span className={`json-tree__key${isArrayItem ? ' json-tree__key--index' : ''}`}>
                        {isArrayItem ? `[${label}]` : renderHighlightedText(label, searchTerm)}
                        <span className="json-tree__colon">:</span>
                    </span>
                )}
                {isColor && strVal && (
                    <span
                        className="json-color-swatch"
                        style={{ backgroundColor: strVal.trim() }}
                        title={strVal}
                    />
                )}
                {svgMarkup && (
                    <span className="json-tree__svg-badge" title={$t('json.svgPreview')}>
                        <span
                            className="json-inline-svg-thumb"
                            dangerouslySetInnerHTML={{ __html: svgMarkup }}
                        />
                        <span className="json-tree__svg-tag">SVG</span>
                    </span>
                )}
                <span
                    className={`json-tree__val json-tree__val--${typeCls}`}
                    title={typeof value === 'string' ? value : preview}
                >
                    {renderHighlightedText(preview, searchTerm)}
                </span>
                {isUrl && strVal && (
                    <a
                        className="json-tree__url-chip"
                        href={strVal}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={strVal}
                    >
                        <span className="codicon codicon-link-external" />
                    </a>
                )}
                {isDate && strVal && (
                    <span className="json-tree__meta-tag">
                        {new Date(strVal).toISOString().replace('T', ' ').slice(0, 19)}
                    </span>
                )}
                <span className="json-tree__row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                        type="button"
                        className="json-row-action-btn"
                        title={$t('json.copyValue')}
                        onClick={() => onCopy(typeof value === 'string' ? value : JSON.stringify(value), preview)}
                    >
                        <span className="codicon codicon-clippy" />
                    </button>
                    <button
                        type="button"
                        className="json-row-action-btn"
                        title={$t('json.copyPath')}
                        onClick={() => onCopy(jsonPath, jsonPath)}
                    >
                        <span className="codicon codicon-symbol-Namespace" />
                    </button>
                </span>
            </div>
        );
    }

    return <BranchNode {...props} searching={searching} isHit={isHit} isSelected={isSelected} />;
});
TreeNode.displayName = 'TreeNode';

interface BranchProps extends NodeProps {
    searching: boolean;
    isHit: boolean;
    isSelected: boolean;
}

const BranchNode = ({
    value,
    label,
    isArrayItem,
    pathArr,
    path,
    depth,
    expandCmd,
    selectedPathKey,
    searchTerm,
    filterOnlyMatches,
    hitKeys,
    hitTree,
    searching,
    isHit,
    isSelected,
    onSelectPath,
    onCopy,
    onOpenInTable,
}: BranchProps) => {
    const [open, setOpen] = useState(() => depth < expandCmd.maxDepth);
    const [lastSeq, setLastSeq] = useState(expandCmd.seq);
    const [showAll, setShowAll] = useState(false);

    if (expandCmd.seq !== lastSeq) {
        setLastSeq(expandCmd.seq);
        setOpen(depth < expandCmd.maxDepth);
    }

    const forceOpenForSearch = searching && hitTree?.has(path) === true;
    const expanded = forceOpenForSearch ? true : open;
    const isArr = Array.isArray(value);
    const children = useMemo(() => getJsonNodeChildren(value), [value]);
    const visible = showAll ? children : children.slice(0, CHILD_PAGE);
    const jsonPath = useMemo(() => buildJsonPath(pathArr), [pathArr]);
    const summary = useMemo(() => formatBranchInlineSummary(value, 4), [value]);

    return (
        <div className="json-tree__branch-group">
            <div
                className={`json-tree__row json-tree__row--branch${isHit ? ' json-tree__row--hit' : ''}${isSelected ? ' json-tree__row--selected' : ''}`}
                data-path={jsonPath}
                data-path-key={path}
                data-toggle={path}
                data-depth={depth}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelectPath(pathArr);
                    if (!forceOpenForSearch) {
                        setOpen((o) => !o);
                    }
                }}
            >
                <span className={`json-tree__caret codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
                {label !== '' ? (
                    <span className={`json-tree__key${isArrayItem ? ' json-tree__key--index' : ''}`}>
                        {isArrayItem ? `[${label}]` : renderHighlightedText(label, searchTerm)}
                        <span className="json-tree__colon">:</span>
                    </span>
                ) : (
                    <span className="json-tree__root-tag">$</span>
                )}
                <span className={`json-tree__val json-tree__val--${isArr ? 'array' : 'object'}`}>
                    {summary.badge}
                </span>
                {!expanded && children.length > 0 && (
                    <span className="json-tree__collapsed-preview" title={summary.preview}>
                        {renderHighlightedText(summary.preview, searchTerm)}
                    </span>
                )}
                <span className="json-tree__row-actions" onClick={(e) => e.stopPropagation()}>
                    {isArr && children.length > 0 && (
                        <button
                            type="button"
                            className="json-row-action-btn"
                            title={$t('json.openInTable')}
                            onClick={() => onOpenInTable(pathArr)}
                        >
                            <span className="codicon codicon-table" />
                        </button>
                    )}
                    <button
                        type="button"
                        className="json-row-action-btn"
                        title={$t('json.copyValue')}
                        onClick={() => onCopy(JSON.stringify(value, null, 2), jsonPath)}
                    >
                        <span className="codicon codicon-clippy" />
                    </button>
                    <button
                        type="button"
                        className="json-row-action-btn"
                        title={$t('json.copyPath')}
                        onClick={() => onCopy(jsonPath, jsonPath)}
                    >
                        <span className="codicon codicon-symbol-Namespace" />
                    </button>
                </span>
            </div>
            {expanded && (
                <div className="json-tree__children">
                    {visible.map((child) => {
                        const childSeg = isArr ? Number(child.key) : child.key;
                        const childPathArr = [...pathArr, childSeg];
                        return (
                            <TreeNode
                                key={child.key}
                                value={child.value}
                                label={child.key}
                                isArrayItem={isArr}
                                pathArr={childPathArr}
                                path={pk(childPathArr)}
                                depth={depth + 1}
                                expandCmd={expandCmd}
                                selectedPathKey={selectedPathKey}
                                searchTerm={searchTerm}
                                filterOnlyMatches={filterOnlyMatches}
                                hitKeys={hitKeys}
                                hitTree={hitTree}
                                onSelectPath={onSelectPath}
                                onCopy={onCopy}
                                onOpenInTable={onOpenInTable}
                            />
                        );
                    })}
                    {!showAll && children.length > CHILD_PAGE && (
                        <div className="json-tree__more">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setShowAll(true); }}>
                                {$t('json.showAll', { count: children.length.toLocaleString() })}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function JsonTree({ payload }: TreeProps) {
    const { message } = App.useApp();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [parsed, setParsed] = useState<JsonValue | null>(null);
    const [fileName, setFileName] = useState('');
    const [fileSize, setFileSize] = useState(0);

    const [tab, setTab] = useState<'tree' | 'table' | 'formatted'>('tree');
    const [expandCmd, setExpandCmd] = useState<ExpandCommand>({ maxDepth: 2, seq: 1 });
    const [searchInput, setSearchInput] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterOnlyMatches, setFilterOnlyMatches] = useState(false);

    const [selectedPathArr, setSelectedPathArr] = useState<(string | number)[]>([]);
    const [showInspector, setShowInspector] = useState(true);
    const [wordWrap, setWordWrap] = useState(true);
    const [codeIndent, setCodeIndent] = useState(2);
    const [activeTableSourceKey, setActiveTableSourceKey] = useState<string>(pk([]));

    const [viewCell, setViewCell] = useState<{ key: string; text: string } | null>(null);
    const [matchIndex, setMatchIndex] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setSearchTerm(searchInput.trim());
            setMatchIndex(0);
        }, SEARCH_DEBOUNCE);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    const load = useCallback(async () => {
        if (!payload) return;
        try {
            const buffer = await loadOfficeBuffer(payload);
            const text = new TextDecoder('utf-8').decode(buffer);
            setFileName(payload.fileName ?? '');
            setFileSize(buffer.byteLength);
            const value = /\.jsonc$/i.test(payload.ext ?? '')
                ? (await import('jsonc-parser')).parse(text) as JsonValue
                : JSON.parse(text) as JsonValue;
            setParsed(value);
            // 大文件默认展开 1 层，常规文件默认展开 2 层
            const defaultDepth = buffer.byteLength > 512 * 1024 ? 1 : 2;
            setExpandCmd((prev) => ({ maxDepth: defaultDepth, seq: prev.seq + 1 }));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [payload]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    const stats = useMemo(() => computeJsonStats(parsed), [parsed]);
    const arraySources = useMemo(() => collectArraySources(parsed), [parsed]);

    useEffect(() => {
        if (arraySources.length > 0 && !arraySources.some((s) => s.pathKey === activeTableSourceKey)) {
            setActiveTableSourceKey(arraySources[0].pathKey);
        }
    }, [arraySources, activeTableSourceKey]);

    const matches = useMemo(() => {
        if (!parsed || !searchTerm) return [];
        return collectJsonMatches(parsed, searchTerm);
    }, [parsed, searchTerm]);

    const { hitKeys, hitTree } = useMemo(() => {
        if (!searchTerm || matches.length === 0) return { hitKeys: null, hitTree: null };
        const keys = new Set<string>();
        const tree = new Set<string>();
        for (const hit of matches) {
            keys.add(pk(hit.path));
            for (let i = 0; i <= hit.path.length; i += 1) tree.add(pk(hit.path.slice(0, i)));
        }
        return { hitKeys: keys, hitTree: tree };
    }, [matches, searchTerm]);

    const selectedPathKey = useMemo(() => pk(selectedPathArr), [selectedPathArr]);
    const selectedPath = useMemo(() => buildJsonPath(selectedPathArr), [selectedPathArr]);
    const selectedValue = useMemo(() => resolveJsonNodeByPath(parsed, selectedPathArr), [parsed, selectedPathArr]);

    const handleCopy = useCallback(async (text: string, label?: string) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success(`${$t('json.copied')} ${label ?? (text.length > 48 ? `${text.slice(0, 48)}…` : text)}`);
        } catch {
            message.error($t('json.copyFailed'));
        }
    }, [message]);

    const jumpToMatch = useCallback((index: number) => {
        if (matches.length === 0) return;
        const bounded = ((index % matches.length) + matches.length) % matches.length;
        setMatchIndex(bounded);
        const matchPath = matches[bounded].path;
        setSelectedPathArr(matchPath);
        window.setTimeout(() => {
            const targetPath = buildJsonPath(matchPath);
            const rows = rootRef.current?.querySelectorAll('.json-tree__row--hit') ?? [];
            rows.forEach((row) => {
                if (row.getAttribute('data-path') === targetPath) {
                    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    row.classList.add('json-tree__row--flash');
                    window.setTimeout(() => row.classList.remove('json-tree__row--flash'), 650);
                }
            });
        }, 60);
    }, [matches]);

    const handleSelectPath = useCallback((pathArr: (string | number)[]) => {
        setSelectedPathArr(pathArr);
        window.setTimeout(() => {
            const targetKey = pk(pathArr);
            const el = rootRef.current?.querySelector(`[data-path-key=${JSON.stringify(targetKey)}]`);
            el?.scrollIntoView({ block: 'nearest' });
        }, 30);
    }, []);

    const handleOpenInTable = useCallback((pathArr: (string | number)[]) => {
        setActiveTableSourceKey(pk(pathArr));
        setTab('table');
    }, []);

    const onRootDoubleClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
        const row = (e.target as HTMLElement).closest('.json-tree__row');
        if (!row) return;
        const path = row.getAttribute('data-path');
        if (!path) return;
        const full = row.getAttribute('data-full');
        if (full) {
            setViewCell({ key: path, text: full });
            return;
        }
        await handleCopy(path, path);
    }, [handleCopy]);

    const triggerExpandDepth = useCallback((maxDepth: number) => {
        setExpandCmd((prev) => ({ maxDepth, seq: prev.seq + 1 }));
    }, []);

    const searchActive = searchTerm.length > 0;

    return (
        <div className="json-viewer">
            {loading && <div className="json-viewer__overlay"><Spin /></div>}
            {error && (
                <div className="json-viewer__error">
                    <span className="codicon codicon-error" />
                    <span>{$t('json.parseError')}: {error}</span>
                </div>
            )}

            {/* ===== 顶部主工具栏 ===== */}
            <div className="json-viewer__toolbar">
                <div className="json-viewer__brand">
                    <span className="codicon codicon-json json-viewer__file-icon" />
                    <span className="json-viewer__file" title={fileName}>{fileName || 'JSON'}</span>
                    {fileSize > 0 && <span className="json-viewer__size">{formatSize(fileSize)}</span>}
                    {parsed !== null && (
                        <span className="json-viewer__stat-pill">
                            {stats.rootType === 'array'
                                ? `Array [${stats.topCount}]`
                                : stats.rootType === 'object'
                                    ? `Object {${stats.topCount}}`
                                    : typeof parsed}
                        </span>
                    )}
                </div>

                {/* 视图切换器：树视图 / 表格视图 / 代码视图 */}
                <div className="sqlite-viewer__tabs sqlite-viewer__tabs--inline json-viewer__mode-tabs">
                    <button
                        type="button"
                        className={`sqlite-viewer__tab${tab === 'tree' ? ' sqlite-viewer__tab--active' : ''}`}
                        onClick={() => setTab('tree')}
                    >
                        <span className="codicon codicon-list-tree" />
                        <span>{$t('json.tabTree')}</span>
                    </button>
                    <button
                        type="button"
                        className={`sqlite-viewer__tab${tab === 'table' ? ' sqlite-viewer__tab--active' : ''}`}
                        onClick={() => setTab('table')}
                    >
                        <span className="codicon codicon-table" />
                        <span>{$t('json.tabTable')}</span>
                    </button>
                    <button
                        type="button"
                        className={`sqlite-viewer__tab${tab === 'formatted' ? ' sqlite-viewer__tab--active' : ''}`}
                        onClick={() => setTab('formatted')}
                    >
                        <span className="codicon codicon-code" />
                        <span>{$t('json.tabFormatted')}</span>
                    </button>
                </div>

                {/* 树深度控制按钮组 */}
                {tab === 'tree' && (
                    <div className="json-viewer__depth-group" role="group" aria-label="Tree expansion controls">
                        <button
                            type="button"
                            className={`json-tool-btn${expandCmd.maxDepth === 1 ? ' json-tool-btn--active' : ''}`}
                            title={$t('json.expandLevel', { level: '1' })}
                            onClick={() => triggerExpandDepth(1)}
                        >
                            L1
                        </button>
                        <button
                            type="button"
                            className={`json-tool-btn${expandCmd.maxDepth === 2 ? ' json-tool-btn--active' : ''}`}
                            title={$t('json.expandLevel', { level: '2' })}
                            onClick={() => triggerExpandDepth(2)}
                        >
                            L2
                        </button>
                        <button
                            type="button"
                            className={`json-tool-btn${expandCmd.maxDepth === 3 ? ' json-tool-btn--active' : ''}`}
                            title={$t('json.expandLevel', { level: '3' })}
                            onClick={() => triggerExpandDepth(3)}
                        >
                            L3
                        </button>
                        <button
                            type="button"
                            className="json-tool-btn"
                            title={$t('json.expandAll')}
                            onClick={() => triggerExpandDepth(99)}
                        >
                            <span className="codicon codicon-expand-all" />
                        </button>
                        <button
                            type="button"
                            className="json-tool-btn"
                            title={$t('json.collapseAll')}
                            onClick={() => triggerExpandDepth(0)}
                        >
                            <span className="codicon codicon-collapse-all" />
                        </button>
                    </div>
                )}

                {/* 代码视图控制按钮组 */}
                {tab === 'formatted' && (
                    <div className="json-viewer__depth-group">
                        <button
                            type="button"
                            className={`json-tool-btn${codeIndent === 2 ? ' json-tool-btn--active' : ''}`}
                            onClick={() => setCodeIndent(2)}
                        >
                            2sp
                        </button>
                        <button
                            type="button"
                            className={`json-tool-btn${codeIndent === 4 ? ' json-tool-btn--active' : ''}`}
                            onClick={() => setCodeIndent(4)}
                        >
                            4sp
                        </button>
                        <button
                            type="button"
                            className={`json-tool-btn${codeIndent === 0 ? ' json-tool-btn--active' : ''}`}
                            onClick={() => setCodeIndent(0)}
                        >
                            Min
                        </button>
                        <button
                            type="button"
                            className={`json-tool-btn${wordWrap ? ' json-tool-btn--active' : ''}`}
                            onClick={() => setWordWrap((w) => !w)}
                            title={$t('json.wordWrap')}
                        >
                            <span className="codicon codicon-word-wrap" />
                        </button>
                    </div>
                )}

                <span className="json-viewer__toolbar-spacer" />

                {/* 搜索框与匹配导航 */}
                {tab !== 'table' && (
                    <>
                        <Input
                            className="json-viewer__search"
                            allowClear
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onPressEnter={(e) => jumpToMatch(matchIndex + (e.shiftKey ? -1 : 1))}
                            placeholder={$t('json.searchPlaceholder')}
                            prefix={<span className="codicon codicon-search" />}
                        />
                        {searchActive && (
                            <div className="json-viewer__match-nav">
                                <span className="json-viewer__match-count">
                                    {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : '0'}
                                </span>
                                <button
                                    type="button"
                                    className="json-viewer__nav-btn"
                                    disabled={matches.length === 0}
                                    onClick={() => jumpToMatch(matchIndex - 1)}
                                    title={$t('json.prev')}
                                >
                                    <span className="codicon codicon-arrow-up" />
                                </button>
                                <button
                                    type="button"
                                    className="json-viewer__nav-btn"
                                    disabled={matches.length === 0}
                                    onClick={() => jumpToMatch(matchIndex + 1)}
                                    title={$t('json.next')}
                                >
                                    <span className="codicon codicon-arrow-down" />
                                </button>
                                {tab === 'tree' && (
                                    <button
                                        type="button"
                                        className={`json-viewer__nav-btn${filterOnlyMatches ? ' json-tool-btn--active' : ''}`}
                                        onClick={() => setFilterOnlyMatches((f) => !f)}
                                        title={filterOnlyMatches ? $t('json.filterMode') : $t('json.highlightMode')}
                                    >
                                        <span className="codicon codicon-filter" />
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* 全局快捷操作 */}
                <div className="json-viewer__actions">
                    <button
                        type="button"
                        className="json-tool-btn"
                        title={$t('json.copyFormatted')}
                        onClick={() => parsed !== null && void handleCopy(JSON.stringify(parsed, null, 2))}
                    >
                        <span className="codicon codicon-copy" />
                    </button>
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

            {/* ===== 面包屑路径导航栏 ===== */}
            <div className="json-viewer__breadcrumbs" data-testid="json-breadcrumbs">
                <span className="codicon codicon-symbol-namespace json-viewer__bc-icon" />
                <div className="json-viewer__bc-list">
                    <button
                        type="button"
                        className={`json-bc-item${selectedPathArr.length === 0 ? ' json-bc-item--active' : ''}`}
                        onClick={() => handleSelectPath([])}
                    >
                        $
                    </button>
                    {selectedPathArr.map((seg, idx) => {
                        const subPath = selectedPathArr.slice(0, idx + 1);
                        const isLast = idx === selectedPathArr.length - 1;
                        return (
                            <span key={idx} className="json-bc-seg">
                                <span className="codicon codicon-chevron-right json-bc-sep" />
                                <button
                                    type="button"
                                    className={`json-bc-item${isLast ? ' json-bc-item--active' : ''}`}
                                    onClick={() => handleSelectPath(subPath)}
                                >
                                    {typeof seg === 'number' ? `[${seg}]` : String(seg)}
                                </button>
                            </span>
                        );
                    })}
                </div>
                <span className="json-viewer__toolbar-spacer" />
                <div className="json-viewer__bc-actions">
                    <button
                        type="button"
                        className="json-mini-btn"
                        onClick={() => void handleCopy(selectedPath, selectedPath)}
                        title={$t('json.copyPath')}
                    >
                        <span className="codicon codicon-copy" />
                        <code>{selectedPath}</code>
                    </button>
                    <button
                        type="button"
                        className="json-mini-btn"
                        onClick={() => {
                            const js = buildJsAccessor(selectedPathArr);
                            void handleCopy(js, js);
                        }}
                        title={$t('json.copyJsPath')}
                    >
                        <span>JS</span>
                    </button>
                </div>
            </div>

            {/* ===== 主工作区（左：主视图 / 右：节点检查器） ===== */}
            <div className="json-viewer__workspace">
                <div
                    ref={rootRef}
                    className="json-viewer__content"
                    onDoubleClick={onRootDoubleClick}
                >
                    {parsed !== null && tab === 'tree' && (
                        <div className="json-tree">
                            <TreeNode
                                value={parsed}
                                label=""
                                pathArr={[]}
                                path={pk([])}
                                depth={0}
                                expandCmd={expandCmd}
                                selectedPathKey={selectedPathKey}
                                searchTerm={searchTerm}
                                filterOnlyMatches={filterOnlyMatches}
                                hitKeys={hitKeys}
                                hitTree={hitTree}
                                onSelectPath={setSelectedPathArr}
                                onCopy={handleCopy}
                                onOpenInTable={handleOpenInTable}
                            />
                        </div>
                    )}
                    {parsed !== null && tab === 'table' && (
                        <JsonArrayTableView
                            root={parsed}
                            sources={arraySources}
                            activeSourceKey={activeTableSourceKey}
                            onChangeSourceKey={setActiveTableSourceKey}
                            selectedPathKey={selectedPathKey}
                            onSelectPath={setSelectedPathArr}
                        />
                    )}
                    {parsed !== null && tab === 'formatted' && (
                        <JsonCodeView
                            value={parsed}
                            searchTerm={searchTerm}
                            wordWrap={wordWrap}
                            indent={codeIndent}
                            onCopy={handleCopy}
                        />
                    )}
                </div>

                {showInspector && parsed !== null && (
                    <JsonInspectorPanel
                        selectedPath={selectedPathArr}
                        selectedValue={selectedValue}
                        onSelectPath={handleSelectPath}
                        onCopy={handleCopy}
                        onOpenInTable={handleOpenInTable}
                        onClose={() => setShowInspector(false)}
                    />
                )}
            </div>

            {/* ===== 底部状态栏 ===== */}
            <div className="json-viewer__statusbar">
                <span className="codicon codicon-symbol-namespace" />
                <code>{selectedPath || '$'}</code>
                <span className="json-viewer__status-sep">·</span>
                <span>Nodes: {stats.totalNodes.toLocaleString()}{stats.totalNodes >= 25000 ? '+' : ''}</span>
                <span className="json-viewer__status-sep">·</span>
                <span>Depth: {stats.maxDepth}</span>
                {searchActive && (
                    <span className="json-viewer__hint-right">
                        {$t('json.matchCount', { count: matches.length.toLocaleString() })}
                    </span>
                )}
                <span className="json-viewer__hint">{$t('json.hint')}</span>
            </div>

            <Modal
                open={viewCell !== null}
                title={viewCell?.key}
                footer={null}
                width={760}
                onCancel={() => setViewCell(null)}
            >
                <pre className="json-viewer__cell-view">{viewCell ? formatCellView(viewCell.text) : ''}</pre>
            </Modal>
        </div>
    );
}

export default JsonTree;
