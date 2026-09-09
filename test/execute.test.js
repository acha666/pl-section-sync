import { RequestError } from '../dist/src/core/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, operations } from '../dist/src/sync/execute.js';
import { createPlan } from '../dist/src/core/plan.js';
import { matchStudents } from '../dist/src/core/match.js';
import { snapshot, fakeClient } from './fixtures.js';
const g = { records: [{ id: '10', sis: '001', name: 'One', section: 'New' }], issues: [] };
const mapping = new Map([['New', ['New']]]);
function setup() {
  const s = snapshot(),
    client = fakeClient(s),
    matching = matchStudents(g, s.roster);
  return { s, client, matching, plan: createPlan(s, matching, mapping) };
}
test('complete sync orders creates, adds, removes, deletes and is idempotent', async () => {
  const { s, client, matching, plan } = setup();
  const result = await execute(client, s, plan);
  assert.deepEqual(
    client.calls.map((c) => c.method),
    ['upsert', 'batchAdd', 'batchRemove', 'destroy'],
  );
  assert.equal(Object.hasOwn(client.calls[0].input, 'labelId'), false);
  assert.equal(createPlan(result, matching, mapping).changes.length, 0);
  assert.deepEqual(result.labels.find((l) => l.id === '12').members, ['1']);
});
test('stale roster or membership prevents any write', async () => {
  for (const change of [
    (s) => {
      s.roster[0].uin = 'changed';
    },
    (s) => {
      s.labels[0].members = [];
    },
  ]) {
    const { s, client, plan } = setup();
    change(client.state);
    await assert.rejects(execute(client, s, plan), /out of date/);
    assert.equal(client.calls.length, 0);
  }
});
test('successful write with lost response is verified without retry', async () => {
  const { s, client, plan } = setup();
  const mutate = client.mutate;
  client.mutate = async (...args) => {
    const result = await mutate(...args);
    if (args[0].method === 'upsert') throw new RequestError('Timed out', true);
    return result;
  };
  await execute(client, s, plan);
  assert.equal(client.calls.filter((c) => c.method === 'upsert').length, 1);
});
test('failed uncertain write stops without blind retry or later deletion', async () => {
  const { s, client, plan } = setup();
  let calls = 0;
  client.mutate = async () => {
    calls++;
    throw new RequestError('Timed out', true);
  };
  await assert.rejects(execute(client, s, plan), /Timed out/);
  assert.equal(calls, 1);
});
test('concurrent unrelated changes after a write are detected', async () => {
  const { s, client, plan } = setup();
  const mutate = client.mutate;
  client.mutate = async (...args) => {
    const result = await mutate(...args);
    client.state.labels[1].members = [];
    return result;
  };
  await assert.rejects(execute(client, s, plan), /differs/);
  assert.equal(client.calls.length, 1);
});
test('partial batch response stops before destructive cleanup', async () => {
  const { s, client, plan } = setup();
  const mutate = client.mutate;
  client.mutate = async (...args) => {
    const result = await mutate(...args);
    return args[0].method === 'batchAdd' ? { ...result, notFound: 1 } : result;
  };
  await assert.rejects(execute(client, s, plan), /account/);
  assert.equal(
    client.calls.some((c) => c.method === 'destroy'),
    false,
  );
});
test('cancel stops between operations; a fresh plan resumes from actual state', async () => {
  const { s, client, plan, matching } = setup();
  const controller = new AbortController();
  await assert.rejects(
    execute(client, s, plan, {
      signal: controller.signal,
      onProgress: async (p) => {
        if (p.phase === 'verified') controller.abort(new Error('Stopped'));
      },
    }),
    /Stopped/,
  );
  assert.equal(client.calls.length, 1);
  const next = await client.read();
  const remaining = createPlan(next, matching, mapping);
  assert.equal(remaining.summary.create, 0);
  await execute(client, next, remaining);
  assert.equal(createPlan(await client.read(), matching, mapping).changes.length, 0);
});
test('large membership sets are chunked and removals precede deletes', () => {
  const ops = operations({
    changes: [
      {
        key: 'section a',
        name: 'section A',
        create: false,
        destroy: true,
        add: [],
        remove: Array.from({ length: 1001 }, (_, i) => String(i)),
      },
    ],
  });
  assert.deepEqual(
    ops.filter((o) => o.type === 'remove').map((o) => o.ids.length),
    [500, 500, 1],
  );
  assert.equal(ops.at(-1).type, 'destroy');
});

test('cancellation while recording progress prevents the next write', async () => {
  const { s, client, plan } = setup();
  const controller = new AbortController();
  await assert.rejects(
    execute(client, s, plan, {
      signal: controller.signal,
      onProgress: async (event) => {
        if (event.phase === 'sending') controller.abort(new Error('Stopped'));
      },
    }),
    /Stopped/,
  );
  assert.equal(client.calls.length, 0);
});
