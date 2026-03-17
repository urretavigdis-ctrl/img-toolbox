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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, algo: 'telea', python: 'required' });
});

app.post('/api/inpaint', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]), async (req, res) => {
  const image = req.files?.image?.[0];
  const mask = req.files?.mask?.[0];
  const format = normalizeFormat(req.body?.format);

  if (!image || !mask) {
    return res.status(400).json({ error: 'image and mask are required' });
  }

  if (!format) {
    return res.status(400).json({ error: 'format must be one of: jpeg, png, webp' });
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imgexe-inpaint-'));
  const inputPath = path.join(tempDir, `input${pickExtension(image.mimetype, image.originalname)}`);
  const maskPath = path.join(tempDir, 'mask.png');
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
    ]);

    if (py.code !== 0) {
      const stderr = (py.stderr || '').trim() || 'inpaint failed';
      const dependencyHint = /No module named 'cv2'|No module named cv2|ModuleNotFoundError: .*cv2/.test(stderr)
        ? ' Python 缺少 OpenCV。请按 README 用项目 venv 安装依赖。'
        : '';
      return res.status(500).json({ error: `${stderr}${dependencyHint}`.trim() });
    }

    const out = await fs.readFile(outputPath);
    res.setHeader('Content-Type', MIME_BY_FORMAT[format]);
    res.setHeader('X-Inpaint-Algo', 'telea');
    res.send(out);
  } catch (error) {
    const message = error?.message || 'server error';
    const status = /Python runtime not found/.test(message) ? 500 : 500;
    res.status(status).json({ error: message });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
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
    'python3 -m venv .venv',
    'source .venv/bin/activate',
    'python -m pip install -U pip',
    'python -m pip install -r requirements.txt',
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

  const result = await runPython(candidate, ['--version']).catch(() => null);
  return Boolean(result && result.code === 0);
}

function runPython(pythonBin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { cwd: __dirname });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (error) => {
      reject(new Error(`failed to start python (${pythonBin}): ${error.message}`));
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
