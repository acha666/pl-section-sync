import type { Controller, State } from './controller.js';
import { capabilities } from './controller.js';
import type { Mapping, MatchResult, Plan, Snapshot } from '../core/types.js';

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
export function createView(controller: Controller) {
  const course = element('course', 'h2'),
    origin = element('origin', 'p'),
    notice = element('notice', 'p');
  const refresh = element('refresh', 'button'),
    csv = element('csv', 'input');
  const scope = element('scope', 'select'),
    cleanup = element('cleanup', 'input');
  const preview = element('preview', 'button'),
    apply = element('apply', 'button'),
    stop = element('stop', 'button');
  const pattern = element('regex-pattern', 'input'),
    replacement = element('regex-replacement', 'input'),
    replaceLabels = element('replace-labels', 'button');
  const approval = element('delete-confirm', 'input');
  let renderedMatching: MatchResult | undefined,
    renderedSnapshot: Snapshot | undefined,
    renderedMapping: Mapping | undefined,
    renderedPlan: Plan | undefined;
  refresh.addEventListener('click', () => {
    void controller.refresh();
  });
  csv.addEventListener('change', () => {
    const file = csv.files?.[0];
    if (file) void controller.importCsv(file);
  });
  for (const node of [scope, cleanup])
    node.addEventListener('change', () =>
      controller.options(scope.value === 'replace', cleanup.checked),
    );
  preview.addEventListener('click', () => {
    controller.preview();
    if (controller.state.plan)
      element('review', 'section').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  replaceLabels.addEventListener('click', () =>
    controller.replaceLabels(pattern.value, replacement.value),
  );
  approval.addEventListener('change', () => controller.approve(approval.checked));
  apply.addEventListener('click', () => {
    void controller.apply();
  });
  stop.addEventListener('click', () => controller.stop());
  return (state: State) => {
    const allowed = capabilities(state),
      snapshot = state.session?.snapshot;
    notice.textContent = state.notice;
    notice.hidden = !state.notice;
    notice.classList.toggle('error', state.error);
    course.textContent =
      snapshot?.title ?? (state.phase === 'loading' ? 'Loading course…' : 'No course selected');
    origin.textContent = state.session?.context.origin ?? '';
    origin.title = state.session
      ? `${state.session.context.origin}${state.session.context.base}`
      : '';
    refresh.disabled = !allowed.refresh;
    csv.disabled = !allowed.csv;
    scope.disabled = cleanup.disabled = !allowed.mapping;
    pattern.disabled = replacement.disabled = replaceLabels.disabled = !allowed.mapping;
    preview.disabled = !allowed.preview;
    apply.disabled = !allowed.apply;
    stop.disabled = !allowed.stop;
    stop.hidden = !['applying', 'stopping'].includes(state.phase);
    approval.disabled = state.phase !== 'preview';
    approval.checked = state.approved;
    scope.value = state.replace ? 'replace' : 'imported';
    scope.options[1]!.disabled = !!state.matching?.issues.length;
    cleanup.checked = state.cleanup;
    element('scope-note', 'p').hidden = !state.replace;
    if (!state.filename) csv.value = '';
    element('roster-details', 'details').hidden = !snapshot;
    if (snapshot !== renderedSnapshot) {
      renderedSnapshot = snapshot;
      const root = element('roster-list', 'div');
      root.replaceChildren();
      element('roster-summary', 'summary').textContent = `${snapshot?.roster.length ?? 0} students`;
      for (const s of snapshot?.roster ?? []) {
        const row = el('div', s.name || s.uid || 'Pending student', 'row');
        row.append(el('small', `UIN ${s.uin || 'missing'} · ${s.status}`));
        root.append(row);
      }
    }
    const matching = state.matching;
    element('mapping-area', 'div').hidden = !matching || !!matching.errors.length;
    if (matching !== renderedMatching) {
      renderedMatching = matching;
      const issues = [...(matching?.errors ?? []), ...(matching?.issues ?? [])];
      const issueList = element('issue-list', 'div');
      issueList.replaceChildren(...issues.map((text) => el('div', text, 'row')));
      element('issues', 'details').hidden = !issues.length;
      element('issues', 'details').open = !!matching?.errors.length;
      element('issues-summary', 'summary').textContent = `${issues.length} import issues`;
      element('match-summary', 'p').textContent = matching
        ? `${matching.matches.length} ${matching.matches.length === 1 ? 'student' : 'students'} matched`
        : '';
      element('matches', 'details').hidden = !matching?.matches.length;
      const matchList = element('match-list', 'div');
      matchList.replaceChildren();
      for (const m of matching?.matches ?? []) {
        const row = el('div', m.student.name || m.student.uid, 'row');
        row.append(el('small', `${m.student.uin} · ${m.sections.join(' | ')}`));
        matchList.append(row);
      }
    }
    if (state.mapping !== renderedMapping) {
      renderedMapping = state.mapping;
      const mappings = element('mappings', 'div');
      mappings.replaceChildren();
      for (const [index, [section, labels]] of [...state.mapping].entries()) {
        const label = el('label', section),
          field = el('textarea');
        label.htmlFor = field.id = `mapping-${index}`;
        field.value = labels.join('\n');
        field.rows = Math.max(2, labels.length);
        field.spellcheck = false;
        field.addEventListener('input', () => controller.edit(section, field.value));
        mappings.append(label, field);
      }
    }
    for (const field of document.querySelectorAll<HTMLTextAreaElement>('#mappings textarea'))
      field.disabled = !allowed.mapping;
    const plan = state.plan;
    element('review', 'section').hidden = !plan;
    element('delete-confirm-wrap', 'label').hidden = !plan?.summary.destroy;
    if (plan !== renderedPlan) {
      renderedPlan = plan;
      const root = element('changes', 'div');
      root.replaceChildren();
      element('plan-summary', 'p').textContent = plan
        ? `${plan.scope} ${plan.scope === 1 ? 'student' : 'students'} · Labels: +${plan.summary.create} / −${plan.summary.destroy} · Memberships: +${plan.summary.add} / −${plan.summary.remove}`
        : '';
      const students = new Map(snapshot?.roster.map((s) => [s.id, s]));
      for (const change of plan?.changes ?? []) {
        const row = el('div', undefined, 'change');
        row.append(
          el('strong', change.name),
          el(
            'p',
            [
              change.create ? 'Create' : '',
              `Add ${change.add.length}`,
              `Remove ${change.remove.length}`,
              change.destroy ? 'Delete' : '',
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        );
        if (change.add.length || change.remove.length) {
          const details = el('details'),
            list = el('ul');
          details.append(el('summary', 'Students'));
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
          details.append(list);
          row.append(details);
        }
        root.append(row);
      }
    }
    element('execution', 'section').hidden =
      !state.progress && !['applying', 'stopping'].includes(state.phase);
    const progress = element('progress', 'progress');
    progress.max = state.progress?.total || 1;
    progress.value = state.progress?.index ?? 0;
    element('progress-text', 'p').textContent = state.progress
      ? `${state.progress.phase === 'sending' ? 'Applying' : 'Verified'} ${state.progress.index}/${state.progress.total}: ${state.progress.name}`
      : '';
    element('log', 'ol').replaceChildren(...state.log.map((text) => el('li', text)));
  };
}
