import { memo, useMemo, useState } from 'react';
import { $t } from '../../i18n/i18nConfig.ts';
import { buildJsonPath, getJsonNodeChildren, getJsonNodeKind, type JsonValue } from '../../../provider/jsonCore.ts';
import {
    buildJsAccessor,
    extractSanitizedSvg,
    formatShortScalar,
    isColorString,
    isIsoDateString,
    isUrlString,
    tryParseNestedJson,
} from './jsonUtils.ts';

/** 高亮搜索词的辅助渲染函数 */
export function renderHighlightedText(text: string, keyword: string): React.ReactNode {
    if (!keyword) return text;
    const lowerText = text.toLowerCase();
    const lowerKey = keyword.toLowerCase();
    const idx = lowerText.indexOf(lowerKey);
    if (idx === -1) return text;

    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let matchIdx = idx;
    let keyCounter = 0;
    while (matchIdx !== -1) {
        if (matchIdx > lastIdx) {
            parts.push(text.slice(lastIdx, matchIdx));
        }
        parts.push(
            <mark key={keyCounter++} className="json-hl-mark">
                {text.slice(matchIdx, matchIdx + keyword.length)}
            </mark>,
        );
        lastIdx = matchIdx + keyword.length;
        matchIdx = lowerText.indexOf(lowerKey, lastIdx);
    }
    if (lastIdx < text.length) {
        parts.push(text.slice(lastIdx));
    }
    return parts;
}

/** 单行 JSON 语法着色器 */
export function tokenizeJsonLine(line: string, searchKeyword = ''): React.ReactNode {
    // 匹配前导缩进、属性名、冒号、标量值、括号与逗号
    const tokenRegex = /^(\s*)(?:("(?:\\.|[^"\\])*")(\s*:\s*))?(.*)$/;
    const match = tokenRegex.exec(line);
    if (!match) return renderHighlightedText(line, searchKeyword);

    const [, indent, propKey, colon, rest] = match;
    return (
        <>
            {indent}
            {propKey && (
                <>
                    <span className="json-tok-key">{renderHighlightedText(propKey, searchKeyword)}</span>
                    <span className="json-tok-punc">{colon}</span>
                </>
            )}
            {renderJsonValueToken(rest, searchKeyword)}
        </>
    );
}

function renderJsonValueToken(raw: string, searchKeyword: string): React.ReactNode {
    if (!raw) return null;
    const trimmed = raw.trimEnd();
    const hasComma = trimmed.endsWith(',');
    const core = hasComma ? trimmed.slice(0, -1) : trimmed;
    const trailingComma = hasComma ? <span className="json-tok-punc">,</span> : null;

    if (core === '{' || core === '}' || core === '[' || core === ']' || core === '{}' || core === '[]') {
        return (
            <>
                <span className="json-tok-brace">{core}</span>
                {trailingComma}
            </>
        );
    }
    if (core.startsWith('"') && core.endsWith('"')) {
        return (
            <>
                <span className="json-tok-string">{renderHighlightedText(core, searchKeyword)}</span>
                {trailingComma}
            </>
        );
    }
    if (core === 'true' || core === 'false') {
        return (
            <>
                <span className="json-tok-boolean">{renderHighlightedText(core, searchKeyword)}</span>
                {trailingComma}
            </>
        );
    }
    if (core === 'null') {
        return (
            <>
                <span className="json-tok-null">{renderHighlightedText(core, searchKeyword)}</span>
                {trailingComma}
            </>
        );
    }
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(core)) {
        return (
            <>
                <span className="json-tok-number">{renderHighlightedText(core, searchKeyword)}</span>
                {trailingComma}
            </>
        );
    }
    return renderHighlightedText(raw, searchKeyword);
}

interface FoldBlock {
    endLine: number;
    openChar: '{' | '[';
    closeChar: '}' | ']';
    hasTrailingComma: boolean;
}

/** 计算每一行可折叠代码块的起止行号 */
function computeFoldMap(lines: string[]): Map<number, FoldBlock> {
    const map = new Map<number, FoldBlock>();
    const stack: { line: number; openChar: '{' | '[' }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.endsWith('{') || trimmed.endsWith('[')) {
            const openChar = trimmed[trimmed.length - 1] as '{' | '[';
            stack.push({ line: i, openChar });
        } else if (trimmed === '}' || trimmed === '},' || trimmed === ']' || trimmed === '],') {
            const top = stack.pop();
            if (top && i > top.line) {
                map.set(top.line, {
                    endLine: i,
                    openChar: top.openChar,
                    closeChar: top.openChar === '{' ? '}' : ']',
                    hasTrailingComma: trimmed.endsWith(','),
                });
            }
        }
    }
    return map;
}

interface JsonCodeViewProps {
    value: JsonValue | null;
    searchTerm: string;
    wordWrap: boolean;
    indent: number;
    onCopy: (text: string, label?: string) => void;
}

export const JsonCodeView = memo(({ value, searchTerm, wordWrap, indent, onCopy }: JsonCodeViewProps) => {
    const [foldedLines, setFoldedLines] = useState<Set<number>>(() => new Set());

    const formattedText = useMemo(() => {
        if (value === null || value === undefined) return 'null';
        const raw = indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, indent);
        const limit = 2 * 1024 * 1024;
        return raw.length > limit ? `${raw.slice(0, limit)}\n… ${$t('sqlite.truncated')}` : raw;
    }, [value, indent]);

    const lines = useMemo(() => formattedText.split('\n'), [formattedText]);
    const foldMap = useMemo(() => (indent > 0 ? computeFoldMap(lines) : new Map<number, FoldBlock>()), [lines, indent]);

    const toggleFold = (lineIndex: number) => {
        setFoldedLines((prev) => {
            const next = new Set(prev);
            if (next.has(lineIndex)) next.delete(lineIndex);
            else next.add(lineIndex);
            return next;
        });
    };

    const visibleRows = useMemo(() => {
        const rows: { lineIndex: number; text: string; fold?: FoldBlock; isFolded: boolean }[] = [];
        let i = 0;
        while (i < lines.length) {
            const fold = foldMap.get(i);
            const isFolded = !!fold && foldedLines.has(i);
            rows.push({ lineIndex: i, text: lines[i], fold, isFolded });
            if (isFolded && fold) {
                i = fold.endLine + 1;
            } else {
                i += 1;
            }
        }
        return rows;
    }, [lines, foldMap, foldedLines]);

    return (
        <div className={`json-code-view${wordWrap ? ' json-code-view--wrap' : ''}`}>
            <div className="json-code-view__bar">
                <span className="json-code-view__meta">
                    {lines.length.toLocaleString()} lines · {formattedText.length.toLocaleString()} chars
                </span>
                <div className="json-code-view__actions">
                    {foldMap.size > 0 && (
                        <>
                            <button
                                type="button"
                                className="json-mini-btn"
                                onClick={() => setFoldedLines(new Set())}
                                title={$t('json.expandAll')}
                            >
                                <span className="codicon codicon-unfold" />
                                <span>{$t('json.expandAll')}</span>
                            </button>
                            <button
                                type="button"
                                className="json-mini-btn"
                                onClick={() => {
                                    const all = new Set<number>();
                                    foldMap.forEach((_v, k) => {
                                        if (k > 0) all.add(k);
                                    });
                                    setFoldedLines(all);
                                }}
                                title={$t('json.collapseAll')}
                            >
                                <span className="codicon codicon-fold" />
                                <span>{$t('json.collapseAll')}</span>
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        className="json-mini-btn"
                        onClick={() => onCopy(formattedText)}
                    >
                        <span className="codicon codicon-copy" />
                        <span>{$t('json.copyFormatted')}</span>
                    </button>
                </div>
            </div>
            <div className="json-code-view__lines">
                {visibleRows.map(({ lineIndex, text, fold, isFolded }) => {
                    const isMatch = searchTerm.length > 0 && text.toLowerCase().includes(searchTerm.toLowerCase());
                    return (
                        <div
                            key={lineIndex}
                            className={`json-code-line${isMatch ? ' json-code-line--hit' : ''}`}
                        >
                            <span className="json-code-line__gutter">
                                <span className="json-code-line__num">{lineIndex + 1}</span>
                                {fold ? (
                                    <button
                                        type="button"
                                        className="json-code-line__fold"
                                        onClick={() => toggleFold(lineIndex)}
                                        aria-label="Toggle fold"
                                    >
                                        <span className={`codicon codicon-chevron-${isFolded ? 'right' : 'down'}`} />
                                    </button>
                                ) : (
                                    <span className="json-code-line__fold-spacer" />
                                )}
                            </span>
                            <span className="json-code-line__content">
                                {tokenizeJsonLine(text, searchTerm)}
                                {isFolded && fold && (
                                    <button
                                        type="button"
                                        className="json-code-line__folded-pill"
                                        onClick={() => toggleFold(lineIndex)}
                                    >
                                        … {fold.endLine - lineIndex - 1} lines {fold.closeChar}
                                        {fold.hasTrailingComma ? ',' : ''}
                                    </button>
                                )}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});
JsonCodeView.displayName = 'JsonCodeView';

interface JsonInspectorPanelProps {
    selectedPath: (string | number)[];
    selectedValue: JsonValue | undefined;
    onSelectPath: (path: (string | number)[]) => void;
    onCopy: (text: string, label?: string) => void;
    onOpenInTable?: (path: (string | number)[]) => void;
    onClose: () => void;
}

export const JsonInspectorPanel = memo(({
    selectedPath,
    selectedValue,
    onSelectPath,
    onCopy,
    onOpenInTable,
    onClose,
}: JsonInspectorPanelProps) => {
    const jsonPath = useMemo(() => buildJsonPath(selectedPath), [selectedPath]);
    const jsPath = useMemo(() => buildJsAccessor(selectedPath), [selectedPath]);

    const nodeType = useMemo(() => {
        if (selectedValue === undefined) return 'none';
        if (selectedValue === null) return 'null';
        if (Array.isArray(selectedValue)) return 'array';
        return typeof selectedValue;
    }, [selectedValue]);

    // 检测当前节点或当前对象的直接属性里是否包含 SVG
    const svgCandidates = useMemo(() => {
        const list: { label: string; svg: string }[] = [];
        if (typeof selectedValue === 'string') {
            const svg = extractSanitizedSvg(selectedValue);
            if (svg) list.push({ label: jsonPath, svg });
        } else if (selectedValue && typeof selectedValue === 'object') {
            const entries = Array.isArray(selectedValue)
                ? selectedValue.slice(0, 12).map((v, i) => [String(i), v] as const)
                : Object.entries(selectedValue).slice(0, 20);
            for (const [k, v] of entries) {
                if (typeof v === 'string') {
                    const svg = extractSanitizedSvg(v);
                    if (svg) list.push({ label: k, svg });
                }
            }
        }
        return list;
    }, [selectedValue, jsonPath]);

    const nestedJson = useMemo(() => {
        if (typeof selectedValue !== 'string') return null;
        return tryParseNestedJson(selectedValue);
    }, [selectedValue]);

    const children = useMemo(() => {
        if (selectedValue === undefined || selectedValue === null || typeof selectedValue !== 'object') return [];
        return getJsonNodeChildren(selectedValue);
    }, [selectedValue]);

    const formattedNodeText = useMemo(() => {
        if (selectedValue === undefined) return '';
        if (typeof selectedValue === 'string') return selectedValue;
        const text = JSON.stringify(selectedValue, null, 2) ?? 'null';
        return text.length > 64 * 1024 ? `${text.slice(0, 64 * 1024)}\n…` : text;
    }, [selectedValue]);

    if (selectedValue === undefined) {
        return (
            <aside className="json-inspector">
                <div className="json-inspector__header">
                    <span className="json-inspector__title">
                        <span className="codicon codicon-inspect" />
                        <span>{$t('json.inspector')}</span>
                    </span>
                    <button type="button" className="json-icon-btn" onClick={onClose}>
                        <span className="codicon codicon-close" />
                    </button>
                </div>
                <div className="json-inspector__empty">{$t('json.inspectorEmpty')}</div>
            </aside>
        );
    }

    const isColor = typeof selectedValue === 'string' && isColorString(selectedValue);
    const isUrl = typeof selectedValue === 'string' && isUrlString(selectedValue);
    const isDate = typeof selectedValue === 'string' && isIsoDateString(selectedValue);

    return (
        <aside className="json-inspector" data-testid="json-inspector">
            <div className="json-inspector__header">
                <span className="json-inspector__title">
                    <span className="codicon codicon-inspect" />
                    <span>{$t('json.inspector')}</span>
                    <span className={`json-type-pill json-type-pill--${nodeType}`}>{nodeType.toUpperCase()}</span>
                </span>
                <button type="button" className="json-icon-btn" onClick={onClose} title="Close">
                    <span className="codicon codicon-close" />
                </button>
            </div>

            <div className="json-inspector__body">
                {/* 路径与快捷操作卡片 */}
                <div className="json-inspector__card">
                    <div className="json-inspector__path-row">
                        <span className="json-inspector__path-label">JSONPath</span>
                        <code className="json-inspector__path-code" title={jsonPath}>{jsonPath}</code>
                        <button
                            type="button"
                            className="json-mini-btn"
                            onClick={() => onCopy(jsonPath, jsonPath)}
                        >
                            <span className="codicon codicon-copy" />
                        </button>
                    </div>
                    <div className="json-inspector__path-row">
                        <span className="json-inspector__path-label">JS</span>
                        <code className="json-inspector__path-code" title={jsPath}>{jsPath}</code>
                        <button
                            type="button"
                            className="json-mini-btn"
                            onClick={() => onCopy(jsPath, jsPath)}
                        >
                            <span className="codicon codicon-copy" />
                        </button>
                    </div>
                    {Array.isArray(selectedValue) && selectedValue.length > 0 && onOpenInTable && (
                        <div className="json-inspector__card-actions">
                            <button
                                type="button"
                                className="json-mini-btn json-mini-btn--primary"
                                onClick={() => onOpenInTable(selectedPath)}
                            >
                                <span className="codicon codicon-table" />
                                <span>{$t('json.openInTable')} ({selectedValue.length})</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* 颜色 / URL / 日期 特殊徽章 */}
                {(isColor || isUrl || isDate) && (
                    <div className="json-inspector__card json-inspector__special-row">
                        {isColor && (
                            <div className="json-inspector__color-preview">
                                <span
                                    className="json-color-swatch json-color-swatch--lg"
                                    style={{ backgroundColor: (selectedValue as string).trim() }}
                                />
                                <code>{selectedValue as string}</code>
                            </div>
                        )}
                        {isUrl && (
                            <a
                                className="json-inspector__url-link"
                                href={selectedValue as string}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <span className="codicon codicon-link-external" />
                                <span>{selectedValue as string}</span>
                            </a>
                        )}
                        {isDate && (
                            <div className="json-inspector__date-preview">
                                <span className="codicon codicon-calendar" />
                                <span>{new Date(selectedValue as string).toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* 内联 SVG 矢量图实时渲染卡片 */}
                {svgCandidates.length > 0 && (
                    <div className="json-inspector__section">
                        <div className="json-inspector__section-title">
                            <span className="codicon codicon-symbol-color" />
                            <span>{$t('json.svgPreview')} ({svgCandidates.length})</span>
                        </div>
                        <div className="json-inspector__svg-list">
                            {svgCandidates.map((item, idx) => (
                                <div key={idx} className="json-inspector__svg-card" data-testid="json-svg-preview">
                                    {svgCandidates.length > 1 && (
                                        <div className="json-inspector__svg-label">{item.label}</div>
                                    )}
                                    <div
                                        className="json-inspector__svg-canvas"
                                        dangerouslySetInnerHTML={{ __html: item.svg }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 字符串内嵌 JSON 解析 */}
                {nestedJson !== null && (
                    <div className="json-inspector__section">
                        <div className="json-inspector__section-title">
                            <span className="codicon codicon-json" />
                            <span>{$t('json.nestedJson')}</span>
                            <button
                                type="button"
                                className="json-mini-btn"
                                onClick={() => onCopy(JSON.stringify(nestedJson, null, 2))}
                            >
                                <span className="codicon codicon-copy" />
                            </button>
                        </div>
                        <pre className="json-inspector__pre">
                            {JSON.stringify(nestedJson, null, 2)}
                        </pre>
                    </div>
                )}

                {/* 对象/数组直接子属性表 */}
                {children.length > 0 && (
                    <div className="json-inspector__section">
                        <div className="json-inspector__section-title">
                            <span className="codicon codicon-symbol-property" />
                            <span>{$t('json.properties')} ({children.length})</span>
                        </div>
                        <div className="json-inspector__prop-table">
                            {children.slice(0, 100).map((child) => {
                                const childKind = getJsonNodeKind(child.value);
                                const childType = child.value === null
                                    ? 'null'
                                    : Array.isArray(child.value)
                                        ? `array[${child.value.length}]`
                                        : typeof child.value === 'object'
                                            ? `object{${Object.keys(child.value).length}}`
                                            : typeof child.value;
                                const nextSeg = Array.isArray(selectedValue) ? Number(child.key) : child.key;
                                return (
                                    <div
                                        key={child.key}
                                        className="json-inspector__prop-row"
                                        onClick={() => onSelectPath([...selectedPath, nextSeg])}
                                    >
                                        <span className="json-inspector__prop-key">{child.key}</span>
                                        <span className={`json-inspector__prop-type json-inspector__prop-type--${childKind}`}>
                                            {childType}
                                        </span>
                                        <span className="json-inspector__prop-val">
                                            {formatShortScalar(child.value, 48)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 原始值 / 格式化 JSON */}
                <div className="json-inspector__section">
                    <div className="json-inspector__section-title">
                        <span className="codicon codicon-code" />
                        <span>{$t('json.rawValue')}</span>
                        <button
                            type="button"
                            className="json-mini-btn"
                            onClick={() => onCopy(
                                typeof selectedValue === 'string'
                                    ? selectedValue
                                    : JSON.stringify(selectedValue, null, 2),
                            )}
                        >
                            <span className="codicon codicon-copy" />
                            <span>{$t('json.copyValue')}</span>
                        </button>
                    </div>
                    <pre className="json-inspector__pre">{formattedNodeText}</pre>
                </div>
            </div>
        </aside>
    );
});
JsonInspectorPanel.displayName = 'JsonInspectorPanel';
