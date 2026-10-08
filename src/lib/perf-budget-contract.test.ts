import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Performans bütçesi sözleşmesi (regresyon kilidi): "tüm sayfalar tıklar tıklamaz açılır".
 *
 * (a) /app ve /admin altındaki HER `page.tsx` segmentinin kendi `loading.tsx` dosyası vardır: tıklayınca kabuk + iskelet anında
 *     gelir, veri akıtılır (üst segmentin sınırına güvenmek ince sayfalarda iskeleti yanlış boyutlu gösterirdi).
 * (b) Sayfa dosyalarında, aynı işlev gövdesinde ARDIŞIK ve BİRBİRİNDEN BAĞIMSIZ `await supabase...` sorguları yoktur
 *     (waterfall): bağımsız okumalar `Promise.all` ile tek turda başlar. Statik, basit tespit: aynı girinti düzeyinde art arda
 *     iki `const x = await ...supabase...` ifadesinde ikincisi birincinin değişkenlerini kullanmıyorsa ihlaldir.
 *     Bağımlı zincirler (ikinci sorgu birinciyi kullanır) ihlal değildir. Aşağıdaki liste yalnız GEREKÇELİ istisnadır.
 * (c) "use client" bileşenleri ağır kütüphaneyi (recharts, pdf-lib, fontkit, read-excel-file ...) STATİK içe aktarmaz,
 *     ne doğrudan ne de içe aktarma zinciriyle; yalnız `next/dynamic` / dinamik `import()` (istemci paketi bölünür).
 *     `client-bundle-contract.test.ts` (zod / kabuk panelleri) ile birlikte çalışır.
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (f: string) => f.slice(ROOT.length + 1).split("\\").join("/");
const SRC_FILES = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

describe("(a) her sayfa segmentinin kendi loading.tsx dosyası var", () => {
  it("/app ve /admin page.tsx segmentleri", () => {
    const missing = [...walk(join(ROOT, "src/app/app")), ...walk(join(ROOT, "src/app/admin"))]
      .filter((f) => f.endsWith("page.tsx"))
      .filter((f) => !existsSync(join(dirname(f), "loading.tsx")))
      .map((f) => rel(dirname(f)));
    expect(missing, `loading.tsx eksik segmentler (tıklayınca iskelet gelmez):\n${missing.join("\n")}`).toEqual([]);
  });
});

/** (b) Gerekçeli istisnalar: sayfa -> neden bağımsız ardışık okuma kabul edildi. Yeni satır eklemek için gerekçe şart. */
const WATERFALL_ALLOW: Record<string, string> = {};

type Stmt = { start: number; text: string; declared: string[] };

/** Bir dosyadaki "  const x = await ...supabase..." biçimli, girintisi `indent` olan ifadeleri (çok satırlı) çıkarır. */
function awaitStatements(lines: string[]): { indent: number; stmts: Stmt[] }[] {
  const groups = new Map<number, Stmt[]>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s+)(?:const|let)\s+(\{[^=]*\}|\[[^=]*\]|[A-Za-z_$][\w$]*)\s*=\s*await\s+(.*)$/);
    if (!m) continue;
    const indent = m[1]!.length;
    // İfade, aynı girintide yeni satır başlayana ya da kapanan `;` satırına kadar sürer.
    let j = i;
    let text = lines[i]!;
    while (j + 1 < lines.length && !/;\s*$/.test(lines[j]!)) {
      j++;
      text += `\n${lines[j]!}`;
      if (j - i > 60) break;
    }
    const declared = [...m[2]!.matchAll(/[A-Za-z_$][\w$]*/g)].map((d) => d[0]);
    const arr = groups.get(indent) ?? [];
    arr.push({ start: i, text, declared });
    groups.set(indent, arr);
  }
  return [...groups.entries()].map(([indent, stmts]) => ({ indent, stmts }));
}

/** Aynı girintide, satır olarak BİTİŞİK iki ifade: ikincisi birincinin değişkenini kullanmıyor ve ikisi de supabase sorgusu. */
export function findIndependentSequentialAwaits(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  for (const { stmts } of awaitStatements(lines)) {
    for (let k = 1; k < stmts.length; k++) {
      const prev = stmts[k - 1]!;
      const cur = stmts[k]!;
      const prevEnd = prev.start + prev.text.split("\n").length - 1;
      // Aralarında başka kod olmamalı (yalnız boş satır / yorum): kontrol akışı ya da kullanım araya girmiş olabilir.
      const between = lines.slice(prevEnd + 1, cur.start).filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
      if (between.length > 0) continue;
      const isDb = (t: string) => /\bsupabase\b|\badmin\b|\.from\(|\.rpc\(/.test(t);
      if (!isDb(prev.text) || !isDb(cur.text)) continue;
      const usesPrev = prev.declared.some((d) => new RegExp(`(?<![\\w$.])${d.replace(/\$/g, "\\$")}(?![\\w$])`).test(cur.text));
      if (!usesPrev) hits.push(cur.start + 1);
    }
  }
  return hits;
}

describe("(b) sayfalarda bağımsız ardışık await supabase (waterfall) yok", () => {
  it("tespit yardımcısı bağımsız ardışık sorguyu yakalar, bağımlıyı yakalamaz", () => {
    const bad = [
      "export default async function P() {",
      "  const a = await supabase.from(\"x\").select(\"id\");",
      "  const b = await supabase.from(\"y\").select(\"id\");",
      "}",
    ].join("\n");
    expect(findIndependentSequentialAwaits(bad)).toEqual([3]);
    const dependent = [
      "export default async function P() {",
      "  const a = await supabase.from(\"x\").select(\"id\");",
      "  const b = await supabase.from(\"y\").select(\"id\").in(\"id\", a.data);",
      "}",
    ].join("\n");
    expect(findIndependentSequentialAwaits(dependent)).toEqual([]);
  });

  it("/app ve /admin page.tsx dosyaları", () => {
    const offenders: string[] = [];
    const pages = [...walk(join(ROOT, "src/app/app")), ...walk(join(ROOT, "src/app/admin"))].filter((f) => f.endsWith("page.tsx"));
    for (const f of pages) {
      const path = rel(f);
      if (WATERFALL_ALLOW[path]) continue;
      const hits = findIndependentSequentialAwaits(readFileSync(f, "utf8"));
      if (hits.length > 0) offenders.push(`${path}: satır ${hits.join(", ")}`);
    }
    expect(offenders, `Bağımsız ardışık await supabase (Promise.all kullanın ya da gerekçeyle istisna ekleyin):\n${offenders.join("\n")}`).toEqual([]);
  });
});

/** (c) İstemci paketine statik girmemesi gereken ağır paketler. */
const HEAVY_PACKAGES = ["recharts", "pdf-lib", "@pdf-lib/fontkit", "read-excel-file", "exceljs", "xlsx", "jspdf", "html2canvas", "web-push", "pg"];

/** Gerekçeli istisna: bu dosya DOĞRUDAN ağır paketi içe aktarır çünkü yalnız dinamik yükleyicinin hedefidir. */
const HEAVY_ENTRY_ALLOW: Record<string, string> = {
  "src/components/ui/chart.tsx": "recharts sarmalayıcısı; yalnız lazy-charts.tsx (next/dynamic) tarafından yüklenir",
};

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Değer içe aktarmaları (`import type`, yalnız-tip listeleri ve dinamik `import()` hariç). */
function valueImports(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) continue;
    const inner = m[2]!.match(/^\{([\s\S]*)\}$/);
    if (inner && inner[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[3]!);
  }
  for (const s of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(s[1]!);
  return out;
}

const isClientFile = (text: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(text);

describe("(c) istemci bileşenleri ağır kütüphaneyi statik içe aktarmaz", () => {
  it("doğrudan ve içe aktarma zinciriyle", () => {
    const heavyHit = (spec: string) => HEAVY_PACKAGES.find((p) => spec === p || spec.startsWith(`${p}/`));
    const offenders: string[] = [];
    for (const f of SRC_FILES) {
      const text = readFileSync(f, "utf8");
      if (!isClientFile(text)) continue;
      const seen = new Set<string>();
      const walkChain = (file: string, chain: string[]): string | null => {
        if (seen.has(file)) return null;
        seen.add(file);
        const t = readFileSync(file, "utf8");
        // "use server" sınırı istemci paketine girmez (eylem referansı olur).
        if (chain.length > 0 && /^\s*["']use server["']/.test(t)) return null;
        for (const spec of valueImports(t)) {
          const pkg = heavyHit(spec);
          if (pkg && !HEAVY_ENTRY_ALLOW[rel(file)]) return [...chain, rel(file), pkg].join(" -> ");
          const next = resolveSpec(spec, file);
          if (next) {
            const hit = walkChain(next, [...chain, rel(file)]);
            if (hit) return hit;
          }
        }
        return null;
      };
      const hit = walkChain(f, []);
      if (hit) offenders.push(hit);
    }
    expect(offenders, `İstemci paketine statik giren ağır paket (next/dynamic kullanın):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("istisna listesindeki dosyalar gerçekten dinamik yükleyiciyle bağlı (statik import yok)", () => {
    for (const allowed of Object.keys(HEAVY_ENTRY_ALLOW)) {
      const importers = SRC_FILES.filter((f) => {
        const text = readFileSync(f, "utf8");
        return valueImports(text).some((s) => resolveSpec(s, f) === join(ROOT, allowed));
      }).map(rel);
      expect(importers, `${allowed} statik içe aktarılıyor`).toEqual([]);
    }
  });
});
