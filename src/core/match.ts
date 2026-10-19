import type { Gradebook, GradebookRecord, MatchResult, Student } from './types.js';
/** Canvas Student View's test student, exported with its sortable or display name. */
const TEST_STUDENT = /^(student, test|test student)$/i;
export function matchStudents(gradebook: Gradebook, roster: Student[]): MatchResult {
  const byUin = new Map<string, Student[]>(),
    byCanvas = new Map<string, GradebookRecord & { sections: Set<string> }>(),
    owners = new Map<string, string>();
  const errors: string[] = [],
    issues = [...gradebook.issues],
    notes: string[] = [],
    preserved: string[] = [],
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
    const found = (r.sis && byUin.get(r.sis)) || [];
    // A record that matches an enrollment is a real student, whatever its name.
    if (!found.length && TEST_STUDENT.test(r.name)) {
      notes.push(`${r.name}: Canvas test student; ignored.`);
      continue;
    }
    if (!r.sis) {
      issues.push(`${r.name}: missing SIS Login ID.`);
      continue;
    }
    if (found.length > 1) {
      errors.push(`${r.sis}: multiple PrairieLearn enrollments have this UIN.`);
      continue;
    }
    // No enrollment has this UIN, so full replacement cannot clear anyone on its behalf.
    if (!found.length) {
      notes.push(`${r.name} (${r.sis}): not found in PrairieLearn.`);
      continue;
    }
    if (found[0]!.status !== 'joined') {
      notes.push(`${r.name}: enrollment is ${found[0]!.status}; preserved.`);
      continue;
    }
    if (r.sections.has('')) {
      notes.push(`${r.name}: missing Section; preserved.`);
      preserved.push(found[0]!.id);
      continue;
    }
    matches.push({ student: found[0]!, sections: [...r.sections] });
  }
  if (!matches.length) errors.push('No eligible students matched. No changes can be applied.');
  return { matches, errors: [...new Set(errors)], issues, notes, preserved, total: byCanvas.size };
}
