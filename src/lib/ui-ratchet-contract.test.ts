import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * UI RATCHET SÖZLEŞMESİ (konsey #42; #32/#39 ile birlikte). /app ve /admin yüzeyinde şu üç kusurun SAYISI yalnız
 * azalabilir; yeni dosya ya da mevcut dosyada artış testi kırar:
 *  - hamRenk:   metin/sınıf içinde ham renk (#rrggbb, rgb()/hsl() değeri, `[#...]` keyfi renk). Renk TOKEN'dan gelir
 *               (bg-surface, text-ink-950, border-line ...); koyu temada ham renk okunmaz hale gelir.
 *  - hamPalet:  Tailwind'in HAM palet sınıfı (`bg-red-50`, `text-zinc-500`, `stroke-orange-500` ...). Projenin token ailesi
 *               (ink/brand/mint/amber/danger/warn/surface/text-*) kullanılır; ham palet koyu temada dönmez (konsey #30).
 *               `cyan-400` token'a bağlıdır, sayılmaz.
 *  - hamButon:  ham `<button` (kanonik `Button` / `FilterChip` / `IconButton` kullan: odak, basma, 44px, yükleme tek yerde).
 *  - kucukHedef: tıklanabilir öğe (button/a/Link/summary) className'inde `h-5..h-10` / `min-h-*` 44px altı yükseklik,
 *               AYNI className'de `touch:` 44px karşılığı (`touch:h-11` / `touch:min-h-11` / `h-11+`) olmadan.
 * Mevcut borç `src/lib/ui-ratchet-baseline.json` içindedir (dosya -> sayı). Bir dosyayı düzeltince sayıyı AŞAĞI çek
 * (test, gerçek sayı sınırın altına düşünce de uyarır: "sınırı düşür"). Elle YÜKSELTME: sorunu kodda düzelt.
 * Güncelleme: `UI_RATCHET_WRITE=1 npx vitest run src/lib/ui-ratchet-contract.test.ts` yalnız AZALAN sayıları yazar
 * (yeni dosya ya da artış asla yazılmaz).
 */
const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "src/lib/ui-ratchet-baseline.json");

const SCAN_DIRS = [
  "src/app/app",
  "src/app/admin",
  "src/components/admin",
  "src/components/app",
  "src/components/billing",
  "src/components/listing-control",
  "src/components/report-center",
  "src/components/settings",
  "src/components/surveys",
  "src/components/modules",
  "src/components/tools",
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** JSX açılış etiketlerini ayıklar (süslü parantez derinliğine ve tırnaklara saygılı, `=>` içindeki `>` dikkate alınmaz). */
function openingTags(src: string): Array<{ name: string; text: string }> {
  const tags: Array<{ name: string; text: string }> = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || (c === "`" && depth > 0)) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && src[i - 1] !== "=") break;
    }
    tags.push({ name: m[1], text: src.slice(m.index, i + 1) });
    re.lastIndex = m.index + m[0].length;
  }
  return tags;
}

const RAW_COLOR = /(?:#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgb|rgba|hsl|hsla)\(\s*\d)/g;
const RAW_PALETTE =
  /(?<![\w-])(?:[\w[\]=-]+:)*(?:text|bg|border|ring|from|to|via|divide|fill|stroke|outline|decoration|accent|caret|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|yellow|green|lime|emerald|teal|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?![\w-])/g;
const SMALL_H = /(?:^|[\s"'`:])(?:h|min-h)-(?:\[(?:[1-3]\d|4[0-3])px\]|[1-9]|10|0\.5|1\.5|2\.5|3\.5)(?=[\s"'`}]|$)/;
const TOUCH_OK = /touch:(?:h|min-h|size)-(?:11|12|14)|(?:^|[\s"'`])min-h-(?:11|12|14)(?=[\s"'`}]|$)|(?:^|[\s"'`])h-(?:11|12|14|16)(?=[\s"'`}]|$)/;

export function measureFile(src: string) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const hamRenk = (code.match(RAW_COLOR) ?? []).length;
  const hamPalet = (code.match(RAW_PALETTE) ?? []).length;
  let hamButon = 0;
  let kucukHedef = 0;
  for (const t of openingTags(code)) {
    if (t.name === "button") hamButon++;
    if (/^(button|a|Link|summary|ButtonLink)$/.test(t.name)) {
      const cls = /className=(?:\{`([^`]*)`\}|"([^"]*)"|\{"([^"]*)"\}|\{cn\(([^)]*)\)\})/.exec(t.text);
      const text = cls ? (cls[1] ?? cls[2] ?? cls[3] ?? cls[4] ?? "") : "";
      if (text && SMALL_H.test(text) && !TOUCH_OK.test(text)) kucukHedef++;
    }
  }
  return { hamRenk, hamPalet, hamButon, kucukHedef };
}

type Counts = { hamRenk: number; hamPalet: number; hamButon: number; kucukHedef: number };
const KEYS = ["hamRenk", "hamPalet", "hamButon", "kucukHedef"] as const;

function measureAll(): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const dir of SCAN_DIRS) {
    for (const f of walk(join(ROOT, dir))) {
      const c = measureFile(readFileSync(f, "utf8"));
      if (c.hamRenk || c.hamPalet || c.hamButon || c.kucukHedef) out[relative(ROOT, f).replace(/\\/g, "/")] = c;
    }
  }
  return out;
}

const current = measureAll();
const baseline: Record<string, Counts> = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};

if (process.env.UI_RATCHET_INIT === "1") {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 1) + "\n");
}
if (process.env.UI_RATCHET_WRITE === "1" && existsSync(BASELINE_PATH)) {
  const next: Record<string, Counts> = {};
  for (const [file, b] of Object.entries(baseline)) {
    const c = current[file] ?? { hamRenk: 0, hamPalet: 0, hamButon: 0, kucukHedef: 0 };
    const merged = {
      hamRenk: Math.min(b.hamRenk, c.hamRenk),
      hamPalet: Math.min(b.hamPalet ?? 0, c.hamPalet),
      hamButon: Math.min(b.hamButon, c.hamButon),
      kucukHedef: Math.min(b.kucukHedef, c.kucukHedef),
    };
    if (merged.hamRenk || merged.hamPalet || merged.hamButon || merged.kucukHedef) next[file] = merged;
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 1) + "\n");
}

describe("UI ratchet (ham renk / ham button / 44px altı hedef)", () => {
  it("ölçüm kuralları doğru çalışır", () => {
    expect(measureFile(`<div className="bg-[#fff] text-ink-950" style={{ color: "#123456" }} />`).hamRenk).toBe(2);
    expect(measureFile(`<div className="bg-red-50 hover:text-zinc-500 text-danger-600 bg-cyan-400 text-ink-950" />`).hamPalet).toBe(2);
    expect(measureFile(`<button type="button">x</button><Button>y</Button>`).hamButon).toBe(1);
    expect(measureFile(`<Link href="/a" className="inline-flex h-8 px-2">x</Link>`).kucukHedef).toBe(1);
    expect(measureFile(`<Link href="/a" className="inline-flex h-8 touch:h-11 px-2">x</Link>`).kucukHedef).toBe(0);
    expect(measureFile(`<button className={\`min-h-9 touch:min-h-11 \${x}\`}>x</button>`).kucukHedef).toBe(0);
    expect(measureFile(`<div className="h-8 w-8" />`).kucukHedef).toBe(0);
  });

  it("yeni ham renk / ham button / 44px altı hedef eklenmedi (yalnız küçülebilir)", () => {
    const violations: string[] = [];
    for (const [file, c] of Object.entries(current)) {
      const b = baseline[file] ?? { hamRenk: 0, hamPalet: 0, hamButon: 0, kucukHedef: 0 };
      for (const k of KEYS) if (c[k] > b[k]) violations.push(`${file}: ${k} ${b[k]} -> ${c[k]} (kanonik bileşen / token / touch:h-11 kullan)`);
    }
    expect(violations).toEqual([]);
  });

  it("önekli (hover:/focus:/group-hover:/data-[..]:) text-ink-* sınıflarının hepsi theme-dark.css'te karşılanır (#29)", () => {
    const css = readFileSync(join(ROOT, "src/app/theme-dark.css"), "utf8");
    const used = new Set<string>();
    for (const dir of SCAN_DIRS) {
      for (const f of walk(join(ROOT, dir))) {
        for (const m of readFileSync(f, "utf8").matchAll(/(?<![\w-])([\w-]+(?:\[[^\]\s]*\])?):text-ink-(?:950|900|800)(?![\w-])/g)) used.add(m[1]);
      }
    }
    const missing = [...used].filter((v) => !css.includes(`.${v.replace(/[[\]=]/g, "\\$&")}\\:text-ink-950`));
    expect(missing).toEqual([]);
  });

  it("düzeltilen dosyalarda sınır düşürülür (sınır gerçek sayıdan yüksek kalamaz)", () => {
    const stale: string[] = [];
    for (const [file, b] of Object.entries(baseline)) {
      const c = current[file] ?? { hamRenk: 0, hamPalet: 0, hamButon: 0, kucukHedef: 0 };
      for (const k of KEYS) if (c[k] < b[k]) stale.push(`${file}: ${k} sınırı ${b[k]}, gerçek ${c[k]} -> UI_RATCHET_WRITE=1 npx vitest run src/lib/ui-ratchet-contract.test.ts`);
    }
    expect(stale).toEqual([]);
  });
});
