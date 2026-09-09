export interface Student {
  id: string;
  uid: string;
  uin: string;
  name: string;
  status: string;
}
export interface Label {
  id: string;
  name: string;
  color: string;
  uuid: string;
  members: string[];
}
export interface Snapshot {
  roster: Student[];
  labels: Label[];
  hash: string;
  title: string;
  canEdit: boolean;
}
export interface Context {
  tabId: number;
  origin: string;
  base: string;
  courseId: string;
}
export type Target = ({ context: Context } | { error: string }) & {
  windowId: number;
  nonce: string;
};
export interface GradebookRecord {
  id: string;
  sis: string;
  section: string;
  name: string;
}
export interface Gradebook {
  records: GradebookRecord[];
  issues: string[];
  skipped: number;
}
export interface MatchResult {
  matches: { student: Student; sections: string[] }[];
  errors: string[];
  issues: string[];
  total: number;
}
export interface Change {
  key: string;
  id: string | undefined;
  name: string;
  create: boolean;
  destroy: boolean;
  add: string[];
  remove: string[];
  target: string[];
}
export interface Plan {
  changes: Change[];
  scope: number;
  summary: { create: number; destroy: number; add: number; remove: number };
}
export type Mapping = Map<string, string[]>;
export type Mutation =
  | { method: 'upsert'; input: { name: string; color: string; uids: string[]; origHash: string } }
  | { method: 'destroy'; input: { labelId: string; origHash: string } }
  | { method: 'batchAdd' | 'batchRemove'; input: { labelId: string; enrollmentIds: string[] } };
export type Command = { type: 'read' } | ({ type: 'write' } & Mutation);
export type Reply =
  { ok: true; value: unknown } | { ok: false; uncertain: boolean; message: string };
export interface Client {
  read(): Promise<Snapshot>;
  mutate(command: Mutation): Promise<unknown>;
}
export type Operation = { key: string; name: string } & (
  { type: 'create' } | { type: 'destroy' } | { type: 'add' | 'remove'; ids: string[] }
);
export interface Progress {
  phase: 'sending' | 'verified';
  index: number;
  total: number;
  type: Operation['type'];
  name: string;
}
