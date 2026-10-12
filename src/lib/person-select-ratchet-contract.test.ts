import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * KİŞİ/MÜŞTERİ/PORTFÖY/HESAP/KONUM SEÇİMİ RATCHET SÖZLEŞMESİ. 200 danışmanlı bir ofiste düz `<select>` içinde
 * gezmek kullanılamaz; büyüyebilen listeler `PersonSelect` (kişi) ya da `Combobox` (müşteri, portföy, anlaşma, hesap,
 * şube, il/ilçe/mahalle) ile aranabilir seçilir. Bu test ham `<select>` / `FormSelect` / Radix `Select` gövdesinde
 * böyle bir listenin (advisors, members, staff, customers, properties, deals, accounts, branches, provinces ...)
 * `.map(` ile döküldüğü yerleri sayar; dosya başına sayı yalnız AZALABİLİR (yeni dosya ya da artış testi kırar).
 * Sabit kısa enum seçimleri (durum, tür, evet/hayır) kapsam dışıdır.
 * Güncelleme: `PERSON_SELECT_RATCHET_WRITE=1 npx vitest run src/lib/person-select-ratchet-contract.test.ts`
 * yalnız AZALAN sayıları yazar.
 */
const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "src/lib/person-select-ratchet-baseline.json");
const SCAN_DIRS = ["src/app/app", "src/app/admin", "src/components/app", "src/components/ui"];

const BIG_LIST =
  /\{\s*\(?\s*(?:[\w.?]*\.)?(?:advisors?|members?|staff|people|team|customers?|properties|portfolios|deals|accounts|officeAccounts|candidates|managers|requesters|authors|actorOptions|handoffTargets|provinces|provinceOptions|iller|ilceler|mahalleler|districts|branches|teams)\s*\)?\.map\(/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** Ham seçim elemanlarının gövdesini çıkarır (açılıştan kapanışa). */
export function rawSelectBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /<(select|FormSelect|NativeSelect|Select)(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const close = `</${m[1]}>`;
    const end = src.indexOf(close, m.index);
    if (end === -1) continue;
    blocks.push(src.slice(m.index, end + close.length));
  }
  return blocks;
}

export function countBigListSelects(src: string): number {
  return rawSelectBlocks(src).filter((b) => BIG_LIST.test(b)).length;
}

function measureAll(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const n = countBigListSelects(readFileSync(file, "utf8"));
      if (n > 0) out[relative(ROOT, file).replace(/\\/g, "/")] = n;
    }
  }
  return out;
}

describe("kişi/müşteri/portföy seçimi ratchet'i", () => {
  it("sayaç doğru çalışır", () => {
    const bad = `<select name="x">{advisors.map((a) => <option key={a.id}>{a.name}</option>)}</select>`;
    const ok = `<select name="x">{STATUS.map((a) => <option key={a}>{a}</option>)}</select>`;
    expect(countBigListSelects(bad)).toBe(1);
    expect(countBigListSelects(`<FormSelect>{members.map((m) => null)}</FormSelect>`)).toBe(1);
    expect(countBigListSelects(ok)).toBe(0);
    expect(countBigListSelects(`<PersonSelect people={advisors.map((a) => a)} />`)).toBe(0);
  });

  it("ham seçimli büyük liste sayısı yalnız azalır", () => {
    const baseline: Record<string, number> = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
    const current = measureAll();
    const worse: string[] = [];
    const better: Record<string, number> = {};
    for (const [file, n] of Object.entries(current)) {
      const limit = baseline[file] ?? 0;
      if (n > limit) worse.push(`${file}: ${n} > sınır ${limit} (PersonSelect/Combobox kullanın)`);
    }
    for (const [file, limit] of Object.entries(baseline)) {
      const n = current[file] ?? 0;
      if (n < limit) better[file] = n;
    }
    if (process.env.PERSON_SELECT_RATCHET_WRITE === "1" && Object.keys(better).length > 0) {
      const next = { ...baseline };
      for (const [file, n] of Object.entries(better)) {
        if (n === 0) delete next[file];
        else next[file] = n;
      }
      writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 1) + "\n");
    } else {
      expect(Object.keys(better), `Sınırı düşür (PERSON_SELECT_RATCHET_WRITE=1): ${Object.keys(better).join(", ")}`).toEqual([]);
    }
    expect(worse).toEqual([]);
  });
});
