// 每面場地各自往下打（不用等整輪）
//
// 規則：一面場地打完，就從賽程裡找「最早的一場、而且人都沒在別的場地上」的比賽遞補。
// 通常就是下一輪同一面場的比賽；如果那場有人還在別的場地打，就先上後面人都有空的那場。
// 沒有可以上的比賽時，那面場地等待。
//
// 這裡不另外存「哪場在哪面場地」，而是每次都從「每場打完的時間（doneAt）」重新推算一遍。
// 這樣兩支手機各自計算，結果一定一樣，不會把同一場比賽分配到兩面場地。

const players = (q) => [...q.m.a, ...q.m.b];
export const matchKey = (ri, mi) => `${ri}-${mi}`;

// 打完了（含：打完後又打開來改比分的，doneAt 會保留，不影響場地安排）
export const isFinished = (m) => m.done || m.doneAt != null;

export function courtFlow(ev) {
  const queue = [];
  ev.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => queue.push({ ri, mi, m, key: matchKey(ri, mi) })));
  const nCourts = Math.max(0, ...ev.rounds.map((r) => r.matches.length));
  const onCourt = new Array(nCourts).fill(null);
  const busy = new Set();
  const courtOf = new Map(); // key → 第幾面場地（1 起算）
  const pending = queue.slice();

  // 把空著的場地補滿：照賽程順序找人都有空的比賽；
  // 優先放回它原本排定的場地（下一輪的場 1 → 場地 1），那面場不空才放別的空場
  const fillEmpty = () => {
    for (;;) {
      const empties = [];
      onCourt.forEach((q, k) => !q && empties.push(k));
      if (!empties.length) return;
      // 最多只往後看到「最早還沒打的那一輪」的下一輪，避免把太後面（例如晚到的人）的比賽拉上來
      const horizon = pending.length ? pending[0].ri + 1 : 0;
      const i = pending.findIndex((q) => q.ri <= horizon && players(q).every((p) => !busy.has(p)));
      if (i < 0) return;
      const q = pending.splice(i, 1)[0];
      const pref = (q.m.court || q.mi + 1) - 1;
      const k = empties.includes(pref) ? pref : empties[0];
      onCourt[k] = q;
      players(q).forEach((p) => busy.add(p));
      courtOf.set(q.key, k + 1);
    }
  };

  fillEmpty();

  // 依打完的時間順序重播；舊資料沒有 doneAt 的照賽程順序
  const finished = queue
    .filter((q) => isFinished(q.m))
    .sort((a, b) => (a.m.doneAt ?? 0) - (b.m.doneAt ?? 0) || a.ri - b.ri || a.mi - b.mi);
  for (const f of finished) {
    const k = onCourt.indexOf(f);
    if (k < 0) {
      // 沒排上場就被標成打完（例如在「賽程」分頁直接記分）：從待打名單拿掉就好
      const i = pending.indexOf(f);
      if (i >= 0) pending.splice(i, 1);
      if (!courtOf.has(f.key)) courtOf.set(f.key, f.m.court);
      continue;
    }
    players(f).forEach((p) => busy.delete(p));
    onCourt[k] = null;
    fillEmpty();
  }

  const doneCount = queue.filter((q) => isFinished(q.m)).length;
  return {
    nCourts,
    // 每面場地現在在打的比賽（沒有 = 等待中或已經全部打完）
    courts: onCourt.map((q) => (q ? { ri: q.ri, mi: q.mi, key: q.key } : null)),
    // 還沒上場的比賽，照順序
    pending: pending.map((q) => ({ ri: q.ri, mi: q.mi, key: q.key })),
    courtOf,
    doneCount,
    total: queue.length,
    allDone: doneCount === queue.length,
  };
}

// 場地空著時，說明在等誰：第一場待打比賽裡，還在別的場地上的人
export function waitingFor(ev, flow) {
  const first = flow.pending[0];
  if (!first) return [];
  const m = ev.rounds[first.ri].matches[first.mi];
  const playingNow = new Set(
    flow.courts.filter(Boolean).flatMap((c) => {
      const x = ev.rounds[c.ri].matches[c.mi];
      return [...x.a, ...x.b];
    })
  );
  return [...m.a, ...m.b].filter((p) => playingNow.has(p));
}

// 現在沒有在任何場地上的人
export function benched(ev, flow, activeIds) {
  const playingNow = new Set(
    flow.courts.filter(Boolean).flatMap((c) => {
      const x = ev.rounds[c.ri].matches[c.mi];
      return [...x.a, ...x.b];
    })
  );
  return activeIds.filter((id) => !playingNow.has(id));
}
