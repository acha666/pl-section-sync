import type { Snapshot } from './types.js';

export const LABEL_PREFIX = 'Section ';
export const LABEL_COLOR = 'blue1';
export const MAX_CSV_BYTES = 20 * 1024 * 1024;

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
export const managed = (name: string): boolean =>
  name.length > LABEL_PREFIX.length && key(name).startsWith(key(LABEL_PREFIX));
export const sorted = (values: Iterable<string>): string[] => [...values].sort();
export function fingerprint(snapshot: Snapshot): string {
  return JSON.stringify({
    roster: [...snapshot.roster].sort((a, b) => a.id.localeCompare(b.id)),
    labels: snapshot.labels
      .map((l) => ({ ...l, members: sorted(l.members) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    hash: snapshot.hash,
  });
}
