import type { Context, Label, Snapshot, Student } from './types.js';

export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function object(value: unknown): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'Unsupported response object.',
  );
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  requireValue(typeof value === 'string', 'Unsupported text value.');
  return value;
}
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unexpected error.';
export class RequestError extends Error {
  constructor(
    text: string,
    public readonly uncertain: boolean,
  ) {
    super(text);
  }
}
export const key = (name: string): string => name.toLowerCase();
export const managed = (name: string): boolean => /^section .+$/i.test(name);
export const sorted = (values: Iterable<string>): string[] => [...values].sort();
export function contextFromUrl(value: string, tabId: number): Context {
  const url = new URL(value);
  const match = url.pathname.match(
    /^(.*\/course_instance\/(\d+)\/instructor)\/instance_admin\/students(?:\/labels)?\/?$/,
  );
  requireValue(
    ['https:', 'http:'].includes(url.protocol) && match,
    'Open a PrairieLearn Students or Student labels page, then click the extension icon.',
  );
  return { tabId, origin: url.origin, base: match[1]!, courseId: match[2]! };
}
export function parseRoster(data: unknown, courseId: string): Student[] {
  requireValue(Array.isArray(data), 'Unsupported PrairieLearn student response.');
  const ids = new Set<string>();
  return data.map((value: unknown) => {
    const row = object(value),
      e = object(row.enrollment);
    const id = string(e.id);
    requireValue(
      e.course_instance_id === courseId && !ids.has(id),
      'Invalid or duplicate PrairieLearn enrollment.',
    );
    ids.add(id);
    const u = row.user == null ? undefined : object(row.user);
    return {
      id,
      uid: u ? string(u.uid) : '',
      uin: string(u?.uin ?? '').trim(),
      name: string(u?.name ?? e.pending_name ?? ''),
      status: string(e.status),
    };
  });
}
export function parseLabels(value: unknown): { labels: Label[]; hash: string } {
  const data = object(value),
    hash = string(data.origHash);
  requireValue(Array.isArray(data.labels), 'Unsupported PrairieLearn label response.');
  const ids = new Set<string>();
  const labels = data.labels.map((value: unknown) => {
    const row = object(value),
      l = object(row.student_label),
      id = string(l.id);
    requireValue(
      Array.isArray(row.user_data) && !ids.has(id),
      'Invalid PrairieLearn label definition.',
    );
    ids.add(id);
    const members = row.user_data.map((value: unknown) => {
      const u = object(value);
      string(u.uid);
      return string(u.enrollment_id);
    });
    requireValue(new Set(members).size === members.length, 'Duplicate label membership.');
    return {
      id,
      name: string(l.name),
      color: string(l.color),
      uuid: string(l.uuid),
      members: sorted(members),
    };
  });
  return { labels, hash };
}
export function fingerprint(snapshot: Snapshot): string {
  return JSON.stringify({
    roster: [...snapshot.roster].sort((a, b) => a.id.localeCompare(b.id)),
    labels: snapshot.labels
      .map((l) => ({ ...l, members: sorted(l.members) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    hash: snapshot.hash,
  });
}
