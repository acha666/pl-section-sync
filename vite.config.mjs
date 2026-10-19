import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';

/** Emits manifest.json with the package version, which Chrome requires to be numeric. */
function manifest() {
  return {
    name: 'extension-manifest',
    apply: 'build',
    async generateBundle() {
      const { version } = JSON.parse(await readFile('package.json', 'utf8'));
      if (
        !/^\d+\.\d+\.\d+$/.test(version) ||
        version.split('.').some((n) => Number(n) > 65535 || String(Number(n)) !== n) ||
        version === '0.0.0'
      )
        throw new Error('Invalid Chrome version.');
      const source = JSON.parse(await readFile('src/manifest.json', 'utf8'));
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify({ ...source, version }, null, 2) + '\n',
      });
    },
  };
}
/** The development server shows the panel with synthetic data instead of extension APIs. */
function demo() {
  return {
    name: 'synthetic-demo',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/') return next();
        res.writeHead(302, { Location: '/panel.html' }).end();
      });
    },
    transformIndexHtml: () => [
      { tag: 'script', attrs: { type: 'module', src: '/scripts/demo.js' }, injectTo: 'head' },
    ],
  };
}
export default defineConfig({
  // Extension pages load files relative to the extension root.
  base: './',
  plugins: [manifest(), demo()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    target: 'chrome116',
    // Readable output for Chrome Web Store review; size is irrelevant for a local extension.
    minify: false,
    modulePreload: false,
    rolldownOptions: {
      input: { panel: 'panel.html', background: 'src/background.ts' },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  server: { port: 8080, strictPort: true },
  test: { include: ['test/*.test.js'] },
});
