import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

export async function upload({
  version,
  zip,
  env = process.env,
  request = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  const manifestBytes = unzipSync(zip, { filter: (entry) => entry.name === 'manifest.json' })[
    'manifest.json'
  ];
  if (!manifestBytes || JSON.parse(strFromU8(manifestBytes)).version !== version)
    throw new Error('Release ZIP version mismatch.');
  const required = (name) => {
    if (!env[name]) throw new Error(`Missing ${name}.`);
    return env[name];
  };
  const publisher = encodeURIComponent(required('CWS_PUBLISHER_ID')),
    item = encodeURIComponent(required('CWS_EXTENSION_ID'));
  async function json(url, options) {
    const response = await request(url, { ...options, signal: AbortSignal.timeout(120000) });
    if (!response.ok)
      throw new Error(
        `Chrome Web Store request failed: HTTP ${response.status}. Check the dashboard before retrying.`,
      );
    return response.json();
  }
  const headers = { Authorization: `Bearer ${required('CWS_ACCESS_TOKEN')}` };
  const name = `publishers/${publisher}/items/${item}`;
  const result = await json(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/zip' },
    body: zip,
  });
  if (result.crxVersion && result.crxVersion !== version)
    throw new Error('Uploaded version mismatch.');
  let state = result.uploadState;
  for (
    let attempt = 0;
    ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state) && attempt < 30;
    attempt++
  ) {
    await wait(10000);
    const status = await json(`https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`, {
      headers,
    });
    state = status.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED')
    throw new Error(
      `Upload did not succeed: ${state ?? 'unknown'}. Check the dashboard before retrying.`,
    );
  const submission = await json(`https://chromewebstore.googleapis.com/v2/${name}:publish`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true }),
  });
  if (!['PENDING_REVIEW', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(submission.state))
    throw new Error(
      `Unexpected submission state: ${submission.state ?? 'unknown'}. Check the dashboard before retrying.`,
    );
  return submission.state;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.env.RELEASE_VERSION;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  const state = await upload({
    version,
    zip: await readFile(`release/pl-section-sync-${version}.zip`),
  });
  console.log(
    `Submitted ${version}: ${state}. Check review and publication status in the Chrome Web Store dashboard.`,
  );
}
