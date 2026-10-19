import { object, requireValue, sorted, string } from '../core/model.js';
import type { Context, Label, Student, Target } from '../core/types.js';

/** Validates PrairieLearn URLs and response shapes before they reach the core model. */
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
export function parseTarget(value: unknown, windowId: number): Target {
  const data = object(value);
  requireValue(data.windowId === windowId, 'Invalid source window.');
  const identity = { windowId, nonce: string(data.nonce) };
  if ('error' in data) return { ...identity, error: string(data.error) };
  const c = object(data.context);
  requireValue(typeof c.tabId === 'number' && Number.isInteger(c.tabId), 'Invalid source tab.');
  const origin = string(c.origin),
    base = string(c.base),
    courseId = string(c.courseId);
  const context = contextFromUrl(`${origin}${base}/instance_admin/students`, c.tabId);
  requireValue(
    context.origin === origin && context.base === base && context.courseId === courseId,
    'Invalid source course.',
  );
  return { ...identity, context };
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
