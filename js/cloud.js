// 雲端同步：Firebase Realtime Database + 匿名登入
//
// 資料結構
//   events/{id}          球局內容（任何人有 id 就能讀）
//   secrets/{id}/editKey 編輯密鑰（沒有人能讀，只能在建立時寫一次）
//   editors/{id}/{uid}   = editKey，寫入時由規則比對密鑰；有這筆的人才能改 events/{id}
//
// 分享連結
//   可編輯：#j={id}~{editKey}
//   只能看：#w={id}

import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
let ready = null;

export const cloudEnabled = () => !!(firebaseConfig && firebaseConfig.databaseURL);

function init() {
  if (!ready) {
    ready = (async () => {
      const [{ initializeApp }, db, auth] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-database.js`),
        import(`${SDK}/firebase-auth.js`),
      ]);
      const app = initializeApp(firebaseConfig);
      return { db, auth, database: db.getDatabase(app), authInst: auth.getAuth(app) };
    })();
    ready.catch(() => (ready = null)); // 離線載入失敗時，下次再試
  }
  return ready;
}

async function signIn() {
  const c = await init();
  await c.authInst.authStateReady();
  if (!c.authInst.currentUser) await c.auth.signInAnonymously(c.authInst);
  return c;
}

function randomId(n) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// ---------- 資料轉換 ----------
export function toCloud(ev) {
  return {
    meta: {
      title: ev.title,
      date: ev.date,
      mode: ev.mode,
      courts: ev.courts,
      perGame: ev.perGame || 15,
      start: ev.start || "",
      createdAt: ev.createdAt,
      updatedAt: Date.now(),
    },
    players: ev.players.map((p) => ({
      id: p.id,
      name: p.name,
      fromRound: p.fromRound || 0,
      arrive: p.arrive || "",
      left: !!p.left,
    })),
    rounds: ev.rounds.map((r) => ({
      matches: r.matches.map((m) => ({ court: m.court, a: m.a, b: m.b, sa: m.sa || 0, sb: m.sb || 0, done: !!m.done })),
      rest: r.rest || [],
      absent: r.absent || [],
    })),
  };
}

// Realtime Database 會把空陣列刪掉、把陣列存成物件，讀回來時要補齊
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

export function fromCloud(data) {
  if (!data || !data.meta) return null;
  return {
    title: data.meta.title,
    date: data.meta.date,
    mode: data.meta.mode,
    courts: data.meta.courts,
    perGame: data.meta.perGame,
    start: data.meta.start,
    createdAt: data.meta.createdAt,
    players: arr(data.players).map((p) => ({
      id: p.id,
      name: p.name,
      fromRound: p.fromRound || 0,
      arrive: p.arrive || null,
      ...(p.left ? { left: true } : {}),
    })),
    rounds: arr(data.rounds).map((r) => ({
      matches: arr(r.matches).map((m) => ({ court: m.court, a: arr(m.a), b: arr(m.b), sa: m.sa || 0, sb: m.sb || 0, done: !!m.done })),
      rest: arr(r.rest),
      absent: arr(r.absent),
    })),
  };
}

// ---------- 操作 ----------
export async function createCloud(ev) {
  const c = await signIn();
  const { ref, set } = c.db;
  const uid = c.authInst.currentUser.uid;
  const id = randomId(12);
  const key = randomId(20);
  await set(ref(c.database, `secrets/${id}`), { editKey: key });
  await set(ref(c.database, `editors/${id}/${uid}`), key);
  await set(ref(c.database, `events/${id}`), toCloud(ev));
  return { id, key };
}

export async function joinCloud(cloud) {
  const c = await signIn();
  await c.db.set(c.db.ref(c.database, `editors/${cloud.id}/${c.authInst.currentUser.uid}`), cloud.key);
}

export async function fetchCloud(id) {
  const c = await signIn();
  const snap = await c.db.get(c.db.ref(c.database, `events/${id}`));
  return fromCloud(snap.val());
}

// 寫入失敗（例如換了手機、清過資料）時，用編輯密鑰重新加入再試一次
async function withEditor(cloud, write) {
  const c = await signIn();
  try {
    await write(c);
  } catch (e) {
    if (!cloud.key || !/permission/i.test(String(e?.code || e?.message))) throw e;
    await joinCloud(cloud);
    await write(c);
  }
}

// 只更新單一場比賽，兩面場地同時記分不會互相覆蓋
export function saveMatch(cloud, r, mi, m) {
  return withEditor(cloud, (c) =>
    c.db.update(c.db.ref(c.database, `events/${cloud.id}`), {
      [`rounds/${r}/matches/${mi}/sa`]: m.sa || 0,
      [`rounds/${r}/matches/${mi}/sb`]: m.sb || 0,
      [`rounds/${r}/matches/${mi}/done`]: !!m.done,
      "meta/updatedAt": Date.now(),
    })
  );
}

export function saveAll(cloud, ev) {
  return withEditor(cloud, (c) => c.db.set(c.db.ref(c.database, `events/${cloud.id}`), toCloud(ev)));
}

export async function watchCloud(id, onData) {
  const c = await signIn();
  return c.db.onValue(c.db.ref(c.database, `events/${id}`), (snap) => onData(fromCloud(snap.val())));
}

export function shareUrl(cloud, editable) {
  const base = `${location.origin}${location.pathname}`;
  return editable ? `${base}#j=${cloud.id}~${cloud.key}` : `${base}#w=${cloud.id}`;
}

export function parseShareHash(hash) {
  let m = /^#j=([A-Za-z0-9]{10,24})~([A-Za-z0-9]{16,40})$/.exec(hash);
  if (m) return { id: m[1], key: m[2] };
  m = /^#w=([A-Za-z0-9]{10,24})$/.exec(hash);
  if (m) return { id: m[1], key: null };
  return null;
}
