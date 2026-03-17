import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.join(rootDir, 'public', 'runtime-config.js');
const apiBaseUrl = String(process.env.IMGEXE_API_BASE_URL || '').trim().replace(/\/$/, '');

const content = `window.IMGEXE_RUNTIME_CONFIG = {\n  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},\n};\n`;

await fs.writeFile(outputPath, content, 'utf8');
console.log(`[prepare-frontend] wrote ${outputPath} with apiBaseUrl=${apiBaseUrl || '(same-origin)'}`);
