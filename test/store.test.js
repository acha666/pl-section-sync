import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { upload } from '../scripts/store-upload.mjs';
const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: '1.0.0' })) });
const env = Object.fromEntries(
  ['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_ACCESS_TOKEN'].map((key) => [key, 'synthetic']),
);
function requestSequence(results) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      const result = results.shift();
      return result instanceof Response ? result : Response.json(result);
    },
  };
}
test('store waits for upload success before submitting once with warnings blocked', async () => {
  for (const uploadState of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) {
    const mock = requestSequence([
      { uploadState },
      { lastAsyncUploadState: 'SUCCEEDED' },
      { state: 'PENDING_REVIEW' },
    ]);
    assert.equal(
      await upload({ version: '1.0.0', zip, env, ...mock, wait: async () => {} }),
      'PENDING_REVIEW',
    );
    assert.equal(mock.calls.length, 3);
    assert.ok(mock.calls[0].url.endsWith(':upload'));
    assert.ok(mock.calls[1].url.endsWith(':fetchStatus'));
    for (const call of mock.calls)
      assert.equal(call.options.headers.Authorization, 'Bearer synthetic');
    assert.ok(mock.calls[2].url.endsWith(':publish'));
    assert.equal(mock.calls[2].options.method, 'POST');
    assert.deepEqual(JSON.parse(mock.calls[2].options.body), {
      publishType: 'DEFAULT_PUBLISH',
      blockOnWarnings: true,
    });
  }
});
test('store rejects mismatched asset version before any request', async () => {
  const mock = requestSequence([]);
  await assert.rejects(upload({ version: '2.0.0', zip, env, ...mock }), /mismatch/);
  assert.equal(mock.calls.length, 0);
});
test('store rejects a missing access token before any request', async () => {
  const mock = requestSequence([]);
  await assert.rejects(
    upload({ version: '1.0.0', zip, env: { ...env, CWS_ACCESS_TOKEN: '' }, ...mock }),
    /Missing CWS_ACCESS_TOKEN/,
  );
  assert.equal(mock.calls.length, 0);
});
test('store failure and poll timeout do not retry writes', async () => {
  for (const state of ['FAILED', 'IN_PROGRESS', 'UNKNOWN', undefined]) {
    const mock = requestSequence([
      { uploadState: state },
      ...Array.from({ length: 30 }, () => ({ lastAsyncUploadState: state })),
    ]);
    await assert.rejects(
      upload({ version: '1.0.0', zip, env, ...mock, wait: async () => {} }),
      /did not succeed/,
    );
    assert.equal(mock.calls.filter((call) => call.url.endsWith(':upload')).length, 1);
    assert.equal(
      mock.calls.some((call) => call.url.endsWith(':publish')),
      false,
    );
  }
});
test('store submits immediately completed uploads without polling', async () => {
  for (const state of ['PENDING_REVIEW', 'PUBLISHED', 'PUBLISHED_TO_TESTERS']) {
    const mock = requestSequence([{ uploadState: 'SUCCEEDED', crxVersion: '1.0.0' }, { state }]);
    assert.equal(await upload({ version: '1.0.0', zip, env, ...mock }), state);
    assert.equal(mock.calls.length, 2);
    assert.ok(mock.calls[1].url.endsWith(':publish'));
  }
});
test('store rejects a server version mismatch without submitting', async () => {
  const mock = requestSequence([{ uploadState: 'SUCCEEDED', crxVersion: '2.0.0' }]);
  await assert.rejects(upload({ version: '1.0.0', zip, env, ...mock }), /version mismatch/);
  assert.equal(mock.calls.length, 1);
});
test('store does not retry rejected or uncertain submissions', async () => {
  for (const result of [
    Response.json({ error: { message: 'Validation warnings' } }, { status: 400 }),
    { state: 'REJECTED' },
    {},
  ]) {
    const mock = requestSequence([{ uploadState: 'SUCCEEDED' }, result]);
    await assert.rejects(upload({ version: '1.0.0', zip, env, ...mock }), /Check the dashboard/);
    assert.equal(mock.calls.length, 2);
  }
});
test('store does not retry a submission after a network timeout', async () => {
  const mock = requestSequence([{ uploadState: 'SUCCEEDED' }]);
  let submissions = 0;
  await assert.rejects(
    upload({
      version: '1.0.0',
      zip,
      env,
      request: async (url, options) => {
        if (url.endsWith(':publish')) {
          submissions++;
          throw new Error('Request timed out');
        }
        return mock.request(url, options);
      },
    }),
    /timed out/,
  );
  assert.equal(submissions, 1);
});
