export function snapshot() {
  return {
    roster: [
      { id: '1', uid: 'one@example.invalid', uin: '001', name: 'Student One', status: 'joined' },
      { id: '2', uid: 'two@example.invalid', uin: '002', name: 'Student Two', status: 'joined' },
      { id: '3', uid: 'three@example.invalid', uin: '003', name: 'Student Three', status: 'left' },
    ],
    labels: [
      { id: '11', name: 'Section Old', color: 'blue1', uuid: 'old', members: ['1', '2', '3'] },
      { id: '12', name: 'Accommodations', color: 'blue1', uuid: 'other', members: ['1'] },
      { id: '13', name: 'section Empty', color: 'blue1', uuid: 'empty', members: [] },
    ],
    hash: 'hash-1',
    canEdit: true,
    title: 'Example course · Term A',
  };
}
export function fakeClient(initial) {
  let state = structuredClone(initial),
    id = 100;
  const calls = [];
  return {
    calls,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    read: async () => structuredClone(state),
    async mutate({ method, input }) {
      calls.push({ method, input: structuredClone(input) });
      const label = state.labels.find((l) => l.id === input.labelId);
      if (method === 'upsert') {
        state.labels.push({
          id: String(id++),
          name: input.name,
          color: input.color,
          uuid: `uuid-${id}`,
          members: [],
        });
        state.hash += '+';
        return { origHash: state.hash, enrollmentWarning: null };
      }
      if (method === 'destroy') {
        state.labels = state.labels.filter((l) => l.id !== input.labelId);
        state.hash += '+';
        return { origHash: state.hash };
      }
      const add = method === 'batchAdd';
      let changed = 0;
      for (const member of input.enrollmentIds) {
        if (add && !label.members.includes(member)) {
          label.members.push(member);
          changed++;
        }
        if (!add && label.members.includes(member)) {
          label.members = label.members.filter((m) => m !== member);
          changed++;
        }
      }
      return add
        ? { added: changed, alreadyHaveLabel: input.enrollmentIds.length - changed, notFound: 0 }
        : { removed: changed, didNotHaveLabel: input.enrollmentIds.length - changed, notFound: 0 };
    },
  };
}
