import { parseRoster, defaultTitle } from "./parser.js";
import { buildSchedule, roundsFromTime, standings } from "./scheduler.js";
import { cloudEnabled, createCloud, joinCloud, fetchCloud, saveMatch, saveAll, watchCloud, shareUrl, parseShareHash } from "./cloud.js";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------- 儲存 ----------
const KEY = "rallymate.events.v1";
function loadEvents() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function saveEvents() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.events));
  } catch {
    toast("無法儲存（瀏覽器限制），關閉頁面後資料會消失");
  }
}

// ---------- 狀態 ----------
const state = {
  view: "home", // home | paste | setup | event
  events: loadEvents(),
  draft: null,
  eventId: null,
  tab: "live", // live | rounds | rank
  editing: null, // {r, m} 在賽程分頁中展開改分
  shared: null, // 唯讀分享的賽事
};

const current = () => state.shared || state.events.find((e) => e.id === state.eventId);
// 唯讀：別人分享的快照，或用「觀看連結」打開的雲端球局
const readonly = () => {
  if (state.shared) return true;
  const ev = state.events.find((e) => e.id === state.eventId);
  return !!(ev?.cloud && !ev.cloud.key);
};

// ---------- 雲端同步 ----------
let lastSyncToast = 0;
function syncFail(e) {
  console.warn("sync failed", e);
  if (Date.now() - lastSyncToast < 8000) return;
  lastSyncToast = Date.now();
  toast(navigator.onLine ? "同步失敗，請稍後再試" : "目前離線，連上網路後會自動同步");
}
const pushMatch = (ev, r, mi) => ev?.cloud?.key && saveMatch(ev.cloud, Number(r), Number(mi), ev.rounds[r].matches[mi]).catch(syncFail);
const pushAll = (ev) => ev?.cloud?.key && saveAll(ev.cloud, ev).catch(syncFail);

let watching = null; // { id, off }
let lastInteract = 0;
document.addEventListener("pointerdown", () => (lastInteract = Date.now()), true);

async function ensureWatch(ev) {
  if (!ev?.cloud || !cloudEnabled()) return stopWatch();
  if (watching?.id === ev.cloud.id) return;
  stopWatch();
  const w = { id: ev.cloud.id, off: null };
  watching = w;
  try {
    const off = await watchCloud(ev.cloud.id, (data) => onRemote(ev.id, data));
    if (watching === w) w.off = off;
    else off();
  } catch (e) {
    syncFail(e);
  }
}
function stopWatch() {
  watching?.off?.();
  watching = null;
}

const snapshotKey = (ev) => JSON.stringify([ev.title, ev.players, ev.rounds]);
function onRemote(localId, data) {
  const ev = state.events.find((e) => e.id === localId);
  if (!ev || !data) return;
  // 自己有剛滑、還沒存的分數：先送出。Firebase 會馬上再通知一次「合併後」的資料，
  // 那一次才套用；這次的資料比較舊，套用會把自己的分數蓋回去。
  if (flushWheels()) return;
  const before = snapshotKey(ev);
  Object.assign(ev, data, { id: ev.id, cloud: ev.cloud, createdAt: ev.createdAt });
  if (snapshotKey(ev) === before) return; // 自己剛寫入的回音
  saveEvents();
  remoteRender();
}
// 別人更新時重畫；正在滑滾輪或開著選單時先等一下，避免畫面跳掉
let remoteTimer;
function remoteRender() {
  clearTimeout(remoteTimer);
  if (state.view === "home") return renderHome();
  if (state.view !== "event") return;
  if (Date.now() - lastInteract < 1500 || !$("#sheet").hidden || state.renaming) {
    remoteTimer = setTimeout(remoteRender, 700);
    return;
  }
  flushWheels(); // 畫面上還沒存的分數先存起來（並送出），才不會被別人的更新蓋掉
  const y = window.scrollY;
  renderEvent();
  window.scrollTo(0, y);
}

// ---------- 工具 ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function nameMap(ev) {
  return Object.fromEntries(ev.players.map((p) => [p.id, p.name]));
}
const teamNames = (ids, names) => ids.map((id) => esc(names[id] || "?")).join("<br>");
const teamText = (ids, names) => ids.map((id) => names[id] || "?").join("/");

function progress(ev) {
  const all = ev.rounds.flatMap((r) => r.matches);
  const done = all.filter((m) => m.done).length;
  return { done, total: all.length };
}
function currentRoundIndex(ev) {
  const i = ev.rounds.findIndex((r) => r.matches.some((m) => !m.done));
  return i; // -1 = 全部打完
}

function defaultCourts(n, mode) {
  if (mode === "singles") return Math.max(1, Math.min(4, Math.floor(n / 3)));
  return Math.max(1, Math.min(4, Math.floor(n / 5)));
}

function draftCalc(d) {
  const active = d.players.filter((p) => p.active);
  const size = d.mode === "singles" ? 2 : 4;
  const perRound = Math.min(d.courts, Math.floor(active.length / size));
  const rounds = d.roundsTouched ? d.rounds : roundsFromTime(d.minutes, d.perGame) || 8;
  const each = active.length ? (rounds * perRound * size) / active.length : 0;
  return { active, size, perRound, rounds, each };
}

// ---------- 畫面 ----------
function setTop(title, { back = false, menu = false } = {}) {
  $("#topTitle").textContent = title;
  $("#backBtn").hidden = !back;
  $("#menuBtn").hidden = !menu;
  document.title = title === "球局小幫手" ? title : `${title} · 球局小幫手`;
}

function render() {
  const v = state.view;
  app.dataset.view = v;
  if (v === "home") renderHome();
  else if (v === "paste") renderPaste();
  else if (v === "setup") renderSetup();
  else if (v === "event") renderEvent();
  if (v === "event" && !state.shared) ensureWatch(current());
  else stopWatch();
  updateWakeLock();
}

function renderHome() {
  setTop("球局小幫手");
  const list = [...state.events].sort((a, b) => b.createdAt - a.createdAt);
  app.innerHTML = `
    <button class="btn primary block" data-action="new" style="min-height:56px;font-size:17px">＋ 貼上接龍，開新球局</button>
    <div style="height:16px"></div>
    ${
      list.length
        ? list
            .map((ev) => {
              const p = progress(ev);
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
              return `<button class="card event-item" data-action="open" data-id="${ev.id}">
                <div class="row between"><strong>${esc(ev.title)}</strong><span class="muted small">${ev.cloud ? (ev.cloud.key ? "🔗 同步 · " : "👀 觀看 · ") : ""}${esc(ev.date)}</span></div>
                <div class="muted small">${ev.mode === "singles" ? "單打" : "雙打"}・${ev.courts} 面場・${ev.players.filter((p) => !p.left).length} 人・${p.done}/${p.total} 場</div>
                <div class="progress"><i style="width:${pct}%"></i></div>
              </button>`;
            })
            .join("")
        : `<div class="card empty">
            <div class="big">🏸</div>
            <p><strong>還沒有球局</strong></p>
            <p class="muted small">在 LINE 長按接龍訊息 → 複製，<br>回到這裡按上面的按鈕貼上就好。</p>
          </div>`
    }`;
}

function renderPaste() {
  setTop("新球局", { back: true });
  const d = state.draft;
  const parsed = d.players.length > 0;
  app.innerHTML = `
    <div class="steps"><span class="on"></span><span></span></div>
    <div class="card stack">
      <h2>1. 貼上 LINE 接龍</h2>
      <textarea id="rosterText" placeholder="把接龍訊息整段貼在這裡，例如：&#10;&#10;📆11/5（四）&#10;⏰15:30-17:30&#10;1.倫&#10;2.小甄&#10;3.K">${esc(d.text)}</textarea>
      <div class="row">
        <button class="btn" data-action="paste-clip" style="flex:1">📋 從剪貼簿貼上</button>
        <button class="btn" data-action="clear-text">清除</button>
      </div>
    </div>
    <div class="card stack" id="parsedCard" ${parsed || d.text ? "" : "hidden"}>
      <div class="row between">
        <h2 style="margin:0">抓到 <span id="countActive">${d.players.filter((p) => p.active).length}</span> 位球員</h2>
        <span class="muted small">點名字可改名</span>
      </div>
      <div class="chips" id="chips">${chipsHtml(d.players)}</div>
      <form class="row" data-form="add-player">
        <input type="text" name="name" placeholder="手動加人" autocomplete="off" />
        <button class="btn sm" type="submit">加入</button>
      </form>
      ${d.time ? `<p class="muted small" style="margin:0">時間 ${d.time.start}–${d.time.end}（${d.time.minutes} 分鐘）</p>` : ""}
    </div>
    <button class="btn primary block" data-action="to-setup" ${d.players.some((p) => p.active) ? "" : "disabled"} id="nextBtn">下一步：選打法</button>`;
}

function chipsHtml(players) {
  if (!players.length) return `<span class="muted small">還沒抓到名字，確認每行是「1.名字」或「1 名字」的格式</span>`;
  return players
    .map((p) =>
      state.renaming === p.id
        ? `<span class="chip editing"><input class="chip-input" data-rename="${p.id}" value="${esc(p.name)}" aria-label="修改 ${esc(p.name)} 的名字" enterkeyhint="done" autocomplete="off" /></span>`
        : `<span class="chip ${p.active ? "" : "off"}">
        <button type="button" class="chip-name" data-action="rename" data-id="${p.id}" aria-label="修改名字：${esc(p.name)}">${esc(p.name)}</button>
        ${p.arrive ? `<span class="tag">${esc(p.arrive)} 到</span>` : ""}
        ${p.waitlist ? `<span class="tag">候補</span>` : ""}
        ${p.notes?.length ? `<span class="tag">${esc(p.notes.join("、"))}</span>` : ""}
        <button class="x" data-action="toggle-player" data-id="${p.id}" aria-label="${p.active ? "移除" : "加回"} ${esc(p.name)}">${p.active ? "×" : "↺"}</button>
      </span>`
    )
    .join("");
}

function renderSetup() {
  setTop("新球局", { back: true });
  const d = state.draft;
  const c = draftCalc(d);
  const late = c.active.filter((p) => p.arrive);
  const tooFew = c.active.length < c.size;
  app.innerHTML = `
    <div class="steps"><span class="on"></span><span class="on"></span></div>
    <div class="card">
      <h2>2. 選打法</h2>
      <div class="field"><label>球局名稱</label><input type="text" id="titleInput" value="${esc(d.title)}" style="max-width:60%" /></div>
      <div class="field" style="display:block">
        <div class="seg" role="group" aria-label="單打或雙打">
          <button class="${d.mode === "doubles" ? "on" : ""}" data-action="mode" data-v="doubles">雙打</button>
          <button class="${d.mode === "singles" ? "on" : ""}" data-action="mode" data-v="singles">單打</button>
        </div>
      </div>
      <div class="field">
        <label>場地<span class="hint">同時開打的面數</span></label>
        <div class="stepper"><button data-action="step" data-k="courts" data-d="-1" aria-label="減少場地">−</button><output>${d.courts}</output><button data-action="step" data-k="courts" data-d="1" aria-label="增加場地">＋</button></div>
      </div>
      <div class="field">
        <label>開始時間</label>
        <input type="time" id="startInput" value="${esc(d.start || "")}" style="max-width:140px" />
      </div>
      <div class="field">
        <label>總時長<span class="hint">分鐘</span></label>
        <div class="stepper"><button data-action="step" data-k="minutes" data-d="-15" aria-label="減少時長">−</button><output>${d.minutes}</output><button data-action="step" data-k="minutes" data-d="15" aria-label="增加時長">＋</button></div>
      </div>
      <div class="field">
        <label>每局約幾分鐘</label>
        <div class="stepper"><button data-action="step" data-k="perGame" data-d="-1" aria-label="減少">−</button><output>${d.perGame}</output><button data-action="step" data-k="perGame" data-d="1" aria-label="增加">＋</button></div>
      </div>
      <div class="field">
        <label>輪數<span class="hint">${d.roundsTouched ? "已手動調整" : "依時間自動計算"}</span></label>
        <div class="stepper"><button data-action="step" data-k="rounds" data-d="-1" aria-label="減少輪數">−</button><output>${c.rounds}</output><button data-action="step" data-k="rounds" data-d="1" aria-label="增加輪數">＋</button></div>
      </div>
    </div>
    ${
      tooFew
        ? `<div class="banner">人數不夠：${d.mode === "doubles" ? "雙打至少 4 人" : "單打至少 2 人"}，目前 ${c.active.length} 人</div>`
        : `<div class="summary">
            ${c.active.length} 人・每輪 ${c.perRound} 場${c.active.length - c.perRound * c.size > 0 ? `、${c.active.length - c.perRound * c.size} 人輪休` : ""}<br>
            共 ${c.rounds} 輪 ${c.rounds * c.perRound} 場，每人約打 <strong>${c.each.toFixed(1)}</strong> 場
            ${d.courts > c.perRound ? `<br><span class="small">（人數只夠開 ${c.perRound} 面場）</span>` : ""}
            ${late.length ? `<br><span class="small">晚到：${late.map((p) => `${esc(p.name)} ${esc(p.arrive)}`).join("、")}，到場前不會排到</span>` : ""}
          </div>`
    }
    <div style="height:14px"></div>
    <button class="btn primary block" data-action="create" ${tooFew ? "disabled" : ""} style="min-height:56px;font-size:17px">排賽程 🏸</button>`;
}

function renderEvent() {
  const ev = current();
  if (!ev) {
    state.view = "home";
    return render();
  }
  setTop(ev.title, { back: true, menu: true });
  const p = progress(ev);
  const tab = state.tab;
  app.innerHTML = `
    <div class="tabs"><div class="seg" role="tablist">
      <button class="${tab === "live" ? "on" : ""}" data-action="tab" data-v="live" role="tab">現在</button>
      <button class="${tab === "rounds" ? "on" : ""}" data-action="tab" data-v="rounds" role="tab">賽程 ${p.done}/${p.total}</button>
      <button class="${tab === "rank" ? "on" : ""}" data-action="tab" data-v="rank" role="tab">排名</button>
    </div></div>
    ${state.shared ? `<div class="banner">這是別人分享的唯讀賽程。<button class="btn sm" data-action="import-shared" style="margin-left:6px">存到我的手機</button></div>` : readonly() ? `<div class="banner live">👀 觀看模式・比分會即時更新</div>` : ""}
    ${tab === "live" ? liveHtml(ev) : tab === "rounds" ? roundsHtml(ev) : rankHtml(ev)}`;
  initWheels();
}

const nameList = (ids, names) => ids.map((id) => `<span class="nm">${esc(names[id] || "?")}</span>`).join("、");

// ---------- 滾輪記分 ----------
const MAX_SCORE = 30;
const WHEEL_H = 48; // 每格高度，要和 CSS --wheel-h 一致

const HINT_KEY = "rallymate.wheelHintSeen";
function hintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function markHintSeen() {
  if (document.body.classList.contains("wheel-learned")) return;
  document.body.classList.add("wheel-learned");
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {}
}

const CHEVRON = (dir) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${dir === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function wheelHtml(r, mi, s, val) {
  const max = Math.max(MAX_SCORE, val);
  let items = "";
  for (let i = 0; i <= max; i++) items += `<div class="wheel-item${i === val ? " sel" : ""}" data-v="${i}">${i}</div>`;
  return `<div class="wheel-wrap">
    <button type="button" class="wheel-arrow up" data-wheel-step="-1" tabindex="-1" aria-label="少一分">${CHEVRON("up")}</button>
    <div class="wheel-drum">
      <div class="wheel" data-wheel data-r="${r}" data-m="${mi}" data-s="${s}" data-val="${val}"
        role="slider" tabindex="0" aria-label="${s === "a" ? "左隊" : "右隊"}比分，上下滑動調整" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${val}">
        <div class="wheel-pad"></div>${items}<div class="wheel-pad"></div>
      </div>
    </div>
    <button type="button" class="wheel-arrow down" data-wheel-step="1" tabindex="-1" aria-label="多一分">${CHEVRON("down")}</button>
    <div class="wheel-hint" aria-hidden="true"><span class="hand">👆</span>上下滑</div>
  </div>`;
}

// 滾筒立體感：離中間越遠的數字越往後翻、越小、越淡
function paintWheel(w) {
  const top = w.scrollTop;
  const items = w.querySelectorAll(".wheel-item");
  const from = Math.max(0, Math.floor(top / WHEEL_H) - 2);
  const to = Math.min(items.length - 1, Math.ceil(top / WHEEL_H) + 2);
  for (let i = from; i <= to; i++) {
    const off = (i * WHEEL_H - top) / WHEEL_H; // 0 = 正中間
    const a = Math.min(1, Math.abs(off));
    items[i].style.transform = `perspective(240px) rotateX(${-off * 32}deg) scale(${1 - a * 0.28})`;
    items[i].style.opacity = String(1 - a * 0.62);
  }
}

function wheelIndex(w) {
  const max = w.children.length - 3;
  return Math.max(0, Math.min(max, Math.round(w.scrollTop / WHEEL_H)));
}

function markWheel(w, idx) {
  if (w._sel === idx) return;
  const first = w._sel === undefined;
  w._sel = idx;
  w.querySelector(".wheel-item.sel")?.classList.remove("sel");
  w.children[idx + 1]?.classList.add("sel");
  if (!first && navigator.vibrate) navigator.vibrate(5);
}

function commitWheel(w) {
  const ev = current();
  // 只存「使用者真的滑過」的滾輪（停的位置和畫出來時的分數不同）；
  // 畫面上的舊數字不能拿來蓋掉別人剛改的分數。回傳是否有送出。
  if (!ev || readonly() || !w.isConnected) return false;
  const v = wheelIndex(w);
  if (v === Number(w.dataset.val)) return false;
  w.dataset.val = v;
  w.setAttribute("aria-valuenow", v);
  const m = ev.rounds[w.dataset.r]?.matches[w.dataset.m];
  if (!m || m.done || m[w.dataset.s === "a" ? "sa" : "sb"] === v) return false;
  m[w.dataset.s === "a" ? "sa" : "sb"] = v;
  saveEvents();
  pushMatch(ev, w.dataset.r, w.dataset.m);
  markHintSeen();
  return true;
}

// 送出任何動作前，先把還在滑動中的滾輪數值存起來；回傳送出了幾個
function flushWheels() {
  let n = 0;
  document.querySelectorAll("[data-wheel]").forEach((w) => commitWheel(w) && n++);
  return n;
}

function initWheels() {
  document.querySelectorAll("[data-wheel]").forEach((w) => {
    w.scrollTop = Number(w.dataset.val) * WHEEL_H;
    markWheel(w, Number(w.dataset.val));
    paintWheel(w);
    let timer;
    let raf = 0;
    w.addEventListener(
      "scroll",
      () => {
        if (wheelIndex(w) !== Number(w.dataset.val)) lastInteract = Date.now();
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0;
            paintWheel(w);
          });
        markWheel(w, wheelIndex(w));
        clearTimeout(timer);
        timer = setTimeout(() => commitWheel(w), 150);
      },
      { passive: true }
    );
    w.addEventListener("keydown", (e) => {
      const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      w.scrollTo({ top: (wheelIndex(w) + d) * WHEEL_H, behavior: "smooth" });
    });
  });
}

function scoreControls(ev, r, mi, m, big) {
  const ro = readonly();
  const names = nameMap(ev);
  const winA = m.done && m.sa > m.sb;
  const winB = m.done && m.sb > m.sa;
  const side = (s) => {
    const ids = s === "a" ? m.a : m.b;
    const val = s === "a" ? m.sa : m.sb;
    return `<div class="team ${s} ${(s === "a" ? winA : winB) ? "win" : ""}">
      <div class="names">${teamNames(ids, names)}</div>
      ${ro || m.done ? `<div class="scorebox"><span class="num">${val}</span></div>` : wheelHtml(r, mi, s, val)}
    </div>`;
  };
  return `
    <div class="row between">
      <span class="court-label">${big ? `第 ${m.court} 場地` : `第 ${r + 1} 輪・場地 ${m.court}`}</span>
      ${m.done ? `<span class="done-badge">已完成</span>` : ""}
    </div>
    <div class="match">${side("a")}<span class="vs">VS</span>${side("b")}</div>
    ${
      ro
        ? ""
        : m.done
          ? `<button class="btn sm block" style="margin-top:10px" data-action="reopen" data-r="${r}" data-m="${mi}">改比分</button>`
          : `<button class="btn primary block" style="margin-top:10px" data-action="finish" data-r="${r}" data-m="${mi}">這場打完了 ✓</button>`
    }`;
}

function liveHtml(ev) {
  const ri = currentRoundIndex(ev);
  const names = nameMap(ev);
  if (ri === -1) {
    const top = standings(ev.players, ev.rounds).slice(0, 3);
    return `<div class="card empty">
      <div class="big">🏆</div>
      <p><strong>全部打完了！</strong></p>
      <p>${top.map((t, i) => `${["🥇", "🥈", "🥉"][i]} ${esc(t.name)}`).join("　")}</p>
      ${readonly() ? "" : `<button class="btn" data-action="copy-text">複製結果貼到 LINE</button>`}
    </div>`;
  }
  const round = ev.rounds[ri];
  const next = ev.rounds[ri + 1];
  return `
    <p class="muted small" style="margin:0 0 8px">第 ${ri + 1} / ${ev.rounds.length} 輪${ev.cloud ? "・🔗 即時同步中" : ""}</p>
    <div class="courts">${round.matches.map((m, mi) => `<div class="card">${scoreControls(ev, ri, mi, m, true)}</div>`).join("")}</div>
    ${
      round.rest.length || round.absent?.length
        ? `<div class="rest-line">🪑 這輪休息：${nameList(round.rest, names) || "無"}${
            round.absent?.length ? `<br>還沒到：${nameList(round.absent, names)}` : ""
          }</div>`
        : ""
    }
    ${
      next
        ? `<div class="card" style="margin-top:14px">
            <h2>下一輪準備</h2>
            ${next.matches
              .map(
                (m) => `<div class="mini-match"><span class="ct">場${m.court}</span><span class="t r">${teamNames(m.a, names)}</span><span class="s muted">vs</span><span class="t">${teamNames(m.b, names)}</span></div>`
              )
              .join("")}
            ${next.rest.length ? `<div class="rest-line">下一輪休息：${nameList(next.rest, names)}</div>` : ""}
          </div>`
        : ""
    }`;
}

function roundsHtml(ev) {
  const names = nameMap(ev);
  const cur = currentRoundIndex(ev);
  return `<div class="card round-list">
    ${ev.rounds
      .map(
        (round, r) => `<div class="round ${r === cur ? "current" : ""}">
          <div class="row between"><strong>第 ${r + 1} 輪</strong>${r === cur ? `<span class="done-badge">進行中</span>` : ""}</div>
          ${round.matches
            .map((m, mi) => {
              if (state.editing && state.editing.r === r && state.editing.m === mi)
                return `<div style="margin:8px 0">${scoreControls(ev, r, mi, m, false)}
                  <button class="btn sm block" style="margin-top:6px" data-action="collapse">收合</button></div>`;
              return `<button class="mini-match" data-action="expand" data-r="${r}" data-m="${mi}">
                <span class="ct">場${m.court}</span>
                <span class="t r">${teamNames(m.a, names)}</span>
                <span class="s">${m.done || m.sa || m.sb ? `${m.sa} : ${m.sb}` : `<span class="muted">vs</span>`}</span>
                <span class="t">${teamNames(m.b, names)}</span>
              </button>`;
            })
            .join("")}
          ${round.rest.length ? `<div class="rest-line">休息：${nameList(round.rest, names)}</div>` : ""}
        </div>`
      )
      .join("")}
  </div>`;
}

function rankHtml(ev) {
  const rows = standings(ev.players.filter((p) => !p.left || ev.rounds.some((r) => r.matches.some((m) => [...m.a, ...m.b].includes(p.id)))), ev.rounds);
  const games = {};
  for (const r of ev.rounds) for (const m of r.matches) for (const id of [...m.a, ...m.b]) games[id] = (games[id] || 0) + 1;
  return `<div class="card" style="padding:8px 12px">
    <table>
      <thead><tr><th></th><th style="text-align:left">球員</th><th>勝/敗</th><th>淨勝分</th><th>已打/排</th></tr></thead>
      <tbody>
      ${rows
        .map((t, i) => {
          const diff = t.pf - t.pa;
          return `<tr>
            <td class="medal">${t.played ? ["🥇", "🥈", "🥉"][i] || i + 1 : "–"}</td>
            <td class="name">${esc(t.name)}</td>
            <td>${t.w}/${t.l}</td>
            <td>${diff > 0 ? "+" : ""}${diff}</td>
            <td class="muted">${t.played}/${games[t.id] || 0}</td>
          </tr>`;
        })
        .join("")}
      </tbody>
    </table>
  </div>
  <p class="muted small">排名順序：勝場 → 淨勝分 → 總得分 → 失分少者優先</p>`;
}

// ---------- 底部選單 ----------
function openSheet(html) {
  const s = $("#sheet");
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet").innerHTML = "";
}

function eventMenu() {
  const ev = current();
  if (readonly() && !state.shared) {
    openSheet(`<h3>${esc(ev.title)}</h3>
      <button class="menu-item" data-action="share-view"><span class="ico">👀</span>分享觀看連結</button>
      <button class="menu-item" data-action="copy-text"><span class="ico">💬</span>複製賽程文字</button>
      <button class="menu-item" data-action="delete-event" style="color:var(--b)"><span class="ico">🗑</span>從這支手機移除</button>
      <button class="menu-item" data-action="close-sheet"><span class="ico">✕</span>關閉</button>`);
    return;
  }
  if (readonly()) {
    openSheet(`<h3>分享的賽程</h3>
      <button class="menu-item" data-action="import-shared"><span class="ico">💾</span>存到我的手機（可以記分）</button>
      <button class="menu-item" data-action="close-sheet"><span class="ico">✕</span>關閉</button>`);
    return;
  }
  openSheet(`<h3>${esc(current().title)}</h3>
    <button class="menu-item" data-action="copy-text"><span class="ico">💬</span>複製賽程文字（貼到 LINE 群組）</button>
    ${cloudEnabled()
      ? `<button class="menu-item" data-action="share-edit"><span class="ico">✏️</span><span>分享「記分」連結<br><span class="muted small">拿到的人可以一起改比分</span></span></button>
    <button class="menu-item" data-action="share-view"><span class="ico">👀</span><span>分享「觀看」連結<br><span class="muted small">貼到群組，大家即時看比分</span></span></button>`
      : `<button class="menu-item" data-action="share-link"><span class="ico">🔗</span>分享唯讀連結</button>`}
    <button class="menu-item" data-action="edit-players"><span class="ico">👥</span>有人加入/離開 → 重排剩下的賽程</button>
    <button class="menu-item" data-action="reshuffle"><span class="ico">🔀</span>重新洗牌（未開打的輪次）</button>
    <button class="menu-item danger" data-action="delete-event" style="color:var(--b)"><span class="ico">🗑</span>刪除這個球局</button>
    <button class="menu-item" data-action="close-sheet"><span class="ico">✕</span>關閉</button>`);
}

function playersSheet() {
  const ev = current();
  const playing = ev.players.filter((p) => !p.left);
  const left = ev.players.filter((p) => p.left);
  const started = keepRounds(ev).length;
  const remain = Math.max(1, ev.rounds.length - started);
  openSheet(`<h3>調整球員</h3>
    <p class="muted small" style="margin-top:0">已開打的 ${started} 輪會保留，之後的輪次依新名單重排。</p>
    <div class="chips" style="margin-bottom:12px">
      ${playing.map((p) => `<span class="chip"><span>${esc(p.name)}</span><button class="x" data-action="leave" data-id="${p.id}" aria-label="${esc(p.name)} 離開">×</button></span>`).join("")}
      ${left.map((p) => `<span class="chip off"><span>${esc(p.name)}</span><button class="x" data-action="rejoin" data-id="${p.id}" aria-label="${esc(p.name)} 回來">↺</button></span>`).join("")}
    </div>
    <form class="row" data-form="join" style="margin-bottom:12px">
      <input type="text" name="name" placeholder="新加入的人" autocomplete="off" />
      <button class="btn sm" type="submit">加入</button>
    </form>
    <div class="field"><label>剩下要排幾輪</label>
      <div class="stepper"><button data-action="remain" data-d="-1">−</button><output id="remainOut">${remain}</output><button data-action="remain" data-d="1">＋</button></div>
    </div>
    <button class="btn primary block" data-action="apply-players" style="margin-top:12px">重排剩下的賽程</button>
    <button class="btn block" data-action="close-sheet" style="margin-top:8px">取消</button>`);
}

// 有開打（打完或已有比分）的輪次要保留
function keepRounds(ev) {
  let last = -1;
  ev.rounds.forEach((r, i) => {
    if (r.matches.some((m) => m.done || m.sa || m.sb)) last = i;
  });
  return ev.rounds.slice(0, last + 1);
}

function reschedule(ev, remain) {
  const keep = keepRounds(ev);
  const players = ev.players.filter((p) => !p.left).map((p) => ({ id: p.id, fromRound: Math.max(p.fromRound || 0, 0) }));
  ev.rounds = buildSchedule({ players, mode: ev.mode, courts: ev.courts, rounds: remain, keep });
}

// ---------- 分享 ----------
function scheduleText(ev) {
  const names = nameMap(ev);
  const lines = [`🏸 ${ev.title}｜${ev.mode === "singles" ? "單打" : "雙打"}・${ev.courts} 面場`, ""];
  ev.rounds.forEach((round, r) => {
    lines.push(`【第 ${r + 1} 輪】`);
    for (const m of round.matches) {
      const score = m.done ? `  ${m.sa}:${m.sb}` : "";
      lines.push(`${ev.courts > 1 ? `場${m.court} ` : ""}${teamText(m.a, names)} vs ${teamText(m.b, names)}${score}`);
    }
    if (round.rest.length) lines.push(`休：${round.rest.map((id) => names[id]).join("、")}`);
    lines.push("");
  });
  const p = progress(ev);
  if (p.done) {
    lines.push("📊 目前排名");
    standings(ev.players, ev.rounds)
      .filter((t) => t.played)
      .forEach((t, i) => lines.push(`${i + 1}. ${t.name}  ${t.w}勝${t.l}敗  ${t.pf - t.pa >= 0 ? "+" : ""}${t.pf - t.pa}`));
  }
  return lines.join("\n").trim();
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

async function shareOrCopy(text, url, copiedMsg) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  (await copy(`${text}\n${url}`)) ? toast(copiedMsg) : toast("複製失敗");
}

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
async function encodeShare(ev) {
  const slim = {
    t: ev.title,
    d: ev.date,
    mo: ev.mode,
    c: ev.courts,
    p: ev.players.map((p) => [p.id, p.name]),
    r: ev.rounds.map((r) => [r.matches.map((m) => [m.court, m.a, m.b, m.sa, m.sb, m.done ? 1 : 0]), r.rest]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(slim));
  if ("CompressionStream" in window) return "z" + b64url(await pipe(bytes, new CompressionStream("deflate-raw")));
  return "j" + b64url(bytes);
}
async function decodeShare(code) {
  let bytes = unb64url(code.slice(1));
  if (code[0] === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  const s = JSON.parse(new TextDecoder().decode(bytes));
  return {
    id: "shared",
    title: s.t,
    date: s.d,
    mode: s.mo,
    courts: s.c,
    createdAt: Date.now(),
    players: s.p.map(([id, name]) => ({ id, name })),
    rounds: s.r.map(([ms, rest]) => ({
      matches: ms.map(([court, a, b, sa, sb, done]) => ({ court, a, b, sa, sb, done: !!done })),
      rest,
    })),
  };
}

// ---------- 動作 ----------
function newDraft() {
  return { text: "", title: defaultTitle(null), time: null, players: [], mode: "doubles", courts: 1, minutes: 120, perGame: 15, start: "", rounds: 8, roundsTouched: false };
}

function applyParse(text) {
  const d = state.draft;
  d.text = text;
  const r = parseRoster(text);
  // 保留使用者手動改過的狀態
  const prev = Object.fromEntries(d.players.map((p) => [p.srcName, p]));
  const manual = d.players.filter((p) => p.manual);
  d.players = r.players.map((p) => {
    const old = prev[p.name];
    return old ? { ...old, arrive: p.arrive, notes: p.notes } : { ...p, id: uid(), srcName: p.name };
  });
  for (const m of manual) if (!d.players.some((p) => p.name === m.name)) d.players.push(m);
  if (!d.titleTouched) d.title = defaultTitle(r.date);
  d.time = r.time;
  if (r.time) {
    d.minutes = r.time.minutes;
    d.start = r.time.start;
  }
}

function refreshParsed() {
  const d = state.draft;
  const card = $("#parsedCard");
  if (!card) return;
  card.hidden = !d.text && !d.players.length;
  $("#chips").innerHTML = chipsHtml(d.players);
  $("#countActive").textContent = d.players.filter((p) => p.active).length;
  $("#nextBtn").disabled = !d.players.some((p) => p.active);
}

function createEvent() {
  const d = state.draft;
  const c = draftCalc(d);
  const start = toMin(d.start);
  const players = c.active.map((p) => {
    let fromRound = 0;
    const arr = toMin(p.arrive);
    if (start != null && arr != null && arr > start) fromRound = Math.ceil((arr - start) / d.perGame);
    return { id: p.id, name: p.name, arrive: p.arrive || null, fromRound };
  });
  const now = new Date();
  const ev = {
    id: uid(),
    title: d.title.trim() || defaultTitle(null),
    date: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    createdAt: Date.now(),
    mode: d.mode,
    courts: d.courts,
    perGame: d.perGame,
    start: d.start,
    players,
    rounds: buildSchedule({ players, mode: d.mode, courts: d.courts, rounds: c.rounds }),
  };
  state.events.push(ev);
  saveEvents();
  if (cloudEnabled())
    createCloud(ev)
      .then((cloud) => {
        ev.cloud = cloud;
        saveEvents();
        if (state.view === "event" && state.eventId === ev.id) {
          ensureWatch(ev);
          renderEvent();
        }
      })
      .catch((e) => console.warn("upload later", e)); // 失敗沒關係，分享時會再上傳
  state.draft = null;
  state.eventId = ev.id;
  state.view = "event";
  state.tab = "live";
  history.replaceState(null, "", location.pathname);
  render();
  window.scrollTo(0, 0);
}

let remainCount = 0;

async function onAction(el) {
  const a = el.dataset.action;
  flushWheels();
  const ev = current();
  const d = state.draft;
  switch (a) {
    case "home":
      closeSheet();
      if (state.view === "setup") state.view = "paste";
      else {
        state.view = "home";
        state.shared = null;
        state.editing = null;
        if (location.hash) history.replaceState(null, "", location.pathname);
      }
      render();
      break;
    case "new":
      state.draft = newDraft();
      state.view = "paste";
      render();
      $("#rosterText")?.focus();
      break;
    case "paste-clip":
      try {
        const t = await navigator.clipboard.readText();
        if (!t) return toast("剪貼簿是空的");
        $("#rosterText").value = t;
        applyParse(t);
        refreshParsed();
      } catch {
        toast("瀏覽器不允許讀取剪貼簿，請長按輸入框貼上");
      }
      break;
    case "clear-text":
      state.draft = newDraft();
      render();
      break;
    case "toggle-player": {
      const p = d.players.find((x) => x.id === el.dataset.id);
      p.active = !p.active;
      refreshParsed();
      break;
    }
    case "rename": {
      state.renaming = el.dataset.id;
      refreshParsed();
      const input = $(`[data-rename="${el.dataset.id}"]`);
      input?.focus();
      input?.select();
      break;
    }
    case "to-setup":
      if (!d.roundsTouched) d.courts = defaultCourts(d.players.filter((p) => p.active).length, d.mode);
      d.perGame = d.mode === "singles" ? 12 : 15;
      state.view = "setup";
      render();
      window.scrollTo(0, 0);
      break;
    case "mode":
      d.mode = el.dataset.v;
      d.perGame = d.mode === "singles" ? 12 : 15;
      d.courts = defaultCourts(d.players.filter((p) => p.active).length, d.mode);
      renderSetup();
      break;
    case "step": {
      const k = el.dataset.k;
      const delta = Number(el.dataset.d);
      if (k === "rounds") {
        d.rounds = Math.max(1, Math.min(60, draftCalc(d).rounds + delta));
        d.roundsTouched = true;
      } else {
        const lim = { courts: [1, 8], minutes: [15, 480], perGame: [5, 40] }[k];
        d[k] = Math.max(lim[0], Math.min(lim[1], d[k] + delta));
        if (k !== "courts") d.roundsTouched = false;
      }
      renderSetup();
      break;
    }
    case "create":
      createEvent();
      break;
    case "open":
      state.eventId = el.dataset.id;
      state.view = "event";
      state.tab = "live";
      render();
      break;
    case "tab":
      state.tab = el.dataset.v;
      state.editing = null;
      renderEvent();
      break;
    case "score": {
      const m = ev.rounds[el.dataset.r].matches[el.dataset.m];
      const k = el.dataset.s === "a" ? "sa" : "sb";
      m[k] = Math.max(0, Math.min(99, m[k] + Number(el.dataset.d)));
      saveEvents();
      if (navigator.vibrate) navigator.vibrate(8);
      renderEvent();
      break;
    }
    case "finish": {
      const m = ev.rounds[el.dataset.r].matches[el.dataset.m];
      if (m.sa === m.sb && !confirm(m.sa === 0 ? "還沒記分，確定這場打完了？" : "比分相同，確定這場打完了？")) return;
      m.done = true;
      saveEvents();
      pushMatch(ev, el.dataset.r, el.dataset.m);
      const round = ev.rounds[el.dataset.r];
      if (state.tab === "live" && round.matches.every((x) => x.done)) toast(`第 ${Number(el.dataset.r) + 1} 輪結束，換下一輪`);
      renderEvent();
      break;
    }
    case "reopen":
      ev.rounds[el.dataset.r].matches[el.dataset.m].done = false;
      saveEvents();
      pushMatch(ev, el.dataset.r, el.dataset.m);
      if (state.tab === "rounds") state.editing = { r: Number(el.dataset.r), m: Number(el.dataset.m) };
      renderEvent();
      break;
    case "expand":
      state.editing = { r: Number(el.dataset.r), m: Number(el.dataset.m) };
      renderEvent();
      break;
    case "collapse":
      state.editing = null;
      renderEvent();
      break;
    case "menu":
      eventMenu();
      break;
    case "close-sheet":
      closeSheet();
      break;
    case "copy-text":
      closeSheet();
      (await copy(scheduleText(ev))) ? toast("已複製，到 LINE 群組貼上即可") : toast("複製失敗");
      break;
    case "share-link": {
      closeSheet();
      const url = `${location.origin}${location.pathname}#s=${await encodeShare(ev)}`;
      await shareOrCopy(`${ev.title} 賽程`, url, "連結已複製（比分是此刻的快照）");
      break;
    }
    case "share-edit":
    case "share-view": {
      closeSheet();
      if (!ev.cloud) {
        toast("上傳中…");
        try {
          ev.cloud = await createCloud(ev);
          saveEvents();
          ensureWatch(ev);
        } catch (e) {
          console.warn(e);
          return toast("上傳失敗，請確認網路後再試");
        }
      }
      const editable = a === "share-edit";
      if (editable && !ev.cloud.key) return toast("你只有觀看權限，不能分享記分連結");
      await shareOrCopy(
        editable ? `🏸 ${ev.title}｜記分連結（點開可以一起改比分）` : `🏸 ${ev.title}｜即時比分`,
        shareUrl(ev.cloud, editable),
        editable ? "記分連結已複製，貼到 LINE 給記分的人" : "觀看連結已複製，貼到 LINE 群組"
      );
      renderEvent();
      break;
    }
    case "import-shared": {
      closeSheet();
      const copyEv = { ...state.shared, id: uid(), createdAt: Date.now(), perGame: 15, players: state.shared.players.map((p) => ({ ...p, fromRound: 0 })) };
      state.events.push(copyEv);
      saveEvents();
      state.shared = null;
      state.eventId = copyEv.id;
      history.replaceState(null, "", location.pathname);
      toast("已存到這支手機");
      render();
      break;
    }
    case "edit-players":
      remainCount = Math.max(1, ev.rounds.length - keepRounds(ev).length);
      ev._backup = JSON.stringify(ev.players);
      playersSheet();
      break;
    case "leave":
    case "rejoin":
      ev.players.find((p) => p.id === el.dataset.id).left = a === "leave";
      playersSheet();
      $("#remainOut").textContent = remainCount;
      break;
    case "remain":
      remainCount = Math.max(1, Math.min(60, remainCount + Number(el.dataset.d)));
      $("#remainOut").textContent = remainCount;
      break;
    case "apply-players": {
      const size = ev.mode === "singles" ? 2 : 4;
      if (ev.players.filter((p) => !p.left).length < size) return toast("人數不夠排賽程");
      ev.players.forEach((p) => delete p.isNew);
      reschedule(ev, remainCount);
      delete ev._backup;
      saveEvents();
      pushAll(ev);
      closeSheet();
      toast("已重排剩下的賽程");
      renderEvent();
      break;
    }
    case "reshuffle": {
      closeSheet();
      const remain = ev.rounds.length - keepRounds(ev).length;
      if (remain <= 0) return toast("沒有未開打的輪次");
      reschedule(ev, remain);
      saveEvents();
      pushAll(ev);
      toast("已重新洗牌");
      renderEvent();
      break;
    }
    case "delete-event":
      if (!confirm(ev.cloud ? `從這支手機移除「${ev.title}」？\n其他人的連結仍然可以使用。` : `刪除「${ev.title}」？刪除後無法復原。`)) return;
      if (ev.cloud) stopWatch();
      state.events = state.events.filter((e) => e.id !== ev.id);
      saveEvents();
      closeSheet();
      state.view = "home";
      render();
      break;
  }
}

document.addEventListener("click", (e) => {
  const sheet = $("#sheet");
  if (e.target === sheet) {
    // 點遮罩關閉；調整球員的未套用變更要還原
    const ev = current();
    if (ev?._backup) {
      ev.players = JSON.parse(ev._backup);
      delete ev._backup;
    }
    return closeSheet();
  }
  // 點滾輪上的數字 → 直接滑到那個分數
  const item = e.target.closest(".wheel-item");
  if (item) {
    item.parentElement.scrollTo({ top: Number(item.dataset.v) * WHEEL_H, behavior: "smooth" });
    return;
  }
  // 滾筒上下的箭頭：轉一格
  const step = e.target.closest("[data-wheel-step]");
  if (step) {
    const w = step.parentElement.querySelector("[data-wheel]");
    w.scrollTo({ top: (wheelIndex(w) + Number(step.dataset.wheelStep)) * WHEEL_H, behavior: "smooth" });
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  if (el.dataset.action === "close-sheet") {
    const ev = current();
    if (ev?._backup) {
      ev.players = JSON.parse(ev._backup);
      delete ev._backup;
    }
  }
  onAction(el);
});

document.addEventListener("input", (e) => {
  const d = state.draft;
  if (!d) return;
  if (e.target.id === "rosterText") {
    applyParse(e.target.value);
    refreshParsed();
  } else if (e.target.id === "titleInput") {
    d.title = e.target.value;
    d.titleTouched = true;
  } else if (e.target.id === "startInput") {
    d.start = e.target.value;
  }
});

// 名字原地編輯：Enter 或點別處 = 確定，Esc = 取消
function finishRename(input, save) {
  const id = input.dataset.rename;
  if (state.renaming !== id) return; // 已處理過（重繪時的 blur）
  state.renaming = null;
  const d = state.draft;
  const p = d?.players.find((x) => x.id === id);
  const name = input.value.trim();
  if (save && p && name && name !== p.name) {
    if (d.players.some((x) => x.id !== id && x.name === name)) toast("名單裡已經有這個名字");
    else p.name = name;
  }
  refreshParsed();
}
document.addEventListener("keydown", (e) => {
  const input = e.target.closest?.("[data-rename]");
  if (!input) return;
  if (e.key === "Enter") {
    e.preventDefault();
    finishRename(input, true);
  } else if (e.key === "Escape") {
    finishRename(input, false);
  }
});
document.addEventListener("focusout", (e) => {
  const input = e.target.closest?.("[data-rename]");
  if (input) finishRename(input, true);
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  if (!name) return;
  if (form.dataset.form === "add-player") {
    const d = state.draft;
    if (d.players.some((p) => p.name === name)) return toast("名單裡已經有這個名字");
    d.players.push({ id: uid(), name, srcName: name, active: true, manual: true, notes: [], waitlist: false });
    form.name.value = "";
    refreshParsed();
  } else if (form.dataset.form === "join") {
    const ev = current();
    const existing = ev.players.find((p) => p.name === name);
    if (existing) existing.left = false;
    else ev.players.push({ id: uid(), name, fromRound: 0, isNew: true });
    playersSheet();
    $("#remainOut").textContent = remainCount;
  }
});

// ---------- 螢幕常亮（記分時不要自動鎖屏） ----------
let wakeLock = null;
async function updateWakeLock() {
  const want = state.view === "event" && !readonly() && document.visibilityState === "visible";
  try {
    if (want && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* 不支援就算了 */
  }
}
document.addEventListener("visibilitychange", updateWakeLock);

// ---------- 啟動 ----------
async function boot() {
  if (hintSeen()) document.body.classList.add("wheel-learned");
  const link = parseShareHash(location.hash);
  if (link) {
    history.replaceState(null, "", location.pathname);
    if (!cloudEnabled()) toast("這個版本沒有開啟雲端同步");
    else await openCloudLink(link);
  }
  const m = location.hash.match(/^#s=(.+)$/);
  if (m) {
    try {
      state.shared = await decodeShare(m[1]);
      state.view = "event";
      state.tab = "live";
    } catch {
      toast("分享連結壞掉了");
    }
  }
  render();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
async function openCloudLink(link) {
  app.innerHTML = `<div class="card empty"><div class="big">🏸</div><p>載入球局中…</p></div>`;
  try {
    let ev = state.events.find((e) => e.cloud?.id === link.id);
    if (!ev) {
      if (link.key) await joinCloud(link);
      const data = await fetchCloud(link.id);
      if (!data) throw new Error("not found");
      ev = { ...data, id: uid(), cloud: { id: link.id, key: link.key } };
      state.events.push(ev);
      saveEvents();
      toast(link.key ? "已加入，可以一起記分" : "觀看模式，比分會即時更新");
    } else if (link.key && !ev.cloud.key) {
      await joinCloud(link); // 原本只能看，現在拿到記分連結
      ev.cloud.key = link.key;
      saveEvents();
      toast("已升級成可以記分");
    }
    state.eventId = ev.id;
    state.view = "event";
    state.tab = "live";
  } catch (e) {
    console.warn(e);
    toast(navigator.onLine ? "找不到這個球局，或連結有誤" : "目前離線，連上網路後再打開連結");
  }
}

window.addEventListener("hashchange", () => location.reload());
boot();
