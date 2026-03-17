const els = {
  clock: document.getElementById('clock'),
  date: document.getElementById('date'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  canvasStage: document.getElementById('canvasStage'),
  mainCanvas: document.getElementById('mainCanvas'),
  maskCanvas: document.getElementById('maskCanvas'),
  reselectBtn: document.getElementById('reselectBtn'),
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
  formatBtns: [...document.querySelectorAll('.format-btn')],
};

const ctx = {
  main: els.mainCanvas.getContext('2d', { willReadFrequently: true }),
  mask: els.maskCanvas.getContext('2d', { willReadFrequently: true }),
};

const state = {
  imageLoaded: false,
  originalImage: null,
  originalBitmap: null,
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
  maxUndo: 20,
  hasMask: false,
  busy: false,
};

boot();

function boot() {
  bindEvents();
  updateClock();
  setInterval(updateClock, 1000);
  syncBrushUi();
  syncRemoveModeUi();
  syncToolUi();
  syncActionState();
  setStatus('等待上传图片。', 'idle');
}

function bindEvents() {
  els.dropzone.addEventListener('click', (event) => {
    if (!state.imageLoaded && !event.target.closest('button')) {
      els.fileInput.click();
    }
  });

  els.reselectBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
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

  els.dropzone.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) loadFile(file);
  });

  window.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      const named = new File([file], `pasted-${Date.now()}.png`, { type: file.type });
      await loadFile(named);
    }
  });

  els.brushSize.addEventListener('input', () => {
    state.brushSize = Number(els.brushSize.value);
    syncBrushUi();
  });

  els.paintModeBtn.addEventListener('click', () => setTool('paint'));
  els.eraseModeBtn.addEventListener('click', () => setTool('erase'));
  els.inpaintModeBtn.addEventListener('click', () => setRemoveMode('inpaint'));
  els.alphaModeBtn.addEventListener('click', () => setRemoveMode('alpha'));

  els.alphaSlider.addEventListener('input', () => {
    els.alphaValue.textContent = els.alphaSlider.value;
  });

  els.formatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.outputFormat = btn.dataset.format;
      els.formatBtns.forEach((b) => b.classList.toggle('active', b === btn));
      if (state.resultBlob) {
        state.resultBlob = null;
        revokeResultUrl();
        setStatus('输出格式已切换，请重新执行一次处理后再下载。', 'idle');
      }
      syncDownloadState();
    });
  });

  els.undoBtn.addEventListener('click', undoMask);
  els.clearMaskBtn.addEventListener('click', clearMask);
  els.runBtn.addEventListener('click', runRemoval);
  els.downloadBtn.addEventListener('click', downloadResult);

  const start = (event) => {
    if (!state.imageLoaded || state.busy) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    pushUndo();
    state.isDrawing = true;
    state.lastPoint = getCanvasPoint(event);
    drawStroke(state.lastPoint, state.lastPoint);
  };

  const move = (event) => {
    if (!state.isDrawing) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
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
  window.addEventListener('mouseup', end);

  els.maskCanvas.addEventListener('touchstart', start, { passive: false });
  els.maskCanvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);
}

function updateClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  els.date.textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
}

async function loadFile(file) {
  try {
    setBusy(true);
    setStatus('正在载入图片...', 'working');

    const imageBitmap = await createImageBitmap(file);
    const src = URL.createObjectURL(file);
    const image = new Image();
    image.src = src;
    await image.decode();

    state.fileNameBase = (file.name || 'image').replace(/\.[^.]+$/, '');
    state.originalBitmap = imageBitmap;
    state.originalImage = image;
    state.imageLoaded = true;

    const width = imageBitmap.width;
    const height = imageBitmap.height;
    [els.mainCanvas, els.maskCanvas].forEach((canvas) => {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });

    ctx.main.clearRect(0, 0, width, height);
    ctx.main.drawImage(imageBitmap, 0, 0);

    ctx.mask.clearRect(0, 0, width, height);
    ctx.mask.lineCap = 'round';
    ctx.mask.lineJoin = 'round';

    els.canvasStage.classList.remove('hidden');
    els.dropzone.querySelector('.drop-inner')?.classList.add('hidden');

    state.undoStack = [];
    state.hasMask = false;
    revokeResultUrl();
    state.resultBlob = null;
    syncActionState();
    setStatus('图片已载入。请在水印区域涂抹标记。', 'success');
  } catch (error) {
    console.error(error);
    setStatus(`载入失败：${error.message || '未知错误'}`, 'error');
  } finally {
    setBusy(false);
  }
}

function getCanvasPoint(event) {
  const rect = els.maskCanvas.getBoundingClientRect();
  const source = event.touches?.[0] || event;
  const scaleX = els.maskCanvas.width / rect.width;
  const scaleY = els.maskCanvas.height / rect.height;
  return {
    x: (source.clientX - rect.left) * scaleX,
    y: (source.clientY - rect.top) * scaleY,
  };
}

function drawStroke(from, to) {
  const drawCtx = ctx.mask;
  drawCtx.save();
  drawCtx.lineWidth = state.brushSize;

  if (state.tool === 'paint') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = 'rgba(255, 82, 82, 0.86)';
    drawCtx.fillStyle = 'rgba(255, 82, 82, 0.86)';
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
  if (!state.imageLoaded || state.busy) return;
  pushUndo();
  ctx.mask.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  updateMaskState();
  setStatus('标记已清空。', 'idle');
}

function updateMaskState() {
  state.hasMask = maskHasPixels();
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
    ? '画笔模式：左键涂抹标记水印区域。'
    : '橡皮模式：擦掉误涂区域，细修边缘更自然。';
  els.maskCanvas.style.cursor = isPaint ? 'crosshair' : 'cell';
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
    ? '扩散修复：Telea FMM 算法，适合不透明水印，用周边纹理修复，效果更清晰。'
    : '透明还原：按水印颜色和透明度做本地反向混合，适合半透明浅色水印。';
  els.runBtn.textContent = isInpaint ? 'auto_fix_high 去除水印' : 'opacity 透明还原';
}

async function runRemoval() {
  if (!state.imageLoaded || !state.hasMask || state.busy) return;

  try {
    setBusy(true);
    revokeResultUrl();
    state.resultBlob = null;

    if (state.removeMode === 'inpaint') {
      setStatus('正在执行扩散修复，等待服务端返回...', 'working');
      const blob = await runInpaint();
      state.resultBlob = blob;
      await paintBlobToMainCanvas(blob);
      setStatus('扩散修复完成，可继续标记或直接下载。', 'success');
    } else {
      setStatus('正在本地执行透明还原...', 'working');
      const blob = await runAlphaRestore();
      state.resultBlob = blob;
      await paintBlobToMainCanvas(blob);
      setStatus('透明还原完成，可继续细修或直接下载。', 'success');
    }

    syncDownloadState();
  } catch (error) {
    console.error(error);
    setStatus(`处理失败：${error.message || '未知错误'}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function runInpaint() {
  const formData = new FormData();
  formData.append('image', await canvasToBlob(fileCanvasFromImage(state.originalImage), 'image/png'), 'image.png');
  formData.append('mask', await buildMaskBlob(), 'mask.png');
  formData.append('format', state.outputFormat);

  const res = await fetch('/api/inpaint', { method: 'POST', body: formData });
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
  const output = new OffscreenCanvas(width, height);
  const outCtx = output.getContext('2d', { willReadFrequently: true });
  outCtx.drawImage(state.originalImage, 0, 0, width, height);

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

function recoverChannel(composited, watermark, alpha) {
  const restored = (composited - watermark * alpha) / Math.max(1 - alpha, 0.001);
  return Math.max(0, Math.min(255, restored));
}

async function paintBlobToMainCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  ctx.main.clearRect(0, 0, els.mainCanvas.width, els.mainCanvas.height);
  ctx.main.drawImage(bitmap, 0, 0, els.mainCanvas.width, els.mainCanvas.height);
}

async function buildMaskBlob() {
  const temp = new OffscreenCanvas(els.maskCanvas.width, els.maskCanvas.height);
  const tempCtx = temp.getContext('2d');
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

function fileCanvasFromImage(image) {
  const canvas = new OffscreenCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const c = canvas.getContext('2d');
  c.drawImage(image, 0, 0);
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
}

function syncActionState() {
  els.runBtn.disabled = !state.imageLoaded || !state.hasMask || state.busy;
  els.undoBtn.disabled = !state.undoStack.length || state.busy;
  els.clearMaskBtn.disabled = !state.hasMask || state.busy;
  syncDownloadState();
}

function syncDownloadState() {
  els.downloadBtn.disabled = !state.resultBlob || state.busy;
}

function setBusy(busy) {
  state.busy = busy;
  syncActionState();
}

function setStatus(message, kind = 'idle') {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
}

function revokeResultUrl() {
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = '';
  }
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
