import { type OutputFormat, formatBytes } from './imageOps';

export type PanelKind = 'compress' | 'pdf';
export type CopyKind = 'image' | 'markdown' | 'path';

const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.25,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};

function FitIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M2.5 6V3.5H5M13.5 6V3.5H11M2.5 10v2.5H5M13.5 10v2.5H11" />
            <rect x="5.6" y="5.6" width="4.8" height="4.8" rx="0.8" />
        </svg>
    );
}

function RotateIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M13 8a5 5 0 1 1-1.6-3.7" />
            <path d="M13.2 2.4v2.9H10.3" />
        </svg>
    );
}

function FlipIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M8 2.2v11.6" strokeDasharray="1.6 1.6" />
            <path d="M6.4 4.4H3.2l3.2 7.2z" />
            <path d="M9.6 4.4h3.2l-3.2 7.2z" />
        </svg>
    );
}

function CropIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M4.4 1.8v9.8h9.8" />
            <path d="M1.8 4.4h9.8v9.8" />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <rect x="5.6" y="5.6" width="8" height="8" rx="1.2" />
            <path d="M10.4 3.6V3A1.2 1.2 0 0 0 9.2 1.8H3.4A1.6 1.6 0 0 0 1.8 3.4v5.8a1.2 1.2 0 0 0 1.2 1.2h.6" />
        </svg>
    );
}

function SaveIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M3 2.6h7.2L13 5.4v8H3z" />
            <path d="M5.6 2.6v3.2h4.2V2.6" />
            <path d="M5.2 9h5.6v4.4H5.2z" />
        </svg>
    );
}

function CompressIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M2.6 6.4L5 4v4.8z" />
            <path d="M13.4 6.4L11 4v4.8z" />
            <path d="M2.6 9.6L5 12V7.2z" />
            <path d="M13.4 9.6L11 12V7.2z" />
        </svg>
    );
}

function PdfIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...strokeProps}>
            <path d="M3.4 2.4h6l3.2 3.2v8H3.4z" />
            <path d="M9.2 2.4v3.4h3.4" />
            <path d="M6.2 8h3.6M8 7v4.4M6.6 10.2L8 11.4l1.4-1.2" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" {...strokeProps}>
            <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
    );
}

interface ToolbarProps {
    busy: boolean;
    hasImage: boolean;
    panel: PanelKind | null;
    copyMenuOpen: boolean;
    cropped: boolean;
    canCopyLink: boolean;
    onFit: () => void;
    onRotate: () => void;
    onFlip: () => void;
    onCrop: () => void;
    onSave: () => void;
    /** 是否有裁剪/旋转/翻转等未保存的修改 */
    modified: boolean;
    onCopyMenu: () => void;
    onCopy: (kind: CopyKind) => void;
    onOpenPanel: (kind: PanelKind) => void;
}

export function ImageToolbar(props: ToolbarProps) {
    const { busy, hasImage, panel, copyMenuOpen, cropped } = props;
    const disabled = busy || !hasImage;
    return (
        <div className="image-actions" role="toolbar" aria-label="图片操作">
            <button type="button" className="image-actions__btn" title="复位缩放与裁剪 (0)" disabled={disabled} onClick={props.onFit}>
                <FitIcon />
                <span className="image-actions__label">适应</span>
            </button>
            <button type="button" className="image-actions__btn" title="顺时针旋转 90°" disabled={disabled} onClick={props.onRotate}>
                <RotateIcon />
                <span className="image-actions__label">旋转</span>
            </button>
            <button type="button" className="image-actions__btn" title="水平翻转" disabled={disabled} onClick={props.onFlip}>
                <FlipIcon />
                <span className="image-actions__label">翻转</span>
            </button>
            <button
                type="button"
                className={`image-actions__btn${cropped ? ' is-active' : ''}`}
                title={cropped ? '重新框选裁剪区域' : '框选裁剪'}
                disabled={disabled}
                onClick={props.onCrop}
            >
                <CropIcon />
                <span className="image-actions__label">裁剪</span>
            </button>

            <span className="image-actions__divider" aria-hidden="true" />

            <div className="image-actions__menu-wrap">
                <button
                    type="button"
                    className={`image-actions__btn${copyMenuOpen ? ' is-active' : ''}`}
                    title="复制图片或路径"
                    disabled={disabled}
                    onClick={props.onCopyMenu}
                >
                    <CopyIcon />
                    <span className="image-actions__label">复制</span>
                </button>
                {copyMenuOpen && hasImage && (
                    <div className="image-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => props.onCopy('image')}>
                            复制图片
                            <span className="image-menu__hint">PNG 到剪贴板</span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => props.onCopy('markdown')}>
                            复制 Markdown 链接
                            <span className="image-menu__hint">![](图片路径)</span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => props.onCopy('path')}>
                            复制文件路径
                        </button>
                    </div>
                )}
            </div>

            <button
                type="button"
                className={`image-actions__btn${panel === 'compress' ? ' is-active' : ''}`}
                title="压缩 / 调整尺寸"
                disabled={disabled}
                onClick={() => props.onOpenPanel('compress')}
            >
                <CompressIcon />
                <span className="image-actions__label">压缩</span>
            </button>
            <button
                type="button"
                className={`image-actions__btn${panel === 'pdf' ? ' is-active' : ''}`}
                title="导出为 PDF"
                disabled={disabled}
                onClick={() => props.onOpenPanel('pdf')}
            >
                <PdfIcon />
                <span className="image-actions__label">PDF</span>
            </button>

            <span className="image-actions__divider" aria-hidden="true" />

            <button
                type="button"
                className={`image-actions__btn${props.modified ? ' is-primary' : ''}`}
                title={props.modified ? '把当前修改（裁剪 / 旋转 / 翻转）另存为新文件' : '先裁剪或旋转，再保存结果'}
                disabled={disabled || !props.modified}
                onClick={props.onSave}
            >
                <SaveIcon />
                <span className="image-actions__label">保存</span>
            </button>
        </div>
    );
}

/** 体积对比文案：变小/变大都要说清楚，避免"预计比原图大"却看不出问题 */
function estimateText(estimate: number, sourceBytes: number): string {
    const base = `预计 ${formatBytes(estimate)}`;
    if (!sourceBytes) {
        return base;
    }
    const ratio = Math.round((1 - estimate / sourceBytes) * 100);
    if (ratio > 0) {
        return `${base}，减少 ${ratio}%`;
    }
    if (ratio < 0) {
        return `${base}，比原图大 ${Math.abs(ratio)}%`;
    }
    return `${base}，与原图相当`;
}

const PRESETS = [1920, 1280, 800];

interface CompressPanelProps {
    sourceName: string;
    /** 图片真实尺寸 */
    natural: { width: number; height: number };
    /** 裁剪后的基准尺寸，没裁剪时等于 natural */
    base: { width: number; height: number };
    cropped: boolean;
    sourceBytes: number;
    format: OutputFormat;
    quality: number;
    width: number;
    height: number;
    lockAspect: boolean;
    estimate: number | null;
    canOverwrite: boolean;
    overwriteHint: string;
    animated: boolean;
    batchEnabled: boolean;
    batchCount: number;
    busy: boolean;
    status: string;
    onFormat: (format: OutputFormat) => void;
    onQuality: (quality: number) => void;
    onWidth: (width: number) => void;
    onHeight: (height: number) => void;
    onLock: (lock: boolean) => void;
    onPreset: (longSide: number | null) => void;
    onBatch: (enabled: boolean) => void;
    onSave: () => void;
    onOverwrite: () => void;
    onClose: () => void;
}

export function CompressPanel(props: CompressPanelProps) {
    const { format, quality, width, height, busy, status } = props;
    const lossless = format === 'png';
    const longSide = Math.max(width, height);
    const baseLong = Math.max(props.base.width, props.base.height);
    return (
        <div className="image-panel" role="dialog" aria-label="压缩图片">
            <div className="image-panel__head">
                <span>压缩图片</span>
                <button type="button" className="image-panel__close" aria-label="关闭" onClick={props.onClose}>
                    <CloseIcon />
                </button>
            </div>
            <div className="image-panel__body">
                <div className="image-panel__label">格式</div>
                <div className="image-seg" role="group" aria-label="格式">
                    {(['jpeg', 'png', 'webp'] as OutputFormat[]).map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={format === item ? 'is-selected' : ''}
                            disabled={busy}
                            onClick={() => props.onFormat(item)}
                        >
                            {item === 'jpeg' ? 'JPG' : item.toUpperCase()}
                        </button>
                    ))}
                </div>

                {lossless ? (
                    <div className="image-panel__note">
                        PNG 是无损格式，没有质量参数。想减小体积请选 JPG 或 WebP。
                    </div>
                ) : (
                    <>
                        <div className="image-panel__row">
                            <span className="image-panel__label">质量</span>
                            <span className="image-panel__value">{quality}</span>
                        </div>
                        <input
                            className="image-panel__range"
                            type="range"
                            min={10}
                            max={100}
                            step={1}
                            value={quality}
                            disabled={busy}
                            onChange={(event) => props.onQuality(Number(event.target.value))}
                        />
                    </>
                )}

                <div className="image-panel__row">
                    <span className="image-panel__label">尺寸</span>
                    <label className="image-panel__lock">
                        <input
                            type="checkbox"
                            checked={props.lockAspect}
                            disabled={busy}
                            onChange={(event) => props.onLock(event.target.checked)}
                        />
                        锁定比例
                    </label>
                </div>
                <div className="image-panel__inputs">
                    <input
                        type="number"
                        min={1}
                        value={width}
                        disabled={busy}
                        onChange={(event) => props.onWidth(Number(event.target.value))}
                    />
                    <span className="image-panel__times">×</span>
                    <input
                        type="number"
                        min={1}
                        value={height}
                        disabled={busy}
                        onChange={(event) => props.onHeight(Number(event.target.value))}
                    />
                </div>
                <div className="image-panel__presets" role="group" aria-label="长边预设">
                    <button
                        type="button"
                        className={longSide >= baseLong ? 'is-selected' : ''}
                        disabled={busy}
                        onClick={() => props.onPreset(null)}
                    >
                        原尺寸
                    </button>
                    {PRESETS.map((size) => (
                        <button
                            key={size}
                            type="button"
                            className={longSide === size ? 'is-selected' : ''}
                            disabled={busy || size >= baseLong}
                            title={size >= baseLong ? '不能放大到超过当前尺寸' : `长边缩到 ${size}`}
                            onClick={() => props.onPreset(size)}
                        >
                            {size}
                        </button>
                    ))}
                </div>
                <div className="image-panel__hint">
                    {props.cropped ? '裁剪后' : '原图'} {props.base.width} × {props.base.height}
                    {props.cropped ? `（原 ${props.natural.width} × ${props.natural.height}）` : ''}
                    {' · '}文件 {formatBytes(props.sourceBytes)}
                </div>

                {props.animated && (
                    <div className="image-panel__note is-warning">
                        这是动图，压缩后只会保留首帧。为保护原文件，覆盖原图已禁用。
                    </div>
                )}

                <div className="image-panel__estimate">
                    {props.estimate === null ? '正在估算…' : estimateText(props.estimate, props.sourceBytes)}
                </div>

                {props.batchCount > 1 && (
                    <label className="image-panel__batch">
                        <input
                            type="checkbox"
                            checked={props.batchEnabled}
                            disabled={busy}
                            onChange={(event) => props.onBatch(event.target.checked)}
                        />
                        应用到本文件夹全部 {props.batchCount} 张
                    </label>
                )}

                <div className="image-panel__actions">
                    <button type="button" className="image-panel__btn is-primary" disabled={busy} onClick={props.onSave}>
                        {props.batchEnabled ? '批量另存为…' : '另存为…'}
                    </button>
                    <button
                        type="button"
                        className="image-panel__btn"
                        disabled={busy || !props.canOverwrite}
                        title={props.overwriteHint}
                        onClick={props.onOverwrite}
                    >
                        覆盖原图
                    </button>
                </div>
                <div className={`image-panel__status${status ? '' : ' is-empty'}`}>{status}</div>
            </div>
        </div>
    );
}

interface PdfPanelProps {
    total: number;
    scope: 'current' | 'all';
    pageMode: 'a4' | 'fit';
    busy: boolean;
    status: string;
    onScope: (scope: 'current' | 'all') => void;
    onPageMode: (mode: 'a4' | 'fit') => void;
    onExport: () => void;
    onClose: () => void;
}

export function PdfPanel(props: PdfPanelProps) {
    const { busy, status } = props;
    return (
        <div className="image-panel" role="dialog" aria-label="导出 PDF">
            <div className="image-panel__head">
                <span>导出 PDF</span>
                <button type="button" className="image-panel__close" aria-label="关闭" onClick={props.onClose}>
                    <CloseIcon />
                </button>
            </div>
            <div className="image-panel__body">
                <div className="image-panel__label">范围</div>
                <div className="image-seg" role="group" aria-label="范围">
                    <button
                        type="button"
                        className={props.scope === 'current' ? 'is-selected' : ''}
                        disabled={busy}
                        onClick={() => props.onScope('current')}
                    >
                        当前图片
                    </button>
                    <button
                        type="button"
                        className={props.scope === 'all' ? 'is-selected' : ''}
                        disabled={busy || props.total <= 1}
                        onClick={() => props.onScope('all')}
                    >
                        全部 {props.total} 张
                    </button>
                </div>

                <div className="image-panel__label">页面</div>
                <div className="image-seg" role="group" aria-label="页面">
                    <button
                        type="button"
                        className={props.pageMode === 'a4' ? 'is-selected' : ''}
                        disabled={busy}
                        onClick={() => props.onPageMode('a4')}
                    >
                        A4 居中
                    </button>
                    <button
                        type="button"
                        className={props.pageMode === 'fit' ? 'is-selected' : ''}
                        disabled={busy}
                        onClick={() => props.onPageMode('fit')}
                    >
                        贴合图片
                    </button>
                </div>
                <div className="image-panel__hint">
                    当前旋转 / 裁剪会应用到导出的那张图；其他图片按原样导出
                </div>

                <div className="image-panel__actions">
                    <button type="button" className="image-panel__btn is-primary" disabled={busy} onClick={props.onExport}>
                        {busy ? '正在导出…' : '导出…'}
                    </button>
                </div>
                <div className={`image-panel__status${status ? '' : ' is-empty'}`}>{status}</div>
            </div>
        </div>
    );
}
