import * as vscode from 'vscode';
import { basename, join, parse } from 'path';
import JSZip from 'jszip';
import { Handler } from '@/common/handler';
import { isWebExtensionHost } from '@/common/extensionHost';

/**
 * PDF 导出图片 / 文本。
 *
 * 渲染与文本抽取都在 webview 内完成（pdf.js 离屏 canvas / getTextContent），
 * 扩展侧只负责选路径、收内容、落盘。
 * 图像数据以 base64 字符串传输：整页 PNG 动辄数 MB，走 number[] 会在消息通道上
 * 逐元素序列化，既慢又占内存。
 */

export type PdfExportMode = 'current' | 'all';
export type PdfExportFormat = 'png' | 'jpeg';

interface StartRequest {
    mode: PdfExportMode;
    format: PdfExportFormat;
    scale: number;
    pageNumber: number;
    totalPages: number;
}

interface PagePayload {
    index: number;
    content: string;
}

interface ExportSession {
    mode: PdfExportMode;
    format: PdfExportFormat;
    target: vscode.Uri;
    stem: string;
    totalPages: number;
    pages: { name: string; data: Uint8Array }[];
}

const IMAGE_EXT: Record<PdfExportFormat, string> = { png: 'png', jpeg: 'jpg' };

function decodeBase64(value: string): Uint8Array {
    if (typeof value !== 'string' || !value) {
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

/** 默认落到源文件同目录；虚拟 scheme 下 fsPath 未必可写，交给保存对话框决定 */
function resolveDefaultTarget(uri: vscode.Uri, fileName: string): vscode.Uri | undefined {
    const { dir } = parse(uri.fsPath);
    // 同一文件系统命名空间内直接拼路径，语义最稳（含 vscode.dev 的工作区）
    if (uri.scheme === 'file' || uri.scheme === 'vscode-remote' || uri.scheme === 'vscode-vfs') {
        return vscode.Uri.joinPath(uri, '..', fileName);
    }
    // git 等只读 scheme：写到对应的本地目录
    if (dir && (dir.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(dir))) {
        return vscode.Uri.file(join(dir, fileName));
    }
    return undefined;
}

function ensureExtension(uri: vscode.Uri, ext: string): vscode.Uri {
    return /\.[a-zA-Z0-9]{1,5}$/.test(basename(uri.fsPath)) ? uri : uri.with({ path: `${uri.path}.${ext}` });
}

function buildFilters(request: StartRequest): Record<string, string[]> {
    if (request.mode === 'all') {
        return { 'ZIP 压缩包': ['zip'] };
    }
    return request.format === 'jpeg' ? { 'JPG 图片': ['jpg', 'jpeg'] } : { 'PNG 图片': ['png'] };
}

async function pickTarget(uri: vscode.Uri, request: StartRequest): Promise<vscode.Uri | undefined> {
    const { name } = parse(uri.fsPath);
    const isZip = request.mode === 'all';
    const ext = IMAGE_EXT[request.format] ?? 'png';
    const fileName = isZip ? `${name}-images.zip` : `${name}-p${request.pageNumber}.${ext}`;
    const defaultUri = resolveDefaultTarget(uri, fileName);

    if (isWebExtensionHost()) {
        // web 扩展宿主没有原生保存对话框，只能按默认路径写入；写不进去再报错给用户
        return defaultUri;
    }
    const picked = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: '导出',
        filters: buildFilters(request),
    });
    return picked ? ensureExtension(picked, isZip ? 'zip' : ext) : undefined;
}

/** 纯文本导出：webview 只负责抽文本，落盘仍走和图片一样的选择器/写入路径 */
async function pickTextTarget(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const defaultUri = resolveDefaultTarget(uri, `${parse(uri.fsPath).name}.txt`);
    if (isWebExtensionHost()) {
        return defaultUri;
    }
    const picked = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: '导出',
        filters: { '文本文件': ['txt'], 'Markdown': ['md'] },
    });
    return picked ? ensureExtension(picked, 'txt') : undefined;
}

async function writeOutput(session: ExportSession): Promise<number> {
    if (session.pages.length === 0) {
        throw new Error('没有生成任何页面图像');
    }
    if (session.mode === 'current') {
        await vscode.workspace.fs.writeFile(session.target, session.pages[0].data);
        return 1;
    }
    const zip = new JSZip();
    for (const page of session.pages) {
        zip.file(page.name, page.data);
    }
    // PNG/JPEG 已压缩，再 deflate 收益极低，STORE 更快
    const data = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    await vscode.workspace.fs.writeFile(session.target, data);
    return session.pages.length;
}

async function revealResult(target: vscode.Uri): Promise<void> {
    if (isWebExtensionHost()) {
        return;
    }
    try {
        await vscode.commands.executeCommand('revealFileInOS', target);
    } catch {
        // 容器/远程环境可能没有 reveal 能力，忽略
    }
}

export function handlePdfExport(handler: Handler, uri: vscode.Uri): void {
    let session: ExportSession | undefined;
    const reset = (): void => {
        session = undefined;
    };

    handler
        .on('pdfExportStart', async (request: StartRequest) => {
            reset();
            if (!request || (request.mode !== 'current' && request.mode !== 'all')) {
                handler.emit('pdfExportError', { message: '导出参数无效' });
                return;
            }
            const target = await pickTarget(uri, request);
            if (!target) {
                handler.emit('pdfExportCancel');
                return;
            }
            session = {
                mode: request.mode,
                format: request.format,
                target,
                stem: parse(uri.fsPath).name,
                totalPages: Math.max(1, request.totalPages || 1),
                pages: [],
            };
            handler.emit('pdfExportAccept');
        })
        .on('pdfExportPage', (payload: PagePayload) => {
            if (!session || !payload) {
                return;
            }
            const index = Number(payload.index) || session.pages.length + 1;
            const pad = String(session.totalPages).length;
            const ext = IMAGE_EXT[session.format] ?? 'png';
            session.pages.push({
                name: `${session.stem}-p${String(index).padStart(pad, '0')}.${ext}`,
                data: decodeBase64(payload.content),
            });
        })
        .on('pdfExportDone', async () => {
            const current = session;
            if (!current) {
                handler.emit('pdfExportError', { message: '导出会话已失效' });
                return;
            }
            try {
                const count = await writeOutput(current);
                reset();
                handler.emit('pdfExportFinished', { count });
                void revealResult(current.target);
                const action = await vscode.window.showInformationMessage(
                    `已导出 ${count} 页图片：${basename(current.target.fsPath)}`,
                    '打开',
                );
                if (action === '打开') {
                    void vscode.commands.executeCommand('vscode.open', current.target);
                }
            } catch (error) {
                reset();
                const message = error instanceof Error ? error.message : '导出失败';
                handler.emit('pdfExportError', { message });
                void vscode.window.showErrorMessage(`导出图片失败：${message}`);
            }
        })
        .on('pdfExportAbort', () => reset())
        // webview 启动动作前的存活探测：扩展版本过旧（窗口没重载）时不会有回应，
        // 前端据此给出明确提示，而不是永远卡在「正在写入文件…」
        .on('pdfExportPing', () => {
            handler.emit('pdfExportPong', {});
        })
        .on('pdfExportText', async (payload: { content?: string }) => {
            const content = payload && typeof payload.content === 'string' ? payload.content : '';
            if (!content.trim()) {
                handler.emit('pdfExportTextError', { message: '没有提取到文本' });
                return;
            }
            try {
                const target = await pickTextTarget(uri);
                if (!target) {
                    handler.emit('pdfExportTextCancel');
                    return;
                }
                await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
                const fileName = basename(target.fsPath);
                handler.emit('pdfExportTextDone', { fileName });
                void revealResult(target);
                const action = await vscode.window.showInformationMessage(`已导出文本：${fileName}`, '打开');
                if (action === '打开') {
                    void vscode.commands.executeCommand('vscode.open', target);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : '导出失败';
                handler.emit('pdfExportTextError', { message });
                void vscode.window.showErrorMessage(`导出文本失败：${message}`);
            }
        });
}
