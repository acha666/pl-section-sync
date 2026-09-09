import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fakeClient, snapshot } from '../fixtures.js';

test('installed extension injects the adapter and verifies writes in the source document', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'pl-extension-'));
  const extension = join(profile, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Local test permission replaces the toolbar gesture; the shipping manifest is unchanged.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const backend = fakeClient(snapshot());
    const source = await context.newPage();
    const base = '/pl/course_instance/123/instructor';
    await source.route('**/pl/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/students')) {
        const props = {
          courseInstance: { id: '123', long_name: 'Term A' },
          course: { title: 'Example course' },
          trpcCsrfToken: 'synthetic',
          authzData: {
            has_course_permission_edit: true,
            has_course_instance_permission_edit: true,
          },
        };
        await route.fulfill({
          contentType: 'text/html',
          body: `<script type="application/json" data-component="InstructorStudents" data-component-props>${JSON.stringify({ json: props })}</script>`,
        });
      } else if (url.pathname.endsWith('/data.json')) {
        await route.fulfill({
          json: backend.state.roster.map((s) => ({
            enrollment: { id: s.id, status: s.status, course_instance_id: '123' },
            user: s,
          })),
        });
      } else {
        const method = url.pathname.split('.').at(-1);
        const value =
          method === 'list'
            ? {
                origHash: backend.state.hash,
                labels: backend.state.labels.map((l) => ({
                  student_label: l,
                  user_data: l.members.map((id) => ({ enrollment_id: id, uid: 'synthetic' })),
                })),
              }
            : await backend.mutate({ method, input: route.request().postDataJSON().json });
        await route.fulfill({ json: { result: { data: { json: value } } } });
      }
    });
    await source.goto(`http://127.0.0.1:8080${base}/instance_admin/students`);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/panel.html`);
    const tab = await worker.evaluate(async () =>
      (await chrome.tabs.query({})).find((tab) => tab.url?.includes('/instance_admin/students')),
    );
    expect(tab).toBeTruthy();
    await worker.evaluate(
      async ({ tabId, windowId, base }) => {
        await chrome.storage.session.set({
          [`target:${windowId}`]: {
            windowId,
            nonce: 'installed-test',
            context: {
              tabId,
              origin: 'http://127.0.0.1:8080',
              base,
              courseId: '123',
            },
          },
        });
      },
      { tabId: tab.id, windowId: tab.windowId, base },
    );
    await expect(panel.locator('#course')).toHaveText('Example course · Term A');
    await panel.locator('#csv').setInputFiles({
      name: 'sample.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Student,ID,SIS Login ID,Section\nOne,10,001,New'),
    });
    await panel.locator('#preview').click();
    await panel.locator('#delete-confirm').check();
    await panel.locator('#apply').click();
    await expect(panel.locator('#notice')).toHaveText(
      'Changes verified. Refresh the PrairieLearn page.',
    );
    expect(backend.calls.map((call) => call.method)).toEqual([
      'upsert',
      'batchAdd',
      'batchRemove',
      'destroy',
    ]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
