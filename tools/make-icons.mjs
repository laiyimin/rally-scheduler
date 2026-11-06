// 產生 PNG 圖示（iOS 主畫面需要 PNG）。不依賴任何套件：手動編碼 PNG。
// 用法：node tools/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function draw(size, { rounded }) {
  const s = size / 512; // 依 icon.svg 的 512 座標系
  const px = Buffer.alloc(size * size * 4);
  // 與 icon.svg 相同的匹克球圖示：橘底、黃綠色球、咖啡色描邊、洞洞
  const orange = [247, 165, 49], ball = [214, 232, 74], ink = [59, 47, 40], hole = [162, 181, 42], white = [255, 255, 255];
  const holes = [[186, 176, 24], [292, 150, 23], [356, 230, 24], [246, 250, 25], [160, 292, 23], [320, 320, 25], [232, 364, 23]];
  const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / s, y = (j + 0.5) / s;
      let c = null, a = 255;
      if (!rounded || inRoundRect(x, y, 0, 0, 512, 512, 112)) c = orange;
      else a = 0;
      if (c) {
        const d = Math.hypot(x - 256, y - 256);
        if (d <= 179) c = ink; // 描邊
        if (d <= 157) {
          c = ball;
          if (holes.some(([hx, hy, r]) => Math.hypot(x - hx, y - hy) <= r)) c = hole;
          // 左上的反光
          const ang = Math.atan2(y - 256, x - 256);
          if (Math.abs(d - 130) <= 9 && ang > -2.75 && ang < -1.75) c = ball.map((v, k) => Math.round(v + (white[k] - v) * 0.7));
        }
      }
      const o = (j * size + i) * 4;
      if (c) [px[o], px[o + 1], px[o + 2]] = c;
      px[o + 3] = a;
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = new URL("../", import.meta.url);
writeFileSync(new URL("icon-180.png", root), draw(180, { rounded: false })); // iOS 自己會裁圓角
writeFileSync(new URL("icon-192.png", root), draw(192, { rounded: true }));
writeFileSync(new URL("icon-512.png", root), draw(512, { rounded: false })); // maskable：滿版
console.log("icons written");
