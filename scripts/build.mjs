import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  version.split('.').some((n) => Number(n) > 65535 || String(Number(n)) !== n) ||
  version === '0.0.0'
)
  throw new Error('Invalid Chrome version.');
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
manifest.version = version;
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
console.log(`Built extension ${version} in dist/.`);
