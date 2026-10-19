import { z } from 'zod';
import { contextFromUrl } from './context.js';
import { requireValue, sorted } from '../core/model.js';
import type { Label, Snapshot, Student, Target } from '../core/types.js';

// Validates PrairieLearn responses and panel messages before they reach the core model.

/** Parses untrusted data, reporting a fixed message rather than schema details. */
function check<S extends z.ZodType>(schema: S, value: unknown, message: string): z.output<S> {
  const result = schema.safeParse(value);
  requireValue(result.success, message);
  return result.data;
}
const unique = (values: string[]) => new Set(values).size === values.length;

const TargetMessage = z.object({
  windowId: z.number(),
  nonce: z.string(),
  error: z.string().optional(),
  context: z
    .object({ tabId: z.int(), origin: z.string(), base: z.string(), courseId: z.string() })
    .optional(),
});
export function parseTarget(value: unknown, windowId: number): Target {
  const data = check(TargetMessage, value, 'Invalid source target.');
  requireValue(data.windowId === windowId, 'Invalid source window.');
  const identity = { windowId, nonce: data.nonce };
  if (data.error !== undefined) return { ...identity, error: data.error };
  requireValue(data.context, 'Invalid source course.');
  const { tabId, origin, base, courseId } = data.context;
  const context = contextFromUrl(`${origin}${base}/instance_admin/students`, tabId);
  requireValue(
    context.origin === origin && context.base === base && context.courseId === courseId,
    'Invalid source course.',
  );
  return { ...identity, context };
}

const Roster = z.array(
  z.object({
    enrollment: z.object({
      id: z.string(),
      course_instance_id: z.string(),
      status: z.string(),
      pending_name: z.string().nullish(),
    }),
    user: z
      .object({ uid: z.string(), uin: z.string().nullish(), name: z.string().nullish() })
      .nullish(),
  }),
);
export function parseRoster(data: unknown, courseId: string): Student[] {
  const rows = check(Roster, data, 'Unsupported PrairieLearn student response.');
  requireValue(
    rows.every((row) => row.enrollment.course_instance_id === courseId) &&
      unique(rows.map((row) => row.enrollment.id)),
    'Invalid or duplicate PrairieLearn enrollment.',
  );
  return rows.map(({ enrollment: e, user: u }) => ({
    id: e.id,
    uid: u?.uid ?? '',
    uin: u?.uin?.trim() ?? '',
    name: u?.name ?? e.pending_name ?? '',
    status: e.status,
  }));
}

const LabelList = z.object({
  origHash: z.string(),
  labels: z.array(
    z.object({
      student_label: z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        uuid: z.string(),
      }),
      user_data: z.array(z.object({ uid: z.string(), enrollment_id: z.string() })),
    }),
  ),
});
export function parseLabels(value: unknown): { labels: Label[]; hash: string } {
  const data = check(LabelList, value, 'Unsupported PrairieLearn label response.');
  const labels = data.labels.map(({ student_label, user_data }) => ({
    ...student_label,
    members: sorted(user_data.map((u) => u.enrollment_id)),
  }));
  requireValue(
    unique(labels.map((l) => l.id)) && labels.every((l) => unique(l.members)),
    'Invalid PrairieLearn label definition or duplicate membership.',
  );
  return { labels, hash: data.origHash };
}

const PageData = z.object({
  roster: z.unknown(),
  labels: z.unknown(),
  title: z.string(),
  canEdit: z.boolean(),
});
/** Converts the adapter's read reply into a snapshot of the course. */
export function parseSnapshot(value: unknown, courseId: string): Snapshot {
  const data = check(PageData, value, 'Unsupported PrairieLearn page data.');
  return {
    roster: parseRoster(data.roster, courseId),
    ...parseLabels(data.labels),
    title: data.title,
    canEdit: data.canEdit,
  };
}
