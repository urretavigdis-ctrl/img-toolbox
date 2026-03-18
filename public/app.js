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
  compareHoldBtn: document.getElementById('compareHoldBtn'),
  compareHoldBtnPanel: document.getElementById('compareHoldBtnPanel'),
  imageMeta: document.getElementById('imageMeta'),
  previewHint: document.getElementById('previewHint'),
  canvasModeLabel: document.getElementById('canvasModeLabel'),
  compareHintLabel: document.getElementById('compareHintLabel'),
  mainCanvas: document.getElementById('mainCanvas'),
  maskCanvas: document.getElementById('maskCanvas'),
  resultCanvas: document.getElementById('resultCanvas'),
  editWrap: document.getElementById('editWrap'),
  brushCursor: document.getElementById('brushCursor'),
  brushSize: document.getElementById('brushSize'),
  brushValue: document.getElementById('brushValue'),
  paintModeBtn: document.getElementById('paintModeBtn'),
  eraseModeBtn: document.getElementById('eraseModeBtn'),
  brushTip: document.getElementById('brushTip'),
  inpaintModeBtn: document.getElementById('inpaintModeBtn'),
  alphaModeBtn: document.getElementById('alphaModeBtn'),
  inpaintControls: document.getElementById('inpaintControls'),
  inpaintRadius: document.getElementById('inpaintRadius'),
  inpaintRadiusValue: document.getElementById('inpaintRadiusValue'),
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
};

const ctx = {
  main: els.mainCanvas.getContext('2d', { willReadFrequently: true }),
  mask: els.maskCanvas.getContext('2d', { willReadFrequently: true }),
  result: els.resultCanvas.getContext('2d', { willReadFrequently: true }),
};

const THEME_KEY = 'imgexe-theme';

const state = {
  imageLoaded: false,
  originalBitmap: null,
  currentImageBitmap: null,
  workingBlob: null,
  resultBlob: null,
  resultUrl: '',
  fileNameBase: 'result',
  outputFormat: 'jpeg',
  tool: 'paint',
  removeMode: 'inpaint',
  brushSize: Number(els.brushSize.value),
  inpaintRadius: Number(els.inpaintRadius?.value || 4.5),
  isDrawing: false,
  isComparing: false,
  lastPoint: null,
  undoStack: [],
  maxUndo: 24,
  hasMask: false,
  busy: false,
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
  syncInpaintUi();
  syncRemoveModeUi();
  syncToolUi();
  syncCompareUi();
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
  els.inpaintRadius?.addEventListener('input', () => {
    state.inpaintRadius = Number(els.inpaintRadius.value);
    syncInpaintUi();
  });
  els.themeToggle?.addEventListener('click', toggleTheme);

  bindCompareButton(els.compareHoldBtn);
  bindCompareButton(els.compareHoldBtnPanel);

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
        syncCompareUi();
        renderMainView();
        setStatus('输出格式已切换，请重新执行处理后再下载。', 'idle');
      }
      syncActionState();
    });
  });

  els.undoBtn.addEventListener('click', undoMask);
  els.clearMaskBtn.addEventListener('click', clearMask);
  els.runBtn.addEventListener('click', runRemoval);
  els.downloadBtn.addEventListener('click', downloadResult);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', relayoutCanvases);

  const start = (event) => {
    if (!state.imageLoaded || state.busy || state.isComparing) return;
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
  window.addEventListener('mouseup', () => {
    end();
    setCompareMode(false);
  });

  els.maskCanvas.addEventListener('touchstart', start, { passive: false });
  els.maskCanvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', () => {
    end();
    setCompareMode(false);
  });
  window.addEventListener('touchcancel', () => {
    end();
    setCompareMode(false);
  });
}

function bindCompareButton(button) {
  if (!button) return;
  const startCompare = (event) => {
    if (button.disabled) return;
    if (event) event.preventDefault();
    setCompareMode(true);
  };
  const stopCompare = (event) => {
    if (event) event.preventDefault();
    setCompareMode(false);
  };

  button.addEventListener('mousedown', startCompare);
  button.addEventListener('touchstart', startCompare, { passive: false });
  button.addEventListener('mouseup', stopCompare);
  button.addEventListener('mouseleave', stopCompare);
  button.addEventListener('touchend', stopCompare);
  button.addEventListener('touchcancel', stopCompare);
  button.addEventListener('blur', stopCompare);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  state.theme = savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
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
  if (event.code === 'Space' && state.resultBlob) {
    event.preventDefault();
    setCompareMode(true);
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

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') setCompareMode(false);
});

function updateClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  els.date.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
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
    state.isComparing = false;
    state.resultBlob = null;
    state.originalBitmap = bitmap;
    revokeResultUrl();

    await applyBitmapAsWorkingImage(bitmap);
    clearMaskCanvas();
    clearResultCanvas();

    els.workspace.classList.remove('hidden');
    els.dropInner.classList.add('hidden');
    scheduleRelayout(3);
    els.imageMeta.textContent = `${bitmap.width} × ${bitmap.height}`;
    syncCompareUi();
    renderMainView();
    setStatus('图片已载入。请直接在主画布上涂抹要去除的水印区域。', 'success');
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
  ctx.mask.clearRect(0, 0, width, height);
  ctx.mask.lineCap = 'round';
  ctx.mask.lineJoin = 'round';

  drawBitmapToCanvas(ctx.main, state.resultBlob ? state.currentImageBitmap : state.originalBitmap);
  drawBitmapToCanvas(ctx.result, bitmap);

  state.workingBlob = await canvasToBlob(els.mainCanvas, 'image/png');
}

async function setWorkingImageFromBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  state.currentImageBitmap = bitmap;
  state.imageWidth = bitmap.width;
  state.imageHeight = bitmap.height;
  state.workingBlob = blob;
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
  if (!state.imageLoaded || !point || state.isComparing) {
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
    ? '涂抹要去除的区域。'
    : '擦掉误涂，适合修边。';
}

function syncBrushUi() {
  els.brushValue.textContent = String(state.brushSize);
}

function syncInpaintUi() {
  if (els.inpaintRadiusValue) {
    els.inpaintRadiusValue.textContent = state.inpaintRadius.toFixed(1).replace(/\.0$/, '');
  }
}

function setRemoveMode(mode) {
  state.removeMode = mode;
  syncRemoveModeUi();
}

function syncRemoveModeUi() {
  const isInpaint = state.removeMode === 'inpaint';
  els.inpaintModeBtn.classList.toggle('active', isInpaint);
  els.alphaModeBtn.classList.toggle('active', !isInpaint);
  els.inpaintControls?.classList.toggle('hidden', !isInpaint);
  els.alphaControls.classList.toggle('hidden', isInpaint);
  els.modeTip.textContent = isInpaint
    ? '适合不透明水印；半径越大，补全越强。'
    : '适合浅色半透明水印。';
  const runBtnLabel = els.runBtn?.querySelector('.btn-label');
  if (runBtnLabel) runBtnLabel.textContent = isInpaint ? '去除水印' : '透明还原';
  else els.runBtn.textContent = isInpaint ? '去除水印' : '透明还原';
}

function setCompareMode(enabled) {
  const next = Boolean(enabled && state.resultBlob && !state.busy);
  if (state.isComparing === next) return;
  state.isComparing = next;
  renderMainView();
  syncCompareUi();
}

function syncCompareUi() {
  const enabled = Boolean(state.resultBlob && !state.busy);
  [els.compareHoldBtn, els.compareHoldBtnPanel].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.dataset.active = String(state.isComparing);
    const label = btn.querySelector('.btn-label');
    const icon = btn.querySelector('.btn-icon');
    if (label) {
      label.textContent = state.isComparing
        ? '松开回结果'
        : btn === els.compareHoldBtn
          ? '按住对比原图'
          : '按住看原图';
    } else {
      btn.textContent = state.isComparing ? '松开回结果' : btn === els.compareHoldBtn ? '按住对比原图' : '按住看原图';
    }
    if (icon) icon.textContent = state.isComparing ? '◨' : '◧';
  });

  if (els.canvasModeLabel) {
    els.canvasModeLabel.textContent = state.isComparing
      ? 'ORIGINAL'
      : state.resultBlob
        ? 'RESULT'
        : 'ORIGINAL';
  }

  if (els.compareHintLabel) {
    els.compareHintLabel.textContent = state.isComparing
      ? '正在临时查看原图，松开后回到结果图'
      : state.resultBlob
        ? '当前为结果视图，可按住 Compare 查看原图'
        : '当前为原图编辑视图';
  }

  if (els.previewHint) {
    els.previewHint.textContent = state.resultBlob
      ? '修复结果已回到主画布；按住 Compare 可临时查看原图'
      : '修复后会直接替换到主画布；按住 Compare 可临时查看原图';
  }

  els.maskCanvas.style.opacity = state.isComparing ? '0' : '1';
  if (state.isComparing) els.brushCursor.classList.add('hidden');
}

async function runRemoval() {
  if (!state.imageLoaded || !state.hasMask || state.busy) return;

  try {
    setBusy(true);
    revokeResultUrl();
    state.resultBlob = null;
    syncCompareUi();

    let blob;
    if (state.removeMode === 'inpaint') {
      setStatus('正在执行扩散修复，等待服务端处理...', 'working');
      blob = await runInpaint();
      setStatus('扩散修复完成。结果已回到主画布，可按住 Compare 检查原图。', 'success');
    } else {
      setStatus('正在执行透明还原，本地处理中...', 'working');
      blob = await runAlphaRestore();
      setStatus('透明还原完成。结果已回到主画布，可按住 Compare 检查原图。', 'success');
    }

    state.resultBlob = blob;
    await applyResultBlob(blob);
    clearMaskCanvas();
    state.undoStack = [];
    updateMaskState();
    renderMainView();
    syncCompareUi();
  } catch (error) {
    console.error(error);
    setStatus(`处理失败：${error.message || '未知错误'}`, 'error');
  } finally {
    setBusy(false);
    syncCompareUi();
  }
}

async function runInpaint() {
  const maskInfo = await buildMaskBlob();
  const formData = new FormData();
  formData.append('image', state.workingBlob, 'image.png');
  formData.append('mask', maskInfo.blob, 'mask.png');
  formData.append('format', state.outputFormat);
  formData.append('radius', String(state.inpaintRadius));

  console.info('[imgexe] inpaint request', {
    api: buildApiUrl('/api/inpaint'),
    imageBytes: state.workingBlob?.size || 0,
    maskBytes: maskInfo.blob.size,
    maskPixels: maskInfo.nonZeroPixels,
    maskCoverage: maskInfo.coverage,
    format: state.outputFormat,
    radius: state.inpaintRadius,
  });

  const res = await fetch(buildApiUrl('/api/inpaint'), {
    method: 'POST',
    body: formData,
    cache: 'no-store',
  });
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

  const algo = (res.headers.get('X-Inpaint-Algo') || 'telea').trim();
  console.info('[imgexe] inpaint response', {
    algo,
    radius: res.headers.get('X-Inpaint-Radius'),
    smoothOptimized: res.headers.get('X-Inpaint-Smooth'),
    contentType: res.headers.get('Content-Type'),
    contentLength: res.headers.get('Content-Length'),
  });

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
  drawBitmapToCanvas(ctx.result, bitmap);
  await setWorkingImageFromBlob(blob);
}

async function buildMaskBlob() {
  const temp = createCanvas(els.maskCanvas.width, els.maskCanvas.height);
  const tempCtx = temp.getContext('2d', { willReadFrequently: true });
  tempCtx.clearRect(0, 0, temp.width, temp.height);
  tempCtx.drawImage(els.maskCanvas, 0, 0);

  const imageData = tempCtx.getImageData(0, 0, temp.width, temp.height);
  const d = imageData.data;
  let nonZeroPixels = 0;

  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3];
    const luminance = Math.round((d[i] * 0.299) + (d[i + 1] * 0.587) + (d[i + 2] * 0.114));
    const marked = alpha > 8 || luminance > 8;
    const v = marked ? 255 : 0;
    if (marked) nonZeroPixels += 1;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = v;
  }

  tempCtx.putImageData(imageData, 0, 0);

  const blob = await canvasToBlob(temp, 'image/png');
  return {
    blob,
    nonZeroPixels,
    coverage: Number((nonZeroPixels / Math.max(temp.width * temp.height, 1)).toFixed(4)),
  };
}

function renderMainView() {
  if (!state.imageLoaded) return;
  const bitmap = state.isComparing
    ? state.originalBitmap
    : state.resultBlob
      ? state.currentImageBitmap
      : state.originalBitmap;
  drawBitmapToCanvas(ctx.main, bitmap);
}

function drawBitmapToCanvas(targetCtx, bitmap) {
  if (!bitmap) return;
  targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  targetCtx.drawImage(bitmap, 0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
}

function relayoutCanvases() {
  if (!state.imageWidth || !state.imageHeight) return;

  const wrap = els.editWrap;
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

  [els.mainCanvas, els.maskCanvas, els.resultCanvas].forEach((canvas) => {
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
  });

  state.displayWidth = displayWidth;
  state.displayHeight = displayHeight;
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
  if (busy) state.isComparing = false;
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
