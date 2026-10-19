import { readGradebook, suggestSections } from '../core/csv.js';
import { matchStudents } from '../core/match.js';
import { createPlan } from '../core/plan.js';
import { MAX_CSV_BYTES, message, requireValue } from '../core/model.js';
import { execute } from '../sync/execute.js';
import type {
  Client,
  Context,
  Mapping,
  MatchResult,
  Operation,
  Plan,
  Progress,
  Snapshot,
  Target,
} from '../core/types.js';

export interface Session {
  context: Context;
  client: Client;
  snapshot: Snapshot;
}
export interface State {
  phase:
    | 'empty'
    | 'loading'
    | 'ready'
    | 'reading'
    | 'editing'
    | 'preview'
    | 'applying'
    | 'stopping'
    | 'reload';
  session?: Session;
  matching?: MatchResult;
  mapping: Mapping;
  filename: string;
  replace: boolean;
  cleanup: boolean;
  plan?: Plan;
  approved: boolean;
  notice: string;
  error: boolean;
  progress?: Progress;
  /** Verified operations of the current sync. */
  log: Operation[];
}
export interface Services {
  client(context: Context): Client;
  /** Session-scoped recovery markers, normally chrome.storage.session. */
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
  lock(task: () => Promise<void>): Promise<boolean>;
}
export const running = (state: State): boolean =>
  state.phase === 'applying' || state.phase === 'stopping';
export function capabilities(state: State) {
  const editable = state.phase === 'editing' || state.phase === 'preview';
  return {
    refresh: !!state.session && state.phase !== 'loading' && !running(state),
    csv: !!state.session && ['ready', 'reading', 'editing', 'preview'].includes(state.phase),
    mapping: editable,
    preview: editable && !!state.matching && !state.matching.errors.length,
    apply:
      state.phase === 'preview' &&
      !!state.session?.snapshot.canEdit &&
      !!state.plan?.changes.length &&
      (!state.plan.summary.destroy || state.approved),
    stop: state.phase === 'applying',
  };
}
const cleared = () => ({
  session: undefined,
  matching: undefined,
  mapping: new Map<string, string[]>(),
  filename: '',
  plan: undefined,
  approved: false,
  progress: undefined,
  log: [],
});
/** Any mapping or option change requires a new preview and approval. */
const invalidated = { phase: 'editing', plan: undefined, approved: false } as const;
const labelList = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];
const journalKey = (context: Context) => `journal:${context.origin}${context.base}`;
function interrupted(journal: unknown): string {
  const { completed, total } = (journal ?? {}) as { completed?: unknown; total?: unknown };
  const detail =
    typeof completed === 'number' && typeof total === 'number'
      ? ` after ${completed} of ${total} operations`
      : '';
  return `An earlier sync was interrupted${detail}. Import the same CSV and review the remaining changes.`;
}
export class Controller {
  state: State = {
    ...cleared(),
    phase: 'empty',
    replace: false,
    cleanup: true,
    notice: 'Open Students or Student labels, then click the extension icon.',
    error: false,
  };
  private generation = 0;
  private nonce?: string;
  private abort?: AbortController;
  constructor(
    private services: Services,
    private changed: (state: State) => void,
  ) {}
  private update(patch: Partial<State>) {
    Object.assign(this.state, patch);
    this.changed(this.state);
  }
  report(error: unknown) {
    this.update({ notice: message(error), error: true });
  }
  async accept(target: Target) {
    if (target.nonce === this.nonce) return;
    if (running(this.state)) {
      this.update({
        notice:
          'Sync is using the original course. Finish or stop it before selecting another course.',
      });
      return;
    }
    this.nonce = target.nonce;
    if (!('error' in target)) return this.load(target.context);
    // Clicking the icon on an unrelated tab must not discard a loaded course.
    const session = this.state.session;
    if (session) {
      this.update({
        notice: `${target.error} Still using ${session.snapshot.title}.`,
        error: true,
      });
      return;
    }
    ++this.generation;
    this.update({ ...cleared(), phase: 'empty', notice: target.error, error: true });
  }
  async refresh() {
    if (capabilities(this.state).refresh && this.state.session)
      await this.load(this.state.session.context);
  }
  private async load(context: Context) {
    const generation = ++this.generation;
    const client = this.services.client(context);
    this.update({ ...cleared(), phase: 'loading', notice: 'Loading students…', error: false });
    try {
      const key = journalKey(context);
      const [snapshot, stored] = await Promise.all([client.read(), this.services.storage.get(key)]);
      if (generation !== this.generation) return;
      const journal = stored[key];
      this.update({
        phase: 'ready',
        session: { context, client, snapshot },
        notice: journal
          ? interrupted(journal)
          : snapshot.canEdit
            ? ''
            : 'Preview only. This account cannot edit students.',
        error: !!journal,
      });
    } catch (error) {
      if (generation === this.generation)
        this.update({ phase: 'empty', notice: message(error), error: true });
    }
  }
  async importCsv(file: Pick<File, 'name' | 'size' | 'text'>) {
    const session = this.state.session;
    if (!session || !capabilities(this.state).csv) return;
    const generation = ++this.generation;
    this.update({
      phase: 'reading',
      filename: file.name,
      matching: undefined,
      mapping: new Map(),
      plan: undefined,
      approved: false,
      notice: 'Reading CSV…',
      error: false,
    });
    try {
      requireValue(file.size <= MAX_CSV_BYTES, 'CSV exceeds 20 MB.');
      const text = await file.text();
      if (generation !== this.generation) return;
      const matching = matchStudents(readGradebook(text), session.snapshot.roster);
      const mapping = new Map(
        [...new Set(matching.matches.flatMap((m) => m.sections))]
          .sort()
          .map((section) => [section, suggestSections(section)]),
      );
      this.update({
        phase: 'editing',
        matching,
        mapping,
        replace: false,
        notice: matching.errors.length
          ? 'Resolve the import errors before previewing.'
          : matching.issues.length
            ? 'Students with import issues will keep their labels.'
            : '',
        error: matching.errors.length > 0,
      });
    } catch (error) {
      // Clearing the filename resets the file input, so the corrected file can be chosen again.
      if (generation === this.generation)
        this.update({ phase: 'ready', filename: '', notice: message(error), error: true });
    }
  }
  edit(section: string, text: string) {
    if (!capabilities(this.state).mapping) return;
    const mapping = new Map(this.state.mapping).set(section, labelList(text.split('\n')));
    this.update({ mapping, ...invalidated });
  }
  replaceLabels(pattern: string, replacement: string) {
    if (!capabilities(this.state).mapping) return;
    try {
      requireValue(pattern, 'Enter a regular expression.');
      const regex = new RegExp(pattern, 'g');
      const mapping = new Map(
        [...this.state.mapping].map(([section, labels]) => [
          section,
          labelList(labels.map((label) => label.replace(regex, replacement))),
        ]),
      );
      this.update({
        mapping,
        ...invalidated,
        notice: 'Replacement applied. Review the section labels before previewing.',
        error: false,
      });
    } catch (error) {
      this.report(error);
    }
  }
  options(replace: boolean, cleanup: boolean) {
    if (!capabilities(this.state).mapping) return;
    this.update({ replace, cleanup, ...invalidated });
  }
  preview() {
    const { session, matching, mapping, replace, cleanup } = this.state;
    if (!session || !matching || !capabilities(this.state).preview) return;
    try {
      const plan = createPlan(session.snapshot, matching, mapping, { replace, cleanup });
      this.update({
        phase: 'preview',
        plan,
        approved: false,
        error: false,
        notice: plan.changes.length
          ? session.snapshot.canEdit
            ? ''
            : 'Preview only. This account cannot edit students.'
          : 'No changes needed.',
      });
    } catch (error) {
      this.update({ ...invalidated, notice: message(error), error: true });
    }
  }
  approve(value: boolean) {
    if (this.state.phase === 'preview') this.update({ approved: value });
  }
  stop() {
    if (!capabilities(this.state).stop) return;
    this.abort?.abort(new Error('Sync stopped.'));
    this.update({
      phase: 'stopping',
      notice: 'Stopping after the current request and verification…',
    });
  }
  async apply() {
    const { session, plan } = this.state;
    if (!session || !plan || !capabilities(this.state).apply) return;
    // Freeze the selected session before waiting for a cross-panel lock.
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.update({
      phase: 'applying',
      progress: undefined,
      log: [],
      notice: 'Keep this panel and the source tab open.',
      error: false,
    });
    try {
      const acquired = await this.services.lock(async () => {
        const key = journalKey(session.context);
        try {
          const snapshot = await execute(session.client, session.snapshot, plan, {
            signal,
            onProgress: async (progress) => {
              // Recorded before each write, so a closed panel leaves a recovery reminder.
              const { completed, total } = progress;
              await this.services.storage.set({ [key]: { completed, total } });
              this.update({
                progress,
                ...(progress.phase === 'verified' && {
                  log: [...this.state.log, progress.operation],
                }),
              });
            },
          });
          await this.services.storage.remove(key);
          this.update({
            session: { ...session, snapshot },
            notice: 'Changes verified. Refresh the PrairieLearn page.',
          });
        } catch (error) {
          this.report(
            new Error(
              `${message(error)} Refresh students and import the CSV again. Completed changes are not rolled back.`,
            ),
          );
        } finally {
          this.update({ phase: 'reload', plan: undefined, approved: false });
        }
      });
      if (!acquired)
        this.update({
          phase: 'preview',
          notice: 'Another panel is syncing. Try again when it finishes.',
          error: true,
        });
    } catch (error) {
      this.update({ phase: 'reload', plan: undefined });
      this.report(error);
    } finally {
      this.abort = undefined;
    }
  }
}
