import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 依序探测可用的 IDE CLI：环境变量 > 本机常见 Antigravity 安装位置 > PATH 上的 antigravity-ide/code
function resolveCli() {
    const fileCandidates = [
        process.env.OFFICE_IDE_CLI,
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
        'G:\\Antigravity IDE\\bin\\antigravity-ide.cmd',
    ].filter(Boolean);
    for (const cli of fileCandidates) {
        if (existsSync(cli)) return cli;
    }
    for (const cmd of ['antigravity-ide', 'code']) {
        try {
            execSync(`"${cmd}" --version`, { stdio: 'ignore' });
            return cmd;
        } catch { /* try next */ }
    }
    return null;
}

const cli = resolveCli();
if (!cli) {
    console.error('未找到 IDE CLI（antigravity-ide / code）。可设置 OFFICE_IDE_CLI 环境变量指向 CLI 路径。');
    process.exit(1);
}

const version = process.env.npm_package_version;
if (!version) {
    console.error('请在项目目录下通过 npm run 执行本脚本（需要 npm_package_version 环境变量）。');
    process.exit(1);
}
const vsix = `vscode-office-${version}.vsix`;
if (!existsSync(vsix)) {
    console.error(`未找到 ${vsix}，请先执行 npm run package。`);
    process.exit(1);
}

console.log(`使用 ${cli} 安装 ${vsix} ...`);
try {
    execSync(`"${cli}" --install-extension "${vsix}" --force`, { stdio: 'inherit' });
} catch {
    console.error('\n❌ 安装命令失败：如果 IDE 正在运行，可能是扩展服务被占用，关闭 IDE 或重载窗口后重试。');
    process.exit(1);
}
console.log(`\n✅ vscode-office ${version} 已安装到 ${cli}，重载窗口后生效（Ctrl+Shift+P → Reload Window）`);
