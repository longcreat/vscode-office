import * as vscode from 'vscode';
import { basename, dirname, join, parse } from 'path';

export type PdfPageMode = 'a4' | 'fit';

export interface PdfImagePage {
    bytes: Uint8Array;
    mime: 'image/png' | 'image/jpeg';
}

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
const A4_MARGIN = 24;

/**
 * pdf-lib 体积较大且在 web 宿主不可用，按需加载。
 * 打包后依赖落在 out/node_modules/pdf-lib.js，只有 CJS 的 require 能解析到这个文件，
 * 动态 import 会按 ESM 规则找目录，装到用户机器上就找不到了。
 */
async function loadPdfLib(): Promise<typeof import('pdf-lib')> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('pdf-lib');
    return (mod.PDFDocument ? mod : mod.default) as typeof import('pdf-lib');
}

/** 把一组图片按顺序拼成一份 PDF：A4 居中留白，或页面贴合图片比例 */
export async function buildImagePdf(pages: PdfImagePage[], mode: PdfPageMode): Promise<Uint8Array> {
    if (!pages.length) {
        throw new Error('没有可导出的图片');
    }
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.create();
    for (const page of pages) {
        const image = page.mime === 'image/png'
            ? await doc.embedPng(page.bytes)
            : await doc.embedJpg(page.bytes);
        if (mode === 'a4') {
            const pdfPage = doc.addPage([A4_WIDTH, A4_HEIGHT]);
            const scale = Math.min(
                (A4_WIDTH - A4_MARGIN * 2) / image.width,
                (A4_HEIGHT - A4_MARGIN * 2) / image.height,
            );
            const width = image.width * scale;
            const height = image.height * scale;
            pdfPage.drawImage(image, {
                x: (A4_WIDTH - width) / 2,
                y: (A4_HEIGHT - height) / 2,
                width,
                height,
            });
        } else {
            // 贴合图片：长边对齐 A4 长边，页面比例与图片一致
            const ratio = A4_HEIGHT / Math.max(image.width, image.height);
            const width = image.width * ratio;
            const height = image.height * ratio;
            const pdfPage = doc.addPage([width, height]);
            pdfPage.drawImage(image, { x: 0, y: 0, width, height });
        }
    }
    return doc.save();
}

/** 多选文件 → 一份 PDF，默认落在第一个文件的目录 */
export async function exportImagesToPdf(uris: vscode.Uri[], mode: PdfPageMode = 'a4'): Promise<void> {
    const images = uris.filter((uri) => uri.scheme === 'file' && /\.(png|jpe?g)$/i.test(uri.fsPath));
    const skipped = uris.length - images.length;
    if (!images.length) {
        void vscode.window.showWarningMessage('请选择 PNG 或 JPG 图片（其他格式需要先在查看器里转换）。');
        return;
    }
    const pages: PdfImagePage[] = [];
    for (const uri of images) {
        const bytes = await vscode.workspace.fs.readFile(uri);
        pages.push({
            bytes,
            mime: /\.png$/i.test(uri.fsPath) ? 'image/png' : 'image/jpeg',
        });
    }
    const first = images[0].fsPath;
    const defaultUri = vscode.Uri.file(join(dirname(first), `${parse(first).name}.pdf`));
    const target = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: '导出',
        filters: { 'PDF 文档': ['pdf'] },
    });
    if (!target) {
        return;
    }
    const pdf = await buildImagePdf(pages, mode);
    await vscode.workspace.fs.writeFile(target, pdf);
    const message = skipped > 0
        ? `已导出 ${pages.length} 页 PDF「${basename(target.fsPath)}」，跳过 ${skipped} 个不支持的格式`
        : `已导出 ${pages.length} 页 PDF「${basename(target.fsPath)}」`;
    const action = await vscode.window.showInformationMessage(message, '打开');
    if (action === '打开') {
        void vscode.commands.executeCommand('vscode.open', target);
    }
}
