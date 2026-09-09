import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { upload } from '../scripts/store-upload.mjs';
const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: '1.0.0' })) });
const env = Object.fromEntries(
  [
    'CWS_PUBLISHER_ID',
    'CWS_EXTENSION_ID',
    'CWS_CLIENT_ID',
    'CWS_CLIENT_SECRET',
    'CWS_REFRESH_TOKEN',
  ].map((key) => [key, 'synthetic']),
);
function requestSequence(results) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      return Response.json(results.shift());
    },
  };
}
test('store uploads once, polls async status, and never publishes', async () => {
  for (const uploadState of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) {
    const mock = requestSequence([
      { access_token: 'synthetic-token' },
      { uploadState },
      { lastAsyncUploadState: 'SUCCEEDED' },
    ]);
    await upload({ version: '1.0.0', zip, env, ...mock, wait: async () => {} });
    assert.equal(mock.calls.length, 3);
    assert.ok(mock.calls[1].url.endsWith(':upload'));
    assert.ok(mock.calls[2].url.endsWith(':fetchStatus'));
    assert.equal(
      mock.calls.some((call) => call.url.endsWith(':publish')),
      false,
    );
  }
});
test('store rejects mismatched asset version before any request', async () => {
  const mock = requestSequence([]);
  await assert.rejects(upload({ version: '2.0.0', zip, env, ...mock }), /mismatch/);
  assert.equal(mock.calls.length, 0);
});
test('store failure and poll timeout do not retry writes', async () => {
  for (const state of ['FAILED', 'IN_PROGRESS']) {
    const mock = requestSequence([
      { access_token: 'synthetic-token' },
      { uploadState: state },
      ...Array.from({ length: 30 }, () => ({ lastAsyncUploadState: state })),
    ]);
    await assert.rejects(
      upload({ version: '1.0.0', zip, env, ...mock, wait: async () => {} }),
      /did not succeed/,
    );
    assert.equal(mock.calls.filter((call) => call.url.endsWith(':upload')).length, 1);
  }
});
