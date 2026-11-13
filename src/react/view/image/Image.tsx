import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ImageGallery from "react-image-gallery";
import "react-image-gallery/styles/css/image-gallery.css";
import { handler } from '../../util/vscode';
import { type ImageSource, needsConversion, resolveImageSrc, revokeObjectUrl } from './convertImage';
import {
    IDENTITY_TRANSFORM,
    type CropRect,
    type OutputFormat,
    type Transform,
    canvasToBase64,
    canvasToBlob,
    estimateSize,
    extOf,
    fitLongSide,
    formatBytes,
    guessFormatFromName,
    isAnimatedName,
    loadImageElement,
    pdfEmbedMime,
    releaseCanvas,
    renderCanvas,
} from './imageOps';
import { CompressPanel, ImageToolbar, PdfPanel, type CopyKind, type PanelKind } from './ImageTools';
import './Image.less';

type WheelMode = 'navigate' | 'zoom';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

function ZoomIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M6.5 1a5.5 5.5 0 1 0 3.898 9.402l3.854 3.853a.5.5 0 0 0 .707-.708l-3.853-3.853A5.5 5.5 0 0 0 6.5 1zm0 1a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z" />
            <path fill="currentColor" d="M6 5.5a.5.5 0 0 1 .5.5V6h.5a.5.5 0 0 1 0 1H6.5v.5a.5.5 0 0 1-1 0V7H5a.5.5 0 0 1 0-1h.5V6a.5.5 0 0 1 .5-.5z" />
        </svg>
    );
}

function BrowseIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M2.5 5A1.5 1.5 0 0 1 4 3.5h5A1.5 1.5 0 0 1 10.5 5v1H11.5A1.5 1.5 0 0 1 13 7.5v5A1.5 1.5 0 0 1 11.5 14h-5A1.5 1.5 0 0 1 5 12.5v-1H4A1.5 1.5 0 0 1 2.5 10V5z" opacity="0.45" />
            <path fill="currentColor" d="M4.5 2A1.5 1.5 0 0 1 6 .5h5A1.5 1.5 0 0 1 12.5 2v8A1.5 1.5 0 0 1 11 11.5H10v-1A1.5 1.5 0 0 0 8.5 9h-5A1.5 1.5 0 0 1 2 7.5V4.5h2V2z" />
            <circle cx="5.75" cy="5.25" r="0.75" fill="currentColor" />
            <path fill="currentColor" d="M3.75 8.75l1.75-1.25 1.25.9 2-1.8V10H3.75V8.75z" />
        </svg>
    );
}

export default function Image() {
    const gallery = useRef<any>(null);
    const [info, setInfo] = useState({ images: [], current: 0 } as any);
    const [resolvedImages, setResolvedImages] = useState<{ original: string; thumbnail: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [wheelMode, setWheelMode] = useState<WheelMode>('zoom');
    const [zoom, setZoom] = useState(1);
    const [index, setIndex] = useState(0);
    const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);
    const [crop, setCrop] = useState<CropRect | null>(null);
    const [cropUrl, setCropUrl] = useState<string | null>(null);
    const [cropping, setCropping] = useState(false);
    const [panel, setPanel] = useState<PanelKind | null>(null);
    const [copyMenuOpen, setCopyMenuOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [toast, setToast] = useState('');
    const [pendingIntent, setPendingIntent] = useState<PanelKind | null>(null);

    const [format, setFormat] = useState<OutputFormat>('jpeg');
    const [quality, setQuality] = useState(82);
    const [natural, setNatural] = useState({ width: 0, height: 0 });
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    const [lockAspect, setLockAspect] = useState(true);
    const [sourceBytes, setSourceBytes] = useState(0);
    const [estimate, setEstimate] = useState<number | null>(null);
    const [batchEnabled, setBatchEnabled] = useState(false);

    const [pdfScope, setPdfScope] = useState<'current' | 'all'>('current');
    const [pdfPageMode, setPdfPageMode] = useState<'a4' | 'fit'>('a4');

    const objectUrlsRef = useRef<string[]>([]);
    const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const cropUrlRef = useRef<string | null>(null);
    const cropOverlayRef = useRef<HTMLDivElement | null>(null);
    const cropRectRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ active: boolean; startX: number; startY: number; rect: CropRect | null }>({
        active: false,
        startX: 0,
        startY: 0,
        rect: null,
    });
    const batchRef = useRef({ expect: 0, done: 0, failed: 0 });
    const saveGuardRef = useRef<number | null>(null);
    const toastTimerRef = useRef<number | null>(null);

    const showToast = useCallback((text: string, ms = 2000) => {
        setToast(text);
        if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = window.setTimeout(() => setToast(''), ms);
    }, []);

    /** 扩展侧没回执时（比如宿主还跑着旧版本）把按钮放回来，避免永久禁用 */
    const armSaveGuard = useCallback(() => {
        if (saveGuardRef.current) {
            clearTimeout(saveGuardRef.current);
        }
        saveGuardRef.current = window.setTimeout(() => {
            saveGuardRef.current = null;
            setBusy(false);
            setStatus('没有收到扩展响应，请重载窗口后重试');
            showToast('保存超时，请重载窗口');
        }, 30000);
    }, [showToast]);

    const clearSaveGuard = useCallback(() => {
        if (saveGuardRef.current) {
            clearTimeout(saveGuardRef.current);
            saveGuardRef.current = null;
        }
    }, []);


    const currentSrc = useCallback(
        (): string => resolvedImages[index]?.original ?? info.images[index]?.src ?? '',
        [resolvedImages, index, info.images],
    );

    const currentTitle = info.images[index]?.title ?? '';
    const animated = isAnimatedName(currentTitle);

    const ensureImage = useCallback(async (src: string): Promise<HTMLImageElement> => {
        const cached = imageCacheRef.current.get(src);
        if (cached) {
            return cached;
        }
        const image = await loadImageElement(src);
        imageCacheRef.current.set(src, image);
        return image;
    }, []);

    /** 清掉裁剪状态与预览图 URL，供复位/切图复用 */
    const clearCrop = useCallback(() => {
        if (cropUrlRef.current) {
            URL.revokeObjectURL(cropUrlRef.current);
            cropUrlRef.current = null;
        }
        setCropUrl(null);
        setCrop(null);
    }, []);

    /** 预览：把滚轮缩放、旋转、翻转合成一个 transform；旋转 90° 时顺带缩到容器内 */
    const applyPreview = useCallback((scale: number, next: Transform) => {
        const img = document.querySelector('.image-gallery-slide.image-gallery-center .image-gallery-image') as HTMLElement | null;
        if (!img) {
            return;
        }
        const slide = img.closest('.image-gallery-slide') as HTMLElement | null;
        let fit = 1;
        if (Math.abs(next.rotate % 180) === 90 && slide) {
            const layoutWidth = img.clientWidth;
            const layoutHeight = img.clientHeight;
            if (layoutWidth && layoutHeight) {
                fit = Math.min(
                    (slide.clientWidth - 32) / layoutHeight,
                    (slide.clientHeight - 32) / layoutWidth,
                    1,
                );
            }
        }
        const parts = [`scale(${scale * fit})`];
        if (next.rotate) {
            parts.push(`rotate(${next.rotate}deg)`);
        }
        if (next.flipH || next.flipV) {
            parts.push(`scale(${next.flipH ? -1 : 1}, ${next.flipV ? -1 : 1})`);
        }
        img.style.transform = parts.join(' ');
    }, []);

    useEffect(() => {
        applyPreview(zoom, transform);
    }, [zoom, transform, applyPreview, resolvedImages, index]);

    // 裁剪 / 旋转后重新生成预览图，保证所见即所得
    useEffect(() => {
        let cancelled = false;
        const src = currentSrc();
        if (!crop || !src) {
            return;
        }
        void (async () => {
            try {
                const element = await ensureImage(src);
                // 只烘焙裁剪，旋转/翻转仍由 CSS transform 负责，避免重复应用
                const canvas = renderCanvas(element, { crop });
                const blob = await canvasToBlob(canvas, 'png');
                releaseCanvas(canvas);
                if (cancelled) {
                    return;
                }
                const url = URL.createObjectURL(blob);
                if (cropUrlRef.current) {
                    URL.revokeObjectURL(cropUrlRef.current);
                }
                cropUrlRef.current = url;
                setCropUrl(url);
            } catch {
                if (!cancelled) {
                    setCropUrl(null);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [crop, currentSrc, ensureImage]);

    useEffect(() => {
        handler.on('images', (next: any) => {
            setInfo(next);
            setZoom(1);
            setIndex(next?.current ?? 0);
            setTransform(IDENTITY_TRANSFORM);
            clearCrop();
            setCropping(false);
            setPanel(null);
            setCopyMenuOpen(false);
            setStatus('');
            imageCacheRef.current.clear();
            const hasResolvable = next.images.some((image: ImageSource) =>
                needsConversion(image) || !!image.buffer?.length
            );
            setLoading(hasResolvable);
            if (!next.images.length) {
                setResolvedImages([]);
                setLoading(false);
            }
        }).emit('images');
        handler.on('imageIntent', (payload: any) => {
            const intent = payload?.intent === 'pdf' ? 'pdf' : 'compress';
            setPendingIntent(intent);
        });
    }, [clearCrop]);

    const cropSize = useMemo(() => (crop ? { width: crop.width, height: crop.height } : null), [crop]);

    const openPanel = useCallback(async (kind: PanelKind) => {
        if (panel === kind) {
            setPanel(null);
            return;
        }
        setPanel(kind);
        setCopyMenuOpen(false);
        setStatus('');
        if (kind !== 'compress') {
            return;
        }
        const src = currentSrc();
        const image = info.images[index];
        if (!src || !image) {
            return;
        }
        try {
            const element = await ensureImage(src);
            const real = { width: element.naturalWidth, height: element.naturalHeight };
            const size = cropSize ?? real;
            setNatural(real);
            setWidth(size.width);
            setHeight(size.height);
            setLockAspect(true);
            setBatchEnabled(false);
            setFormat(guessFormatFromName(image.title ?? ''));
            setQuality(82);
            setEstimate(null);
            setSourceBytes(image.buffer?.length ?? 0);
            if (!image.buffer?.length) {
                try {
                    const response = await fetch(src);
                    setSourceBytes((await response.blob()).size);
                } catch {
                    setSourceBytes(0);
                }
            }
        } catch {
            setStatus('无法读取图片');
        }
    }, [panel, currentSrc, info.images, index, ensureImage, cropSize]);
    // 右键菜单带进来的动作，等图片解析完再打开面板
    useEffect(() => {
        if (!pendingIntent || !resolvedImages.length) {
            return;
        }
        const intent = pendingIntent;
        // 放到下一个宏任务里再 setState，避免在 effect 内同步更新导致级联渲染
        const timer = window.setTimeout(() => {
            setPendingIntent(null);
            void openPanel(intent);
        }, 0);
        return () => clearTimeout(timer);
    }, [pendingIntent, resolvedImages.length, openPanel]);

    useEffect(() => {
        let cancelled = false;
        for (const url of objectUrlsRef.current) {
            revokeObjectUrl(url);
        }
        objectUrlsRef.current = [];

        if (!info.images.length) {
            return;
        }

        (async () => {
            const resolved: { original: string; thumbnail: string }[] = [];
            for (const image of info.images) {
                if (cancelled) return;
                try {
                    const src = await resolveImageSrc(image);
                    if (src.startsWith('blob:')) {
                        objectUrlsRef.current.push(src);
                    }
                    resolved.push({ original: src, thumbnail: src });
                } catch {
                    resolved.push({ original: image.src ?? '', thumbnail: image.src ?? '' });
                }
            }
            if (!cancelled) {
                setResolvedImages(resolved);
                setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            for (const url of objectUrlsRef.current) {
                revokeObjectUrl(url);
            }
            objectUrlsRef.current = [];
        };
    }, [info.images]);

    useEffect(() => {
        let previous = 0;
        const onWheel = (e: WheelEvent) => {
            if (cropping || panel) {
                return;
            }
            if (wheelMode === 'navigate') {
                if (Date.now() - previous < 300) return;
                previous = Date.now();
                const current = gallery.current.getCurrentIndex();
                gallery.current.slideToIndex(current + (e.deltaY > 0 ? 1 : -1));
                return;
            }
            e.preventDefault();
            const factor = Math.pow(1.001, -e.deltaY);
            setZoom(value => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value * factor)));
        };
        addEventListener('wheel', onWheel, { passive: false });
        return () => removeEventListener('wheel', onWheel);
    }, [wheelMode, cropping, panel]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setCropping(false);
                setCopyMenuOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        return () => {
            if (cropUrlRef.current) {
                URL.revokeObjectURL(cropUrlRef.current);
            }
            if (toastTimerRef.current) {
                clearTimeout(toastTimerRef.current);
            }
            if (saveGuardRef.current) {
                clearTimeout(saveGuardRef.current);
            }
        };
    }, []);



    useEffect(() => {
        if (panel !== 'compress' || !width || !height) {
            return;
        }
        const src = currentSrc();
        if (!src) {
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const element = await ensureImage(src);
                const value = await estimateSize(element, {
                    transform,
                    crop,
                    targetWidth: width,
                    targetHeight: height,
                    format,
                    quality,
                });
                if (!cancelled) {
                    setEstimate(value);
                }
            } catch {
                if (!cancelled) {
                    setEstimate(null);
                }
            }
        }, 320);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [panel, width, height, format, quality, transform, crop, currentSrc, ensureImage]);

    const aspectRatio = natural.width && natural.height ? natural.width / natural.height : 1;

    const changeWidth = (next: number) => {
        const value = Math.max(1, Math.round(next || 1));
        setWidth(value);
        if (lockAspect) {
            setHeight(Math.max(1, Math.round(value / aspectRatio)));
        }
    };

    const changeHeight = (next: number) => {
        const value = Math.max(1, Math.round(next || 1));
        setHeight(value);
        if (lockAspect) {
            setWidth(Math.max(1, Math.round(value * aspectRatio)));
        }
    };

    const applyPreset = (longSide: number | null) => {
        const base = cropSize ?? natural;
        if (!longSide) {
            setWidth(base.width);
            setHeight(base.height);
            return;
        }
        const fitted = fitLongSide(base.width, base.height, longSide);
        setWidth(fitted.width);
        setHeight(fitted.height);
    };

    const resetView = () => {
        setZoom(1);
        setTransform(IDENTITY_TRANSFORM);
        clearCrop();
    };

    const copyToClipboard = async (kind: CopyKind) => {
        setCopyMenuOpen(false);
        const image = info.images[index];
        const src = currentSrc();
        if (!src) {
            return;
        }
        try {
            if (kind === 'path') {
                await navigator.clipboard.writeText(image?.path ?? '');
                showToast('已复制文件路径');
                return;
            }
            if (kind === 'markdown') {
                const target = image?.relPath || image?.path || '';
                await navigator.clipboard.writeText(`![${image?.title ?? 'image'}](${target})`);
                showToast('已复制 Markdown 链接');
                return;
            }
            const element = await ensureImage(src);
            const canvas = renderCanvas(element, { transform, crop, background: '#ffffff' });
            const blob = await canvasToBlob(canvas, 'png');
            releaseCanvas(canvas);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('已复制图片');
        } catch (error) {
            showToast(`复制失败：${(error as Error).message}`);
        }
    };

    const startCrop = () => {
        clearCrop();
        setCropping(true);
        setPanel(null);
        setCopyMenuOpen(false);
        setZoom(1);
        setTransform(IDENTITY_TRANSFORM);
    };

    const onCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        const drag = dragRef.current;
        drag.active = true;
        drag.startX = event.clientX;
        drag.startY = event.clientY;
        drag.rect = null;
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // 忽略指针捕获失败
        }
    };

    const onCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag.active || !cropRectRef.current) {
            return;
        }
        const left = Math.min(drag.startX, event.clientX);
        const top = Math.min(drag.startY, event.clientY);
        const width = Math.abs(event.clientX - drag.startX);
        const height = Math.abs(event.clientY - drag.startY);
        drag.rect = { x: left, y: top, width, height };
        Object.assign(cropRectRef.current.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        });
    };

    const onCropPointerUp = () => {
        const drag = dragRef.current;
        if (!drag.active) {
            return;
        }
        drag.active = false;
        const selection = drag.rect;
        setCropping(false);
        const img = document.querySelector('.image-gallery-slide.image-gallery-center .image-gallery-image') as HTMLImageElement | null;
        if (!selection || !img || selection.width < 8 || selection.height < 8) {
            showToast('选区太小，已取消');
            return;
        }
        const rect = img.getBoundingClientRect();
        const ratio = img.naturalWidth / rect.width;
        // 两端都要钳到图片范围内：只钳起点会让"从图外拖进来"的选区多出一截
        const clampX = (value: number) => Math.max(rect.left, Math.min(value, rect.right));
        const clampY = (value: number) => Math.max(rect.top, Math.min(value, rect.bottom));
        const x1 = clampX(selection.x);
        const x2 = clampX(selection.x + selection.width);
        const y1 = clampY(selection.y);
        const y2 = clampY(selection.y + selection.height);
        const sx = x1 - rect.left;
        const sy = y1 - rect.top;
        const sw = x2 - x1;
        const sh = y2 - y1;
        if (sw < 4 || sh < 4) {
            showToast('选区太小，已取消');
            return;
        }
        const next: CropRect = {
            x: Math.round(sx * ratio),
            y: Math.round(sy * ratio),
            width: Math.max(1, Math.round(sw * ratio)),
            height: Math.max(1, Math.round(sh * ratio)),
        };
        setCrop(next);
        setWidth(next.width);
        setHeight(next.height);
        showToast(`已裁剪 ${next.width} × ${next.height}，可点右侧「保存」导出`);
    };

    /** 有修改时的一步保存：裁剪 / 旋转 / 翻转都会烘焙进去，沿用原图格式 */
    const saveEdited = async () => {
        const src = currentSrc();
        if (!src || !modified) {
            return;
        }
        const ext = (currentTitle.split('.').pop() ?? '').toLowerCase();
        const outFormat: OutputFormat = ext === 'png' || ext === 'apng'
            ? 'png'
            : ext === 'webp'
                ? 'webp'
                : ext === 'jpg' || ext === 'jpeg'
                    ? 'jpeg'
                    : 'png';
        setBusy(true);
        setStatus('正在编码…');
        try {
            const element = await ensureImage(src);
            const canvas = renderCanvas(element, {
                transform,
                crop,
                background: outFormat === 'png' ? null : '#ffffff',
            });
            let content: string;
            try {
                content = await canvasToBase64(canvas, outFormat, outFormat === 'png' ? undefined : 0.92);
            } finally {
                releaseCanvas(canvas);
            }
            setStatus('正在写入文件…');
            const base = currentTitle.replace(/\.[^.]+$/, '');
            const suffix = crop ? 'cropped' : 'edited';
            armSaveGuard();
            handler.emit('imageSaveBytes', {
                content,
                ext: extOf(outFormat),
                name: `${base}-${suffix}.${extOf(outFormat)}`,
            });
            showToast(crop ? '正在保存裁剪结果…' : '正在保存修改结果…');
        } catch (error) {
            setBusy(false);
            setStatus(`失败：${(error as Error).message}`);
            showToast(`保存失败：${(error as Error).message}`);
        }
    };

    const saveCompressed = async (overwrite: boolean) => {
        if (batchEnabled && !overwrite) {
            await saveBatch();
            return;
        }
        const src = currentSrc();
        if (!src) {
            return;
        }
        setBusy(true);
        setStatus('正在编码…');
        try {
            const element = await ensureImage(src);
            const canvas = renderCanvas(element, {
                transform,
                crop,
                targetWidth: width,
                targetHeight: height,
                background: format === 'png' ? null : '#ffffff',
            });
            let content: string;
            try {
                content = await canvasToBase64(canvas, format, format === 'png' ? undefined : quality / 100);
            } finally {
                releaseCanvas(canvas);
            }
            setStatus('正在写入文件…');
            const base = currentTitle.replace(/\.[^.]+$/, '');
            armSaveGuard();
            handler.emit('imageSaveBytes', {
                content,
                ext: extOf(format),
                name: `${base}-compressed.${extOf(format)}`,
                overwrite,
            });
        } catch (error) {
            setBusy(false);
            setStatus(`失败：${(error as Error).message}`);
        }
    };

    const saveBatch = async () => {
        const entries = info.images
            .map((image: any, i: number) => ({ image, src: resolvedImages[i]?.original }))
            .filter((entry: any) => entry.image?.path && entry.src);
        if (!entries.length) {
            setStatus('这个文件夹里没有可批量处理的图片');
            return;
        }
        const targetLong = Math.max(width, height);
        setBusy(true);
        batchRef.current = { expect: entries.length, done: 0, failed: 0 };
        try {
            for (let i = 0; i < entries.length; i++) {
                setStatus(`正在处理 ${i + 1} / ${entries.length}`);
                const { image, src } = entries[i];
                const element = await ensureImage(src);
                const dims = fitLongSide(element.naturalWidth, element.naturalHeight, targetLong);
                const canvas = renderCanvas(element, {
                    targetWidth: dims.width,
                    targetHeight: dims.height,
                    background: format === 'png' ? null : '#ffffff',
                });
                let content: string;
                try {
                    content = await canvasToBase64(canvas, format, format === 'png' ? undefined : quality / 100);
                } finally {
                    releaseCanvas(canvas);
                }
                const base = String(image.title ?? 'image').replace(/\.[^.]+$/, '');
                armSaveGuard();
                handler.emit('imageSaveBytes', {
                    content,
                    ext: extOf(format),
                    name: `${base}-compressed.${extOf(format)}`,
                    auto: true,
                    sourcePath: image.path,
                });
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        } catch (error) {
            setBusy(false);
            setStatus(`失败：${(error as Error).message}`);
        }
    };

    const sendPdfPages = useCallback(async () => {
        const useAll = pdfScope === 'all';
        const list = useAll ? resolvedImages : [resolvedImages[index]];
        const total = list.length;
        try {
            for (let i = 0; i < total; i++) {
                setStatus(`正在生成 ${i + 1} / ${total}`);
                const src = list[i]?.original;
                if (!src) {
                    continue;
                }
                const element = await ensureImage(src);
                const canvas = renderCanvas(element, {
                    transform: useAll ? IDENTITY_TRANSFORM : transform,
                    crop: useAll ? null : crop,
                    background: '#ffffff',
                });
                let content: string;
                try {
                    const title = info.images[useAll ? i : index]?.title ?? '';
                    const mime = pdfEmbedMime(title);
                    content = await canvasToBase64(canvas, mime === 'image/png' ? 'png' : 'jpeg', 0.92);
                } finally {
                    releaseCanvas(canvas);
                }
                const title = info.images[useAll ? i : index]?.title ?? '';
                handler.emit('imagePdfPage', { index: i + 1, content, mime: pdfEmbedMime(title) });
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            setStatus('正在写入 PDF…');
            handler.emit('imagePdfDone', {});
        } catch (error) {
            setBusy(false);
            setStatus(`失败：${(error as Error).message}`);
            handler.emit('imagePdfAbort', {});
        }
    }, [pdfScope, resolvedImages, index, transform, crop, info.images, ensureImage]);

    const startPdfExport = () => {
        if (busy) {
            return;
        }
        setBusy(true);
        setStatus('等待选择保存位置…');
        handler.emit('imagePdfStart', {
            pageMode: pdfPageMode,
            totalPages: pdfScope === 'all' ? resolvedImages.length : 1,
        });
    };

    useEffect(() => {
        handler.on('imageSaveDone', (payload: any) => {
            clearSaveGuard();
            if (payload?.auto) {
                batchRef.current.done += 1;
                const { done, failed, expect } = batchRef.current;
                if (done + failed >= expect) {
                    setBusy(false);
                    setStatus(failed > 0
                        ? `批量完成：${done} 张成功，${failed} 张失败`
                        : `批量完成：已保存 ${done} 张`);
                } else {
                    setStatus(`已完成 ${done + failed} / ${expect}`);
                }
                return;
            }
            setBusy(false);
            const size = payload?.bytes ? `（${formatBytes(payload.bytes)}）` : '';
            setStatus(`已保存 ${payload?.fileName ?? ''}${size}`);
        });
        handler.on('imageSaveCancel', () => {
            setBusy(false);
            setStatus('已取消');
        });
        handler.on('imageSaveError', (payload: any) => {
            clearSaveGuard();
            if (payload?.auto) {
                batchRef.current.failed += 1;
                const { done, failed, expect } = batchRef.current;
                if (done + failed >= expect) {
                    setBusy(false);
                    setStatus(`批量完成：${done} 张成功，${failed} 张失败`);
                }
                return;
            }
            setBusy(false);
            setStatus(`失败：${payload?.message ?? ''}`);
        });
        handler.on('imagePdfAccept', () => {
            void sendPdfPages();
        });
        handler.on('imagePdfCancel', () => {
            setBusy(false);
            setStatus('已取消');
        });
        handler.on('imagePdfFinished', (payload: any) => {
            setBusy(false);
            setStatus(`已导出 ${payload?.count ?? 0} 页 PDF`);
        });
        handler.on('imagePdfError', (payload: any) => {
            setBusy(false);
            setStatus(`失败：${payload?.message ?? ''}`);
        });
    }, [sendPdfPages, armSaveGuard, clearSaveGuard]);

    const images = useMemo(() => {
        const base = resolvedImages.length ? resolvedImages : info.images.map((image: { src: string }) => ({
            original: image.src,
            thumbnail: image.src
        }));
        if (!cropUrl) {
            return base;
        }
        // 裁剪后直接把这张图的地址换成裁剪结果，复用画廊自身的居中与布局
        return base.map((item, i) => (i === index ? { ...item, original: cropUrl } : item));
    }, [resolvedImages, info.images, cropUrl, index]);

    const hasImage = !!images.length;
    const batchCount = info.images.filter((image: any) => image?.path).length;
    const modified = !!crop || transform.rotate !== 0 || transform.flipH || transform.flipV;
    const formatMatchesSource = guessFormatFromName(currentTitle) === format;
    const canOverwrite = formatMatchesSource && !animated;
    const overwriteHint = animated
        ? '动图覆盖后会丢失动画，请另存为新文件'
        : formatMatchesSource
            ? '直接替换磁盘上的原文件'
            : '改变格式时不能覆盖原图';

    return (
        <div className="image-viewer">
            {loading && <div className="image-viewer__loading">Converting image…</div>}

            <ImageToolbar
                busy={busy}
                hasImage={hasImage}
                panel={panel}
                copyMenuOpen={copyMenuOpen}
                cropped={!!crop}
                canCopyLink={!!(info.images[index]?.relPath || info.images[index]?.path)}
                onFit={resetView}
                onRotate={() => setTransform(value => ({ ...value, rotate: (value.rotate + 90) % 360 }))}
                onFlip={() => setTransform(value => ({ ...value, flipH: !value.flipH }))}
                onCrop={startCrop}
                onSave={() => void saveEdited()}
                modified={modified}
                onCopyMenu={() => setCopyMenuOpen(open => !open)}
                onCopy={(kind) => void copyToClipboard(kind)}
                onOpenPanel={(kind) => void openPanel(kind)}
            />

            <div className="image-wheel-toolbar" role="toolbar" aria-label="Wheel mode">
                <button
                    type="button"
                    className={`image-wheel-toolbar__btn${wheelMode === 'zoom' ? ' is-active' : ''}`}
                    title="Scroll wheel to zoom"
                    aria-pressed={wheelMode === 'zoom'}
                    onClick={() => setWheelMode('zoom')}
                >
                    <ZoomIcon />
                    <span className="image-wheel-toolbar__label">Zoom</span>
                </button>
                <span className="image-wheel-toolbar__divider" aria-hidden="true" />
                <button
                    type="button"
                    className={`image-wheel-toolbar__btn${wheelMode === 'navigate' ? ' is-active' : ''}`}
                    title="Scroll wheel to switch images"
                    aria-pressed={wheelMode === 'navigate'}
                    onClick={() => setWheelMode('navigate')}
                >
                    <BrowseIcon />
                    <span className="image-wheel-toolbar__label">Browse</span>
                </button>
            </div>

            {cropping && (
                <div
                    className="image-crop-overlay"
                    ref={cropOverlayRef}
                    onPointerDown={onCropPointerDown}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={onCropPointerUp}
                    onPointerCancel={() => setCropping(false)}
                >
                    <div className="image-crop-rect" ref={cropRectRef} />
                    <div className="image-crop-hint">拖拽框选裁剪区域 · Esc 取消</div>
                </div>
            )}

            {panel === 'compress' && (
                <CompressPanel
                    sourceName={currentTitle}
                    natural={natural}
                    base={cropSize ?? natural}
                    cropped={!!crop}
                    sourceBytes={sourceBytes}
                    format={format}
                    quality={quality}
                    width={width}
                    height={height}
                    lockAspect={lockAspect}
                    estimate={estimate}
                    canOverwrite={canOverwrite}
                    overwriteHint={overwriteHint}
                    animated={animated}
                    batchEnabled={batchEnabled}
                    batchCount={batchCount}
                    busy={busy}
                    status={status}
                    onFormat={setFormat}
                    onQuality={setQuality}
                    onWidth={changeWidth}
                    onHeight={changeHeight}
                    onLock={setLockAspect}
                    onPreset={applyPreset}
                    onBatch={setBatchEnabled}
                    onSave={() => void saveCompressed(false)}
                    onOverwrite={() => void saveCompressed(true)}
                    onClose={() => setPanel(null)}
                />
            )}

            {panel === 'pdf' && (
                <PdfPanel
                    total={images.length}
                    scope={pdfScope}
                    pageMode={pdfPageMode}
                    busy={busy}
                    status={status}
                    onScope={setPdfScope}
                    onPageMode={setPdfPageMode}
                    onExport={startPdfExport}
                    onClose={() => setPanel(null)}
                />
            )}

            {toast && <div className="image-toast">{toast}</div>}

            <ImageGallery ref={gallery} items={images} startIndex={info.current} lazyLoad={true}
                slideDuration={0} showIndex={true} showFullscreenButton={false} showPlayButton={false}
                onSlide={(nextIndex) => {
                    setZoom(1);
                    setIndex(nextIndex);
                    setTransform(IDENTITY_TRANSFORM);
                    clearCrop();
                    setPanel(null);
                    setCopyMenuOpen(false);
                    setStatus('');
                    const title = info.images[nextIndex]?.title;
                    if (title) handler.emit('slideTitle', title);
                }}
            />
        </div>
    );
};
