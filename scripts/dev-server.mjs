import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';

const build = () => execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
build();
if (!process.argv.includes('--no-watch')) {
  let timer;
  for (const root of ['src', 'public'])
    watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          build();
        } catch {
          console.error('Build failed. Fix the error and save again.');
        }
      }, 150);
    });
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file;
    if (pathname === '/' || pathname === '/panel.html') {
      const html = await readFile('dist/panel.html', 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.end(html.replace('src="src/panel.js"', 'src="scripts/demo.js"'));
      return;
    }
    if (pathname === '/scripts/demo.js') {
      const { version } = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
      res.setHeader('Content-Type', 'text/javascript');
      res.end(
        `window.demoVersion = ${JSON.stringify(version)};\n` +
          (await readFile('scripts/demo.js', 'utf8')),
      );
      return;
    }
    if (pathname === '/test/fixtures.js') file = resolve('test/fixtures.js');
    else {
      file = resolve('dist', pathname.slice(1));
      if (!file.startsWith(`${resolve('dist')}/`)) throw new Error('Invalid path');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.json': 'application/json',
      }[extname(file)] ?? 'text/plain',
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
server.listen(8080, '0.0.0.0', () =>
  console.log('Synthetic UI: http://localhost:8080 (reload after saving)'),
);
