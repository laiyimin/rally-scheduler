// 手繪風格的匹克球塗鴉（全部原創，用 SVG 畫）
// 顏色用 CSS 變數，深色模式（黑板）會自動換成粉筆色

// 匹克球：黃綠色、有洞洞
export const BALL = `<svg class="doodle doodle-ball" viewBox="0 0 48 48" aria-hidden="true">
  <path d="M24.5 4.2c11.4-.4 19.8 8.3 19.3 19.9-.4 11.2-8.9 19.9-20.2 19.6C12.4 43.4 4 34.8 4.3 23.4 4.6 12.6 13.2 4.6 24.5 4.2z" fill="var(--ball)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/>
  <g fill="var(--ball-hole)">
    <circle cx="16" cy="14.5" r="2.5"/><circle cx="27.5" cy="11.5" r="2.4"/><circle cx="36.5" cy="19" r="2.5"/>
    <circle cx="22" cy="23" r="2.6"/><circle cx="12.5" cy="27.5" r="2.4"/><circle cx="32" cy="29.5" r="2.6"/>
    <circle cx="21.5" cy="35.5" r="2.4"/><circle cx="38" cy="31" r="1.9"/>
  </g>
  <path d="M12 12.5c2.5-3 6-4.8 9.5-5.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
</svg>`;

// 匹克球拍：圓角拍面 + 握把纏帶
export const PADDLE = `<svg class="doodle doodle-paddle" viewBox="0 0 64 64" aria-hidden="true">
  <g transform="rotate(-32 32 32)">
    <path d="M19.5 5.5c4.2-2.4 20.6-2.6 25 .3 2.2 7.6 2.4 18.7.8 25.6-4.4 4.2-22.6 4.4-27.1.2-1.8-7.3-1.6-18.6 1.3-26.1z" fill="var(--paddle)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M22.5 10.5c1.6-1 4-1.4 6.5-1.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    <path d="M28 35.5l8.2-.2.6 21.4c-2.6 2-6.6 2-9.4.1z" fill="var(--grip)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M28.3 41l8.4-1.6M28.4 46.4l8.5-1.7M28.6 51.6l8.4-1.6" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>
  </g>
</svg>`;

// 球拍擊球：拍子 + 飛出去的球 + 速度線
export const RALLY = `<span class="doodle-rally" aria-hidden="true">${PADDLE}${BALL}
  <svg class="doodle doodle-swoosh" viewBox="0 0 40 24" aria-hidden="true">
    <path d="M3 18c8-1 15-4 21-9M6 22c7-.4 13-2.4 19-6M2 12c6-1.5 11-4 15-8" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5" opacity=".6"/>
  </svg></span>`;

// 分享圖示：三個圓點用手繪線連起來
export const SHARE = `<svg class="doodle doodle-share" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M8.2 10.8l7.4-4.1M8.4 13.4l7.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="18" cy="5.6" r="3" fill="var(--ball)" stroke="currentColor" stroke-width="1.9"/>
  <circle cx="6" cy="12" r="3.1" fill="var(--ball)" stroke="currentColor" stroke-width="1.9"/>
  <circle cx="18" cy="18.6" r="3" fill="var(--ball)" stroke="currentColor" stroke-width="1.9"/>
</svg>`;

// 手繪箭頭：橘色蠟筆塗鴉 + 外圍虛線
export const ARROW = `<svg class="doodle doodle-arrow" viewBox="0 0 76 46" aria-hidden="true">
  <defs><clipPath id="arrow-clip"><path d="M5 15.5c11-1.6 23-1.4 34.5-2.2L38.2 4.6c10.6 5.2 21 11.2 31.6 18.2-10.2 6.6-20.4 12.8-31 18.6l1.2-9.2c-11.2.6-23.2.8-34.6-.4-1.6-5.2-1.6-11 .6-16.3z"/></clipPath></defs>
  <path d="M5 15.5c11-1.6 23-1.4 34.5-2.2L38.2 4.6c10.6 5.2 21 11.2 31.6 18.2-10.2 6.6-20.4 12.8-31 18.6l1.2-9.2c-11.2.6-23.2.8-34.6-.4-1.6-5.2-1.6-11 .6-16.3z" fill="var(--arrow)" stroke="var(--arrow-ink)" stroke-width="2.6" stroke-linejoin="round"/>
  <g clip-path="url(#arrow-clip)" fill="none" stroke="var(--arrow-light)" stroke-width="2.2" stroke-linecap="round">
    <path d="M2 30L20 6M9 36L31 6M17 40L41 8M27 42L52 10M37 44L62 14M48 44L70 20"/>
  </g>
  <path d="M7 37.5c10 .8 21 .6 32-.2M44 42.5l6-3.5M3 10.5c9-1.4 19-1.8 28-1.6M41 2.5l7 3.4M58 13l6 4" fill="none" stroke="var(--arrow)" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="5 4" opacity=".75"/>
</svg>`;
