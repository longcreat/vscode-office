/** 图片处理管线：解码 → 变换/缩放 → 编码，供压缩与导出 PDF 共用 */

export interface Transform {
    /** 顺时针旋转角度，通常是 90 的倍数 */
    rotate: number;
    flipH: boolean;
    flipV: boolean;
}

export const IDENTITY_TRANSFORM: Transform = { rotate: 0, flipH: false, flipV: false };

export type OutputFormat = 'jpeg' | 'png' | 'webp';

/** 单张图处理的像素上限，超过按比例缩下来，避免 canvas 撑爆内存 */
const MAX_PIXELS = 40 * 1000 * 1000;

const MIME: Record<OutputFormat, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

export function mimeOf(format: OutputFormat): string {
    return MIME[format];
}

export function extOf(format: OutputFormat): string {
    return format === 'jpeg' ? 'jpg' : format;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    if (bytes < 1024) {
        return `${Math.round(bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function loadElement(url: string, revokeAfterLoad: boolean): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            if (revokeAfterLoad && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
            resolve(img);
        };
        img.onerror = () => {
            if (revokeAfterLoad && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
            reject(new Error('无法读取图片'));
        };
        img.src = url;
    });
}

/**
 * 优先 fetch 成 blob 再解码：resource 域和 webview 域可能不同源，
 * 直接用 <img> 会让 canvas 被污染、toBlob 抛 SecurityError。
 */
export async function loadImageElement(src: string): Promise<HTMLImageElement> {
    if (src.startsWith('blob:') || src.startsWith('data:')) {
        return loadElement(src, false);
    }
    try {
        const response = await fetch(src);
        if (response.ok) {
            const blob = await response.blob();
            return await loadElement(URL.createObjectURL(blob), true);
        }
    } catch {
        // 跨域或非 http 场景退回直连
    }
    return loadElement(src, false);
}

export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface RenderOptions {
    transform?: Transform;
    /** 按原图像素裁掉的区域，裁剪先于缩放 */
    crop?: CropRect | null;
    /** 目标宽高（缩放发生在旋转之前），缺省为裁剪尺寸或原图尺寸 */
    targetWidth?: number;
    targetHeight?: number;
    /** 需要不透明背景时传入颜色，PNG 输出传 null */
    background?: string | null;
}

/** 动图（GIF / APNG）经 canvas 重编码只剩首帧，需要明确提示 */
export function isAnimatedName(name: string): boolean {
    return /\.(gif|apng)$/i.test(name);
}

/** 按长边等比换算尺寸 */
export function fitLongSide(width: number, height: number, longSide: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!longest || longSide >= longest) {
        return { width, height };
    }
    const ratio = longSide / longest;
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
    };
}

/** 把图片画到离屏 canvas，返回的 canvas 由调用方负责释放 */
export function renderCanvas(img: HTMLImageElement, options: RenderOptions = {}): HTMLCanvasElement {
    const transform = options.transform ?? IDENTITY_TRANSFORM;
    const naturalWidth = img.naturalWidth || img.width || 1;
    const naturalHeight = img.naturalHeight || img.height || 1;
    const crop = options.crop && options.crop.width > 0 && options.crop.height > 0
        ? options.crop
        : { x: 0, y: 0, width: naturalWidth, height: naturalHeight };

    let width = Math.max(1, Math.round(options.targetWidth || crop.width));
    let height = Math.max(1, Math.round(options.targetHeight || crop.height));
    if (width * height > MAX_PIXELS) {
        const ratio = Math.sqrt(MAX_PIXELS / (width * height));
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
    }

    const swapped = Math.abs(transform.rotate % 180) === 90;
    const canvas = document.createElement('canvas');
    canvas.width = swapped ? height : width;
    canvas.height = swapped ? width : height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法创建画布');
    }
    ctx.imageSmoothingQuality = 'high';
    if (options.background) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (transform.rotate) {
        ctx.rotate((transform.rotate * Math.PI) / 180);
    }
    if (transform.flipH || transform.flipV) {
        ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
    }
    ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, -width / 2, -height / 2, width, height);
    return canvas;
}

export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
    if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
    }
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: OutputFormat, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('浏览器无法编码此格式'))),
            MIME[format],
            quality,
        );
    });
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error('编码图片失败'));
        reader.readAsDataURL(blob);
    });
}

export async function canvasToBase64(canvas: HTMLCanvasElement, format: OutputFormat, quality?: number): Promise<string> {
    return blobToBase64(await canvasToBlob(canvas, format, quality));
}

/**
 * 体积估算：先按小图编码，再按像素数放大推算。
 * 不同格式的压缩曲线不一样，所以界面要标注是估算值。
 */
export async function estimateSize(img: HTMLImageElement, options: {
    transform?: Transform;
    crop?: CropRect | null;
    targetWidth?: number;
    targetHeight?: number;
    format: OutputFormat;
    quality: number;
}): Promise<number> {
    const crop = options.crop && options.crop.width > 0
        ? options.crop
        : { width: img.naturalWidth, height: img.naturalHeight };
    const targetWidth = options.targetWidth || crop.width;
    const targetHeight = options.targetHeight || crop.height;
    const longSide = Math.max(targetWidth, targetHeight);
    const probeScale = longSide > 480 ? 480 / longSide : 1;
    const probe = renderCanvas(img, {
        transform: options.transform,
        crop: options.crop,
        targetWidth: Math.max(1, Math.round(targetWidth * probeScale)),
        targetHeight: Math.max(1, Math.round(targetHeight * probeScale)),
        background: options.format === 'png' ? null : '#ffffff',
    });
    try {
        const base64 = await canvasToBase64(
            probe,
            options.format,
            options.format === 'png' ? undefined : options.quality / 100,
        );
        const probeBytes = Math.floor((base64.length * 3) / 4);
        const probePixels = Math.max(1, probe.width * probe.height);
        const fullPixels = Math.max(1, targetWidth * targetHeight);
        return Math.round(probeBytes * (fullPixels / probePixels));
    } finally {
        releaseCanvas(probe);
    }
}

export function guessFormatFromName(name: string): OutputFormat {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    if (ext === 'png' || ext === 'apng') {
        return 'png';
    }
    if (ext === 'webp') {
        return 'webp';
    }
    return 'jpeg';
}

/** PDF 里能直接嵌入的只有 JPEG 和 PNG，其余格式先转 PNG 保真 */
export function pdfEmbedMime(name: string): 'image/png' | 'image/jpeg' {
    return /\.(png|apng|gif|bmp|ico|cur)$/i.test(name) ? 'image/png' : 'image/jpeg';
}
