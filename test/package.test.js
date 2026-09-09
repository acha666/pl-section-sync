import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';

test('package includes only extension files and has reproducible bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pl-package-'));
  try {
    await cp('dist', join(directory, 'dist'), { recursive: true });
    await cp('package.json', join(directory, 'package.json'));
    await writeFile(join(directory, 'students.csv'), 'synthetic private data');
    await writeFile(join(directory, '.env'), 'SYNTHETIC_SECRET=example');
    const script = resolve('scripts/package.mjs');
    execFileSync(process.execPath, [script], { cwd: directory });
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    const path = join(directory, `release/pl-section-sync-${version}.zip`);
    const first = await readFile(path),
      files = unzipSync(first);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.equal(manifest.version, version);
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'sidePanel', 'storage']);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.ok(files[manifest.background.service_worker]);
    assert.ok(files[manifest.side_panel.default_path]);
    assert.ok(
      Object.keys(files).every((path) =>
        /^(src\/.*\.js|icons\/\d+\.png|panel\.(html|css)|manifest\.json)$/.test(path),
      ),
    );
    execFileSync(process.execPath, [script], { cwd: directory });
    assert.deepEqual(await readFile(path), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release notes require matching tag and dated changelog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pl-release-'));
  try {
    await mkdir(join(directory, 'release'));
    await writeFile(join(directory, 'package.json'), '{"version":"1.0.0"}');
    await writeFile(
      join(directory, 'CHANGELOG.md'),
      '# Changelog\n\n## Unreleased\n\n## 1.0.0 (2026-09-08)\n\n- Initial release.\n',
    );
    const script = resolve('scripts/release.mjs');
    execFileSync(process.execPath, [script], {
      cwd: directory,
      env: { ...process.env, RELEASE_TAG: 'v1.0.0' },
    });
    assert.equal(
      await readFile(join(directory, 'release/notes.md'), 'utf8'),
      '- Initial release.\n',
    );
    assert.throws(() =>
      execFileSync(process.execPath, [script], {
        cwd: directory,
        env: { ...process.env, RELEASE_TAG: 'v2.0.0' },
        stdio: 'pipe',
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
