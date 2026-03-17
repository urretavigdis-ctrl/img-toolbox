import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.join(rootDir, 'public', 'runtime-config.js');

const rawApiBaseUrl = String(process.env.IMGEXE_API_BASE_URL || '').trim();
const strictRuntimeConfig = shouldRequireApiBaseUrl();
const apiBaseUrl = normalizeApiBaseUrl(rawApiBaseUrl);

if (strictRuntimeConfig && !apiBaseUrl) {
  console.error('[prepare-frontend] IMGEXE_API_BASE_URL is required for this build but is empty.');
  console.error('[prepare-frontend] Set it to your Render backend origin, for example: https://your-render-service.onrender.com');
  process.exit(1);
}

const content = `window.IMGEXE_RUNTIME_CONFIG = {\n  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},\n};\n`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, content, 'utf8');
console.log(`[prepare-frontend] wrote ${outputPath} with apiBaseUrl=${apiBaseUrl || '(same-origin)'}`);

function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let normalized;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('protocol must be http or https');
    }
    url.hash = '';
    url.search = '';
    normalized = url.toString();
  } catch (error) {
    console.error(`[prepare-frontend] invalid IMGEXE_API_BASE_URL: ${raw}`);
    console.error(`[prepare-frontend] ${error.message}`);
    process.exit(1);
  }

  return normalized.replace(/\/$/, '');
}

function shouldRequireApiBaseUrl() {
  const explicit = String(process.env.IMGEXE_STRICT_RUNTIME_CONFIG || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(explicit)) return true;
  if (['0', 'false', 'no', 'off'].includes(explicit)) return false;

  return process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
}
