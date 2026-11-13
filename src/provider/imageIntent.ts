import * as vscode from 'vscode';

export type ImageIntent = 'compress' | 'pdf';

const pending = new Map<string, ImageIntent>();

/** 右键菜单用：先记下意图，等 webview 就绪后再下发 */
export function setImageIntent(uri: vscode.Uri, intent: ImageIntent): void {
    const key = uri.toString();
    pending.set(key, intent);
    // 用户可能只是点了菜单又没打开，过期自动清掉，避免下次误触发
    setTimeout(() => pending.delete(key), 20_000);
}

export function takeImageIntent(uri: vscode.Uri): ImageIntent | undefined {
    const key = uri.toString();
    const intent = pending.get(key);
    if (intent) {
        pending.delete(key);
    }
    return intent;
}
