import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCustomerFilters, normalizeCustomerFilters } from "@/lib/customer-list-filters";
import { searchTermFilter } from "@/lib/pgrst";

/**
 * SÖZLEŞME (SK7 / B059 + B060): müşteri LİSTESİ, palet (searchWorkspace), /app/ara, seçici araması (lookup) ve mükerrer
 * kontrolü AYNI kapsam çözücüyü (getListScope) ve AYNI arama süzgecini (searchTermFilter) kullanır; böylece aynı rol ve
 * aynı telefon için aynı kümeyi döndürürler. Müşteri görünürlüğü için rol tabanlı `hasOfficeWideDataScope` kısayolu
 * (çağrı merkezini yalnız kendine atananlara hapseden eski kural) bu yollarda KULLANILMAZ.
 */
const read = (p: string) => readFileSync(p, "utf8");

const ENTRY_POINTS = {
  palet: "src/app/actions/search.ts",
  ara: "src/app/app/ara/route.ts",
  secici: "src/app/actions/lookup.ts",
  mukerrer: "src/app/actions/duplicates.ts",
} as const;

describe("müşteri arama kapsamı tek kaynaktan", () => {
  it("her giriş noktası getListScope kullanır", () => {
    for (const [name, path] of Object.entries(ENTRY_POINTS)) expect(read(path), name).toContain("getListScope(");
    // Liste sayfası kapsamı page.tsx'te çözer, sorguya data.ts applyScopeFilter ile bağlar.
    expect(read("src/app/app/musteriler/page.tsx")).toContain("getListScope(");
    expect(read("src/app/app/musteriler/data.ts")).toContain('applyScopeFilter(q, scopeFilter, { ownerColumn: "assigned_to" })');
  });

  it("müşteri sorgusunda rol kısayolu yok: palet, /app/ara ve seçici kapsamı süzgeçle bağlar", () => {
    const search = read(ENTRY_POINTS.palet);
    expect(search).not.toMatch(/customerQuery\s*=\s*customerQuery\.eq\("assigned_to"/);
    expect(search).toMatch(/applyScopeFilter\([\s\S]*?from\("customers"\)[\s\S]*?scope,\s*\{ ownerColumn: "assigned_to" \}/);
    expect(read(ENTRY_POINTS.ara)).not.toContain("hasOfficeWideDataScope");
    expect(read(ENTRY_POINTS.secici)).toContain("listScope.filter");
    // Mükerrer: görünürlük kararı liste kapsamıyla (Viewer.scope).
    expect(read(ENTRY_POINTS.mukerrer)).toContain("scope: listScope.filter");
  });

  it("her müşteri araması searchTermFilter'dan geçer (ham full_name/phone ilike yok)", () => {
    for (const path of [ENTRY_POINTS.palet, ENTRY_POINTS.secici, "src/lib/customer-list-filters.ts"]) {
      const src = read(path);
      expect(src, path).toContain("searchTermFilter(");
      expect(src, path).not.toMatch(/orIlike\(\["full_name", "phone", "email"\]/);
      expect(src, path).not.toMatch(/full_name\.ilike\./);
    }
    expect(read(ENTRY_POINTS.ara)).toContain('.ilike("phone_digits"');
  });

  it("liste süzgeci ile palet aynı dizgeyi üretir (aynı telefon → aynı küme)", () => {
    for (const q of ["0555 999 00 01", "+90 555 999 00 01", "kemal isik", "IŞIK"]) {
      const calls: string[] = [];
      const chain: Record<string, (...a: unknown[]) => unknown> = {};
      for (const m of ["contains", "eq", "gte", "lte", "or"]) {
        chain[m] = (...a: unknown[]) => {
          calls.push(`${m}:${a.join("|")}`);
          return chain;
        };
      }
      applyCustomerFilters(chain, normalizeCustomerFilters({ q }));
      expect(calls, q).toEqual([`or:${searchTermFilter(q)}`]);
    }
  });
});
