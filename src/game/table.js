// A "table" is where a round's shared truth lives: room state during a match (every page reads it, a reload or a
// new host finds it), or a local object for the solo activities in the clubhouse (practice, the daily, the tour).
// Both offer the same get/set, so the round rules and the session code never know which they are on.

export function roomTable(room) {
  return {
    kind: 'room',
    get: (k) => room.state[k],
    set: (k, v) => {
      try {
        room.setState(k, v === undefined ? null : v);
      } catch {}
    },
    keys: () => Object.keys(room.state),
  };
}

export function localTable() {
  const s = {};
  return {
    kind: 'local',
    get: (k) => s[k],
    set: (k, v) => {
      if (v === null || v === undefined) delete s[k];
      else s[k] = v;
    },
    keys: () => Object.keys(s),
    state: s,
  };
}

/** Keys: the round record and one shot record per player. */
export const G_KEY = 'g';
export const shotKey = (pid) => `s.${pid}`;
