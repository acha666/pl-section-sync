import type { Gradebook, GradebookRecord, MatchResult, Student } from './types.js';
export function matchStudents(gradebook: Gradebook, roster: Student[]): MatchResult {
  const byUin = new Map<string, Student[]>(),
    byCanvas = new Map<string, GradebookRecord & { sections: Set<string> }>(),
    owners = new Map<string, string>();
  const errors: string[] = [],
    issues = [...gradebook.issues],
    matches: MatchResult['matches'] = [];
  for (const s of roster) {
    if (s.uin) byUin.set(s.uin, [...(byUin.get(s.uin) ?? []), s]);
  }
  for (const r of gradebook.records) {
    const previous = byCanvas.get(r.id);
    if (previous && previous.sis !== r.sis)
      errors.push(`Canvas ID ${r.id} has conflicting SIS Login IDs.`);
    if (r.sis && owners.has(r.sis) && owners.get(r.sis) !== r.id)
      errors.push(`SIS Login ID ${r.sis} belongs to multiple Canvas students.`);
    if (r.sis) owners.set(r.sis, r.id);
    byCanvas.set(r.id, { ...r, sections: new Set([...(previous?.sections ?? []), r.section]) });
  }
  for (const r of byCanvas.values()) {
    if (!r.sis) {
      issues.push(`${r.name}: missing SIS Login ID.`);
      continue;
    }
    const found = byUin.get(r.sis) ?? [];
    if (found.length > 1) {
      errors.push(`${r.sis}: multiple PrairieLearn enrollments have this UIN.`);
      continue;
    }
    if (!found.length) {
      issues.push(`${r.name} (${r.sis}): not found in PrairieLearn.`);
      continue;
    }
    if (found[0]!.status !== 'joined') {
      issues.push(`${r.name}: enrollment is ${found[0]!.status}; preserved.`);
      continue;
    }
    if (r.sections.has('')) {
      issues.push(`${r.name}: missing Section; preserved.`);
      continue;
    }
    matches.push({ student: found[0]!, sections: [...r.sections] });
  }
  if (!matches.length) errors.push('No eligible students matched. No changes can be applied.');
  return { matches, errors: [...new Set(errors)], issues, total: byCanvas.size };
}
