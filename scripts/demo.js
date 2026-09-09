import { snapshot, fakeClient } from '../test/fixtures.js';
const backend = fakeClient(snapshot());
const target = {
  windowId: 1,
  nonce: 'demo',
  context: {
    tabId: 1,
    origin: 'https://example.invalid',
    base: '/pl/course_instance/123/instructor',
    courseId: '123',
  },
};
const store = { 'target:1': target },
  listeners = [];
window.chrome = {
  runtime: { getManifest: () => ({ version: window.demoVersion }) },
  windows: { getCurrent: async () => ({ id: 1 }) },
  storage: {
    session: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (data) => {
        Object.assign(store, data);
      },
      remove: async (key) => {
        delete store[key];
      },
    },
    onChanged: { addListener: (callback) => listeners.push(callback) },
  },
  scripting: {
    executeScript: async ({ args }) => {
      const command = args[1];
      let value;
      if (command.type === 'read') {
        const s = await backend.read();
        value = {
          roster: s.roster.map((r) => ({
            enrollment: { id: r.id, course_instance_id: '123', status: r.status },
            user: { uin: r.uin, uid: r.uid, name: r.name },
          })),
          labels: {
            origHash: s.hash,
            labels: s.labels.map((l) => ({
              student_label: l,
              user_data: l.members.map((id) => ({
                enrollment_id: id,
                uid: s.roster.find((r) => r.id === id)?.uid ?? 'unknown',
              })),
            })),
          },
          title: s.title,
          canEdit: s.canEdit,
        };
      } else value = await backend.mutate(command);
      return [{ documentId: 'demo-document', result: { ok: true, value } }];
    },
  },
};
const demo = document.createElement('button');
demo.textContent = 'Load synthetic CSV';
const bar = document.createElement('div');
bar.style.padding = '0 16px';
bar.append(demo);
document.body.prepend(bar);
demo.addEventListener('click', () => {
  const transfer = new DataTransfer();
  transfer.items.add(
    new File(
      ['Student,ID,SIS Login ID,Section\nStudent One,10,001,"Lecture A and Lab B"'],
      'example-gradebook.csv',
      { type: 'text/csv' },
    ),
  );
  const input = document.getElementById('csv');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change'));
});
await import('../src/panel.js');
