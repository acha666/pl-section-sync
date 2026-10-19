import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller, capabilities } from '../dist/src/ui/controller.js';
import { parseTarget } from '../dist/src/pl/parse.js';
import { fakeClient, snapshot } from './fixtures.js';
const context = {
  tabId: 1,
  origin: 'https://example.invalid',
  base: '/pl/course_instance/123/instructor',
  courseId: '123',
};
const target = (nonce = 'a') => ({ windowId: 1, nonce, context });
const file = (section = 'New') => ({
  name: 'test.csv',
  size: 100,
  text: async () => `Student,ID,SIS Login ID,Section\nOne,10,001,${section}`,
});
function setup(overrides = {}) {
  const client = fakeClient(snapshot()),
    journal = new Map();
  const controller = new Controller(
    {
      client: () => client,
      storage: {
        get: async (key) => ({ [key]: journal.get(key) }),
        set: async (items) => {
          for (const [key, value] of Object.entries(items)) journal.set(key, value);
        },
        remove: async (key) => journal.delete(key),
      },
      lock: async (task) => {
        await task();
        return true;
      },
      ...overrides,
    },
    () => {},
  );
  return { controller, client, journal };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function preview(controller) {
  await controller.accept(target());
  await controller.importCsv(file());
  controller.preview();
}

test('editing invalidates preview and deletion approval', async () => {
  const { controller } = setup();
  await preview(controller);
  assert.equal(capabilities(controller.state).apply, false);
  controller.approve(true);
  assert.equal(capabilities(controller.state).apply, true);
  controller.edit('New', 'Edited');
  assert.equal(controller.state.plan, undefined);
  assert.equal(controller.state.approved, false);
  controller.preview();
  assert.ok(controller.state.plan.changes.some((c) => c.name === 'Section Edited'));
});
test('successful execution requires a new import and clears recovery marker', async () => {
  const { controller, journal } = setup();
  await preview(controller);
  controller.approve(true);
  await controller.apply();
  assert.equal(controller.state.phase, 'reload');
  assert.equal(journal.size, 0);
  assert.equal(capabilities(controller.state).preview, false);
  assert.equal(capabilities(controller.state).csv, false);
  assert.equal(capabilities(controller.state).refresh, true);
});
test('failed execution keeps journal and disables stale preview', async () => {
  const { controller, client, journal } = setup();
  await preview(controller);
  controller.approve(true);
  client.mutate = async () => {
    throw new Error('Denied');
  };
  await controller.apply();
  assert.equal(controller.state.phase, 'reload');
  assert.equal(journal.size, 1);
  assert.equal(capabilities(controller.state).apply, false);
  assert.match(controller.state.notice, /Denied/);
  await controller.refresh();
  assert.match(controller.state.notice, /interrupted after 0 of 4 operations/);
  assert.equal(controller.state.error, true);
});
test('read-only accounts can preview but cannot apply even after approval', async () => {
  const client = fakeClient({ ...snapshot(), canEdit: false });
  const { controller } = setup({ client: () => client });
  await preview(controller);
  controller.approve(true);
  assert.equal(capabilities(controller.state).apply, false);
  await controller.apply();
  assert.equal(client.calls.length, 0);
});
test('stale CSV success and error cannot replace a later course import', async () => {
  for (const reject of [false, true]) {
    const { controller } = setup();
    await controller.accept(target());
    const pending = deferred();
    const importing = controller.importCsv({ ...file(), text: () => pending.promise });
    await controller.accept(target('b'));
    if (reject) pending.reject(new Error('Old file failed'));
    else pending.resolve(await file().text());
    await importing;
    assert.equal(controller.state.phase, 'ready');
    assert.equal(controller.state.matching, undefined);
    assert.equal(controller.state.error, false);
  }
});
test('newer CSV wins when file reads finish out of order', async () => {
  const { controller } = setup();
  await controller.accept(target());
  const pending = deferred();
  const first = controller.importCsv({ ...file(), text: () => pending.promise });
  await controller.importCsv(file('Latest'));
  pending.resolve(await file('Old').text());
  await first;
  assert.deepEqual([...controller.state.mapping.keys()], ['Latest']);
});
test('newer course wins when roster reads finish out of order', async () => {
  const pending = deferred();
  let count = 0;
  const { controller } = setup({
    client: () => ({
      read: () =>
        ++count === 1 ? pending.promise : Promise.resolve({ ...snapshot(), title: 'Latest' }),
    }),
  });
  const first = controller.accept(target());
  await controller.accept(target('b'));
  pending.resolve({ ...snapshot(), title: 'Old' });
  await first;
  assert.equal(controller.state.session.snapshot.title, 'Latest');
});
test('course stays fixed while acquiring the lock, and lock refusal preserves preview', async () => {
  const pending = deferred();
  const { controller } = setup({ lock: () => pending.promise });
  await preview(controller);
  controller.approve(true);
  const running = controller.apply();
  await controller.accept({ ...target('b'), context: { ...context, tabId: 2 } });
  assert.equal(controller.state.session.context.tabId, 1);
  pending.resolve(false);
  await running;
  assert.equal(controller.state.phase, 'preview');
  assert.equal(capabilities(controller.state).apply, true);
});
test('target validation rejects wrong window and malformed course context', () => {
  assert.deepEqual(parseTarget(target(), 1), target());
  assert.throws(() => parseTarget(target(), 2));
  assert.throws(() =>
    parseTarget({ ...target(), context: { ...context, origin: 'javascript:alert(1)' } }, 1),
  );
  assert.throws(() => parseTarget({ ...target(), context: { ...context, courseId: '456' } }, 1));
  assert.throws(() =>
    parseTarget(
      { ...target(), context: { ...context, base: '/pl/../course_instance/123/instructor' } },
      1,
    ),
  );
});
test('clicking the icon on an unrelated tab keeps the loaded course and work', async () => {
  const { controller } = setup();
  await preview(controller);
  const plan = controller.state.plan;
  await controller.accept({ windowId: 1, nonce: 'other', error: 'Open a PrairieLearn page.' });
  assert.equal(controller.state.phase, 'preview');
  assert.equal(controller.state.plan, plan);
  assert.match(controller.state.notice, /Still using Example course/);
  const fresh = setup().controller;
  await fresh.accept({ windowId: 1, nonce: 'other', error: 'Open a PrairieLearn page.' });
  assert.equal(fresh.state.phase, 'empty');
});
test('a failed CSV import clears the file name so the same file can be chosen again', async () => {
  const { controller } = setup();
  await controller.accept(target());
  await controller.importCsv({ ...file(), text: async () => 'ID,Section\n1,A' });
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.filename, '');
  assert.match(controller.state.notice, /Missing CSV column/);
});

test('regex replacement preserves invalid input, deduplicates, and invalidates approval', async () => {
  const { controller } = setup();
  await preview(controller);
  controller.approve(true);
  const plan = controller.state.plan;
  controller.replaceLabels('[', '');
  assert.equal(controller.state.error, true);
  assert.equal(controller.state.plan, plan);
  assert.deepEqual(controller.state.mapping.get('New'), ['New']);
  controller.replaceLabels('', '');
  assert.equal(controller.state.error, true);
  controller.edit('New', 'A1\nA2\nOther');
  controller.preview();
  controller.approve(true);
  controller.replaceLabels('A\\d', ' Same ');
  assert.deepEqual(controller.state.mapping.get('New'), ['Same', 'Other']);
  assert.equal(controller.state.plan, undefined);
  assert.equal(controller.state.approved, false);
  assert.equal(controller.state.error, false);
  controller.replaceLabels('^Same$', '');
  assert.deepEqual(controller.state.mapping.get('New'), ['Other']);
  controller.replaceLabels('^', 'x');
  assert.deepEqual(controller.state.mapping.get('New'), ['xOther']);
});
test('mapping edits produce a new mapping instead of mutating the previous one', async () => {
  const { controller } = setup();
  await preview(controller);
  const before = controller.state.mapping;
  controller.edit('New', ' A \n\nA\nB ');
  assert.notEqual(controller.state.mapping, before);
  assert.deepEqual(before.get('New'), ['New']);
  assert.deepEqual(controller.state.mapping.get('New'), ['A', 'B']);
});
