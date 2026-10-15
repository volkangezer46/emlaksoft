import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SÖZLEŞME (WP5, docs/design/FINANS_ENTEGRASYON_2026-10.md): eski `expenses` tablosu DONDURULDU. Yeni gider yalnız defter
 * yoluyla yazılır (`finance_record_entry_v2` / `finance_post` `expense.paid` / `invoice.received`); uygulama kodu
 * `expenses` tablosuna doğrudan EKLEME/UPSERT yapmaz. Geçmiş satırları düzenleme/silme ve okuma serbesttir.
 *
 * İstisnalar gerekçeli ve dar tutulur: yalnız örnek/demo veri tohumlayıcıları (her satır is_sample ya da demo ofis; ekranların
 * eski gider okuyucuları defterle birlikte bu geçmişi gösterir). Yeni istisna eklemek yerine defter RPC'si kullanın.
 */
const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const ALLOW: Readonly<Record<string, string>> = {
  "src/lib/sample-data-seed.ts": "Örnek veri (is_sample) tohumu: 'Gerçek kullanıma geç' ile silinir; defter örnekleri modules-seed'de.",
  "src/lib/sample-data/modules-seed.ts": "Demo ofis tohumu: eski gider geçmişi + bağlı defter hareketi birlikte yazılır (çift sayım yok, expense_id bağı).",
};

const WRITE_PATTERNS: readonly RegExp[] = [
  /\.from\(\s*["'`]expenses["'`]\s*\)\s*\.\s*(insert|upsert)\s*\(/g,
  /insertRows\(\s*[\w.]+\s*,\s*["'`]expenses["'`]/g,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function findExpenseWrites(source: string): string[] {
  const hits: string[] = [];
  for (const re of WRITE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) hits.push(m[0].replace(/\s+/g, " "));
  }
  return hits;
}

describe("eski gider tablosu dondurma sözleşmesi", () => {
  it("desen yakalar: zincirli/çok satırlı insert, upsert ve insertRows yardımcısı", () => {
    expect(findExpenseWrites(`await supabase\n  .from("expenses")\n  .insert({ a: 1 })`)).toHaveLength(1);
    expect(findExpenseWrites(`db.from('expenses').upsert(rows)`)).toHaveLength(1);
    expect(findExpenseWrites(`await insertRows(db, "expenses", rows)`)).toHaveLength(1);
    expect(findExpenseWrites(`db.from("expenses").select("id").eq("x", 1)`)).toEqual([]);
    expect(findExpenseWrites(`db.from("expenses").update({ a: 1 })`)).toEqual([]);
    expect(findExpenseWrites(`db.from("expense_budgets").upsert(rows)`)).toEqual([]);
  });

  it("src altında istisna dışında expenses'a ekleme/upsert yok", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      const hits = findExpenseWrites(readFileSync(file, "utf8"));
      if (hits.length > 0 && !ALLOW[rel]) offenders.push(`${rel}: ${hits.join(" | ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("istisna listesi güncel: her istisna gerçekten yazıyor ve gerekçesi var", () => {
    for (const [rel, reason] of Object.entries(ALLOW)) {
      expect(reason.length, rel).toBeGreaterThan(20);
      expect(findExpenseWrites(readFileSync(join(ROOT, rel), "utf8")).length, rel).toBeGreaterThan(0);
    }
  });

  it("eski gider ekleme eylemi kaldırıldı (yeni gider yalnız Muhasebe > Kayıt'tan)", () => {
    const src = readFileSync(join(SRC, "app/actions/expenses.ts"), "utf8");
    expect(src).not.toMatch(/export async function createExpense\b/);
  });
});
