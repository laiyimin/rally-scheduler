import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchedule, standings } from "../js/scheduler.js";

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

function check(rounds, size) {
  for (const r of rounds) {
    const seen = new Set();
    for (const m of r.matches) {
      assert.equal(m.a.length + m.b.length, size);
      for (const id of [...m.a, ...m.b]) {
        assert.ok(!seen.has(id), "同一輪重複出場");
        seen.add(id);
      }
    }
    for (const id of r.rest) assert.ok(!seen.has(id), "休息的人不能上場");
  }
}

function games(rounds) {
  const g = {};
  for (const r of rounds) for (const m of r.matches) for (const id of [...m.a, ...m.b]) g[id] = (g[id] || 0) + 1;
  return g;
}

test("6 人雙打 1 面場 10 輪：上場數差距 ≤ 1、不連休兩輪以上", () => {
  const rounds = buildSchedule({ players: mk(6), mode: "doubles", courts: 1, rounds: 10, seed: 1 });
  assert.equal(rounds.length, 10);
  check(rounds, 4);
  const g = Object.values(games(rounds));
  assert.ok(Math.max(...g) - Math.min(...g) <= 1, JSON.stringify(g));
  const streak = {};
  for (const r of rounds) {
    for (const id of r.rest) {
      streak[id] = (streak[id] || 0) + 1;
      assert.ok(streak[id] <= 1, "連續休息兩輪");
    }
    for (const m of r.matches) for (const id of [...m.a, ...m.b]) streak[id] = 0;
  }
});

test("不會連打太多場：6 人雙打 1 面場最多連打 2 場，7 人以上也是", () => {
  for (const n of [6, 7, 9]) {
    for (let seed = 1; seed <= 5; seed++) {
      const rounds = buildSchedule({ players: mk(n), mode: "doubles", courts: 1, rounds: 12, seed });
      const streak = {};
      for (const r of rounds) {
        const on = new Set(r.matches.flatMap((m) => [...m.a, ...m.b]));
        for (const p of mk(n)) {
          streak[p.id] = on.has(p.id) ? (streak[p.id] || 0) + 1 : 0;
          assert.ok(streak[p.id] <= 2, `${n} 人、seed ${seed}：${p.id} 連打 ${streak[p.id]} 場`);
        }
      }
    }
  }
});

test("10 人雙打 2 面場：每輪 2 場、2 人休息", () => {
  const rounds = buildSchedule({ players: mk(10), mode: "doubles", courts: 2, rounds: 8, seed: 2 });
  check(rounds, 4);
  for (const r of rounds) {
    assert.equal(r.matches.length, 2);
    assert.equal(r.rest.length, 2);
  }
});

test("5 人單打 2 面場", () => {
  const rounds = buildSchedule({ players: mk(5), mode: "singles", courts: 2, rounds: 10, seed: 3 });
  check(rounds, 2);
  const g = Object.values(games(rounds));
  assert.ok(Math.max(...g) - Math.min(...g) <= 1);
});

test("6 人單打 1 面場 15 輪：對手組合要多樣，不能一直循環", () => {
  const rounds = buildSchedule({ players: mk(6), mode: "singles", courts: 1, rounds: 15, seed: 7 });
  const pairs = new Set(rounds.map((r) => [...r.matches[0].a, ...r.matches[0].b].sort().join("|")));
  assert.ok(pairs.size >= 13, `只有 ${pairs.size} 種對戰組合`);
  const g = Object.values(games(rounds));
  assert.ok(Math.max(...g) - Math.min(...g) <= 1);
});

test("雙打搭檔盡量不重複：8 人 1 面場 14 輪，任兩人搭檔 ≤ 2 次", () => {
  const rounds = buildSchedule({ players: mk(8), mode: "doubles", courts: 1, rounds: 14, seed: 8 });
  const partner = {};
  for (const r of rounds)
    for (const m of r.matches)
      for (const t of [m.a, m.b]) {
        const k = t.slice().sort().join("|");
        partner[k] = (partner[k] || 0) + 1;
      }
  assert.ok(Math.max(...Object.values(partner)) <= 2, JSON.stringify(partner));
});

test("晚到的人在到場前不排", () => {
  const players = mk(6);
  players[1].fromRound = 3;
  const rounds = buildSchedule({ players, mode: "doubles", courts: 1, rounds: 8, seed: 4 });
  for (let r = 0; r < 3; r++) {
    for (const m of rounds[r].matches) assert.ok(![...m.a, ...m.b].includes("p1"));
    assert.ok(rounds[r].absent.includes("p1"));
  }
});

test("保留已打的輪次後重排", () => {
  const first = buildSchedule({ players: mk(6), mode: "doubles", courts: 1, rounds: 3, seed: 5 });
  const more = buildSchedule({ players: mk(7), mode: "doubles", courts: 1, rounds: 5, keep: first, seed: 6 });
  assert.equal(more.length, 8);
  assert.deepEqual(more.slice(0, 3), first);
  check(more, 4);
});

test("排名：勝場 > 淨勝分", () => {
  const players = mk(4);
  const rounds = [
    { matches: [{ a: ["p0", "p1"], b: ["p2", "p3"], sa: 21, sb: 10, done: true }], rest: [] },
    { matches: [{ a: ["p0", "p2"], b: ["p1", "p3"], sa: 19, sb: 21, done: true }], rest: [] },
  ];
  const s = standings(players, rounds);
  assert.equal(s[0].id, "p1"); // 2 勝
  // p0、p3 都是 1 勝；p0 淨勝 +9、p3 淨勝 -9 → p0 在前；p2 0 勝墊底
  assert.deepEqual(s.map((r) => r.id), ["p1", "p0", "p3", "p2"]);
});
