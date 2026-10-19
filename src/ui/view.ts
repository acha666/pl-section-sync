import type { Controller, State } from './controller.js';
import { capabilities, running } from './controller.js';
import type { Mapping, MatchResult, Operation, Plan, Snapshot } from '../core/types.js';

function element<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  const node = document.getElementById(id);
  if (!node || node.tagName.toLowerCase() !== tag) throw new Error(`Missing ${tag}#${id}`);
  return node as HTMLElementTagNameMap[K];
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function row(title: string, detail: string) {
  const node = el('div', title, 'row');
  node.append(el('small', detail));
  return node;
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

export function createView(controller: Controller) {
  const $ = {
    notice: element('notice', 'p'),
    course: element('course', 'h2'),
    origin: element('origin', 'p'),
    refresh: element('refresh', 'button'),
    rosterDetails: element('roster-details', 'details'),
    rosterSummary: element('roster-summary', 'summary'),
    rosterList: element('roster-list', 'div'),
    csv: element('csv', 'input'),
    matchSummary: element('match-summary', 'p'),
    issues: element('issues', 'details'),
    issuesSummary: element('issues-summary', 'summary'),
    issueList: element('issue-list', 'div'),
    matches: element('matches', 'details'),
    matchList: element('match-list', 'div'),
    mappingArea: element('mapping-area', 'section'),
    mappingFields: element('mapping-fields', 'fieldset'),
    regex: element('regex', 'form'),
    pattern: element('regex-pattern', 'input'),
    replacement: element('regex-replacement', 'input'),
    mappings: element('mappings', 'div'),
    scope: element('scope', 'select'),
    scopeNote: element('scope-note', 'p'),
    cleanup: element('cleanup', 'input'),
    preview: element('preview', 'button'),
    review: element('review', 'section'),
    planSummary: element('plan-summary', 'p'),
    changes: element('changes', 'div'),
    approvalWrap: element('delete-confirm-wrap', 'label'),
    approval: element('delete-confirm', 'input'),
    apply: element('apply', 'button'),
    execution: element('execution', 'section'),
    progress: element('progress', 'progress'),
    progressText: element('progress-text', 'p'),
    stop: element('stop', 'button'),
    log: element('log', 'ol'),
  };
  const fullScope = $.scope.options[1]!;
  const fields = new Map<string, HTMLTextAreaElement>();
  // Lists are rebuilt only when their source object changes.
  const rendered: { snapshot?: Snapshot; matching?: MatchResult; plan?: Plan; log?: Operation[] } =
    {};

  $.refresh.addEventListener('click', () => void controller.refresh());
  $.csv.addEventListener('change', () => {
    const file = $.csv.files?.[0];
    if (file) void controller.importCsv(file);
  });
  $.regex.addEventListener('submit', (event) => {
    event.preventDefault();
    controller.replaceLabels($.pattern.value, $.replacement.value);
  });
  for (const node of [$.scope, $.cleanup])
    node.addEventListener('change', () =>
      controller.options($.scope.value === 'replace', $.cleanup.checked),
    );
  $.preview.addEventListener('click', () => {
    controller.preview();
    if (controller.state.plan) $.review.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $.approval.addEventListener('change', () => controller.approve($.approval.checked));
  $.apply.addEventListener('click', () => void controller.apply());
  $.stop.addEventListener('click', () => controller.stop());

  function renderRoster(snapshot: Snapshot | undefined) {
    $.rosterSummary.textContent = count(snapshot?.roster.length ?? 0, 'student');
    $.rosterList.replaceChildren(
      ...(snapshot?.roster ?? []).map((s) =>
        row(s.name || s.uid || 'Pending student', `UIN ${s.uin || 'missing'} · ${s.status}`),
      ),
    );
  }
  function renderMatching(matching: MatchResult | undefined, mapping: Mapping) {
    const issues = [...(matching?.errors ?? []), ...(matching?.issues ?? [])];
    $.issues.hidden = !issues.length;
    $.issues.open = !!matching?.errors.length;
    $.issuesSummary.textContent = count(issues.length, 'import issue');
    $.issueList.replaceChildren(...issues.map((text) => el('div', text, 'row')));
    $.matchSummary.textContent = matching
      ? `${count(matching.matches.length, 'student')} matched`
      : '';
    $.matches.hidden = !matching?.matches.length;
    $.matchList.replaceChildren(
      ...(matching?.matches ?? []).map((m) =>
        row(m.student.name || m.student.uid, `${m.student.uin} · ${m.sections.join(' | ')}`),
      ),
    );
    fields.clear();
    $.mappings.replaceChildren();
    for (const [index, section] of [...mapping.keys()].entries()) {
      const students = matching?.matches.filter((m) => m.sections.includes(section)).length ?? 0;
      const label = el('label', section),
        field = el('textarea');
      label.append(el('small', ` · ${count(students, 'student')}`));
      label.htmlFor = field.id = `mapping-${index}`;
      field.spellcheck = false;
      field.addEventListener('input', () => controller.edit(section, field.value));
      fields.set(section, field);
      $.mappings.append(label, field);
    }
  }
  function syncMapping(mapping: Mapping) {
    for (const [section, field] of fields) {
      const labels = mapping.get(section) ?? [];
      // Never rewrite the field being typed in; its text is normalized only in state.
      if (field === document.activeElement || field.value === labels.join('\n')) continue;
      field.value = labels.join('\n');
      field.rows = Math.max(2, labels.length);
    }
  }
  function renderPlan(plan: Plan | undefined, snapshot: Snapshot | undefined) {
    const { create = 0, destroy = 0, add = 0, remove = 0 } = plan?.summary ?? {};
    $.planSummary.textContent = plan
      ? `${count(plan.scope, 'student')} in scope · Labels: ${create} new, ${destroy} deleted · Memberships: ${add} added, ${remove} removed`
      : '';
    const students = new Map(snapshot?.roster.map((s) => [s.id, s]));
    $.changes.replaceChildren(
      ...(plan?.changes ?? []).map((change) => {
        const actions: string[] = [];
        if (change.create) actions.push('New label');
        if (change.add.length) actions.push(`Add ${count(change.add.length, 'student')}`);
        if (change.remove.length) actions.push(`Remove ${count(change.remove.length, 'student')}`);
        if (change.destroy) actions.push('Delete label');
        const node = el('div', undefined, 'change');
        node.append(
          el('strong', change.name),
          el('p', actions.join(' · '), change.destroy ? 'warning-text' : 'muted'),
        );
        if (change.add.length || change.remove.length) {
          const details = el('details'),
            list = el('ul');
          for (const [verb, ids] of [
            ['Add', change.add],
            ['Remove', change.remove],
          ] as const)
            for (const id of ids) {
              const student = students.get(id);
              list.append(
                el(
                  'li',
                  `${verb}: ${student?.name || student?.uid || id} · ${student?.uin || 'No UIN'}`,
                ),
              );
            }
          details.append(el('summary', 'Students'), list);
          node.append(details);
        }
        return node;
      }),
    );
  }

  return (state: State) => {
    const allowed = capabilities(state),
      snapshot = state.session?.snapshot,
      context = state.session?.context,
      { matching, plan, progress } = state;

    $.notice.textContent = state.notice;
    $.notice.hidden = !state.notice;
    $.notice.classList.toggle('error', state.error);

    $.course.textContent =
      snapshot?.title ?? (state.phase === 'loading' ? 'Loading course…' : 'No course selected');
    $.origin.textContent = context?.origin ?? '';
    $.origin.title = context ? `${context.origin}${context.base}` : '';
    $.refresh.disabled = !allowed.refresh;
    $.rosterDetails.hidden = !snapshot;
    if (snapshot !== rendered.snapshot) renderRoster((rendered.snapshot = snapshot));

    $.csv.disabled = !allowed.csv;
    if (!state.filename) $.csv.value = '';
    if (matching !== rendered.matching)
      renderMatching((rendered.matching = matching), state.mapping);

    $.mappingArea.hidden = !matching || matching.errors.length > 0;
    $.mappingFields.disabled = !allowed.mapping;
    syncMapping(state.mapping);
    $.scope.value = state.replace ? 'replace' : 'imported';
    fullScope.disabled = !!matching?.issues.length;
    fullScope.textContent = fullScope.disabled
      ? 'All joined PL students (resolve import issues first)'
      : 'All joined PL students';
    $.scopeNote.hidden = !state.replace;
    $.cleanup.checked = state.cleanup;
    $.preview.disabled = !allowed.preview;

    $.review.hidden = !plan;
    if (plan !== rendered.plan) renderPlan((rendered.plan = plan), snapshot);
    $.approvalWrap.hidden = !plan?.summary.destroy;
    $.approval.disabled = state.phase !== 'preview';
    $.approval.checked = state.approved;
    $.apply.disabled = !allowed.apply;

    $.execution.hidden = !progress && !running(state);
    $.stop.hidden = !running(state);
    $.stop.disabled = !allowed.stop;
    $.progress.max = progress?.total || 1;
    $.progress.value = progress?.completed ?? 0;
    $.progressText.textContent = !progress
      ? running(state)
        ? 'Checking current state…'
        : ''
      : progress.phase === 'sending'
        ? `Step ${progress.completed + 1} of ${progress.total}: ${describe(progress.operation)}…`
        : `${progress.completed} of ${progress.total} verified`;
    if (state.log !== rendered.log)
      $.log.replaceChildren(...(rendered.log = state.log).map((op) => el('li', describe(op))));
  };
}
