import express from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 2,
  },
});
const PORT = Number(process.env.PORT || 3100);
const SUPPORTED_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MIME_BY_FORMAT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const PYTHON_TIMEOUT_MS = Number(process.env.INPAINT_TIMEOUT_MS || 60_000);
const DEFAULT_CORS_METHODS = ['GET', 'POST', 'OPTIONS'];
const DEFAULT_CORS_HEADERS = ['Content-Type'];
const DEFAULT_CORS_EXPOSE_HEADERS = ['X-Inpaint-Algo', 'X-Inpaint-Radius', 'X-Inpaint-Smooth', 'Content-Type'];
const DEFAULT_INPAINT_RADIUS = Number(process.env.DEFAULT_INPAINT_RADIUS || 4.5);
const MIN_INPAINT_RADIUS = 1;
const MAX_INPAINT_RADIUS = 12;

app.use(corsMiddleware);
app.options('*', corsPreflightHandler);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    const pythonBin = await resolvePythonBin();
    res.json({ ok: true, algo: 'telea', python: pythonBin });
  } catch (error) {
    res.status(500).json({ ok: false, algo: 'telea', error: error?.message || 'python unavailable' });
  }
});

app.post('/api/inpaint', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]), async (req, res) => {
  const image = req.files?.image?.[0];
  const mask = req.files?.mask?.[0];
  const format = normalizeFormat(req.body?.format);
  const radius = normalizeRadius(req.body?.radius);

  if (!image || !mask) {
    return res.status(400).json({ error: 'image and mask are required' });
  }

  if (!looksLikeImage(image) || !looksLikeImage(mask)) {
    return res.status(400).json({ error: 'image and mask must be valid image files (jpg/jpeg/png/webp)' });
  }

  if (!format) {
    return res.status(400).json({ error: 'format must be one of: jpg, jpeg, png, webp' });
  }

  if (radius == null) {
    return res.status(400).json({ error: `radius must be a number between ${MIN_INPAINT_RADIUS} and ${MAX_INPAINT_RADIUS}` });
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imgexe-inpaint-'));
  const inputPath = path.join(tempDir, `input${pickExtension(image.mimetype, image.originalname)}`);
  const maskPath = path.join(tempDir, `mask${pickExtension(mask.mimetype, mask.originalname) || '.png'}`);
  const outputPath = path.join(tempDir, `output.${format === 'jpg' ? 'jpeg' : format}`);

  try {
    await fs.writeFile(inputPath, image.buffer);
    await fs.writeFile(maskPath, mask.buffer);

    const pythonBin = await resolvePythonBin();
    const py = await runPython(pythonBin, [
      path.join(__dirname, 'telea_inpaint.py'),
      '--input', inputPath,
      '--mask', maskPath,
      '--output', outputPath,
      '--format', format,
      '--radius', String(radius),
    ], { timeoutMs: PYTHON_TIMEOUT_MS });

    if (py.code !== 0) {
      return res.status(500).json({
        error: formatPythonError(py.stderr || py.stdout || 'inpaint failed'),
      });
    }

    let out;
    try {
      out = await fs.readFile(outputPath);
    } catch {
      return res.status(500).json({ error: 'inpaint finished but output file was not created' });
    }

    const meta = parsePythonMeta(py.stdout);

    res.setHeader('Content-Type', MIME_BY_FORMAT[format]);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Inpaint-Algo', meta.algo || 'telea');
    if (meta.radius) res.setHeader('X-Inpaint-Radius', String(meta.radius));
    if (meta.smooth != null) res.setHeader('X-Inpaint-Smooth', String(meta.smooth));
    res.send(out);
  } catch (error) {
    res.status(500).json({ error: formatServerError(error) });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? '上传文件过大：单个文件不能超过 25MB'
      : err.message;
    return res.status(400).json({ error: message });
  }
  res.status(500).json({ error: err?.message || 'server error' });
});

app.listen(PORT, () => {
  console.log(`imgexe watermark removal clone running at http://localhost:${PORT}`);
});

function normalizeFormat(value) {
  const format = String(value || 'jpeg').toLowerCase();
  if (!SUPPORTED_FORMATS.has(format)) {
    return null;
  }
  return format;
}

function normalizeRadius(value) {
  if (value == null || value === '') return DEFAULT_INPAINT_RADIUS;
  const radius = Number(value);
  if (!Number.isFinite(radius)) return null;
  if (radius < MIN_INPAINT_RADIUS || radius > MAX_INPAINT_RADIUS) return null;
  return Math.round(radius * 10) / 10;
}

function parsePythonMeta(stdout) {
  const meta = { algo: 'telea' };
  const text = String(stdout || '');
  const match = text.match(/\[imgexe-meta\]\s+(\{.*\})/);
  if (!match) return meta;

  try {
    const parsed = JSON.parse(match[1]);
    return {
      algo: parsed.algo || 'telea',
      radius: Number.isFinite(Number(parsed.radius)) ? Number(parsed.radius) : undefined,
      smooth: typeof parsed.smooth === 'boolean' ? parsed.smooth : undefined,
    };
  } catch {
    return meta;
  }
}

function looksLikeImage(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = path.extname(file?.originalname || '').toLowerCase();
  return mime.startsWith('image/') || SUPPORTED_FORMATS.has(ext.replace(/^\./, ''));
}

function pickExtension(mimeType = '', originalname = '') {
  const byMime = mimeType.toLowerCase();
  if (byMime.includes('png')) return '.png';
  if (byMime.includes('webp')) return '.webp';
  if (byMime.includes('jpeg') || byMime.includes('jpg')) return '.jpg';

  const ext = path.extname(originalname || '').toLowerCase();
  if (ext && ext.length <= 6) {
    return ext;
  }
  return '.img';
}

function corsMiddleware(req, res, next) {
  applyCorsHeaders(req, res);
  next();
}

function corsPreflightHandler(req, res) {
  applyCorsHeaders(req, res);
  res.status(204).end();
}

function applyCorsHeaders(req, res) {
  const cors = resolveCorsPolicy(req);
  if (!cors.allowOrigin) return;

  res.setHeader('Access-Control-Allow-Origin', cors.allowOrigin);
  res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Origin'));
  res.setHeader('Access-Control-Allow-Methods', cors.allowMethods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', cors.allowHeaders.join(', '));
  res.setHeader('Access-Control-Expose-Headers', cors.exposeHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', String(cors.maxAge));
}

function resolveCorsPolicy(req) {
  const origin = String(req.headers.origin || '').trim();
  const allowedOrigins = parseCsv(process.env.CORS_ALLOW_ORIGINS);
  const allowedHeaders = parseCsv(process.env.CORS_ALLOW_HEADERS, DEFAULT_CORS_HEADERS);
  const allowedMethods = parseCsv(process.env.CORS_ALLOW_METHODS, DEFAULT_CORS_METHODS);
  const exposeHeaders = parseCsv(process.env.CORS_EXPOSE_HEADERS, DEFAULT_CORS_EXPOSE_HEADERS);
  const maxAge = Number(process.env.CORS_MAX_AGE || 86400);

  if (!origin) {
    return {
      allowOrigin: '*',
      allowHeaders: mergeValues(allowedHeaders, requestedHeaders(req)),
      allowMethods: allowedMethods,
      exposeHeaders,
      maxAge,
    };
  }

  if (!allowedOrigins.length || allowedOrigins.includes('*')) {
    return {
      allowOrigin: '*',
      allowHeaders: mergeValues(allowedHeaders, requestedHeaders(req)),
      allowMethods: allowedMethods,
      exposeHeaders,
      maxAge,
    };
  }

  if (allowedOrigins.includes(origin)) {
    return {
      allowOrigin: origin,
      allowHeaders: mergeValues(allowedHeaders, requestedHeaders(req)),
      allowMethods: allowedMethods,
      exposeHeaders,
      maxAge,
    };
  }

  return {
    allowOrigin: '',
    allowHeaders: allowedHeaders,
    allowMethods: allowedMethods,
    exposeHeaders,
    maxAge,
  };
}

function requestedHeaders(req) {
  return parseCsv(req.headers['access-control-request-headers']);
}

function parseCsv(value, fallback = []) {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length) return items;
  return [...fallback];
}

function mergeValues(base = [], extra = []) {
  return [...new Set([...base, ...extra])];
}

function appendVary(current, value) {
  const items = String(current || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.includes(value)) items.push(value);
  return items.join(', ');
}

async function resolvePythonBin() {
  const candidates = [
    process.env.INPAINT_PYTHON,
    path.join(__dirname, '.venv', 'bin', 'python'),
    path.join(__dirname, '.venv', 'bin', 'python3'),
    path.join(process.cwd(), '.venv', 'bin', 'python'),
    path.join(process.cwd(), '.venv', 'bin', 'python3'),
    'python3.12',
    'python3.11',
    'python3.13',
    'python3',
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await canRun(candidate)) {
      return candidate;
    }
  }

  throw new Error([
    'Python runtime not found for /api/inpaint.',
    '建议在项目目录创建独立虚拟环境：',
    'python3.11 -m venv .venv',
    'source .venv/bin/activate',
    'python -m pip install -U pip',
    'python -m pip install -r requirements.txt',
    '也可以用 INPAINT_PYTHON=/absolute/path/to/python npm start 指定解释器。',
  ].join(' '));
}

async function canRun(candidate) {
  if (candidate.includes(path.sep)) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const result = await runPython(candidate, ['--version'], { timeoutMs: 10_000 }).catch(() => null);
  return Boolean(result && result.code === 0);
}

function runPython(pythonBin, args, { timeoutMs = PYTHON_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { cwd: __dirname });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      child.kill('SIGTERM');
      reject(new Error(`Python inpaint timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (error) => {
      finished = true;
      clearTimeout(timer);
      reject(new Error(`failed to start python (${pythonBin}): ${error.message}`));
    });
    child.on('close', (code) => {
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function formatPythonError(raw) {
  const text = String(raw || '').trim();
  const singleLine = text.replace(/\s+/g, ' ').trim();

  if (!singleLine) {
    return 'Python inpaint failed with empty error output';
  }

  if (/No module named 'cv2'|No module named cv2|ModuleNotFoundError: .*cv2|missing python dependency: opencv-python-headless/i.test(singleLine)) {
    return `${singleLine}。请进入项目目录创建 .venv 并执行: python -m pip install -r requirements.txt`;
  }

  if (/mask is empty after thresholding/i.test(singleLine)) {
    return 'mask 为空或阈值化后没有白色区域；请确认蒙版里白色部分就是要去除的水印区域';
  }

  if (/failed to read input image|input image not found/i.test(singleLine)) {
    return '服务端读取原图失败；请确认上传的是可正常打开的图片文件';
  }

  if (/failed to read mask image|mask image not found/i.test(singleLine)) {
    return '服务端读取蒙版失败；请确认上传的是可正常打开的蒙版图片';
  }

  if (/unsupported format/i.test(singleLine)) {
    return '输出格式不支持；仅支持 jpg / jpeg / png / webp';
  }

  if (/timed out/i.test(singleLine)) {
    return `Telea 修复超时（>${PYTHON_TIMEOUT_MS}ms）；可稍后重试，或减小图片尺寸/蒙版面积`;
  }

  return singleLine;
}

function formatServerError(error) {
  const message = String(error?.message || 'server error').trim();
  if (/Python runtime not found/.test(message)) {
    return message;
  }
  if (/timed out/i.test(message)) {
    return `Telea 修复超时（>${PYTHON_TIMEOUT_MS}ms）；可稍后重试，或减小图片尺寸/蒙版面积`;
  }
  return message;
}
