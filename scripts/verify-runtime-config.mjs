import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const runtimeConfigPath = path.join(rootDir, 'public', 'runtime-config.js');

const source = await fs.readFile(runtimeConfigPath, 'utf8');
const match = source.match(/apiBaseUrl:\s*("(?:[^"\\]|\\.)*")/);

if (!match) {
  console.error(`[verify-runtime-config] apiBaseUrl not found in ${runtimeConfigPath}`);
  process.exit(1);
}

const apiBaseUrl = JSON.parse(match[1]);
console.log(`[verify-runtime-config] apiBaseUrl=${apiBaseUrl || '(same-origin)'}`);
