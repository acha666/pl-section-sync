import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readGradebook, suggestSections } from '../dist/src/core/csv.js';
import { contextFromUrl, parseRoster, parseLabels } from '../dist/src/core/model.js';
import { matchStudents } from '../dist/src/core/match.js';
import { createPlan } from '../dist/src/core/plan.js';
import { snapshot } from './fixtures.js';
const csv = (rows) => `Student,ID,SIS Login ID,Section\n${rows}`;
const gradebook = () => readGradebook(csv('One,10,001,New'));
const mapping = () => new Map([['New', ['New']]]);

test('CSV preserves leading zeros, BOM, commas, escaped quotes, and multiline text', () => {
  assert.deepEqual(parseCsv('\ufeffA,B\r\n001,"a,b"\r\n"x""y","line\nnext"\r\n'), [
    ['A', 'B'],
    ['001', 'a,b'],
    ['x"y', 'line\nnext'],
  ]);
});
test('CSV rejects malformed quoting and incomplete records', () => {
  for (const text of ['"abc', 'ab"c', '"a"b']) assert.throws(() => parseCsv(text), /CSV/);
  assert.throws(() => readGradebook(csv('One,10,001')), /fields/);
});
test('required headers and duplicate headers are checked', () => {
  assert.throws(() => readGradebook('ID,Section\n1,A'), /SIS Login ID/);
  assert.throws(() => readGradebook('ID,ID,Section\n1,1,A'), /Duplicate/);
});
test('Canvas metadata is skipped but unidentified student rows become issues', () => {
  const g = readGradebook(csv('Points Possible,,,\nOne,10,001,New\nTwo,,002,New'));
  assert.equal(g.skipped, 1);
  assert.equal(g.issues.length, 1);
  assert.equal(g.records.length, 1);
});
test('section suggestions handle English two and three section sentences', () => {
  assert.deepEqual(suggestSections('Lecture A, Lab B, and Tutorial C'), [
    'Lecture A',
    'Lab B',
    'Tutorial C',
  ]);
  assert.deepEqual(suggestSections('A and B'), ['A', 'B']);
});
test('matching uses only SIS Login ID and UIN without numeric conversion', () => {
  const g = readGradebook(csv('One,10,001,New\nOther,20,1,New'));
  const m = matchStudents(g, snapshot().roster);
  assert.equal(m.matches.length, 1);
  assert.equal(m.issues.length, 1);
});
test('duplicate Canvas student rows merge section sets', () => {
  const m = matchStudents(
    readGradebook(csv('One,10,001,A\nOne,10,001,B\nOne,10,001,A')),
    snapshot().roster,
  );
  assert.deepEqual(m.matches[0].sections, ['A', 'B']);
  assert.equal(m.total, 1);
});
test('duplicate identity conflicts block execution', () => {
  const roster = snapshot().roster;
  assert.ok(
    matchStudents(readGradebook(csv('One,10,001,A\nOther,20,001,B')), roster).errors.length,
  );
  assert.ok(matchStudents(readGradebook(csv('One,10,001,A\nOne,10,002,A')), roster).errors.length);
  assert.ok(matchStudents(gradebook(), [...roster, { ...roster[0], id: '4' }]).errors.length);
});
test('left, unmatched, missing SIS, and empty sections are preserved as issues', () => {
  const m = matchStudents(
    readGradebook(
      csv('One,10,001,A\nLeft,30,003,A\nUnknown,40,004,A\nMissing,50,,A\nBlank,20,002,'),
    ),
    snapshot().roster,
  );
  assert.equal(m.matches.length, 1);
  assert.equal(m.issues.length, 4);
});
test('partial import preserves outside and non-joined memberships and other labels', () => {
  const s = snapshot();
  const p = createPlan(s, matchStudents(gradebook(), s.roster), mapping());
  assert.deepEqual(p.changes.find((c) => c.id === '11').target, ['2', '3']);
  assert.equal(
    p.changes.some((c) => c.id === '12'),
    false,
  );
  assert.deepEqual(p.summary, { create: 1, destroy: 1, add: 1, remove: 1 });
});
test('full replacement removes only joined students outside import', () => {
  const s = snapshot();
  const p = createPlan(s, matchStudents(gradebook(), s.roster), mapping(), { replace: true });
  assert.deepEqual(p.changes.find((c) => c.id === '11').target, ['3']);
});
test('full replacement rejects unresolved import issues', () => {
  const s = snapshot(),
    m = matchStudents(gradebook(), s.roster);
  m.issues.push('Unknown student');
  assert.throws(() => createPlan(s, m, mapping(), { replace: true }), /Resolve/);
});
test('empty mapping explicitly clears in-scope section assignments', () => {
  const s = snapshot();
  const p = createPlan(s, matchStudents(gradebook(), s.roster), new Map([['New', []]]));
  assert.equal(p.summary.add, 0);
  assert.equal(p.summary.remove, 1);
});
test('case-insensitive existing names are reused and collisions rejected', () => {
  const s = snapshot();
  s.labels.push({ id: '14', name: 'SECTION NEW', color: 'blue1', uuid: 'new', members: [] });
  assert.equal(createPlan(s, matchStudents(gradebook(), s.roster), mapping()).summary.create, 0);
  s.labels.push({ ...s.labels.at(-1), id: '15', name: 'section New' });
  assert.throws(
    () => createPlan(s, matchStudents(gradebook(), s.roster), mapping()),
    /Conflicting/,
  );
});
test('limits and cleanup preference are enforced', () => {
  const s = snapshot(),
    m = matchStudents(gradebook(), s.roster);
  assert.equal(createPlan(s, m, mapping(), { cleanup: false }).summary.destroy, 0);
  assert.throws(() => createPlan(s, m, new Map([['New', ['x'.repeat(255)]]])), /255/);
  for (let i = s.labels.length; i < 100; i++)
    s.labels.push({ id: `x${i}`, name: `Other ${i}`, members: [], color: 'blue1', uuid: `x${i}` });
  assert.throws(() => createPlan(s, m, mapping()), /100-label/);
});
test('context supports arbitrary hosts and rejects unrelated pages', () => {
  assert.equal(
    contextFromUrl(
      'https://example.invalid/pl/course_instance/123/instructor/instance_admin/students/labels',
      1,
    ).courseId,
    '123',
  );
  assert.throws(() => contextFromUrl('https://example.invalid/pl/course_instance/123/student', 1));
});
test('runtime schemas fail early on unexpected course, membership, and response shapes', () => {
  assert.throws(() => parseRoster({}, '1'));
  assert.throws(() =>
    parseRoster(
      [{ enrollment: { id: '1', course_instance_id: '2', status: 'joined' }, user: null }],
      '1',
    ),
  );
  assert.throws(() => parseLabels({ labels: [], origHash: null }));
  assert.throws(() =>
    parseLabels({
      labels: [{ student_label: { id: '1', name: 'x', color: 'x', uuid: 'x' }, user_data: [{}] }],
      origHash: 'h',
    }),
  );
});

test('full replacement preserves joined students without a unique UIN', () => {
  const s = snapshot();
  s.roster.push({ id: '4', uin: '', uid: 'unknown', name: 'Unknown', status: 'joined' });
  s.roster.push({ id: '5', uin: '002', uid: 'duplicate', name: 'Duplicate', status: 'joined' });
  s.labels[0].members.push('4', '5');
  const plan = createPlan(s, matchStudents(gradebook(), s.roster), mapping(), { replace: true });
  assert.deepEqual(plan.changes.find((c) => c.id === '11').target, ['2', '3', '4', '5']);
});

test('roster validation rejects non-text display names', () => {
  assert.throws(() =>
    parseRoster(
      [
        {
          enrollment: { id: '1', course_instance_id: '1', status: 'joined' },
          user: { uid: 'x', name: {} },
        },
      ],
      '1',
    ),
  );
});
