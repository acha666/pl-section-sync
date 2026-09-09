import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pageRequest } from '../dist/src/pl/bridge.js';
import { createClient } from '../dist/src/pl/client.js';
const context = {
  origin: 'https://example.invalid',
  base: '/pl/course_instance/123/instructor',
  courseId: '123',
  tabId: 1,
};
const originals = {
  fetch: globalThis.fetch,
  DOMParser: globalThis.DOMParser,
  location: globalThis.location,
  chrome: globalThis.chrome,
};
afterEach(() => Object.assign(globalThis, originals));
function setup({ canEdit = true } = {}) {
  const requests = [];
  globalThis.location = {
    origin: context.origin,
    pathname: `${context.base}/instance_admin/students/labels`,
  };
  const props = {
    courseInstance: { id: '123', long_name: 'Term A' },
    course: { title: 'Example' },
    trpcCsrfToken: 'synthetic-token',
    authzData: {
      has_course_permission_edit: canEdit,
      has_course_instance_permission_edit: canEdit,
    },
  };
  globalThis.DOMParser = class {
    parseFromString() {
      return { querySelector: () => ({ textContent: JSON.stringify({ json: props }) }) };
    }
  };
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    if (path.endsWith('/students')) return new Response('<html>Mock student props</html>');
    if (path.endsWith('/data.json')) return Response.json([]);
    return Response.json({ result: { data: { json: { labels: [], origHash: 'h' } } } });
  };
  return { requests, props };
}
test('adapter reads the verified data.json path and tRPC envelope with fresh token', async () => {
  const { requests } = setup();
  const result = await pageRequest(context, { type: 'read' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.roster, []);
  assert.equal(requests.length, 3);
  assert.ok(requests.some((r) => r.path === `${context.base}/instance_admin/students/data.json`));
  assert.equal(
    requests.find((r) => r.path.includes('/trpc/')).options.headers['X-CSRF-Token'],
    'synthetic-token',
  );
  assert.equal(JSON.stringify(result).includes('synthetic-token'), false);
});
test('adapter encodes plain JSON with the SuperJSON envelope and sends no arbitrary URL', async () => {
  const { requests } = setup();
  const input = { name: 'section A', color: 'blue1', uids: [], origHash: 'h' };
  await pageRequest(context, { type: 'write', method: 'upsert', input });
  const request = requests.at(-1);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { json: input });
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.redirect, 'error');
});
test('adapter blocks navigation before reading or writing', async () => {
  const { requests } = setup();
  globalThis.location.pathname = '/other';
  const result = await pageRequest(context, { type: 'read' });
  assert.equal(result.ok, false);
  assert.equal(requests.length, 0);
});
test('adapter rechecks source location between fetching props and a write', async () => {
  const { requests } = setup();
  const fetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await fetch(...args);
    globalThis.location.pathname = '/other';
    return response;
  };
  const result = await pageRequest(context, {
    type: 'write',
    method: 'destroy',
    input: { labelId: '1', origHash: 'h' },
  });
  assert.equal(result.ok, false);
  assert.equal(requests.length, 1);
});
test('adapter blocks read-only writes, missing props, and tRPC error responses', async () => {
  const { requests } = setup({ canEdit: false });
  assert.equal(
    (await pageRequest(context, { type: 'write', method: 'destroy', input: {} })).ok,
    false,
  );
  assert.equal(requests.length, 1);
  setup();
  globalThis.DOMParser = class {
    parseFromString() {
      return { querySelector: () => null };
    }
  };
  assert.equal((await pageRequest(context, { type: 'read' })).ok, false);
  setup();
  const fetch = globalThis.fetch;
  globalThis.fetch = (path, options) =>
    path.includes('/trpc/')
      ? Promise.resolve(Response.json({ error: { json: { message: 'Conflict' } } }))
      : fetch(path, options);
  const result = await pageRequest(context, { type: 'read' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Conflict');
});
test('client pins subsequent requests to the original document ID', async () => {
  const calls = [];
  globalThis.chrome = {
    scripting: {
      executeScript: async (arg) => {
        calls.push(arg);
        return [
          {
            documentId: 'document-1',
            result: {
              ok: true,
              value: {
                roster: [],
                labels: { labels: [], origHash: 'h' },
                canEdit: true,
                title: 'Example',
              },
            },
          },
        ];
      },
    },
  };
  const client = createClient(context);
  await client.read();
  await client.read();
  assert.deepEqual(calls[0].target, { tabId: 1 });
  assert.deepEqual(calls[1].target, { tabId: 1, documentIds: ['document-1'] });
  assert.equal(calls[0].world, 'ISOLATED');
});
test('source document disappearance produces a recoverable failure', async () => {
  globalThis.chrome = {
    scripting: {
      executeScript: async () => {
        throw new Error('No document');
      },
    },
  };
  await assert.rejects(createClient(context).read(), /closed, navigated/);
});

test('compiled injected function runs without module scope', async () => {
  setup();
  const { runInNewContext } = await import('node:vm');
  const injected = runInNewContext(`(${pageRequest.toString()})`, {
    location: globalThis.location,
    fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser,
    AbortSignal,
  });
  const result = await injected(context, { type: 'read' });
  assert.equal(result.ok, true);
  assert.equal(result.value.title, 'Example · Term A');
});
