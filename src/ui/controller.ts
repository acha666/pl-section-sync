import { readGradebook, suggestSections } from '../core/csv.js';
import { matchStudents } from '../core/match.js';
import { createPlan } from '../core/plan.js';
import { message, object, requireValue, string } from '../core/model.js';
import { execute } from '../sync/execute.js';
import type {
  Client,
  Context,
  Mapping,
  MatchResult,
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
  log: string[];
}
export interface Services {
  client(context: Context): Client;
  journal(key: string, value?: Progress | true | null): Promise<unknown>;
  lock(task: () => Promise<void>): Promise<boolean>;
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
  requireValue(
    /^https?:$/.test(new URL(origin).protocol) &&
      new URL(origin).origin === origin &&
      /^.*\/course_instance\/\d+\/instructor$/.test(base) &&
      base.endsWith(`/course_instance/${courseId}/instructor`),
    'Invalid source course.',
  );
  return { ...identity, context: { tabId: c.tabId, origin, base, courseId } };
}
export function capabilities(state: State) {
  const editable = state.phase === 'editing' || state.phase === 'preview';
  return {
    refresh: !!state.session && !['loading', 'applying', 'stopping'].includes(state.phase),
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
export class Controller {
  state: State = {
    phase: 'empty',
    mapping: new Map(),
    filename: '',
    replace: false,
    cleanup: true,
    approved: false,
    notice: 'Open Students or Student labels, then click the extension icon.',
    error: false,
    log: [],
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
    if (['applying', 'stopping'].includes(this.state.phase)) {
      this.update({
        notice:
          'Sync is using the original course. Finish or stop it before selecting another course.',
      });
      return;
    }
    this.nonce = target.nonce;
    if ('error' in target) {
      ++this.generation;
      this.update({
        phase: 'empty',
        session: undefined,
        matching: undefined,
        plan: undefined,
        mapping: new Map(),
        filename: '',
        progress: undefined,
        log: [],
        notice: target.error,
        error: true,
      });
      return;
    }
    await this.load(target.context);
  }
  async refresh() {
    if (capabilities(this.state).refresh && this.state.session)
      await this.load(this.state.session.context);
  }
  private async load(context: Context) {
    const generation = ++this.generation;
    const client = this.services.client(context);
    this.update({
      phase: 'loading',
      session: undefined,
      matching: undefined,
      plan: undefined,
      mapping: new Map(),
      filename: '',
      progress: undefined,
      log: [],
      approved: false,
      notice: 'Loading students…',
      error: false,
    });
    try {
      const snapshot = await client.read();
      const unfinished = await this.services.journal(this.journalKey(context));
      if (generation !== this.generation) return;
      this.update({
        phase: 'ready',
        session: { context, client, snapshot },
        notice: unfinished
          ? 'An earlier sync was interrupted. Import the same CSV and review the remaining changes.'
          : snapshot.canEdit
            ? ''
            : 'Preview only. This account cannot edit students.',
        error: !!unfinished,
      });
    } catch (error) {
      if (generation === this.generation)
        this.update({ phase: 'empty', notice: message(error), error: true });
    }
  }
  async importCsv(file: { name: string; size: number; text(): Promise<string> }) {
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
      requireValue(file.size <= 20 * 1024 * 1024, 'CSV exceeds 20 MB.');
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
      if (generation === this.generation)
        this.update({ phase: 'ready', notice: message(error), error: true });
    }
  }
  edit(section: string, text: string) {
    if (!capabilities(this.state).mapping) return;
    this.state.mapping.set(section, [
      ...new Set(
        text
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ]);
    this.update({ phase: 'editing', plan: undefined, approved: false });
  }
  options(replace: boolean, cleanup: boolean) {
    if (!capabilities(this.state).mapping) return;
    this.update({ replace, cleanup, phase: 'editing', plan: undefined, approved: false });
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
        progress: undefined,
        log: [],
        error: false,
        notice: plan.changes.length
          ? session.snapshot.canEdit
            ? ''
            : 'Preview only. This account cannot edit students.'
          : 'No changes needed.',
      });
    } catch (error) {
      this.update({ plan: undefined, phase: 'editing', notice: message(error), error: true });
    }
  }
  approve(value: boolean) {
    this.update({ approved: value });
  }
  stop() {
    if (!capabilities(this.state).stop) return;
    this.abort?.abort(new Error('Sync stopped.'));
    this.update({
      phase: 'stopping',
      notice: 'Stopping after the current request and verification…',
    });
  }
  private journalKey(context: Context) {
    return `journal:${context.origin}${context.base}`;
  }
  async apply() {
    if (!capabilities(this.state).apply) return;
    const { session, plan } = this.state;
    if (!session || !plan) return;
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
        const key = this.journalKey(session.context);
        try {
          await this.services.journal(key, true);
          const snapshot = await execute(session.client, session.snapshot, plan, {
            signal,
            onProgress: async (progress) => {
              await this.services.journal(key, progress);
              if (progress.phase === 'verified')
                this.state.log.push(`${progress.type}: ${progress.name}`);
              this.update({ progress });
            },
          });
          await this.services.journal(key, null);
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
