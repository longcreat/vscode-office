import { Handler } from '@/common/handler';
import { basename, extname, join, parse } from 'path';
import * as vscode from 'vscode';
import { isWebExtensionHost } from '@/common/extensionHost';
import { takeImageIntent } from '@/provider/imageIntent';
import { buildImagePdf, type PdfImagePage, type PdfPageMode } from '@/provider/imagePdf';
import { bytesToPayloadBuffer, isVirtualUri, readUriBytes } from '@/provider/handlers/officeContent';

const IMAGE_MIME: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.pjpeg': 'image/jpeg',
    '.pjp': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.apng': 'image/apng',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.cur': 'image/x-icon',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
};

function getImageMime(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return IMAGE_MIME[ext] ?? 'application/octet-stream';
}

async function loadVirtualImage(uri: vscode.Uri): Promise<{ images: { title: string; ext: string; mime: string; buffer: number[]; path: string; relPath: string }[]; current: number }> {
    const data = await readUriBytes(uri);
    const ext = extname(uri.fsPath).toLowerCase();
    const mime = getImageMime(uri.fsPath);
    return {
        images: [{
            title: basename(uri.fsPath),
            ext,
            mime,
            buffer: bytesToPayloadBuffer(data),
            path: uri.fsPath,
            relPath: vscode.workspace.asRelativePath(uri, false),
        }],
        current: 0,
    };
}

async function loadFolderImages(uri: vscode.Uri, webview: vscode.Webview) {
    const folderPath = vscode.Uri.joinPath(uri, '..');
    const entries = await vscode.workspace.fs.readDirectory(folderPath);
    let current = 0;
    const currentFile = basename(uri.fsPath);
    const images: { src: string; title: string; path: string; relPath: string }[] = [];
    let index = 0;
    for (const [name, fileType] of entries) {
        if (fileType !== vscode.FileType.File || !isImage(name)) {
            continue;
        }
        if (currentFile === name) {
            current = index;
        }
        const resUri = vscode.Uri.joinPath(folderPath, name);
        const resource = webview.asWebviewUri(resUri).with({ query: `nonce=${Date.now().toString()}` }).toString();
        images.push({
            src: resource,
            title: name,
            path: resUri.fsPath,
            relPath: vscode.workspace.asRelativePath(resUri, false),
        });
        index++;
    }
    return { images, current };
}

export function isImage(fileName: string) {
    return /\.(jpg|png|gif|apng|bmp|ico|cur|jpeg|pjpeg|pjp|tif|tiff|heic|heif|webp)$/i.test(fileName);
}

interface SaveBytesRequest {
    /** base64 编码的图像字节 */
    content?: string;
    /** 输出扩展名，jpg / png / webp */
    ext?: string;
    /** 默认文件名（不含目录） */
    name?: string;
    /** 覆盖当前打开的原文件 */
    overwrite?: boolean;
    /** 批量：直接写到源文件同目录，不弹对话框 */
    auto?: boolean;
    /** 批量：这张图对应的源文件路径 */
    sourcePath?: string;
}

interface PdfStartRequest {
    pageMode?: PdfPageMode;
    totalPages?: number;
}

interface PdfPagePayload {
    index?: number;
    content?: string;
    mime?: string;
}

interface PdfSession {
    pageMode: PdfPageMode;
    target: vscode.Uri;
    total: number;
    pages: PdfImagePage[];
}

function decodeBase64(value: string): Uint8Array {
    if (!value) {
        return new Uint8Array(0);
    }
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** 与源文件同目录的默认保存位置；虚拟 scheme 下交给保存对话框 */
function defaultSaveUri(uri: vscode.Uri, name: string): vscode.Uri | undefined {
    const dir = parse(uri.fsPath).dir;
    if (!dir) {
        return undefined;
    }
    if (uri.scheme === 'file' || uri.scheme === 'vscode-remote' || uri.scheme === 'vscode-vfs') {
        return vscode.Uri.joinPath(uri, '..', name);
    }
    if (dir.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(dir)) {
        return vscode.Uri.file(join(dir, name));
    }
    return undefined;
}

export function handleImage(handler: Handler, uri: vscode.Uri, webview: vscode.Webview) {
    const sendImageList = async () => {
        try {
            const images = isVirtualUri(uri)
                ? await loadVirtualImage(uri)
                : await loadFolderImages(uri, webview);
            handler.emit('images', images);
            // 右键菜单进来的动作，等首帧列表到位后再下发
            const intent = takeImageIntent(uri);
            if (intent) {
                handler.emit('imageIntent', { intent });
            }
        } catch (error) {
            handler.emit('images', {
                images: [],
                current: 0,
                error: error instanceof Error ? error.message : 'Failed to read image',
            });
        }
    };
    handler.on('images', () => { void sendImageList(); });
    handler.on('fileChange', () => { void sendImageList(); });
    handler.on('slideTitle', (title: string) => {
        handler.panel.title = title;
    });

    let pdfSession: PdfSession | undefined;

    /** 压缩 / 调整后的字节落盘：默认另存，覆盖原图需要二次确认 */
    const saveBytes = async (request: SaveBytesRequest) => {
        const content = request && typeof request.content === 'string' ? request.content : '';
        if (!content) {
            handler.emit('imageSaveError', { message: '没有可保存的图像数据' });
            return;
        }
        const ext = (request.ext || 'png').replace(/^\./, '').toLowerCase();
        const bytes = decodeBase64(content);
        try {
            if (request.auto && request.sourcePath && request.name) {
                // 批量模式：不打断用户，直接落到源文件同目录，重名自动加后缀
                const dir = parse(request.sourcePath).dir;
                if (!dir) {
                    handler.emit('imageSaveError', { message: '源文件没有可写目录', auto: true });
                    return;
                }
                let target = vscode.Uri.file(join(dir, request.name));
                let counter = 1;
                const stem = request.name.replace(/\.[^.]+$/, '');
                const suffix = request.name.slice(stem.length);
                while (true) {
                    try {
                        await vscode.workspace.fs.stat(target);
                        target = vscode.Uri.file(join(dir, `${stem}-${counter}${suffix}`));
                        counter++;
                    } catch {
                        break;
                    }
                }
                await vscode.workspace.fs.writeFile(target, bytes);
                handler.emit('imageSaveDone', { fileName: basename(target.fsPath), bytes: bytes.length, auto: true });
                return;
            }
            if (request.overwrite) {
                const originalExt = extname(uri.fsPath).replace('.', '').toLowerCase();
                const sameFormat = ext === originalExt
                    || (ext === 'jpg' && originalExt === 'jpeg')
                    || (ext === 'jpeg' && originalExt === 'jpg');
                if (!sameFormat) {
                    handler.emit('imageSaveError', { message: '改变格式时不能覆盖原图，请另存为' });
                    return;
                }
                const answer = await vscode.window.showWarningMessage(
                    `覆盖原文件？${basename(uri.fsPath)} 会被直接替换，且不可撤销。`,
                    { modal: true },
                    '覆盖',
                );
                if (answer !== '覆盖') {
                    handler.emit('imageSaveCancel');
                    return;
                }
                await vscode.workspace.fs.writeFile(uri, bytes);
                handler.emit('imageSaveDone', { fileName: basename(uri.fsPath), bytes: bytes.length, overwrite: true });
                return;
            }

            const defaultName = request.name || `${parse(uri.fsPath).name}-compressed.${ext}`;
            const defaultUri = defaultSaveUri(uri, defaultName);
            if (isWebExtensionHost() && !defaultUri) {
                handler.emit('imageSaveError', { message: '当前环境无法确定保存位置' });
                return;
            }
            const filters = ext === 'png'
                ? { 'PNG 图片': ['png'] }
                : ext === 'webp'
                    ? { 'WebP 图片': ['webp'] }
                    : { 'JPG 图片': ['jpg', 'jpeg'] };
            const target = isWebExtensionHost()
                ? defaultUri
                : await vscode.window.showSaveDialog({ defaultUri, saveLabel: '保存', filters });
            if (!target) {
                handler.emit('imageSaveCancel');
                return;
            }
            await vscode.workspace.fs.writeFile(target, bytes);
            handler.emit('imageSaveDone', { fileName: basename(target.fsPath), bytes: bytes.length });
        } catch (error) {
            const message = error instanceof Error ? error.message : '保存失败';
            handler.emit('imageSaveError', { message });
            void vscode.window.showErrorMessage(`保存图片失败：${message}`);
        }
    };

    const startPdf = async (request: PdfStartRequest) => {
        if (isWebExtensionHost()) {
            handler.emit('imagePdfError', { message: '网页版暂不支持导出 PDF' });
            return;
        }
        const defaultUri = defaultSaveUri(uri, `${parse(uri.fsPath).name}.pdf`);
        const picked = await vscode.window.showSaveDialog({
            defaultUri,
            saveLabel: '导出',
            filters: { 'PDF 文档': ['pdf'] },
        });
        if (!picked) {
            handler.emit('imagePdfCancel');
            return;
        }
        const target = /\.[a-zA-Z0-9]{1,5}$/.test(basename(picked.fsPath))
            ? picked
            : picked.with({ path: `${picked.path}.pdf` });
        pdfSession = {
            pageMode: request.pageMode === 'fit' ? 'fit' : 'a4',
            target,
            total: Math.max(1, request.totalPages || 1),
            pages: [],
        };
        handler.emit('imagePdfAccept');
    };

    const addPdfPage = (payload: PdfPagePayload) => {
        if (!pdfSession || !payload || typeof payload.content !== 'string' || !payload.content) {
            return;
        }
        pdfSession.pages.push({
            bytes: decodeBase64(payload.content),
            mime: payload.mime === 'image/png' ? 'image/png' : 'image/jpeg',
        });
    };

    const finishPdf = async () => {
        const session = pdfSession;
        if (!session) {
            handler.emit('imagePdfError', { message: '导出会话已失效' });
            return;
        }
        try {
            if (!session.pages.length) {
                throw new Error('没有可导出的图片');
            }
            const bytes = await buildImagePdf(session.pages, session.pageMode);
            await vscode.workspace.fs.writeFile(session.target, bytes);
            const count = session.pages.length;
            const fileName = basename(session.target.fsPath);
            pdfSession = undefined;
            handler.emit('imagePdfFinished', { count, fileName });
            const action = await vscode.window.showInformationMessage(`已导出 PDF：${fileName}`, '打开');
            if (action === '打开') {
                void vscode.commands.executeCommand('vscode.open', session.target);
            }
        } catch (error) {
            pdfSession = undefined;
            const message = error instanceof Error ? error.message : '导出失败';
            handler.emit('imagePdfError', { message });
            void vscode.window.showErrorMessage(`导出 PDF 失败：${message}`);
        }
    };

    handler.on('imageSaveBytes', (request: SaveBytesRequest) => void saveBytes(request));
    handler.on('imagePdfStart', (request: PdfStartRequest) => void startPdf(request));
    handler.on('imagePdfPage', (payload: PdfPagePayload) => addPdfPage(payload));
    handler.on('imagePdfDone', () => void finishPdf());
    handler.on('imagePdfAbort', () => { pdfSession = undefined; });
}
