/**
 * EmlakSoft marka varlıklarını (SVG + PNG + ICO) üretir. Harici font/telif yok:
 * sembol ve kelime işareti elle çizilmiş vektörlerdir (kelime işareti çizgi-harf).
 *
 *   node scripts/generate-brand.mjs            -> public/brand/*, public/icon.svg, public/favicon.ico
 *   node scripts/generate-brand.mjs --preview <dir>   (yalnız önizleme sayfası için SVG sözlüğü yazar)
 *
 * Tasarım gerekçesi: docs/DESIGN_SYSTEM.md "Marka".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "brand");
mkdirSync(OUT, { recursive: true });

const NAVY = "#071a38";
const NAVY_2 = "#1b3a78";
const BLUE = "#1463ff";
const BLUE_SOFT = "#5b9bff";
const GOLD_1 = "#f6d27a";
const GOLD_2 = "#d9a441";

const svg = (vb, body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}>${body}</svg>\n`;

const defs = (id) => `<defs>
<linearGradient id="${id}-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${NAVY_2}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
<linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82ff"/><stop offset="1" stop-color="${BLUE}"/></linearGradient>
<linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD_1}"/><stop offset="1" stop-color="${GOLD_2}"/></linearGradient>
</defs>`;

/** 64x64 sembol içeriği: çatı (altın) + gövde "E" (spine + 3 kol; orta kol marka mavisi). */
function glyph(id, { roof, e, mid }) {
  return `<path d="M9 29 32 9.5 55 29" fill="none" stroke="${roof ?? `url(#${id}-g)`}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="${e}"><rect x="19" y="32" width="6.4" height="22.5" rx="2.2"/><rect x="19" y="32" width="26" height="6.2" rx="2.2"/><rect x="19" y="48.3" width="26" height="6.2" rx="2.2"/></g>
<rect x="19" y="40.1" width="20" height="6.2" rx="2.2" fill="${mid}"/>`;
}

/** tone: light (açık zemin) | dark (koyu zemin) */
function markTile(id, tone, { bleed = false, scale = 1 } = {}) {
  const tile = tone === "dark" ? `url(#${id}-b)` : `url(#${id}-t)`;
  const rect = bleed
    ? `<rect width="64" height="64" fill="${tile}"/>`
    : `<rect width="64" height="64" rx="15" fill="${tile}"/>${tone === "dark" ? `<rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#ffffff" stroke-opacity=".22"/>` : ""}`;
  const g = glyph(id, { e: "#ffffff", mid: tone === "dark" ? "#cfe0ff" : BLUE_SOFT });
  const inner = scale === 1 ? g : `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${g}</g>`;
  return rect + inner;
}

function markMono(color) {
  return glyph("m", { roof: color, e: color, mid: color });
}

/* ---- Kelime işareti: çizgi-harf (stroke), yerel koordinat: sol kenar 0, taban y=27.7, büyük harf üstü y=4.3 ---- */
const LETTERS = [
  { c: "E", w: 19.8, d: "M17.5 4.3H2.3V27.7H17.5M2.3 16H15" },
  { c: "m", w: 28.6, d: "M2.3 12.3V27.7M2.3 18.3A6 6 0 0 1 14.3 18.3V27.7M14.3 18.3A6 6 0 0 1 26.3 18.3V27.7" },
  { c: "l", w: 4.6, d: "M2.3 4.3V27.7" },
  { c: "a", w: 19.7, d: "M9.7 12.3a7.7 7.7 0 1 0 0 15.4a7.7 7.7 0 1 0 0-15.4M17.4 12.3V27.7" },
  { c: "k", w: 19.3, d: "M2.3 4.3V27.7M16 12.3L2.3 21.2M8.2 17.2L17 27.7" },
  { c: "S", w: 20.2, d: "M17.8 9.2C16.6 6.2 13.8 4.3 10.4 4.3C6 4.3 3.4 6.6 3.4 9.6C3.4 12.8 6 14.2 10.4 15.8C15 17.4 17.9 18.8 17.9 22.3C17.9 25.6 14.9 27.7 10.6 27.7C6.8 27.7 3.8 25.9 2.6 22.8" },
  { c: "o", w: 20.0, d: "M10 12.3a7.7 7.7 0 1 0 0 15.4a7.7 7.7 0 1 0 0-15.4" },
  { c: "f", w: 17.1, d: "M2.3 12.3H14.8M15.5 6.2C13.8 4.4 11 4.2 9.3 5.4C7.6 6.6 7.3 8.5 7.3 11V27.7" },
  { c: "t", w: 16.8, d: "M7.3 5.5V22.5C7.3 26 9.5 27.7 13.6 27.4M2.3 12.3H14.5" },
];
const GAP = 3.4;
const WORD_W = LETTERS.reduce((s, l) => s + l.w, 0) + GAP * (LETTERS.length - 1);

function wordmark(first, second) {
  let x = 0;
  const parts = LETTERS.map((l, i) => {
    const color = i < 5 ? first : second;
    const out = `<path transform="translate(${x.toFixed(2)} 0)" d="${l.d}" stroke="${color}"/>`;
    x += l.w + GAP;
    return out;
  });
  return `<g fill="none" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</g>`;
}

const S_H = 1.35;
function horizontal(id, tone) {
  const dark = tone === "dark";
  const body = `${defs(id)}<g>${markTile(id, tone)}</g><g transform="translate(80 ${(64 - 28 * S_H) / 2 - 2 * S_H}) scale(${S_H})">${wordmark(dark ? "#ffffff" : NAVY, dark ? BLUE_SOFT : BLUE)}</g>`;
  return svg(`0 0 ${Math.round(80 + WORD_W * S_H)} 64`, body, ` role="img" aria-label="EmlakSoft"`);
}
function horizontalMono(color) {
  const body = `<g>${markMono(color)}</g><g transform="translate(80 ${(64 - 28 * S_H) / 2 - 2 * S_H}) scale(${S_H})">${wordmark(color, color)}</g>`;
  return svg(`0 0 ${Math.round(80 + WORD_W * S_H)} 64`, body, ` role="img" aria-label="EmlakSoft"`);
}
const S_V = 1.2;
function vertical(id, tone) {
  const dark = tone === "dark";
  const w = Math.round(WORD_W * S_V);
  const body = `${defs(id)}<g transform="translate(${(w - 64) / 2} 0)">${markTile(id, tone)}</g><g transform="translate(0 ${64 + 14 - 2 * S_V}) scale(${S_V})">${wordmark(dark ? "#ffffff" : NAVY, dark ? BLUE_SOFT : BLUE)}</g>`;
  return svg(`0 0 ${w} ${Math.round(64 + 14 + 28 * S_V)}`, body, ` role="img" aria-label="EmlakSoft"`);
}

/** Favicon: açık sekmede lacivert, koyu sekmede marka mavisi karo. */
function favicon() {
  const body = `<style>.t{fill:url(#f-t)}@media (prefers-color-scheme:dark){.t{fill:url(#f-b)}}</style>${defs("f")}<rect class="t" width="64" height="64" rx="15"/>${glyph("f", { e: "#ffffff", mid: BLUE_SOFT })}`;
  return svg("0 0 64 64", body);
}

const files = {
  "logo-mark.svg": svg("0 0 64 64", defs("m") + markTile("m", "light"), ` role="img" aria-label="EmlakSoft"`),
  "logo-mark-dark.svg": svg("0 0 64 64", defs("m") + markTile("m", "dark"), ` role="img" aria-label="EmlakSoft"`),
  "logo-horizontal.svg": horizontal("h", "light"),
  "logo-horizontal-dark.svg": horizontal("hd", "dark"),
  "logo-vertical.svg": vertical("v", "light"),
  "logo-vertical-dark.svg": vertical("vd", "dark"),
  "logo-mono.svg": horizontalMono(NAVY),
  "logo-mono-white.svg": horizontalMono("#ffffff"),
  "favicon.svg": favicon(),
};

for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
writeFileSync(join(ROOT, "public", "icon.svg"), files["favicon.svg"]);

/* ---- PNG / ICO ---- */
const tileSvg = (tone, opts) => svg("0 0 64 64", defs("p") + markTile("p", tone, opts));
const png = (s, size) => sharp(Buffer.from(s)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const out = {};
out["icon-192.png"] = await png(tileSvg("light"), 192);
out["icon-512.png"] = await png(tileSvg("light"), 512);
out["maskable-192.png"] = await png(tileSvg("light", { bleed: true, scale: 0.78 }), 192);
out["maskable-512.png"] = await png(tileSvg("light", { bleed: true, scale: 0.78 }), 512);
out["apple-touch-icon.png"] = await png(tileSvg("light", { bleed: true, scale: 0.92 }), 180);
out["favicon-32.png"] = await png(tileSvg("light"), 32);
for (const [n, b] of Object.entries(out)) writeFileSync(join(OUT, n), b);

// ICO: PNG gömülü (16/32/48)
const sizes = [16, 32, 48];
const imgs = await Promise.all(sizes.map((s) => png(tileSvg("light"), s)));
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(imgs.length, 4);
let offset = head.length;
imgs.forEach((b, i) => {
  const o = 6 + 16 * i;
  head.writeUInt8(sizes[i] % 256, o);
  head.writeUInt8(sizes[i] % 256, o + 1);
  head.writeUInt8(0, o + 2);
  head.writeUInt8(0, o + 3);
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(b.length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += b.length;
});
writeFileSync(join(ROOT, "public", "favicon.ico"), Buffer.concat([head, ...imgs]));

console.log("marka varlıkları yazıldı:", Object.keys(files).length, "svg,", Object.keys(out).length, "png, favicon.ico");
