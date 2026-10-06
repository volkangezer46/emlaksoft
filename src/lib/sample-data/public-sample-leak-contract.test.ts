import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Public vitrin ve token'lı portallar örnek (is_sample) kayıtları ASLA göstermez (HAFIZA §7, sample-scope kural 1).
 * Kaynak taraması: bu yüzeylerde `properties` / `customers` okuyan HER sorgu zincirinde `is_sample` süzgeci
 * (`.eq("is_sample", false)` veya `notSample` / `publicPropertyFilter`) bulunmalıdır. Yeni bir public sorgu süzgeçsiz
 * eklenirse test kırılır.
 */
const root = process.cwd();
const PUBLIC_DIRS = [
  "src/app/vitrin",
  "src/app/paylas",
  "src/app/sunum",
  "src/app/malik-portali",
  "src/app/musteri-portali",
  "src/app/degerleme-raporu",
  "src/app/danisman",
  "src/app/randevu-al",
  "src/app/acik-ev-kayit",
];
const PUBLIC_FILES = ["src/app/actions/owner-portal.ts", "src/app/actions/customer-portal.ts", "src/lib/seo/sitemap-data.ts"];

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((e) => {
    const rel = `${dir}/${e}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e) && !e.endsWith(".test.ts") ? [rel] : [];
  });
}

/** `.from("properties"|"customers")` ile başlayan sorgu zinciri: bir sonraki `;` ya da `.from(` / boş satıra kadar. */
function queryChains(src: string): { table: string; chain: string }[] {
  const out: { table: string; chain: string }[] = [];
  const re = /\.from\("(properties|customers)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Satır yorumları atılır (yorumdaki ';' zinciri erken kesmesin).
    const rest = src.slice(m.index + m[0].length).replace(/^[ \t]*\/\/[^\n]*\n/gm, "").replace(/\/\/[^\n]*/g, "");
    const stop = rest.search(/;|\.from\(|\n\s*\n/);
    out.push({ table: m[1]!, chain: rest.slice(0, stop === -1 ? 600 : stop) });
  }
  return out;
}

const SAMPLE_FILTER = /\.eq\("is_sample", false\)|notSample\(|publicPropertyFilter\(/;

describe("public yüzeylerde örnek veri sızmaz (kaynak sözleşmesi)", () => {
  const files = [...PUBLIC_DIRS.flatMap(walk), ...PUBLIC_FILES];

  it("taranacak dosya var (yol bayatlarsa test boşa geçmesin)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("properties/customers okuyan her public sorgu is_sample süzgeci taşır (yazma/sayaç RPC'leri hariç)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8");
      for (const { table, chain } of queryChains(src)) {
        if (/\.(update|insert|upsert|delete)\(/.test(chain)) continue; // yazma (kayıt güncellemesi) okuma değildir
        if (!SAMPLE_FILTER.test(chain)) {
          offenders.push(`${f} → ${table}: ${chain.replace(/\s+/g, " ").slice(0, 140)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("örnek kayda portal bağlantısı ÜRETİLMEZ (malik + müşteri portalı token üretimi)", () => {
    for (const f of ["src/app/actions/owner-portal.ts", "src/app/actions/customer-portal.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).toMatch(/portal(ı)? bağlantısı ÜRETİLMEZ/);
      expect(src, f).toMatch(/\.eq\("is_sample", false\)/);
    }
  });
});
