const API_BASE_URL = normalizeApiBaseUrl(window.IMGEXE_RUNTIME_CONFIG?.apiBaseUrl);

const els = {
  clock: document.getElementById('clock'),
  date: document.getElementById('date'),
  dropzone: document.getElementById('dropzone'),
  dropInner: document.getElementById('dropInner'),
  workspace: document.getElementById('workspace'),
  fileInput: document.getElementById('fileInput'),
  openFileBtn: document.getElementById('openFileBtn'),
  dropUploadBtn: document.getElementById('dropUploadBtn'),
  reselectBtn: document.getElementById('reselectBtn'),
  togglePreviewBtn: document.getElementById('togglePreviewBtn'),
  imageMeta: document.getElementById('imageMeta'),
  previewHint: document.getElementById('previewHint'),
  emptyResult: document.getElementById('emptyResult'),
  mainCanvas: document.getElementById('mainCanvas'),
  maskCanvas: document.getElementById('maskCanvas'),
  resultCanvas: document.getElementById('resultCanvas'),
  editWrap: document.getElementById('editWrap'),
  resultWrap: document.getElementById('resultWrap'),
  brushCursor: document.getElementById('brushCursor'),
  brushSize: document.getElementById('brushSize'),
  brushValue: document.getElementById('brushValue'),
  paintModeBtn: document.getElementById('paintModeBtn'),
  eraseModeBtn: document.getElementById('eraseModeBtn'),
  brushTip: document.getElementById('brushTip'),
  inpaintModeBtn: document.getElementById('inpaintModeBtn'),
  alphaModeBtn: document.getElementById('alphaModeBtn'),
  alphaControls: document.getElementById('alphaControls'),
  alphaSlider: document.getElementById('alphaSlider'),
  alphaValue: document.getElementById('alphaValue'),
  colorInput: document.getElementById('colorInput'),
  modeTip: document.getElementById('modeTip'),
  runBtn: document.getElementById('runBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  undoBtn: document.getElementById('undoBtn'),
  clearMaskBtn: document.getElementById('clearMaskBtn'),
  status: document.getElementById('status'),
  statusLabel: document.getElementById('statusLabel'),
  maskStateLabel: document.getElementById('maskStateLabel'),
  formatStateLabel: document.getElementById('formatStateLabel'),
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.querySelector('.theme-box__icon'),
  themeLabel: document.querySelector('.theme-box__label'),
  formatBtns: [...document.querySelectorAll('.format-btn')],
  viewerTabs: [...document.querySelectorAll('.viewer-tab')],
  viewerCards: [...document.querySelectorAll('.viewer-card')],
};

const ctx = {
  main: els.mainCanvas.getContext('2d', { willReadFrequently: true }),
  mask: els.maskCanvas.getContext('2d', { willReadFrequently: true }),
  result: els.resultCanvas.getContext('2d', { willReadFrequently: true }),
};

const THEME_KEY = 'imgexe-theme';

const state = {
  imageLoaded: false,
  currentImageBitmap: null,
  workingBlob: null,
  resultBlob: null,
  resultUrl: '',
  fileNameBase: 'result',
  outputFormat: 'jpeg',
  tool: 'paint',
  removeMode: 'inpaint',
  brushSize: Number(els.brushSize.value),
  isDrawing: false,
  lastPoint: null,
  undoStack: [],
  maxUndo: 24,
  hasMask: false,
  busy: false,
  viewMode: 'edit',
  theme: 'dark',
  imageWidth: 0,
  imageHeight: 0,
  displayWidth: 0,
  displayHeight: 0,
};

boot();

function boot() {
  initTheme();
  bindEvents();
  updateClock();
  setInterval(updateClock, 1000);
  syncBrushUi();
  syncRemoveModeUi();
  syncToolUi();
  syncViewModeUi();
  syncActionState();
  setStatus('等待上传图片。支持点击、拖拽、粘贴。', 'idle');
}

function scheduleRelayout(frames = 2) {
  const run = () => {
    relayoutCanvases();
    if (frames > 1) {
      frames -= 1;
      window.requestAnimationFrame(run);
    }
  };
  window.requestAnimationFrame(run);
}

function bindEvents() {
  const openPicker = () => els.fileInput.click();
  els.openFileBtn.addEventListener('click', openPicker);
  els.dropUploadBtn.addEventListener('click', openPicker);
  els.reselectBtn.addEventListener('click', openPicker);

  els.dropzone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (!state.imageLoaded) openPicker();
  });

  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    e.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    els.dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    els.dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.remove('drag');
    });
  });
  els.dropzone.addEventListener('drop', async (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) await loadFile(file);
  });

  window.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    const named = new File([file], `pasted-${Date.now()}.png`, { type: file.type });
    await loadFile(named);
  });

  els.brushSize.addEventListener('input', () => {
    state.brushSize = Number(els.brushSize.value);
    syncBrushUi();
  });

  els.paintModeBtn.addEventListener('click', () => setTool('paint'));
  els.eraseModeBtn.addEventListener('click', () => setTool('erase'));
  els.inpaintModeBtn.addEventListener('click', () => setRemoveMode('inpaint'));
  els.alphaModeBtn.addEventListener('click', () => setRemoveMode('alpha'));
  els.togglePreviewBtn.addEventListener('click', () => toggleViewMode());
  els.themeToggle?.addEventListener('click', toggleTheme);

  els.alphaSlider.addEventListener('input', () => {
    els.alphaValue.textContent = els.alphaSlider.value;
  });

  els.formatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.outputFormat = btn.dataset.format;
      els.formatBtns.forEach((b) => b.classList.toggle('active', b === btn));
      els.formatStateLabel.textContent = btn.textContent.trim();
      if (state.resultBlob) {
        revokeResultUrl();
        state.resultBlob = null;
        setStatus('输出格式已切换，请重新执行处理后再下载。', 'idle');
      }
      syncActionState();
    });
  });

  els.viewerTabs.forEach((tab) => {
    tab.addEventListener('click', () => setViewMode(tab.dataset.view));
  });

  els.undoBtn.addEventListener('click', undoMask);
  els.clearMaskBtn.addEventListener('click', clearMask);
  els.runBtn.addEventListener('click', runRemoval);
  els.downloadBtn.addEventListener('click', downloadResult);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', relayoutCanvases);

  const start = (event) => {
    if (!state.imageLoaded || state.busy) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!point) return;
    pushUndo();
    state.isDrawing = true;
    state.lastPoint = point;
    drawStroke(point, point);
  };

  const move = (event) => {
    const point = getCanvasPoint(event);
    updateBrushCursor(point, event);
    if (!state.isDrawing) return;
    event.preventDefault();
    if (!point) return;
    drawStroke(state.lastPoint, point);
    state.lastPoint = point;
  };

  const end = () => {
    if (!state.isDrawing) return;
    state.isDrawing = false;
    state.lastPoint = null;
    updateMaskState();
  };

  els.maskCanvas.addEventListener('mousedown', start);
  els.maskCanvas.addEventListener('mousemove', move);
  els.maskCanvas.addEventListener('mouseleave', () => els.brushCursor.classList.add('hidden'));
  els.maskCanvas.addEventListener('mouseenter', (event) => updateBrushCursor(getCanvasPoint(event), event));
  window.addEventListener('mouseup', end);

  els.maskCanvas.addEventListener('touchstart', start, { passive: false });
  els.maskCanvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  state.theme = savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : prefersLight
      ? 'light'
      : 'dark';
  applyTheme(state.theme);
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.classList.toggle('light', state.theme === 'light');
  root.classList.toggle('dark', state.theme === 'dark');
  els.themeToggle?.setAttribute('aria-pressed', String(state.theme === 'light'));
  if (els.themeIcon) els.themeIcon.textContent = state.theme === 'dark' ? '◐' : '◑';
  if (els.themeLabel) els.themeLabel.textContent = state.theme === 'dark' ? 'MONO' : 'INK';
  localStorage.setItem(THEME_KEY, state.theme);
}

function handleKeyDown(event) {
  if (event.target?.matches('input, textarea')) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoMask();
    return;
  }
  if (event.key.toLowerCase() === 'b') setTool('paint');
  if (event.key.toLowerCase() === 'e') setTool('erase');
  if (event.key.toLowerCase() === 't') toggleTheme();
  if (event.key === '[') {
    state.brushSize = Math.max(5, state.brushSize - 5);
    els.brushSize.value = String(state.brushSize);
    syncBrushUi();
  }
  if (event.key === ']') {
    state.brushSize = Math.min(260, state.brushSize + 5);
    els.brushSize.value = String(state.brushSize);
    syncBrushUi();
  }
}

function updateClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  els.date.textContent = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
}

async function loadFile(file) {
  try {
    setBusy(true);
    setStatus('正在载入图片...', 'working');

    const bitmap = await createImageBitmap(file);
    const extless = (file.name || 'image').replace(/\.[^.]+$/, '');

    state.fileNameBase = extless;
    state.imageLoaded = true;
    state.undoStack = [];
    state.hasMask = false;
    state.resultBlob = null;
    revokeResultUrl();

    await applyBitmapAsWorkingImage(bitmap);
    clearMaskCanvas();
    clearResultCanvas();

    els.workspace.classList.remove('hidden');
    els.dropInner.classList.add('hidden');
    scheduleRelayout(3);
    els.imageMeta.textContent = `${bitmap.width} × ${bitmap.height}`;
    els.previewHint.textContent = '处理后结果会实时显示在右侧';
    els.emptyResult.classList.remove('hidden');
    setViewMode('edit');
    setStatus('图片已载入。请在左侧涂抹要去除的水印区域。', 'success');
  } catch (error) {
    console.error(error);
    setStatus(`载入失败：${error.message || '未知错误'}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function applyBitmapAsWorkingImage(bitmap) {
  state.currentImageBitmap = bitmap;
  const width = bitmap.width;
  const height = bitmap.height;
  state.imageWidth = width;
  state.imageHeight = height;

  [els.mainCanvas, els.maskCanvas, els.resultCanvas].forEach((canvas) => {
    canvas.width = width;
    canvas.height = height;
  });

  relayoutCanvases();

  ctx.main.clearRect(0, 0, width, height);
  ctx.main.drawImage(bitmap, 0, 0);

  ctx.result.clearRect(0, 0, width, height);
  ctx.result.drawImage(bitmap, 0, 0);

  ctx.mask.clearRect(0, 0, width, height);
  ctx.mask.lineCap = 'round';
  ctx.mask.lineJoin = 'round';

  state.workingBlob = await canvasToBlob(els.mainCanvas, 'image/png');
}

function getCanvasPoint(event) {
  if (!state.imageLoaded) return null;
  const rect = els.maskCanvas.getBoundingClientRect();
  const source = event.touches?.[0] || event;
  if (!source || source.clientX == null || source.clientY == null || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const rawViewX = source.clientX - rect.left;
  const rawViewY = source.clientY - rect.top;
  const viewX = Math.max(0, Math.min(rect.width, rawViewX));
  const viewY = Math.max(0, Math.min(rect.height, rawViewY));
  const scaleX = els.maskCanvas.width / rect.width;
  const scaleY = els.maskCanvas.height / rect.height;

  return {
    x: viewX * scaleX,
    y: viewY * scaleY,
    viewX,
    viewY,
    inside: rawViewX >= 0 && rawViewX <= rect.width && rawViewY >= 0 && rawViewY <= rect.height,
  };
}

function updateBrushCursor(point, event) {
  if (!state.imageLoaded || !point) {
    els.brushCursor.classList.add('hidden');
    return;
  }
  const rect = els.maskCanvas.getBoundingClientRect();
  const wrapRect = els.editWrap.getBoundingClientRect();
  const scale = rect.width / Math.max(els.maskCanvas.width, 1);
  const viewSize = state.brushSize * scale;
  els.brushCursor.classList.remove('hidden');
  els.brushCursor.style.width = `${Math.max(8, viewSize)}px`;
  els.brushCursor.style.height = `${Math.max(8, viewSize)}px`;
  els.brushCursor.style.left = `${(rect.left - wrapRect.left) + point.viewX}px`;
  els.brushCursor.style.top = `${(rect.top - wrapRect.top) + point.viewY}px`;
  if (!point.inside || event?.type === 'touchmove' || event?.type === 'touchstart') {
    els.brushCursor.classList.add('hidden');
  }
}

function drawStroke(from, to) {
  const drawCtx = ctx.mask;
  drawCtx.save();
  drawCtx.lineWidth = state.brushSize;

  if (state.tool === 'paint') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = 'rgba(255, 98, 71, 0.90)';
    drawCtx.fillStyle = 'rgba(255, 98, 71, 0.90)';
  } else {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    drawCtx.fillStyle = 'rgba(0,0,0,1)';
  }

  drawCtx.beginPath();
  drawCtx.moveTo(from.x, from.y);
  drawCtx.lineTo(to.x, to.y);
  drawCtx.stroke();

  drawCtx.beginPath();
  drawCtx.arc(to.x, to.y, state.brushSize / 2, 0, Math.PI * 2);
  drawCtx.fill();
  drawCtx.restore();
}

function pushUndo() {
  if (!state.imageLoaded) return;
  if (state.undoStack.length >= state.maxUndo) state.undoStack.shift();
  state.undoStack.push(ctx.mask.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height));
  syncActionState();
}

function undoMask() {
  if (!state.undoStack.length || state.busy) return;
  const snapshot = state.undoStack.pop();
  ctx.mask.putImageData(snapshot, 0, 0);
  updateMaskState();
  setStatus('已撤销上一步标记。', 'idle');
}

function clearMask() {
  if (!state.imageLoaded || state.busy || !state.hasMask) return;
  pushUndo();
  clearMaskCanvas();
  updateMaskState();
  setStatus('标记已清空。', 'idle');
}

function clearMaskCanvas() {
  if (!els.maskCanvas.width || !els.maskCanvas.height) return;
  ctx.mask.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
}

function clearResultCanvas() {
  if (!els.resultCanvas.width || !els.resultCanvas.height) return;
  ctx.result.clearRect(0, 0, els.resultCanvas.width, els.resultCanvas.height);
}

function updateMaskState() {
  state.hasMask = maskHasPixels();
  els.maskStateLabel.textContent = state.hasMask ? '已标记' : '未标记';
  syncActionState();
}

function maskHasPixels() {
  const { data } = ctx.mask.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) return true;
  }
  return false;
}

function setTool(tool) {
  state.tool = tool;
  syncToolUi();
}

function syncToolUi() {
  const isPaint = state.tool === 'paint';
  els.paintModeBtn.classList.toggle('active', isPaint);
  els.eraseModeBtn.classList.toggle('active', !isPaint);
  els.brushTip.textContent = isPaint
    ? '画笔模式：涂抹需要去除的水印区域。'
    : '橡皮模式：擦掉误涂区域，适合修边。';
}

function syncBrushUi() {
  els.brushValue.textContent = String(state.brushSize);
}

function setRemoveMode(mode) {
  state.removeMode = mode;
  syncRemoveModeUi();
}

function syncRemoveModeUi() {
  const isInpaint = state.removeMode === 'inpaint';
  els.inpaintModeBtn.classList.toggle('active', isInpaint);
  els.alphaModeBtn.classList.toggle('active', !isInpaint);
  els.alphaControls.classList.toggle('hidden', isInpaint);
  els.modeTip.textContent = isInpaint
    ? '扩散修复：适合不透明水印，使用周边纹理补全。'
    : '透明还原：适合浅色半透明水印，按颜色与不透明度做反向混合。';
  els.runBtn.textContent = isInpaint ? '去除水印' : '透明还原';
}

function setViewMode(mode) {
  state.viewMode = mode;
  syncViewModeUi();
}

function toggleViewMode() {
  setViewMode(state.viewMode === 'edit' ? 'result' : 'edit');
}

function syncViewModeUi() {
  els.viewerTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.viewMode));
  els.viewerCards.forEach((card) => card.classList.toggle('active', card.dataset.pane === state.viewMode));
  els.togglePreviewBtn.textContent = state.viewMode === 'edit' ? '◐ 显示结果' : '◧ 返回编辑';
  if (state.imageLoaded) scheduleRelayout(2);
}

async function runRemoval() {
  if (!state.imageLoaded || !state.hasMask || state.busy) return;

  try {
    setBusy(true);
    revokeResultUrl();
    state.resultBlob = null;

    let blob;
    if (state.removeMode === 'inpaint') {
      setStatus('正在执行扩散修复，等待服务端处理...', 'working');
      blob = await runInpaint();
      setStatus('扩散修复完成。你可以继续标记细修，或直接下载。', 'success');
    } else {
      setStatus('正在执行透明还原，本地处理中...', 'working');
      blob = await runAlphaRestore();
      setStatus('透明还原完成。你可以继续细修，或直接下载。', 'success');
    }

    state.resultBlob = blob;
    await applyResultBlob(blob);
    clearMaskCanvas();
    state.undoStack = [];
    updateMaskState();
    setViewMode('result');
  } catch (error) {
    console.error(error);
    setStatus(`处理失败：${error.message || '未知错误'}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function runInpaint() {
  const formData = new FormData();
  formData.append('image', state.workingBlob, 'image.png');
  formData.append('mask', await buildMaskBlob(), 'mask.png');
  formData.append('format', state.outputFormat);

  const res = await fetch(buildApiUrl('/api/inpaint'), { method: 'POST', body: formData });
  if (!res.ok) {
    let msg = '服务端修复失败';
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return await res.blob();
}

async function runAlphaRestore() {
  const width = els.mainCanvas.width;
  const height = els.mainCanvas.height;
  const output = createCanvas(width, height);
  const outCtx = output.getContext('2d', { willReadFrequently: true });
  outCtx.drawImage(els.mainCanvas, 0, 0, width, height);

  const imageData = outCtx.getImageData(0, 0, width, height);
  const maskData = ctx.mask.getImageData(0, 0, width, height);
  const alpha = Number(els.alphaSlider.value) / 100;
  const wmColor = hexToRgb(els.colorInput.value);
  const src = imageData.data;
  const mask = maskData.data;

  for (let i = 0; i < src.length; i += 4) {
    const coverage = (mask[i + 3] / 255) * alpha;
    if (coverage <= 0.001) continue;
    src[i] = recoverChannel(src[i], wmColor.r, coverage);
    src[i + 1] = recoverChannel(src[i + 1], wmColor.g, coverage);
    src[i + 2] = recoverChannel(src[i + 2], wmColor.b, coverage);
  }

  outCtx.putImageData(imageData, 0, 0);
  return await canvasToBlob(output, mimeFromFormat(state.outputFormat), qualityFromFormat(state.outputFormat));
}

async function applyResultBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  ctx.result.clearRect(0, 0, els.resultCanvas.width, els.resultCanvas.height);
  ctx.result.drawImage(bitmap, 0, 0, els.resultCanvas.width, els.resultCanvas.height);
  els.emptyResult.classList.add('hidden');
  els.previewHint.textContent = '当前显示最新处理结果';

  await applyBitmapAsWorkingImage(bitmap);
}

async function buildMaskBlob() {
  const temp = createCanvas(els.maskCanvas.width, els.maskCanvas.height);
  const tempCtx = temp.getContext('2d', { willReadFrequently: true });
  tempCtx.fillStyle = '#000';
  tempCtx.fillRect(0, 0, temp.width, temp.height);
  tempCtx.drawImage(els.maskCanvas, 0, 0);

  const imageData = tempCtx.getImageData(0, 0, temp.width, temp.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    const v = a > 8 ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  tempCtx.putImageData(imageData, 0, 0);
  return await canvasToBlob(temp, 'image/png');
}

function relayoutCanvases() {
  if (!state.imageWidth || !state.imageHeight) return;

  [
    [els.editWrap, [els.mainCanvas, els.maskCanvas]],
    [els.resultWrap, [els.resultCanvas]],
  ].forEach(([wrap, canvases]) => {
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return;

    const style = window.getComputedStyle(wrap);
    const padX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
    const padY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
    const availableWidth = Math.max(1, width - padX);
    const availableHeight = Math.max(1, height - padY);
    const scale = Math.min(availableWidth / state.imageWidth, availableHeight / state.imageHeight, 1);
    const displayWidth = Math.max(1, Math.round(state.imageWidth * scale));
    const displayHeight = Math.max(1, Math.round(state.imageHeight * scale));

    canvases.forEach((canvas) => {
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    });

    if (wrap === els.editWrap) {
      state.displayWidth = displayWidth;
      state.displayHeight = displayHeight;
    }
  });
}

function createCanvas(width, height) {
  if ('OffscreenCanvas' in window) return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('无法导出图像'));
    }, type, quality);
  });
}

function downloadResult() {
  if (!state.resultBlob) return;
  revokeResultUrl();
  state.resultUrl = URL.createObjectURL(state.resultBlob);
  const ext = state.outputFormat === 'jpeg' ? 'jpg' : state.outputFormat;
  const a = document.createElement('a');
  a.href = state.resultUrl;
  a.download = `${state.fileNameBase}-clean.${ext}`;
  a.click();
  setStatus(`下载已触发：${state.fileNameBase}-clean.${ext}`, 'success');
}

function syncActionState() {
  els.runBtn.disabled = !state.imageLoaded || !state.hasMask || state.busy;
  els.undoBtn.disabled = !state.undoStack.length || state.busy;
  els.clearMaskBtn.disabled = !state.hasMask || state.busy;
  els.downloadBtn.disabled = !state.resultBlob || state.busy;
  els.openFileBtn.disabled = state.busy;
  els.dropUploadBtn.disabled = state.busy;
  els.reselectBtn.disabled = state.busy;
}

function setBusy(busy) {
  state.busy = busy;
  els.statusLabel.textContent = busy ? '处理中' : '待机中';
  syncActionState();
}

function setStatus(message, kind = 'idle') {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
  els.statusLabel.textContent = kind === 'working'
    ? '处理中'
    : kind === 'error'
      ? '异常'
      : kind === 'success'
        ? '已完成'
        : '待机中';
}

function revokeResultUrl() {
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = '';
  }
}

function recoverChannel(composited, watermark, alpha) {
  const restored = (composited - watermark * alpha) / Math.max(1 - alpha, 0.001);
  return Math.max(0, Math.min(255, restored));
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function mimeFromFormat(format) {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function qualityFromFormat(format) {
  return format === 'png' ? undefined : 0.92;
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/$/, '');
}

function buildApiUrl(pathname) {
  if (!API_BASE_URL) return pathname;
  return `${API_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}
