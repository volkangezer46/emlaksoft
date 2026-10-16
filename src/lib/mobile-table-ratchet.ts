import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Mobil tablo / sabit genişlik ratchet sayacı (MP12, statik; tarayıcısız): telefonda (360–430 px) yana kaydırma doğuran
 * desenleri dosya başına sayar. Sayılan: önek almamış (`md:`/`lg:`… olmayan) geniş sabit genişlik — `min-w-[…]`/`w-[…]`
 * ≥ 400 px (ya da ≥ 25rem) — ve `overflow-x-auto` içindeki `<table`. Dosyada mobil karşılık işareti varsa sayılmaz:
 * kart listesi (`md:hidden`, `MobileCardList`, DataTable `mobileCards`), CSS kart tablosu (`adm-tbl`, `adm-tbl-m`,
 * `tbl-stack`, `table-cards`) ya da yalnız baskı (`print-only`). Sözleşme testi bu sayımı ratchet tabanıyla karşılaştırır.
 */
const MOBILE_MARKERS = /md:hidden|sm:hidden|MobileCardList|mobileCards|\badm-tbl(?:-m)?\b|\btbl-stack\b|\btable-cards\b|\bprint-only\b/;
const WIDE = /(?<![\w:-])(?:min-w|w)-\[(\d+(?:\.\d+)?)(px|rem)\]/g;
const SCROLL_TABLE = /overflow-x-auto[\s\S]{0,400}?<table\b/g;

export type WideFinding = { file: string; count: number };

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx") && !name.includes(".test.")) out.push(p);
  }
}

/** Bir dosyanın mobil karşılıksız geniş desen sayısı (0 = temiz). */
export function countWidePatterns(src: string): number {
  if (MOBILE_MARKERS.test(src)) return 0;
  let n = 0;
  for (const m of src.matchAll(WIDE)) {
    const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
    if (px >= 400) n++;
  }
  n += [...src.matchAll(SCROLL_TABLE)].length;
  return n;
}

export function scanWidePatterns(root: string, dirs: readonly string[] = ["src/app", "src/components"]): WideFinding[] {
  const files: string[] = [];
  for (const d of dirs) walk(join(root, d), files);
  const out: WideFinding[] = [];
  for (const f of files) {
    const count = countWidePatterns(readFileSync(f, "utf8"));
    if (count > 0) out.push({ file: relative(root, f).split("\\").join("/"), count });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
