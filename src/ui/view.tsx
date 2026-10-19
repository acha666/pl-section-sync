import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { Controller, State } from './controller.js';
import { capabilities, labelList, running } from './controller.js';
import type { Change, Operation, Student } from '../core/types.js';

interface Props {
  controller: Controller;
  state: State;
}
const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;
function describe(op: Operation): string {
  switch (op.type) {
    case 'create':
      return `Create ${op.name}`;
    case 'destroy':
      return `Delete ${op.name}`;
    case 'add':
      return `Add ${count(op.ids.length, 'student')} to ${op.name}`;
    case 'remove':
      return `Remove ${count(op.ids.length, 'student')} from ${op.name}`;
  }
}
const name = (student: Student | undefined, id: string) =>
  `${student?.name || student?.uid || id} · ${student?.uin || 'No UIN'}`;
function Row({ title, detail }: { title: string; detail: string }) {
  return (
    <div class="row">
      {title}
      <small>{detail}</small>
    </div>
  );
}

export function Panel(props: Props) {
  const { state } = props;
  return (
    <>
      <header>
        <h1>Section Sync</h1>
      </header>
      <main>
        <p
          id="notice"
          class={state.error ? 'notice error' : 'notice'}
          role="status"
          aria-live="polite"
          hidden={!state.notice}
        >
          {state.notice}
        </p>
        <Course {...props} />
        <Gradebook {...props} />
        <Mapping {...props} />
        <Review {...props} />
        <Execution {...props} />
        <About />
      </main>
    </>
  );
}

function Course({ controller, state }: Props) {
  const snapshot = state.session?.snapshot,
    context = state.session?.context;
  const roster = useMemo(
    () =>
      snapshot?.roster.map((s) => (
        <Row
          key={s.id}
          title={s.name || s.uid || 'Pending student'}
          detail={`UIN ${s.uin || 'missing'} · ${s.status}`}
        />
      )),
    [snapshot],
  );
  return (
    <section aria-labelledby="course">
      <div class="heading">
        <h2 id="course">
          {snapshot?.title ??
            (state.phase === 'loading' ? 'Loading course…' : 'No course selected')}
        </h2>
        <button
          class="secondary compact"
          title="Reload students and labels from PrairieLearn"
          disabled={!capabilities(state).refresh}
          onClick={() => void controller.refresh()}
        >
          Refresh
        </button>
      </div>
      {context && (
        <p class="muted" title={`${context.origin}${context.base}`}>
          {context.origin}
        </p>
      )}
      {snapshot && (
        <details>
          <summary>{count(snapshot.roster.length, 'student')}</summary>
          <div class="scroll-list">{roster}</div>
        </details>
      )}
    </section>
  );
}

function Gradebook({ controller, state }: Props) {
  const { matching } = state;
  const input = useRef<HTMLInputElement>(null);
  // Clearing the input lets the same file be chosen again after an error or reload.
  useLayoutEffect(() => {
    if (!state.filename && input.current) input.current.value = '';
  }, [state.filename]);
  const matches = useMemo(
    () =>
      matching?.matches.map((m) => (
        <Row
          key={m.student.id}
          title={m.student.name || m.student.uid}
          detail={`${m.student.uin} · ${m.sections.join(' | ')}`}
        />
      )),
    [matching],
  );
  const issues = matching ? [...matching.errors, ...matching.issues] : [];
  return (
    <section aria-labelledby="csv-heading">
      <h2 id="csv-heading">Canvas gradebook</h2>
      <label for="csv">CSV export with ID, SIS Login ID, and Section columns</label>
      <input
        ref={input}
        id="csv"
        type="file"
        accept=".csv,text/csv"
        disabled={!capabilities(state).csv}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void controller.importCsv(file);
        }}
      />
      {matching && (
        <>
          <p id="match-summary">{`${count(matching.matches.length, 'student')} matched`}</p>
          {issues.length > 0 && (
            <Messages open summary={count(issues.length, 'import issue')}>
              {issues}
            </Messages>
          )}
          {matching.notes.length > 0 && (
            <Messages summary={`${count(matching.notes.length, 'student')} not updated`}>
              {matching.notes}
            </Messages>
          )}
          {matching.matches.length > 0 && (
            <details>
              <summary>Matched students</summary>
              <div class="scroll-list">{matches}</div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Messages(props: { open?: boolean; summary: string; children: string[] }) {
  return (
    <details open={props.open}>
      <summary>{props.summary}</summary>
      <div class="scroll-list">
        {props.children.map((text, index) => (
          <div key={index} class="row">
            {text}
          </div>
        ))}
      </div>
    </details>
  );
}

function Mapping({ controller, state }: Props) {
  const { matching } = state;
  const students = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of matching?.matches ?? [])
      for (const section of m.sections) counts.set(section, (counts.get(section) ?? 0) + 1);
    return counts;
  }, [matching]);
  if (!matching || matching.errors.length) return null;
  const allowed = capabilities(state),
    unidentified = matching.issues.length;
  return (
    <section id="mapping-area" aria-labelledby="mapping-heading">
      <h2 id="mapping-heading">Section labels</h2>
      <fieldset disabled={!allowed.mapping}>
        <p class="muted">
          One label per line; each becomes <strong>Section …</strong>. An empty box clears those
          students’ section labels.
        </p>
        <RegexRules
          onApply={(pattern, replacement) => controller.replaceLabels(pattern, replacement)}
        />
        <div id="mappings">
          {[...state.mapping].map(([section, labels], index) => (
            <MappingField
              key={section}
              id={`mapping-${index}`}
              section={section}
              students={students.get(section) ?? 0}
              labels={labels}
              onEdit={(text) => controller.edit(section, text)}
            />
          ))}
        </div>
        <label for="scope">Students to update</label>
        <select
          id="scope"
          value={state.replace ? 'replace' : 'imported'}
          onChange={(event) =>
            controller.options(event.currentTarget.value === 'replace', state.cleanup)
          }
        >
          <option value="imported">Matched students in this CSV</option>
          <option value="replace" disabled={unidentified > 0}>
            {unidentified
              ? `All joined PL students (${count(unidentified, 'unidentified student')} in CSV)`
              : 'All joined PL students'}
          </option>
        </select>
        {state.replace && (
          <p class="warning">
            Joined students absent from this CSV will lose their section labels.
          </p>
        )}
        <label class="check">
          <input
            type="checkbox"
            checked={state.cleanup}
            onChange={(event) => controller.options(state.replace, event.currentTarget.checked)}
          />
          Delete unused, empty section labels
        </label>
      </fieldset>
      <button id="preview" disabled={!allowed.preview} onClick={() => controller.preview()}>
        Confirm labels &amp; preview
      </button>
    </section>
  );
}

function RegexRules({ onApply }: { onApply(pattern: string, replacement: string): void }) {
  return (
    <details>
      <summary>Clean up labels with regex</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onApply(String(data.get('pattern') ?? ''), String(data.get('replacement') ?? ''));
        }}
      >
        <label for="regex-pattern">Regular expression</label>
        <input
          id="regex-pattern"
          name="pattern"
          type="text"
          placeholder="^APSC_V 160 (\S+) 2026W1$"
          spellcheck={false}
          autocomplete="off"
        />
        <label for="regex-replacement">Replacement</label>
        <input
          id="regex-replacement"
          name="replacement"
          type="text"
          placeholder="$1"
          spellcheck={false}
          autocomplete="off"
        />
        <p class="muted">
          JavaScript syntax without / delimiters. Replaces every match in each label, before the
          Section prefix is added. Use $1, $2 for capture groups; leave the replacement empty to
          delete matches. Apply rules one after another.
        </p>
        <button class="secondary">Replace in labels</button>
      </form>
    </details>
  );
}

function MappingField(props: {
  id: string;
  section: string;
  students: number;
  labels: string[];
  onEdit(text: string): void;
}) {
  const { id, labels } = props;
  const field = useRef<HTMLTextAreaElement>(null);
  // Adopt outside changes such as regex rules, but never rewrite text that already
  // means the same labels, so blank lines and spaces survive while typing.
  useLayoutEffect(() => {
    const node = field.current;
    if (node && labelList(node.value.split('\n')).join('\n') !== labels.join('\n'))
      node.value = labels.join('\n');
  }, [labels]);
  return (
    <>
      <label for={id}>
        {props.section}
        <small>{` · ${count(props.students, 'student')}`}</small>
      </label>
      <textarea
        ref={field}
        id={id}
        rows={Math.max(2, labels.length)}
        spellcheck={false}
        onInput={(event) => props.onEdit(event.currentTarget.value)}
      />
    </>
  );
}

function Review({ controller, state }: Props) {
  const { plan } = state;
  const section = useRef<HTMLElement>(null);
  const snapshot = state.session?.snapshot;
  const students = useMemo(() => new Map(snapshot?.roster.map((s) => [s.id, s])), [snapshot]);
  useLayoutEffect(() => {
    if (plan) section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [plan]);
  if (!plan) return null;
  const { create, destroy, add, remove } = plan.summary;
  return (
    <section id="review" ref={section} aria-labelledby="review-heading">
      <h2 id="review-heading">Review changes</h2>
      <p class="muted">
        {`${count(plan.scope, 'student')} in scope · Labels: ${create} new, ${destroy} deleted · Memberships: ${add} added, ${remove} removed`}
      </p>
      {plan.absent.length > 0 && (
        <div id="absent" class="warning">
          {`${count(plan.absent.length, 'joined student')} absent from this CSV will lose section labels.`}
          <details>
            <summary>Students</summary>
            <ul>
              {plan.absent.map((id) => (
                <li key={id}>{name(students.get(id), id)}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <div id="changes">
        {plan.changes.map((change) => (
          <ChangeRow key={change.key} change={change} students={students} />
        ))}
      </div>
      {destroy > 0 && (
        <label class="check warning">
          <input
            id="delete-confirm"
            type="checkbox"
            checked={state.approved}
            disabled={state.phase !== 'preview'}
            onChange={(event) => controller.approve(event.currentTarget.checked)}
          />
          Approve label deletions. Access-rule references may be removed and cannot be restored by
          recreating a label.
        </label>
      )}
      <button
        id="apply"
        disabled={!capabilities(state).apply}
        onClick={() => void controller.apply()}
      >
        Apply changes
      </button>
    </section>
  );
}

function ChangeRow({ change, students }: { change: Change; students: Map<string, Student> }) {
  const actions = [
    change.create && 'New label',
    change.add.length > 0 && `Add ${count(change.add.length, 'student')}`,
    change.remove.length > 0 && `Remove ${count(change.remove.length, 'student')}`,
    change.destroy && 'Delete label',
  ].filter(Boolean);
  const members = [
    ...change.add.map((id) => ['Add', id] as const),
    ...change.remove.map((id) => ['Remove', id] as const),
  ];
  return (
    <div class="change">
      <strong>{change.name}</strong>
      <p class={change.destroy ? 'warning-text' : 'muted'}>{actions.join(' · ')}</p>
      {members.length > 0 && (
        <details>
          <summary>Students</summary>
          <ul>
            {members.map(([verb, id]) => (
              <li key={`${verb}:${id}`}>{`${verb}: ${name(students.get(id), id)}`}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Execution({ controller, state }: Props) {
  const { progress } = state;
  const active = running(state);
  if (!progress && !active) return null;
  const text = !progress
    ? 'Checking current state…'
    : progress.phase === 'sending'
      ? `Step ${progress.completed + 1} of ${progress.total}: ${describe(progress.operation)}…`
      : `${progress.completed} of ${progress.total} verified`;
  return (
    <section aria-labelledby="execution-heading">
      <h2 id="execution-heading">Sync progress</h2>
      <progress
        max={progress?.total || 1}
        value={progress?.completed ?? 0}
        aria-labelledby="execution-heading"
      />
      <p aria-live="polite">{text}</p>
      {active && (
        <button
          class="secondary"
          disabled={!capabilities(state).stop}
          onClick={() => controller.stop()}
        >
          Stop after current request
        </button>
      )}
      <details>
        <summary>Completed operations</summary>
        <ol class="scroll-list">
          {state.log.map((op, index) => (
            <li key={index}>{describe(op)}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function About() {
  return (
    <details class="about">
      <summary>About &amp; help</summary>
      <p>
        Matches Canvas SIS Login ID to PL UIN. Only joined students are updated. Review suggested
        section splits before previewing.
      </p>
      <p>
        Labels beginning with “Section ” are managed, ignoring case. Other labels are preserved.
      </p>
      <p>Files are processed locally. No grades are uploaded. No analytics or external backend.</p>
      <p>Version {chrome.runtime.getManifest().version}</p>
    </details>
  );
}
