"use strict";

/**
 * PDF 导出图片。
 *
 * 用 pdf.js 把页面按指定倍率渲染到离屏 canvas，再转成 PNG/JPEG 交给扩展落盘。
 * 页面渲染在 webview 内完成，扩展侧只负责选路径与写文件，因此不依赖任何原生模块。
 */
(function () {
  const QUALITY_KEY = 'vscode-office.pdf.exportQuality';
  const FORMAT_KEY = 'vscode-office.pdf.exportFormat';
  const PANEL_WIDTH = 244;
  // 普通 = 144 DPI（屏幕查看足够清晰），高清 = 288 DPI（接近打印品质）
  const QUALITY_SCALE = { normal: 2, high: 4 };
  // 单页像素上限：A0 级别的大页在高清下会把 canvas 撑到浏览器上限，超了自动降倍率
  const MAX_PIXELS = 24 * 1000 * 1000;

  const EXPORT_ICON =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.1" y="2.9" width="11.8" height="10.2" rx="1.4"/>' +
    '<circle cx="5.6" cy="6.1" r=".85"/>' +
    '<path d="M2.5 11.2l3.4-3 2.5 2.2 2-1.8 3.1 2.9"/>' +
    '</svg>';

  /** 进行中的导出；为 null 表示空闲，渲染循环靠它判断是否被取消 */
  let pending = null;

  /** 界面是否处于忙态（按钮禁用） */
  let busyState = false;
  /** 兜底看门狗：长时间没有任何进展就把界面放回来，避免永久卡死 */
  let watchdogTimer = null;
  const WATCHDOG_MS = 3 * 60 * 1000;

  const $ = (id) => document.getElementById(id);

  function getApp() {
    return window.PDFViewerApplication;
  }

  function getDocument() {
    const app = getApp();
    return app?.pdfDocument ?? null;
  }

  function readSetting(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value || fallback;
    } catch {
      return fallback;
    }
  }

  function saveSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 忽略存储异常
    }
  }

  function setStatus(text, tone) {
    const el = $('officeExportStatus');
    if (!el) {
      return;
    }
    el.textContent = text || '';
    if (tone) {
      el.dataset.tone = tone;
    } else {
      delete el.dataset.tone;
    }
    watchdogKick();
  }

  function watchdogKick() {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    if (!busyState) {
      return;
    }
    watchdogTimer = setTimeout(recoverFromStall, WATCHDOG_MS);
  }

  /** 卡住时自愈：清掉会话、放回按钮，并告诉扩展侧中止 */
  function recoverFromStall() {
    watchdogTimer = null;
    if (!busyState) {
      return;
    }
    pending = null;
    setBusy(false);
    setStatus('操作超时，已恢复；若反复出现请重载窗口', 'error');
    toast('操作超时', 'error');
    vscodeEvent.emit('pdfExportAbort');
  }

  function setBusy(busy) {
    busyState = busy;
    for (const id of [
      'officeExportCurrent',
      'officeExportAll',
      'officeExportCopyImage',
      'officeExportSnip',
      'officeExportCopyText',
      'officeExportSaveText',
    ]) {
      const el = $(id);
      if (el) {
        el.disabled = busy;
      }
    }
    const toggle = $('exportImageToggle');
    const panel = $('officeExportPanel');
    if (toggle && panel) {
      toggle.classList.toggle('toggled', busy || !panel.classList.contains('hidden'));
    }
    const cancel = $('officeExportCancel');
    if (cancel) {
      // 只有「导出」流程才有可取消的会话，复制/截图时不该出现取消按钮
      cancel.classList.toggle('hidden', !(busy && pending));
    }
    watchdogKick();
  }

  function syncAvailability() {
    const doc = getDocument();
    const total = doc?.numPages || 0;
    const toggle = $('exportImageToggle');
    if (toggle) {
      toggle.disabled = !total;
      toggle.title = total ? '导出 / 复制' : '文档尚未加载';
    }
    const info = $('officeExportInfo');
    if (info) {
      const app = getApp();
      const current = app?.pdfViewer?.currentPageNumber || 1;
      info.textContent = total ? `当前第 ${current} 页 · 共 ${total} 页` : '文档尚未加载';
    }
    const all = $('officeExportAll');
    if (all) {
      all.textContent = total > 1 ? `导出全部页（ZIP，${total} 页）` : '导出全部页（ZIP）';
    }
  }

  function readQuality() {
    return readSetting(QUALITY_KEY, 'normal') === 'high' ? 'high' : 'normal';
  }

  function readScale() {
    return QUALITY_SCALE[readQuality()];
  }

  function readFormat() {
    return readSetting(FORMAT_KEY, 'png') === 'jpeg' ? 'jpeg' : 'png';
  }

  function paintSegments() {
    const quality = readQuality();
    const format = readFormat();
    for (const btn of document.querySelectorAll('#officeExportQualitySeg > button')) {
      btn.classList.toggle('selected', btn.dataset.quality === quality);
    }
    for (const btn of document.querySelectorAll('#officeExportFormatSeg > button')) {
      btn.classList.toggle('selected', btn.dataset.format === format);
    }
  }

  function openPanel() {
    const panel = $('officeExportPanel');
    const toggle = $('exportImageToggle');
    if (!panel || !toggle) {
      return;
    }
    syncAvailability();
    paintSegments();
    panel.classList.remove('hidden');
    toggle.classList.add('toggled');
    const rect = toggle.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8);
    panel.style.top = `${Math.round(rect.bottom + 6)}px`;
    panel.style.left = `${Math.round(left)}px`;
    // 面板变高了，窗口不够高时向上收，避免底部被裁掉
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.bottom > window.innerHeight - 8) {
      panel.style.top = `${Math.max(8, window.innerHeight - panelRect.height - 8)}px`;
    }
  }

  function closePanel() {
    const panel = $('officeExportPanel');
    const toggle = $('exportImageToggle');
    if (!panel) {
      return;
    }
    panel.classList.add('hidden');
    if (toggle && !pending) {
      toggle.classList.remove('toggled');
    }
    if (!pending) {
      setStatus('');
    }
  }

  function togglePanel() {
    const panel = $('officeExportPanel');
    if (!panel || pending) {
      return;
    }
    if (panel.classList.contains('hidden')) {
      openPanel();
    } else {
      closePanel();
    }
  }

  function toBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function releaseCanvas(canvas) {
    // 主动释放画布占用的显存，多页导出/连续复制时很关键
    canvas.width = 0;
    canvas.height = 0;
  }

  function canvasToBlob(canvas, format) {
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('浏览器无法生成图片'))),
        mime,
        0.92,
      );
    });
  }

  /**
   * 把页面渲染到离屏 canvas。
   * rotation 需要和屏幕上一致，否则框选坐标无法对应；返回实际生效的倍率，
   * 超大页面被 MAX_PIXELS 降倍率时，调用方要用它换算坐标。
   */
  async function renderPageCanvas(pageNumber, scale, rotation) {
    const app = getApp();
    const page = await app.pdfDocument.getPage(pageNumber);
    const options = rotation === undefined || rotation === null ? { scale } : { scale, rotation };
    let viewport = page.getViewport(options);
    let applied = scale;
    const pixels = viewport.width * viewport.height;
    if (pixels > MAX_PIXELS) {
      applied = scale * Math.sqrt(MAX_PIXELS / pixels);
      viewport = page.getViewport(
        rotation === undefined || rotation === null ? { scale: applied } : { scale: applied, rotation },
      );
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    // PDF 页面本身是透明的，先铺白底，避免导出成"透明背景 + 白字看不见"
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
    return { canvas, scale: applied };
  }

  async function renderPageBytes(pageNumber, scale, format) {
    const { canvas } = await renderPageCanvas(pageNumber, scale);
    try {
      const blob = await canvasToBlob(canvas, format);
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      releaseCanvas(canvas);
    }
  }

  function currentPageNumber() {
    return getApp()?.pdfViewer?.currentPageNumber || 1;
  }

  async function writeImageToClipboard(canvas) {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      throw new Error('当前环境不支持写入图片剪贴板');
    }
    const blob = await canvasToBlob(canvas, 'png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  let toastTimer = null;
  function toast(text, tone) {
    let el = $('officeToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'officeToast';
      el.className = 'office-toast';
      document.body.appendChild(el);
    }
    el.textContent = text || '';
    if (tone) {
      el.dataset.tone = tone;
    } else {
      delete el.dataset.tone;
    }
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2200);
  }

  async function copyCurrentPageImage() {
    const doc = getDocument();
    if (!doc || pending) {
      return;
    }
    const pageNumber = currentPageNumber();
    setBusy(true);
    setStatus('正在渲染当前页…');
    try {
      const { canvas } = await renderPageCanvas(pageNumber, readScale());
      try {
        await writeImageToClipboard(canvas);
        const size = `${canvas.width}×${canvas.height}`;
        setStatus(`已复制当前页图片（${size}）`);
        toast(`已复制当前页图片（${size}）`);
      } finally {
        releaseCanvas(canvas);
      }
    } catch (error) {
      const message = error && error.message ? error.message : '复制失败';
      setStatus(`复制失败：${message}`, 'error');
      toast(`复制失败：${message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  /** 框选状态：为 null 表示不在框选模式 */
  let snip = null;

  function destroySnip() {
    if (!snip) {
      return;
    }
    window.removeEventListener('keydown', snip.onKey, true);
    snip.overlay.remove();
    snip = null;
    document.body.classList.remove('office-snip-active');
  }

  /** 取选区中心点下方的页面 canvas，作为截图来源 */
  function resolveSnipTarget(rect) {
    const overlay = snip ? snip.overlay : null;
    if (overlay) {
      overlay.style.pointerEvents = 'none';
    }
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (overlay) {
      overlay.style.pointerEvents = '';
    }
    const pageEl = element && element.closest ? element.closest('.page') : null;
    const canvas = pageEl ? pageEl.querySelector('canvas') : null;
    if (!pageEl || !canvas) {
      return null;
    }
    const pageNumber = Number(pageEl.dataset.pageNumber) || 0;
    const canvasRect = canvas.getBoundingClientRect();
    if (!pageNumber || canvasRect.width <= 0 || canvasRect.height <= 0) {
      return null;
    }
    return { pageNumber, canvasRect };
  }

  async function captureSnip(rect, target) {
    const app = getApp();
    const { pageNumber, canvasRect } = target;
    const currentScale = app.pdfViewer.currentScale || 1;
    // 先换算成「当前缩放下视图像素」中的选区，再按导出倍率放大
    const left = Math.max(0, rect.left - canvasRect.left);
    const top = Math.max(0, rect.top - canvasRect.top);
    const width = Math.min(rect.width, canvasRect.width - left);
    const height = Math.min(rect.height, canvasRect.height - top);
    if (width < 4 || height < 4) {
      toast('选区太小，已取消');
      return;
    }

    const pageView = app.pdfViewer.getPageView(pageNumber - 1);
    const rotation = pageView && typeof pageView.rotation === 'number' ? pageView.rotation : undefined;
    toast('正在生成选区图片…');
    setBusy(true);
    try {
      const { canvas, scale } = await renderPageCanvas(pageNumber, readScale(), rotation);
      let output = null;
      try {
        const k = scale / currentScale;
        output = document.createElement('canvas');
        output.width = Math.max(1, Math.round(width * k));
        output.height = Math.max(1, Math.round(height * k));
        const context = output.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, output.width, output.height);
        context.drawImage(canvas, left * k, top * k, width * k, height * k, 0, 0, output.width, output.height);
        const size = `${output.width}×${output.height}`;
        await writeImageToClipboard(output);
        toast(`已复制选区 ${size}`);
      } finally {
        if (output) {
          releaseCanvas(output);
        }
        releaseCanvas(canvas);
      }
    } catch (error) {
      const message = error && error.message ? error.message : '截图失败';
      toast(`截图失败：${message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function startSnip() {
    if (snip || pending || !getDocument()) {
      return;
    }
    closePanel();
    const overlay = document.createElement('div');
    overlay.className = 'office-snip-overlay';
    const rectEl = document.createElement('div');
    rectEl.className = 'office-snip-rect';
    const hint = document.createElement('div');
    hint.className = 'office-snip-hint';
    hint.textContent = '拖拽框选区域 · Esc 取消';
    overlay.append(rectEl, hint);
    document.body.appendChild(overlay);
    document.body.classList.add('office-snip-active');

    const state = { overlay, rectEl, hint, startX: 0, startY: 0, dragging: false, rect: null, onKey: null };
    snip = state;

    const paint = (event) => {
      if (!state.dragging) {
        return;
      }
      const left = Math.min(state.startX, event.clientX);
      const top = Math.min(state.startY, event.clientY);
      const width = Math.abs(event.clientX - state.startX);
      const height = Math.abs(event.clientY - state.startY);
      state.rectEl.style.left = `${left}px`;
      state.rectEl.style.top = `${top}px`;
      state.rectEl.style.width = `${width}px`;
      state.rectEl.style.height = `${height}px`;
      state.rect = { left, top, width, height };
    };

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      try {
        overlay.setPointerCapture(event.pointerId);
      } catch {
        // 某些环境下不支持指针捕获，退化为普通事件流
      }
      paint(event);
    });
    overlay.addEventListener('pointermove', paint);
    overlay.addEventListener('pointerup', (event) => {
      if (!state.dragging) {
        return;
      }
      state.dragging = false;
      paint(event);
      const rect = state.rect;
      const target = rect ? resolveSnipTarget(rect) : null;
      destroySnip();
      if (!rect || rect.width < 8 || rect.height < 8) {
        toast('选区太小，已取消');
        return;
      }
      if (!target) {
        toast('未选中页面内容');
        return;
      }
      void captureSnip(rect, target);
    });
    overlay.addEventListener('pointercancel', () => destroySnip());

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        destroySnip();
        toast('已取消框选');
      }
    };
    state.onKey = onKey;
    window.addEventListener('keydown', onKey, true);
  }

  function textItemsToText(items) {
    let out = '';
    let prevY = null;
    let prevEndX = null;
    let lineStart = true;
    const pushNewline = () => {
      if (out && !out.endsWith('\n')) {
        out += '\n';
      }
      prevEndX = null;
      lineStart = true;
    };
    for (const item of items) {
      if (!item || typeof item.str !== 'string') {
        continue;
      }
      const x = item.transform ? item.transform[4] : 0;
      const y = item.transform ? item.transform[5] : 0;
      // hasEOL 之后已经在行首，别再按坐标差补换行，否则会多出空行
      if (!lineStart && prevY !== null && Math.abs(y - prevY) > 1.5) {
        pushNewline();
      } else if (!lineStart && prevEndX !== null && x - prevEndX > 1) {
        out += ' ';
      }
      if (item.str) {
        out += item.str;
        lineStart = false;
      }
      prevEndX = lineStart ? null : x + (typeof item.width === 'number' ? item.width : 0);
      prevY = y;
      if (item.hasEOL) {
        pushNewline();
      }
    }
    return out;
  }

  async function collectText(pages) {
    const doc = getDocument();
    const chunks = [];
    for (const pageNumber of pages) {
      if (!doc) {
        break;
      }
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = textItemsToText(content.items).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text) {
        chunks.push(text);
      }
      await nextTick();
    }
    return chunks.join('\n\n');
  }

  function allPageNumbers() {
    const doc = getDocument();
    const total = doc ? doc.numPages : 0;
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  let pongResolver = null;

  /** 存活探测：旧窗口里跑的是旧版扩展，不会有 pong 回来 */
  function pingExtension(timeout = 1500) {
    return new Promise((resolve) => {
      pongResolver = resolve;
      try {
        vscodeEvent.emit('pdfExportPing', {});
      } catch {
        // 通道不可用，按超时处理
      }
      setTimeout(() => {
        if (pongResolver === resolve) {
          pongResolver = null;
          resolve(false);
        }
      }, timeout);
    });
  }

  function resolvePong() {
    const resolver = pongResolver;
    pongResolver = null;
    if (resolver) {
      resolver(true);
    }
  }

  /** 需要扩展落盘的动作先探活，失败时给出可操作的提示而不是一直转圈 */
  async function ensureExtensionAlive() {
    if (await pingExtension()) {
      return true;
    }
    const message = '扩展未响应，请执行 Developer: Reload Window 后重试';
    pending = null;
    setBusy(false);
    setStatus(message, 'error');
    toast(message, 'error');
    return false;
  }

  async function copyAllText() {
    if (pending || !getDocument()) {
      return;
    }
    setBusy(true);
    setStatus('正在提取文本…');
    try {
      const text = await collectText(allPageNumbers());
      if (!text) {
        throw new Error('这份 PDF 没有文本层，可能是扫描件');
      }
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error('当前环境不支持写入文本剪贴板');
      }
      await navigator.clipboard.writeText(text);
      setStatus(`已复制全文（${text.length} 字）`);
      toast(`已复制全文（${text.length} 字）`);
    } catch (error) {
      const message = error && error.message ? error.message : '复制失败';
      setStatus(`复制失败：${message}`, 'error');
      toast(`复制失败：${message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveAllText() {
    if (pending || !getDocument()) {
      return;
    }
    setBusy(true);
    setStatus('检查扩展状态…');
    if (!(await ensureExtensionAlive())) {
      return;
    }
    setStatus('正在提取文本…');
    try {
      const text = await collectText(allPageNumbers());
      if (!text) {
        throw new Error('这份 PDF 没有文本层，可能是扫描件');
      }
      setStatus('正在写入文件…');
      vscodeEvent.emit('pdfExportText', { content: text });
    } catch (error) {
      const message = error && error.message ? error.message : '导出失败';
      setStatus(`导出失败：${message}`, 'error');
      toast(`导出失败：${message}`, 'error');
      setBusy(false);
    }
  }

  async function runExport() {
    const state = pending;
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      for (let i = 0; i < state.pages.length; i++) {
        if (pending !== state) {
          return;
        }
        const pageNumber = state.pages[i];
        const progress = state.pages.length > 1 ? `正在渲染 ${i + 1} / ${state.pages.length}` : '正在渲染当前页';
        setStatus(progress);
        const bytes = await renderPageBytes(pageNumber, state.scale, state.format);
        if (pending !== state) {
          return;
        }
        vscodeEvent.emit('pdfExportPage', { index: pageNumber, content: toBase64(bytes) });
        await nextTick();
      }
      setStatus('正在写入文件…');
      vscodeEvent.emit('pdfExportDone', {});
    } catch (error) {
      pending = null;
      setBusy(false);
      const message = error && error.message ? error.message : '渲染失败';
      setStatus(`导出失败：${message}`, 'error');
      vscodeEvent.emit('pdfExportAbort');
    }
  }

  async function startExport(mode) {
    const doc = getDocument();
    if (!doc || pending) {
      return;
    }
    const app = getApp();
    const total = doc.numPages;
    const current = app.pdfViewer.currentPageNumber || 1;
    const pages = mode === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : [current];
    setBusy(true);
    setStatus('检查扩展状态…');
    if (!(await ensureExtensionAlive())) {
      return;
    }
    pending = { mode, pages, scale: readScale(), format: readFormat() };
    setStatus('等待选择保存位置…');
    vscodeEvent.emit('pdfExportStart', {
      mode,
      format: pending.format,
      scale: pending.scale,
      pageNumber: current,
      totalPages: total,
    });
  }

  function finish(text, tone) {
    pending = null;
    setBusy(false);
    setStatus(text || '', tone);
  }

  function setupPanel() {
    const toggle = $('exportImageToggle');
    const panel = $('officeExportPanel');
    if (!toggle || !panel) {
      return;
    }
    toggle.innerHTML = EXPORT_ICON;
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePanel();
    });

    const qualitySeg = $('officeExportQualitySeg');
    if (qualitySeg) {
      qualitySeg.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-quality]');
        if (!button) {
          return;
        }
        saveSetting(QUALITY_KEY, button.dataset.quality);
        paintSegments();
      });
    }

    const formatSeg = $('officeExportFormatSeg');
    if (formatSeg) {
      formatSeg.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-format]');
        if (!button) {
          return;
        }
        saveSetting(FORMAT_KEY, button.dataset.format);
        paintSegments();
      });
    }

    $('officeExportCurrent')?.addEventListener('click', () => startExport('current'));
    $('officeExportAll')?.addEventListener('click', () => startExport('all'));
    $('officeExportCopyImage')?.addEventListener('click', () => void copyCurrentPageImage());
    $('officeExportSnip')?.addEventListener('click', () => startSnip());
    $('officeExportCopyText')?.addEventListener('click', () => void copyAllText());
    $('officeExportSaveText')?.addEventListener('click', () => void saveAllText());
    $('officeExportCancel')?.addEventListener('click', () => {
      if (!pending) {
        return;
      }
      pending = null;
      setBusy(false);
      setStatus('已取消');
      vscodeEvent.emit('pdfExportAbort');
    });

    document.addEventListener('pointerdown', (event) => {
      if (pending) {
        return;
      }
      if (panel.contains(event.target) || toggle.contains(event.target)) {
        return;
      }
      closePanel();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || panel.classList.contains('hidden')) {
        return;
      }
      // 卡住时的逃生口：即便还有 pending，也允许 Esc 本地取消并收回界面
      if (pending) {
        pending = null;
        setBusy(false);
        vscodeEvent.emit('pdfExportAbort');
      }
      closePanel();
      toggle.focus();
    });
  }

  function setupMessages() {
    vscodeEvent.on('pdfExportPong', () => {
      resolvePong();
    });
    vscodeEvent.on('pdfExportAccept', () => {
      void runExport();
    });
    vscodeEvent.on('pdfExportCancel', () => {
      finish('已取消');
    });
    vscodeEvent.on('pdfExportFinished', (payload) => {
      const count = payload && payload.count ? payload.count : 0;
      finish(count > 1 ? `已导出 ${count} 页` : '已导出');
      setTimeout(() => {
        if (!pending) {
          closePanel();
        }
      }, 1500);
    });
    vscodeEvent.on('pdfExportError', (payload) => {
      finish((payload && payload.message) || '导出失败', 'error');
    });
    vscodeEvent.on('pdfExportTextDone', (payload) => {
      const name = payload && payload.fileName ? payload.fileName : '';
      setBusy(false);
      setStatus(name ? `已导出文本：${name}` : '已导出文本');
      toast('已导出文本');
    });
    vscodeEvent.on('pdfExportTextCancel', () => {
      setBusy(false);
      setStatus('已取消');
    });
    vscodeEvent.on('pdfExportTextError', (payload) => {
      const message = (payload && payload.message) || '导出失败';
      setBusy(false);
      setStatus(`导出失败：${message}`, 'error');
      toast(`导出失败：${message}`, 'error');
    });
  }

  window.addEventListener(
    'load',
    () => {
      setupPanel();
      setupMessages();
      const app = getApp();
      if (!app || !app.initializedPromise) {
        return;
      }
      void app.initializedPromise.then(() => {
        syncAvailability();
        app.eventBus.on('documentloaded', syncAvailability);
        // 文档偶尔会在监听注册前就加载完，补一次延时同步兜底
        setTimeout(syncAvailability, 500);
        app.eventBus.on('pagechanging', () => {
          const panel = $('officeExportPanel');
          if (panel && !panel.classList.contains('hidden')) {
            syncAvailability();
          }
        });
      });
    },
    { once: true }
  );
})();
