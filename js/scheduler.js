// 排賽程：單打 / 雙打、多面場地、晚到球員
// 目標（依重要性）：每人上場數平均 > 不連續上場太多場 > 不連續休息 > 搭檔不重複 > 對手不重複
// 做法：每輪貪婪挑人 + 隨機搜尋分組，整份賽程跑多次取總成本最低者

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function emptyStats(ids) {
  const s = { games: {}, restStreak: {}, playStreak: {}, lastPlayed: {}, partner: {}, opponent: {} };
  for (const id of ids) {
    s.games[id] = 0;
    s.restStreak[id] = 0;
    s.playStreak[id] = 0;
    s.lastPlayed[id] = -1;
  }
  return s;
}

function cloneStats(s) {
  return {
    games: { ...s.games },
    restStreak: { ...s.restStreak },
    playStreak: { ...s.playStreak },
    lastPlayed: { ...s.lastPlayed },
    partner: { ...s.partner },
    opponent: { ...s.opponent },
  };
}

// 從已排好的輪次重建統計（用於「重排剩餘賽程」）
export function statsFromRounds(ids, rounds) {
  const s = emptyStats(ids);
  rounds.forEach((round, r) => applyRound(s, round, r, ids));
  return s;
}

function applyRound(s, round, r, ids) {
  const playing = new Set();
  for (const m of round.matches) {
    for (const id of [...m.a, ...m.b]) {
      playing.add(id);
      s.games[id] = (s.games[id] || 0) + 1;
      s.lastPlayed[id] = r;
    }
    if (m.a.length === 2) s.partner[pairKey(m.a[0], m.a[1])] = (s.partner[pairKey(m.a[0], m.a[1])] || 0) + 1;
    if (m.b.length === 2) s.partner[pairKey(m.b[0], m.b[1])] = (s.partner[pairKey(m.b[0], m.b[1])] || 0) + 1;
    for (const x of m.a) for (const y of m.b) s.opponent[pairKey(x, y)] = (s.opponent[pairKey(x, y)] || 0) + 1;
  }
  for (const id of ids) {
    if (!(id in s.games)) {
      s.games[id] = 0;
      s.lastPlayed[id] = -1;
    }
    s.restStreak[id] = playing.has(id) ? 0 : (s.restStreak[id] || 0) + 1;
    s.playStreak[id] = playing.has(id) ? (s.playStreak[id] || 0) + 1 : 0;
  }
}

function arrangementCost(groups, s, size) {
  let cost = 0;
  const oppW = size === 2 ? 40 : 3; // 單打只有對手一個變數，重複對戰要罰重一點
  for (const g of groups) {
    const a = g.slice(0, size / 2);
    const b = g.slice(size / 2);
    if (size === 4) {
      cost += 20 * (s.partner[pairKey(a[0], a[1])] || 0) ** 2;
      cost += 20 * (s.partner[pairKey(b[0], b[1])] || 0) ** 2;
    }
    for (const x of a) for (const y of b) cost += oppW * (s.opponent[pairKey(x, y)] || 0) ** 2;
  }
  return cost;
}

// 理想的連續休息輪數：每輪休息人數 / 上場人數（無條件進位）
// 超過理想 1 輪 → 中等罰分（換來對手/搭檔多樣性時可接受）；超過 2 輪以上 → 幾乎禁止
export function idealRest(available, need) {
  return Math.max(1, Math.ceil((available - need) / need));
}
const SOFT_REST = 30;
const HARD_REST = 200;

// 最多連續上場幾輪：目標是「不連打 3 場」（連打 2 場可以接受，
// 若硬要每打一場就休一場，會變成固定兩組人輪流，搭檔一直重複）。
// 人太少時做不到：每個人在每 (S+1) 輪內至少要休息一次，而每輪只有
// (人數 − 上場人數) 個休息名額 → 最低只能到 S = ⌈人數 / 休息名額⌉ − 1。
// 沒有人休息（例如 8 人 2 面場雙打）時一定會一直連打，回傳 Infinity。
export function idealPlayStreak(available, need) {
  const restSlots = available - need;
  if (restSlots <= 0) return Infinity;
  return Math.max(2, Math.ceil(available / restSlots) - 1);
}
const HARD_PLAY = 200;

function planRound(available, s, matchCount, size, rnd) {
  const need = matchCount * size;
  const ideal = idealRest(available.length, need);
  const allow = ideal + 1;
  const maxPlay = idealPlayStreak(available.length, need);
  // 上場數少的一定先上；同一級距內的人選用隨機嘗試，
  // 讓「誰上場」和「怎麼分組」一起評估，避免同樣的對戰一直循環
  // 偶爾讓「多打一場」的人往前擠一點（有罰分），避免賽程卡進固定週期
  const order = (list, loose) => {
    const key = Object.fromEntries(list.map((id) => [id, s.games[id] - (loose && rnd() < 0.35 ? 1 : 0)]));
    // 已經連打到上限的人排到後面（這輪休息）
    const tired = (id) => (s.playStreak[id] >= maxPlay ? 1 : 0);
    return shuffle(list, rnd).sort(
      (x, y) => tired(x) - tired(y) || key[x] - key[y] || (s.restStreak[y] >= allow) - (s.restStreak[x] >= allow)
    );
  };
  const minGames = Math.min(...available.map((id) => s.games[id]));

  let best = null;
  let bestRest = null;
  let bestCost = Infinity;
  const tries = size === 4 ? 160 : 100;
  for (let t = 0; t < tries; t++) {
    const ranked = order(available, t % 2 === 1);
    const chosen = shuffle(ranked.slice(0, need), rnd);
    const rest = ranked.slice(need);
    const groups = [];
    for (let i = 0; i < matchCount; i++) groups.push(chosen.slice(i * size, (i + 1) * size));
    let c = arrangementCost(groups, s, size);
    for (const id of chosen) {
      c += 15 * (s.games[id] - minGames) ** 2; // 讓上場多的人再上，要付代價
      if (s.playStreak[id] + 1 > maxPlay) c += HARD_PLAY; // 連打超過上限
    }
    for (const id of rest) {
      const streak = s.restStreak[id] + 1;
      c += 2 * streak; // 連續休息越久越該上場（輕微偏好）
      if (streak > ideal) c += SOFT_REST;
      if (streak > allow) c += HARD_REST;
    }
    if (c < bestCost) {
      bestCost = c;
      best = groups;
      bestRest = rest;
    }
  }
  const rest = bestRest;
  const matches = best.map((g, i) => ({
    court: i + 1,
    a: g.slice(0, size / 2),
    b: g.slice(size / 2),
    sa: 0,
    sb: 0,
    done: false,
  }));
  return { matches, rest, cost: bestCost };
}

/**
 * @param {object} opt
 * @param {{id:string, fromRound?:number}[]} opt.players  fromRound：第幾輪（0 起算）之後才到
 * @param {"doubles"|"singles"} opt.mode
 * @param {number} opt.courts
 * @param {number} opt.rounds  要排幾輪
 * @param {object[]} [opt.keep]  已打過、要保留的輪次
 * @param {number} [opt.seed]
 */
export function buildSchedule({ players, mode, courts, rounds, keep = [], seed = Date.now(), trials = 40 }) {
  const size = mode === "singles" ? 2 : 4;
  const ids = players.map((p) => p.id);
  const fromRound = Object.fromEntries(players.map((p) => [p.id, p.fromRound || 0]));
  const base = statsFromRounds(ids, keep);
  const rnd = mulberry32(seed);

  let best = null;
  let bestScore = Infinity;
  for (let t = 0; t < trials; t++) {
    const s = cloneStats(base);
    const out = [];
    let score = 0;
    let overRest = 0;
    for (let r = keep.length; r < keep.length + rounds; r++) {
      const available = ids.filter((id) => fromRound[id] <= r);
      const matchCount = Math.min(courts, Math.floor(available.length / size));
      if (matchCount === 0) break;
      const plan = planRound(available, s, matchCount, size, rnd);
      const notYet = ids.filter((id) => fromRound[id] > r);
      const round = { matches: plan.matches, rest: plan.rest, absent: notYet };
      applyRound(s, round, r, available);
      const ideal = idealRest(available.length, matchCount * size);
      const maxPlay = idealPlayStreak(available.length, matchCount * size);
      for (const id of available) if (s.playStreak[id] > maxPlay) overRest += HARD_PLAY;
      for (const id of plan.rest) {
        if (s.restStreak[id] > ideal) overRest += SOFT_REST;
        if (s.restStreak[id] > ideal + 1) overRest += HARD_REST;
      }
      score += plan.cost;
      out.push(round);
    }
    // 上場數差距（只比較同時段在場的人，晚到者自然少打，不算懲罰）
    const counts = ids.filter((id) => fromRound[id] === 0).map((id) => s.games[id]);
    if (counts.length) score += 40 * (Math.max(...counts) - Math.min(...counts));
    score += overRest;
    if (score < bestScore) {
      bestScore = score;
      best = out;
    }
  }
  return [...keep, ...(best || [])];
}

// 依時間推算可以打幾輪
export function roundsFromTime(minutes, perGame) {
  if (!minutes || !perGame) return 0;
  return Math.max(1, Math.floor(minutes / perGame));
}

export function standings(players, rounds) {
  const t = {};
  for (const p of players) t[p.id] = { id: p.id, name: p.name, played: 0, w: 0, l: 0, pf: 0, pa: 0 };
  for (const round of rounds) {
    for (const m of round.matches) {
      if (!m.done) continue;
      const aWin = m.sa > m.sb;
      const tie = m.sa === m.sb;
      for (const id of m.a) {
        const r = t[id];
        if (!r) continue;
        r.played++;
        r.pf += m.sa;
        r.pa += m.sb;
        if (!tie) aWin ? r.w++ : r.l++;
      }
      for (const id of m.b) {
        const r = t[id];
        if (!r) continue;
        r.played++;
        r.pf += m.sb;
        r.pa += m.sa;
        if (!tie) aWin ? r.l++ : r.w++;
      }
    }
  }
  return Object.values(t).sort(
    (x, y) => y.w - x.w || y.pf - y.pa - (x.pf - x.pa) || y.pf - x.pf || x.pa - y.pa
  );
}
