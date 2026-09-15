# Office Viewer

[English](README.md) | [简体中文](README-CN.md) | 繁體中文

## 介紹

本擴充功能支援在 VS Code 中預覽以下常見的辦公檔案格式：

- Excel: `.xls`、`.xlsx`、`.xlsm`、`.csv`、`.ods`
- Word: `.docx`、`.dotx`
- PowerPoint: `.pptx`、`.pptm`
- PDF 與電子書: `.pdf`、`.epub`
- HEIC/TIFF: `.heic`、`.heif`、`.tiff`
- 設計檔案: `.psd`、`.xmind`、`.icns`、`.svg`
- 字型: `.ttf`、`.otf`、`.woff`、`.woff2`
- Markdown: `.md`、`.markdown`
- HTML: `.html`、`.htm`
- HTTP 請求: `.http`、`.rest`
- Java: `.class`（反編譯）
- 壓縮檔案: `.zip`、`.jar`、`.vsix`、`.rar`、`.7z`、`.tar`、`.tar.gz`、`.tgz`、`.apk`

## Git 歷史

Office Viewer 內建完整的 Git 歷史工作區，讓你無需離開 VS Code 即可瀏覽儲存庫。可從原始碼控制檢視、編輯器標題列、編輯器右鍵選單或檔案總管右鍵選單開啟。

![1783342874748](image/README/1783342874748.png)

## Markdown

整合 Markdown 所見即所得編輯器。

如需使用 VS Code 原生 Markdown 編輯器，請在 `settings.json` 中新增以下設定：

```json
{
    "workbench.editorAssociations": {
        "*.md": "default",
        "*.markdown": "default"
    }
}
```

在編輯器中按右鍵，可將 Markdown 匯出為 PDF、DOCX 或 HTML。PDF 匯出依賴 Chromium，可透過 `vscode-office.chromiumPath` 設定瀏覽器路徑。

![匯出 Markdown](image/README-CN/1685418034035.png)

快捷鍵：基於 [shortcut.md](shortcut.md)，以及：

- 新行: `Ctrl+Enter` / `⌘ Enter`
- 硬換行: `Shift+Enter` / `⇧ Enter`
- 編輯超連結: `Alt+Enter` / `^ Enter`
- 設定 CodeMirror 語言: `Alt+Enter` / `^ Enter`
- 在 VS Code 中編輯: `Ctrl Alt E` / `⌘ ^ E`
- 貼上為純文字: `Ctrl+Shift+V` / `⌘ ⇧ V`

## 其他功能

- HTML: 編輯時按下 `Ctrl+Shift+V` 可即時預覽
- YAML: 支援文件大綱與錨點導覽（別名引用可跳轉到定義）
- 圖示主題: 內建 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 部分圖示，並提供 **Office Material Icon Theme** 與 **One Dark Modern** 配色主題
- Excel: 支援預覽與儲存 `.xlsx`、`.xls`、`.xlsm`、`.csv`、`.ods` 等檔案
- HTTP: 在 `.http`、`.rest` 檔案中傳送請求（整合自 [REST Client](https://github.com/Huachao/vscode-restclient)，並修正了本地請求的已知問題）；按 `Ctrl+Enter` / `⌘ Enter` 傳送
- Java: 開啟 `.class` 檔案可反編譯並查看原始碼

## 開發指南

### 環境要求

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) 1.64+

### 快速開始

```bash
git clone https://github.com/cweijan/vscode-office.git
cd vscode-office
npm install
```

### 開發除錯

**桌面端擴充功能**（完整功能）：

```bash
npm run dev
```

在 VS Code 中按 `F5`，或在「執行和偵錯」中選擇 **Extension**。

**Web 端擴充功能**（瀏覽器中的 Markdown、HTML、YAML）：

```bash
npm run dev:web
```

在「執行和偵錯」中選擇 **Extension (Web)**。

### 建置與打包

```bash
npm run build    # 生產建置
npm run package  # 產生 .vsix
```

## Credits

- PDF rendering: [mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX rendering: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX rendering: [pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX rendering:
  - [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs): XLSX parsing
  - [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet): XLSX rendering
- EPUB: [futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD: [ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind: [mind-elixir](https://github.com/ssshooter/mind-elixir-core), [@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC conversion: [heic2any](https://github.com/alexcorvi/heic2any)
- Java decompiler: [JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP: [REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
- Material Icon theme: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
