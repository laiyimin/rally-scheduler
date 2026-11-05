// 解析 LINE 接龍訊息：抓出編號名單、時間範圍、標題
// 設計原則：只認「行首編號 + 分隔符 + 名字」，避免把 11/5、15:30、1600-1800 誤判成名單

const NUM_LINE = /^[\s　]*(?:[#＃])?(\d{1,3})\s*(?:[.．、)）:：]\s*|\s+)(.*)$/;
const TIME_NOTE = /(\d{1,2})\s*[:：]\s*(\d{2})/;
const BRACKET_NOTE = /[（(]([^）)]*)[）)]/g;
const WAITLIST_HINT = /候補|備取|候位|waitlist/i;
const FULL_HINT = /^(滿額|額滿|已滿|full)$/i;

function normalizeDigits(s) {
  // 全形數字轉半形
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function cleanName(raw) {
  let name = raw;
  const notes = [];
  let arrive = null;

  const t = name.match(TIME_NOTE);
  if (t) {
    arrive = `${t[1].padStart(2, "0")}:${t[2]}`;
    name = name.replace(t[0], " ");
  }
  name = name.replace(BRACKET_NOTE, (_, inner) => {
    if (inner.trim()) notes.push(inner.trim());
    return " ";
  });
  // 「+1」代表帶朋友
  let plus = 0;
  name = name.replace(/[+＋]\s*(\d)/, (_, n) => {
    plus = Number(n);
    return " ";
  });
  // 常見註記字
  name = name.replace(/(晚到|遲到|早退|請假|取消)/g, (m) => {
    notes.push(m);
    return " ";
  });
  name = name.replace(/[\s　]+/g, " ").trim();
  // 去掉頭尾殘留符號
  name = name.replace(/^[-–—~、,，.。:：]+|[-–—~、,，.。:：]+$/g, "").trim();
  return { name, arrive, notes, plus };
}

function parseTimeRange(text) {
  // 15:30-17:30、1600-1800、15:30~17:30
  const m =
    text.match(/(\d{1,2})[:：](\d{2})\s*[-–—~～到至]\s*(\d{1,2})[:：](\d{2})/) ||
    text.match(/(?<!\d)(\d{2})(\d{2})\s*[-–—~～到至]\s*(\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start >= 24 * 60 || end >= 24 * 60 || end <= start) return null;
  const fmt = (v) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end), minutes: end - start };
}

const WEEKDAYS = "日一二三四五六";

// 抓接龍裡的日期（11/5、11/5（四））；年份取最接近今天的那一年
export function parseDate(text, now = new Date()) {
  const m = (text || "").match(/(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = now.getFullYear();
  const diffMonths = (month - (now.getMonth() + 1)) ;
  if (diffMonths < -6) year++; // 12 月看到 1/3 → 明年
  else if (diffMonths > 6) year--; // 1 月看到 12/28 → 去年
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // 2/30 之類不存在的日期
  return { year, month, day, weekday: WEEKDAYS[d.getDay()] };
}

// 預設球局名稱：「11/5（四）球敘」；沒有日期就用今天
export function defaultTitle(date, now = new Date()) {
  const d = date || { month: now.getMonth() + 1, day: now.getDate(), weekday: WEEKDAYS[now.getDay()] };
  return `${d.month}/${d.day}（${d.weekday}）球敘`;
}

function parseTitle(lines) {
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (NUM_LINE.test(normalizeDigits(s))) break;
    if (/^[—\-_=─━]{3,}$/.test(s)) continue;
    // 第一行有意義的文字當標題
    return s.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 30) || s.slice(0, 30);
  }
  return "";
}

export function parseRoster(text) {
  const src = normalizeDigits(text || "");
  const lines = src.split(/\r?\n/);
  const players = [];
  const seen = new Set();
  let waitlist = false;
  let expected = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (WAITLIST_HINT.test(trimmed) && !NUM_LINE.test(trimmed)) {
      waitlist = true;
      expected = 1;
      continue;
    }
    if (FULL_HINT.test(trimmed)) continue;
    const m = trimmed.match(NUM_LINE);
    if (!m) continue;
    const num = Number(m[1]);
    // 編號要大致連續，避免把「100 元」之類的行當成名單
    if (num !== expected && !(num === 1 && players.length)) {
      if (num > expected + 2 || num < 1) continue;
    }
    if (num === 1 && players.length && !waitlist) waitlist = true; // 第二段從 1 開始 → 通常是候補
    expected = num + 1;

    const { name, arrive, notes, plus } = cleanName(m[2]);
    if (!name) continue; // 空位
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({ name, arrive, notes, waitlist, active: !waitlist });
    for (let i = 1; i <= plus; i++) {
      const guest = `${name}的朋友${plus > 1 ? i : ""}`;
      if (!seen.has(guest.toLowerCase())) {
        seen.add(guest.toLowerCase());
        players.push({ name: guest, arrive, notes: [], waitlist, active: !waitlist });
      }
    }
  }

  // 標題只有日期時，補上地點（📍麗寶NAPA、地點：xxx）
  let title = parseTitle(lines);
  const place = src.match(/(?:📍|地點\s*[:：])\s*([^\n]+)/);
  if (place && !title.includes(place[1].trim())) {
    const isDateOnly = /^[\d/（）()週星期一二三四五六日天\s]+$/.test(title);
    if (isDateOnly || !title) title = `${title} ${place[1].trim()}`.trim().slice(0, 30);
  }

  return {
    title,
    date: parseDate(src),
    time: parseTimeRange(src),
    players,
  };
}
