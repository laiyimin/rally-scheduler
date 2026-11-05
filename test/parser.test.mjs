import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoster, parseDate, defaultTitle } from "../js/parser.js";

test("接龍格式一：有空位與滿額", () => {
  const r = parseRoster(`📆11/5（四）
⏰15:30-17:30
📍麗寶NAPA
費用：場地費均分
———————————————
1.倫
2.小甄
3.K
4.田
5.阿萱
6.
7.
8.
滿額`);
  assert.deepEqual(r.players.map((p) => p.name), ["倫", "小甄", "K", "田", "阿萱"]);
  assert.deepEqual(r.time, { start: "15:30", end: "17:30", minutes: 120 });
  assert.equal(r.title, "11/5（四） 麗寶NAPA");
});

test("接龍格式二：空白分隔、名字後帶到場時間", () => {
  const r = parseRoster(`這週四下午球敘
時間：11/5（週四）1600-1800
人數：6位
程度要求：能簡單回球
費用：100
1 Evan
2 民16:15
3 阿德
4 鴻鈞
5 柏羽
6 Yen`);
  assert.deepEqual(r.players.map((p) => p.name), ["Evan", "民", "阿德", "鴻鈞", "柏羽", "Yen"]);
  assert.equal(r.players[1].arrive, "16:15");
  assert.equal(r.title, "這週四下午球敘");
  assert.deepEqual(r.time, { start: "16:00", end: "18:00", minutes: 120 });
});

test("候補、+1、括號註記、重複名字", () => {
  const r = parseRoster(`週六場
1. 小明+1
2、阿華(晚到)
3） 小明
候補：
1. 大雄`);
  const names = r.players.map((p) => p.name);
  assert.deepEqual(names, ["小明", "小明的朋友", "阿華", "大雄"]);
  assert.deepEqual(r.players[2].notes, ["晚到"]);
  assert.equal(r.players[3].waitlist, true);
  assert.equal(r.players[3].active, false);
});

test("日期解析與預設球局名稱", () => {
  const now = new Date(2026, 10, 5); // 2026/11/5（四）
  assert.deepEqual(parseDate("📆11/5（四）\n⏰15:30-17:30", now), { year: 2026, month: 11, day: 5, weekday: "四" });
  assert.deepEqual(parseDate("時間：11/5（週四）1600-1800", now)?.weekday, "四");
  assert.equal(parseDate("1/3 新年場", new Date(2026, 11, 20)).year, 2027); // 12 月看到 1/3 → 明年
  assert.equal(parseDate("沒有日期\n1.阿明", now), null);
  assert.equal(parseDate("2/30", now), null);
  assert.equal(defaultTitle(parseDate("11/5", now)), "11/5（四）球敘");
  assert.equal(defaultTitle(null, now), "11/5（四）球敘");
});

test("全形數字", () => {
  const r = parseRoster("１．阿明\n２．阿美");
  assert.deepEqual(r.players.map((p) => p.name), ["阿明", "阿美"]);
});
