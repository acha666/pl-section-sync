import type { Snapshot, MatchResult, Mapping, Plan, Label, Change } from './types.js';
import { LABEL_PREFIX, key, managed, sorted, requireValue } from './model.js';

export function createPlan(
  snapshot: Snapshot,
  matching: MatchResult,
  mapping: Mapping,
  { replace = false, cleanup = true } = {},
): Plan {
  requireValue(!matching.errors.length, matching.errors.join('\n'));
  requireValue(
    !replace || !matching.issues.length,
    'Resolve unidentified Canvas students before updating all joined students.',
  );
  const existing = new Map<string, Label>();
  for (const l of snapshot.labels.filter((l) => managed(l.name))) {
    requireValue(
      !existing.has(key(l.name)),
      `Conflicting managed label names: ${l.name}. Rename one in PrairieLearn.`,
    );
    existing.set(key(l.name), l);
  }
  const uins = new Map<string, number>();
  for (const student of snapshot.roster) uins.set(student.uin, (uins.get(student.uin) ?? 0) + 1);
  const preserved = new Set(matching.preserved),
    matched = new Set(matching.matches.map((m) => m.student.id));
  const scope = new Set(
    replace
      ? snapshot.roster
          .filter(
            (s) => s.status === 'joined' && s.uin && uins.get(s.uin) === 1 && !preserved.has(s.id),
          )
          .map((s) => s.id)
      : matched,
  );
  const labelled = new Set([...existing.values()].flatMap((l) => l.members));
  const desired = new Map<string, { name: string; members: Set<string> }>();
  for (const m of matching.matches)
    for (const section of m.sections) {
      requireValue(mapping.has(section), `Review the section mapping for ${section}.`);
      for (const suffix of mapping.get(section)!) {
        const name = `${LABEL_PREFIX}${suffix.trim()}`;
        requireValue(
          suffix.trim() && name.length <= 255 && !/\p{Cc}/u.test(name),
          'Label names must be 1–255 characters without control characters.',
        );
        const k = key(name);
        if (!desired.has(k)) desired.set(k, { name, members: new Set() });
        desired.get(k)!.members.add(m.student.id);
      }
    }
  const changes: Change[] = [];
  for (const k of sorted(new Set([...existing.keys(), ...desired.keys()]))) {
    const current = existing.get(k),
      want = desired.get(k);
    const members = new Set(current?.members ?? []);
    for (const id of scope) members.delete(id);
    for (const id of want?.members ?? []) members.add(id);
    const before = new Set(current?.members ?? []);
    const add = sorted([...members].filter((id) => !before.has(id)));
    const remove = sorted([...before].filter((id) => !members.has(id)));
    const create = !current && members.size > 0;
    const destroy = !!current && cleanup && members.size === 0 && !want;
    if (create || destroy || add.length || remove.length)
      changes.push({
        key: k,
        id: current?.id,
        name: current?.name ?? want!.name,
        create,
        destroy,
        add,
        remove,
        target: sorted(members),
      });
  }
  requireValue(
    snapshot.labels.length + changes.filter((c) => c.create).length <= 100,
    'The plan exceeds the 100-label limit before cleanup. Free label capacity in PrairieLearn first.',
  );
  return {
    changes,
    scope: scope.size,
    absent: sorted([...scope].filter((id) => !matched.has(id) && labelled.has(id))),
    summary: {
      create: changes.filter((c) => c.create).length,
      destroy: changes.filter((c) => c.destroy).length,
      add: changes.reduce((n, c) => n + c.add.length, 0),
      remove: changes.reduce((n, c) => n + c.remove.length, 0),
    },
  };
}
