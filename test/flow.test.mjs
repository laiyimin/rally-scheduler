import { test } from "node:test";
import assert from "node:assert/strict";
import { courtFlow, waitingFor } from "../js/flow.js";

const M = (a, b, extra = {}) => ({ a, b, sa: 0, sb: 0, done: false, ...extra });
const ev2 = () => ({
  rounds: [
    { matches: [M(["A", "B"], ["C", "D"]), M(["E", "F"], ["G", "H"])] },
    { matches: [M(["A", "E"], ["I", "J"]), M(["B", "F"], ["C", "G"])] },
    { matches: [M(["D", "H"], ["I", "B"]), M(["J", "C"], ["E", "A"])] },
  ],
});
const keys = (f) => f.courts.map((c) => c && c.key);

test("一開始：第一輪各場地照順序開打", () => {
  const f = courtFlow(ev2());
  assert.deepEqual(keys(f), ["0-0", "0-1"]);
  assert.equal(f.pending[0].key, "1-0");
});

test("場地 1 先打完 → 馬上由下一輪的場 1 遞補，不用等場地 2", () => {
  const ev = ev2();
  // 下一輪場 1 是 A、E、I、J；E 還在場地 2 → 不能上
  // 所以改成：下一輪場 1 要等 E；看下一輪場 2（B、F、C、G）：F、G 也在場 2 → 不能上
  // 第三輪場 1（D、H、I、B）：H 在場 2 → 不能上；第三輪場 2（J、C、E、A）：E 在場 2 → 不能上
  ev.rounds[0].matches[0].done = true;
  ev.rounds[0].matches[0].doneAt = 100;
  let f = courtFlow(ev);
  assert.deepEqual(keys(f), [null, "0-1"]);
  assert.deepEqual(waitingFor(ev, f), ["E"]);

  // 換一個沒有衝突的例子：下一輪場 1 的人都有空 → 直接遞補
  const ev3 = {
    rounds: [
      { matches: [M(["A", "B"], ["C", "D"]), M(["E", "F"], ["G", "H"])] },
      { matches: [M(["A", "C"], ["I", "J"]), M(["B", "D"], ["E", "G"])] },
    ],
  };
  ev3.rounds[0].matches[0].done = true;
  ev3.rounds[0].matches[0].doneAt = 100;
  f = courtFlow(ev3);
  assert.deepEqual(keys(f), ["1-0", "0-1"]);
});

test("等待中的場地：另一面場打完後，兩面場一起補上", () => {
  const ev = ev2();
  ev.rounds[0].matches[0].done = true;
  ev.rounds[0].matches[0].doneAt = 100;
  ev.rounds[0].matches[1].done = true;
  ev.rounds[0].matches[1].doneAt = 200;
  const f = courtFlow(ev);
  // 兩面場都空了 → 下一輪的場 1 回到場地 1、場 2 回到場地 2
  assert.deepEqual(keys(f), ["1-0", "1-1"]);
});

test("兩支手機同時打完：依打完時間推算，結果一致且同一場不會上兩面場", () => {
  const evA = ev2();
  const evB = ev2();
  for (const ev of [evA, evB]) {
    ev.rounds[0].matches[1].done = true;
    ev.rounds[0].matches[1].doneAt = 150;
    ev.rounds[0].matches[0].done = true;
    ev.rounds[0].matches[0].doneAt = 151;
  }
  const fa = courtFlow(evA);
  const fb = courtFlow(evB);
  assert.deepEqual(keys(fa), keys(fb));
  const on = keys(fa).filter(Boolean);
  assert.equal(new Set(on).size, on.length);
});

test("打完後又打開來改比分（done=false 但有 doneAt）：不影響場地安排", () => {
  const ev = ev2();
  ev.rounds[0].matches[0].done = true;
  ev.rounds[0].matches[0].doneAt = 100;
  const before = keys(courtFlow(ev));
  ev.rounds[0].matches[0].done = false; // 改比分中
  assert.deepEqual(keys(courtFlow(ev)), before);
});

test("全部打完", () => {
  const ev = ev2();
  let t = 1;
  ev.rounds.forEach((r) => r.matches.forEach((m) => { m.done = true; m.doneAt = t++; }));
  const f = courtFlow(ev);
  assert.equal(f.allDone, true);
  assert.deepEqual(keys(f), [null, null]);
  assert.equal(f.pending.length, 0);
});

test("1 面場：就是照賽程一場接一場", () => {
  const ev = { rounds: [{ matches: [M(["A", "B"], ["C", "D"])] }, { matches: [M(["A", "E"], ["C", "F"])] }] };
  ev.rounds[0].matches[0].done = true;
  ev.rounds[0].matches[0].doneAt = 5;
  assert.deepEqual(keys(courtFlow(ev)), ["1-0"]);
});
