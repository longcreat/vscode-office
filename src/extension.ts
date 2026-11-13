import * as vscode from 'vscode';
import { Global } from './common/global';
import { JavaDecompilerProvider } from './provider/javaDecompilerProvider';
import { MarkdownEditorProvider } from './provider/markdownEditorProvider';
import { OfficeViewerProvider } from './provider/officeViewerProvider';
import { ArchiveViewerProvider } from './provider/archiveViewerProvider';
import { ClassViewerProvider } from './provider/classViewerProvider';
import { HtmlService } from './service/htmlService';
import { MarkdownService } from './service/markdownService';
import { switchCsvEditor } from './service/csvService';
import { FileUtil } from './common/fileUtil';
import { ReactApp } from './common/reactApp';
import { activateHttp } from './provider/http';
import { activateYaml } from './provider/yaml';
import { activateXml } from './provider/xml';
import { activateGitHistory } from './gitHistory/provider';
import { IconService } from './service/icon/iconService';
import { autoClearCacheStorage } from './service/autoClearCacheStorage';
import { setImageIntent } from './provider/imageIntent';
import { exportImagesToPdf } from './provider/imagePdf';

export async function activate(context: vscode.ExtensionContext) {
	await Global.init(context);
	autoClearCacheStorage(context);
	await IconService.getInstance().init(context);
	activateHttp(context);
	activateYaml(context);
	activateXml(context);
	activateGitHistory(context);
	const viewOption = { webviewOptions: { retainContextWhenHidden: true } };
	FileUtil.init(context)
	ReactApp.init(context)
	const markdownService = new MarkdownService(context);
	const viewerInstance = new OfficeViewerProvider(context);
	const archiveViewerInstance = new ArchiveViewerProvider(context);
	const classViewerInstance = new ClassViewerProvider(context);
	const markdownEditorProvider = new MarkdownEditorProvider(context)
	context.subscriptions.push(
		vscode.commands.registerCommand('office.markdown.switch', (uri) => { markdownService.switchEditor(uri) }),
		vscode.commands.registerCommand('office.csv.switch', (uri) => { switchCsvEditor(uri) }),
		vscode.commands.registerCommand('office.markdown.paste', () => { markdownService.loadClipboardImage() }),
		vscode.commands.registerCommand('office.html.preview', uri => HtmlService.previewHtml(uri, context)),
		vscode.commands.registerCommand('office.image.compress', async (uri?: vscode.Uri) => {
			if (!uri) {
				void vscode.window.showInformationMessage('请在资源管理器中右键图片，选择「压缩图片…」');
				return;
			}
			setImageIntent(uri, 'compress');
			await vscode.commands.executeCommand('vscode.openWith', uri, 'cweijan.imageViewer');
		}),
		vscode.commands.registerCommand('office.image.exportPdf', async (clicked?: vscode.Uri, selected?: vscode.Uri[]) => {
			const uris = Array.isArray(selected) && selected.length ? selected : clicked ? [clicked] : [];
			if (!uris.length) {
				void vscode.window.showInformationMessage('请在资源管理器中选中图片后再导出');
				return;
			}
			try {
				await exportImagesToPdf(uris);
			} catch (error) {
				const message = error instanceof Error ? error.message : '导出失败';
				void vscode.window.showErrorMessage(`导出 PDF 失败：${message}`);
			}
		}),
		vscode.workspace.registerTextDocumentContentProvider('decompile_java', new JavaDecompilerProvider(context)),
		vscode.window.registerCustomEditorProvider("cweijan.markdownViewer", markdownEditorProvider, viewOption),
		vscode.window.registerCustomEditorProvider("cweijan.markdownPreview", markdownEditorProvider, viewOption),
		archiveViewerInstance.bindCustomEditor(viewOption),
		classViewerInstance.bindCustomEditor(viewOption),
		...viewerInstance.bindCustomEditors(viewOption)
	);
}

export function deactivate() { }