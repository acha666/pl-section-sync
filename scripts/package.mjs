import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { zipSync } from 'fflate';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (manifest.version !== version) throw new Error('Build version mismatch.');
const files = {};
async function collect(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(`${directory}/${entry.name}`, `${name}/`);
    else {
      if (!entry.isFile() || !/\.(js|html|css|json|png)$/.test(name))
        throw new Error(`Unexpected extension file: ${name}`);
      files[name] = new Uint8Array(await readFile(`${directory}/${entry.name}`));
    }
  }
}
await collect('dist');
for (const name of [
  'manifest.json',
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...Object.values(manifest.icons),
]) {
  if (!files[name]) throw new Error(`Missing extension file: ${name}`);
}
await mkdir('release', { recursive: true });
await writeFile(
  `release/pl-section-sync-${version}.zip`,
  zipSync(files, { level: 6, mtime: new Date('1980-01-01T00:00:00Z') }),
);
console.log(`Packaged extension ${version}.`);
