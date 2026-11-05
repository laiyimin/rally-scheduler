import { test } from "node:test";
import assert from "node:assert/strict";
import { toCloud, fromCloud, parseShareHash } from "../js/cloud.js";

const ev = {
  id: "local1",
  title: "11/5（四）球敘",
  date: "2026/11/5",
  mode: "doubles",
  courts: 1,
  perGame: 15,
  start: "16:00",
  createdAt: 1,
  players: [
    { id: "a", name: "Evan", fromRound: 0, arrive: null },
    { id: "b", name: "民", fromRound: 1, arrive: "16:15" },
    { id: "c", name: "阿德", fromRound: 0, left: true },
  ],
  rounds: [
    { matches: [{ court: 1, a: ["a", "c"], b: ["b", "d"], sa: 21, sb: 18, done: true }], rest: [], absent: ["b"] },
    { matches: [{ court: 1, a: ["a", "b"], b: ["c", "d"], sa: 0, sb: 0, done: false }], rest: ["e"], absent: [] },
  ],
};

test("雲端資料來回轉換不會遺失內容", () => {
  const back = fromCloud(JSON.parse(JSON.stringify(toCloud(ev))));
  assert.equal(back.title, ev.title);
  assert.equal(back.mode, "doubles");
  assert.deepEqual(back.rounds, ev.rounds);
  assert.equal(back.players[1].arrive, "16:15");
  assert.equal(back.players[2].left, true);
  assert.equal(back.players[0].left, undefined);
});

test("Realtime Database 刪掉空陣列、把陣列存成物件時也能還原", () => {
  const stored = {
    meta: { title: "x", mode: "singles", courts: 2 },
    players: { 0: { id: "a", name: "A" }, 1: { id: "b", name: "B" } },
    rounds: { 0: { matches: { 0: { court: 1, a: { 0: "a" }, b: ["b"], sa: 3 } } } }, // 沒有 rest、absent、sb、done
  };
  const back = fromCloud(stored);
  assert.deepEqual(back.players.map((p) => p.name), ["A", "B"]);
  assert.deepEqual(back.rounds[0], { matches: [{ court: 1, a: ["a"], b: ["b"], sa: 3, sb: 0, done: false }], rest: [], absent: [] });
});

test("分享連結解析", () => {
  assert.deepEqual(parseShareHash("#j=Ab3dEf7hJk9m~ABCDEFGHJKLMNPQRSTUV"), { id: "Ab3dEf7hJk9m", key: "ABCDEFGHJKLMNPQRSTUV" });
  assert.deepEqual(parseShareHash("#w=Ab3dEf7hJk9m"), { id: "Ab3dEf7hJk9m", key: null });
  assert.equal(parseShareHash("#w=short"), null);
  assert.equal(parseShareHash("#j=Ab3dEf7hJk9m~tooShort"), null);
  assert.equal(parseShareHash("#s=zabc"), null);
  assert.equal(fromCloud(null), null);
});
