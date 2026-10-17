/**
 * ARAMA SONUCU PİKSEL GENİŞLİĞİ (SAF; istemci editörü de içe aktarır, bağımlılık yok).
 *
 * Google masaüstü sonucunda başlık Arial 20 px, açıklama Arial 14 px çizilir ve sınır karakter değil PİKSELDİR:
 * "İİİİ" ile "MMMM" aynı karakter sayısında çok farklı yer kaplar. Genişlikler Arial'ın yazı tipi ölçülerinden
 * (1000 birim/em) alınmıştır; Türkçe harfler (ç ğ ı İ ö ş ü ve büyükleri) temel harfle aynı ilerleme genişliğindedir.
 * Sonuç bir TAHMİNDİR (Google yazı tipi/ölçek değiştirebilir); eşikler bilinen kesilme noktasının biraz altındadır.
 */

const W: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584,
  ",": 278, "-": 333, ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, "{": 334, "|": 260, "}": 334, "~": 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  // Türkçe ve sık işaretler
  ç: 500, Ç: 722, ğ: 556, Ğ: 778, ı: 278, İ: 278, ö: 556, Ö: 778, ş: 500, Ş: 667, ü: 556, Ü: 722,
  â: 556, Â: 667, î: 278, Î: 278, û: 556, Û: 722, é: 556, è: 556,
  "·": 278, "–": 556, "—": 1000, "…": 1000, "’": 222, "‘": 222, "“": 333, "”": 333, "₺": 556, "€": 556, "²": 333,
  "•": 350, "«": 556, "»": 556, "×": 584,
};
for (const d of "0123456789") W[d] = 556;

/** Bilinmeyen karakter: ortalama harf genişliği. */
const FALLBACK = 556;

/** Başlık (20 px) ve açıklama (14 px) yazı boyutları. */
export const SERP_FONT_PX = { title: 20, description: 14 } as const;

/** Eşikler (piksel). Başlık Google'da ~600 px'te kesilir; açıklama masaüstünde ~920 px (iki satır). */
export const SERP_PX = { titleMax: 580, titleMin: 200, descMax: 920, descMin: 430 } as const;

export function textPixelWidth(text: string, fontPx: number): number {
  let units = 0;
  for (const ch of text.replace(/\s+/g, " ")) units += W[ch] ?? FALLBACK;
  return Math.round((units / 1000) * fontPx);
}

export const titlePixels = (text: string) => textPixelWidth(text.trim(), SERP_FONT_PX.title);
export const descriptionPixels = (text: string) => textPixelWidth(text.trim(), SERP_FONT_PX.description);

export type PixelVerdict = { verdict: "ok" | "warn" | "fail"; px: number; message: string };

export function titlePixelVerdict(rendered: string): PixelVerdict {
  const t = rendered.trim();
  const px = titlePixels(t);
  if (!t) return { verdict: "fail", px, message: "Başlık boş." };
  if (px > SERP_PX.titleMax) return { verdict: "warn", px, message: `Başlık yaklaşık ${px} px; ${SERP_PX.titleMax} px üstü arama sonucunda kesilir.` };
  if (px < SERP_PX.titleMin) return { verdict: "warn", px, message: `Başlık yaklaşık ${px} px; çok kısa (en az ${SERP_PX.titleMin} px önerilir).` };
  return { verdict: "ok", px, message: `Başlık yaklaşık ${px} px (sınır ${SERP_PX.titleMax} px).` };
}

export function descriptionPixelVerdict(desc: string | null | undefined): PixelVerdict {
  const t = (desc ?? "").trim();
  const px = descriptionPixels(t);
  if (!t) return { verdict: "fail", px, message: "Açıklama yok." };
  if (px > SERP_PX.descMax) return { verdict: "warn", px, message: `Açıklama yaklaşık ${px} px; ${SERP_PX.descMax} px üstü kesilir.` };
  if (px < SERP_PX.descMin) return { verdict: "warn", px, message: `Açıklama yaklaşık ${px} px; kısa (en az ${SERP_PX.descMin} px önerilir).` };
  return { verdict: "ok", px, message: `Açıklama yaklaşık ${px} px (sınır ${SERP_PX.descMax} px).` };
}

/**
 * Metni piksel sınırına SÖZCÜK sınırında sığdırır (sığıyorsa aynen döner). Sondaki ayraç/bağlaç kırpılır; üç nokta
 * EKLENMEZ (başlık önerisi tam bir ifade olmalı). Hiç sözcük sığmazsa karakter karakter kesilir.
 */
export function fitToPixels(text: string, maxPx: number, fontPx: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (textPixelWidth(clean, fontPx) <= maxPx) return clean;
  const words = clean.split(" ");
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (textPixelWidth(next, fontPx) > maxPx) break;
    out = next;
  }
  if (!out) {
    for (const ch of clean) {
      if (textPixelWidth(out + ch, fontPx) > maxPx) break;
      out += ch;
    }
    return out;
  }
  return out
    .replace(/[\s,;:|·–—-]+$/, "")
    .replace(/\s+(ve|ile|veya|ya|ama|için|en|bir)$/i, "")
    .replace(/[\s,;:|·–—-]+$/, "");
}
