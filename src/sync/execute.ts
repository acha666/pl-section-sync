import type { Client, Mutation, Operation, Plan, Progress, Snapshot } from '../core/types.js';
import {
  fingerprint,
  key,
  requireValue,
  sorted,
  object,
  message,
  RequestError,
} from '../core/model.js';

export function operations(plan: Pick<Plan, 'changes'>): Operation[] {
  const changes = plan.changes;
  const chunks = (ids: string[]) =>
    Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) =>
      ids.slice(i * 500, i * 500 + 500),
    );
  return [
    ...changes
      .filter((c) => c.create)
      .map((c) => ({ type: 'create' as const, key: c.key, name: c.name })),
    ...(['add', 'remove'] as const).flatMap((type) =>
      changes.flatMap((c) =>
        chunks(c[type]).map((ids) => ({ type, key: c.key, name: c.name, ids })),
      ),
    ),
    ...changes
      .filter((c) => c.destroy)
      .map((c) => ({ type: 'destroy' as const, key: c.key, name: c.name })),
  ];
}
function expectedAfter(before: Snapshot, after: Snapshot, op: Operation) {
  const expected = structuredClone(before);
  const l = expected.labels.find((l) => key(l.name) === op.key);
  if (op.type === 'create') {
    const created = after.labels.find((l) => key(l.name) === op.key);
    requireValue(
      !l &&
        created &&
        created.name === op.name &&
        created.color === 'blue1' &&
        !created.members.length,
      'Created label could not be verified.',
    );
    expected.labels.push(created);
  } else {
    requireValue(l, 'The label no longer exists.');
    if (op.type === 'destroy') {
      requireValue(!l.members.length, 'Only empty labels can be deleted.');
      expected.labels = expected.labels.filter((x) => x.id !== l.id);
    } else {
      const members = new Set(l.members);
      for (const id of op.ids)
        if (op.type === 'add') members.add(id);
        else members.delete(id);
      l.members = sorted(members);
    }
  }
  if (op.type === 'create' || op.type === 'destroy') expected.hash = after.hash;
  requireValue(
    fingerprint(expected) === fingerprint(after),
    'Server state differs from the expected change. Some work may be complete. Import again to review the remaining differences.',
  );
}
function checkResult(value: unknown, op: Operation) {
  const result = object(value);
  if (op.type === 'create' || op.type === 'destroy') {
    requireValue(
      typeof result.origHash === 'string' && !result.enrollmentWarning,
      'PrairieLearn returned a definition warning or an unsupported result.',
    );
  } else {
    const changed = op.type === 'add' ? 'added' : 'removed';
    const unchanged = op.type === 'add' ? 'alreadyHaveLabel' : 'didNotHaveLabel';
    requireValue(
      [changed, unchanged, 'notFound'].every(
        (k) => typeof result[k] === 'number' && Number.isInteger(result[k]) && result[k] >= 0,
      ) &&
        result.notFound === 0 &&
        typeof result[changed] === 'number' &&
        typeof result[unchanged] === 'number' &&
        result[changed] + result[unchanged] === op.ids.length,
      'PrairieLearn did not account for every requested student.',
    );
  }
}
/** Serial writes; every mutation is followed by a complete state check. No blind retries. */
export async function execute(
  client: Client,
  baseline: Snapshot,
  plan: Plan,
  {
    signal,
    onProgress = () => {},
  }: { signal?: AbortSignal; onProgress?: (event: Progress) => void | Promise<void> } = {},
): Promise<Snapshot> {
  let expected = baseline;
  const queue = operations(plan);
  for (const [index, op] of queue.entries()) {
    signal?.throwIfAborted();
    const before = await client.read();
    requireValue(before.canEdit, 'Edit access is no longer available.');
    requireValue(
      fingerprint(before) === fingerprint(expected),
      'The preview is out of date. Import again and review a new preview.',
    );
    const label = before.labels.find((l) => key(l.name) === op.key);
    let command: Mutation;
    if (op.type === 'create') {
      command = {
        method: 'upsert',
        input: { name: op.name, color: 'blue1', uids: [], origHash: before.hash },
      };
    } else if (op.type === 'destroy') {
      requireValue(label && !label.members.length, 'The label is no longer empty.');
      command = { method: 'destroy', input: { labelId: label.id, origHash: before.hash } };
    } else {
      requireValue(label, 'The label is missing.');
      command = {
        method: op.type === 'add' ? 'batchAdd' : 'batchRemove',
        input: { labelId: label.id, enrollmentIds: op.ids },
      };
    }
    signal?.throwIfAborted();
    await onProgress({
      phase: 'sending',
      index,
      total: queue.length,
      type: op.type,
      name: op.name,
    });
    signal?.throwIfAborted();
    let result: unknown, failure: unknown;
    try {
      result = await client.mutate(command);
    } catch (error) {
      failure = error;
    }
    // A lost response can follow a successful write. Read once, without resending.
    const after = await client.read();
    if (failure && !(failure instanceof RequestError && failure.uncertain)) throw failure;
    try {
      expectedAfter(before, after, op);
    } catch (error) {
      throw new Error(`${failure ? `${message(failure)} ` : ''}${message(error)}`, {
        cause: error,
      });
    }
    if (!failure) checkResult(result, op);
    expected = after;
    await onProgress({
      phase: 'verified',
      index: index + 1,
      total: queue.length,
      type: op.type,
      name: op.name,
    });
  }
  const final = await client.read();
  requireValue(
    fingerprint(final) === fingerprint(expected),
    'State changed during final verification. Import again.',
  );
  return final;
}
