import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUILDING_NAME, RENTAL_DEFS, UNIT_DEFS, feeOf, seedModuleData, type ModuleSeedContext } from "./modules-seed";
import { distributeAmount, compareUnits } from "@/lib/building-management/distribution";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Her sorguyu verilen hata ile bitiren sahte istemci (zincirleme builder). */
function failingDb(error: { code: string; message: string }): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error, count: null });
      return () => chain;
    },
  });
  return { from: () => chain, rpc: () => chain } as unknown as SupabaseClient;
}

const baseCtx = (db: SupabaseClient): ModuleSeedContext => ({
  db,
  tenantId: "t-1",
  ownerId: "u-1",
  advisorId: "u-1",
  sample: true,
  place: { provinceId: "p-1", districtId: "d-1", city: "İstanbul", district: "Kadıköy", districts: {} },
  codePrefix: "ORNEK",
  authorityPropertyCodes: ["ORNEK-001"],
  analysisPropertyCodes: ["ORNEK-001"],
  processDeals: [{ propertyCode: "ORNEK-010", profile: "in_transfer" }],
});

describe("modül örnek verisi — tanım sözleşmesi", () => {
  it("4-6 yönetimli kira; yönetim ücreti hem yüzde hem sabit; IBAN biçimi DB kısıtına uyar", () => {
    expect(RENTAL_DEFS.length).toBeGreaterThanOrEqual(4);
    expect(RENTAL_DEFS.length).toBeLessThanOrEqual(6);
    expect(new Set(RENTAL_DEFS.map((d) => d.fee.type))).toEqual(new Set(["percent", "fixed"]));
    for (const d of RENTAL_DEFS) {
      expect(d.iban).toMatch(/^TR[0-9]{24}$/);
      expect(d.payoutDay).toBeGreaterThanOrEqual(1);
      expect(d.payoutDay).toBeLessThanOrEqual(28);
      if (d.fee.type === "percent") expect(d.fee.value).toBeLessThanOrEqual(100);
    }
    const phones = RENTAL_DEFS.flatMap((d) => [d.owner.phone, d.renter.phone]).concat(
      UNIT_DEFS.flatMap((u) => [typeof u.owner === "string" ? "" : u.owner.phone, u.tenant?.phone ?? ""]).filter(Boolean),
    );
    expect(new Set(phones).size).toBe(phones.length);
  });

  it("tahsilat planı kısmi ve gecikmiş (ödenmemiş geçmiş ay) örnek içerir", () => {
    const plans = RENTAL_DEFS.flatMap((d) => d.plan);
    expect(plans).toContain("partial");
    // Geçen ay (-1) ödenmemiş = gecikmiş
    expect(RENTAL_DEFS.some((d) => d.plan[1] === "none")).toBe(true);
    expect(plans.filter((p) => p === "paid").length).toBeGreaterThan(plans.length / 2);
  });

  it("bina: 8-12 daire, tekil blok/numara, arsa payı + m² dolu, mahsup için yönetimli kira bağlantısı", () => {
    expect(UNIT_DEFS.length).toBeGreaterThanOrEqual(8);
    expect(UNIT_DEFS.length).toBeLessThanOrEqual(12);
    const labels = UNIT_DEFS.map((u) => `${u.block}|${u.no}`);
    expect(new Set(labels).size).toBe(labels.length);
    for (const u of UNIT_DEFS) {
      expect(u.m2).toBeGreaterThan(0);
      expect(u.landShare).toBeGreaterThan(0);
    }
    const links = UNIT_DEFS.filter((u) => typeof u.owner === "string").map((u) => u.owner as string);
    for (const l of links) expect(RENTAL_DEFS.some((d) => d.suffix === l)).toBe(true);
    expect(UNIT_DEFS.some((u) => u.payer === "tenant" && u.tenant)).toBe(true);
    expect(BUILDING_NAME.length).toBeGreaterThan(3);
  });

  it("arsa payı dağıtımı toplamı tam tutturur (kuruş farkı son daireye)", () => {
    const units = UNIT_DEFS.map((u, i) => ({ id: `u${i}`, block: u.block, floor: u.floor, unitNo: u.no, landShare: u.landShare, areaM2: u.m2 })).sort(compareUnits);
    for (const method of ["land_share", "area"] as const) {
      const r = distributeAmount({ method, total: 21500, units });
      expect(r.ok).toBe(true);
      if (r.ok) expect(Math.round(r.shares.reduce((s, x) => s + x.amount, 0) * 100)).toBe(2150000);
    }
  });

  it("yönetim ücreti: yüzde ve sabit (tahsilatı aşmaz)", () => {
    expect(feeOf({ type: "percent", value: 8 }, 38000, 0)).toBe(3040);
    expect(feeOf({ type: "fixed", value: 3500 }, 48000, 0)).toBe(3500);
    expect(feeOf({ type: "fixed", value: 3500 }, 2000, 0)).toBe(2000);
    expect(feeOf({ type: "fixed", value: 3500 }, 48000, 3500)).toBe(0);
  });
});

describe("modül örnek verisi — dayanıklılık", () => {
  it("tablolar yoksa (42P01) hiçbir grup hata sayılmaz: tümü 'etkin değil' olarak atlanır", async () => {
    const report = await seedModuleData(baseCtx(failingDb({ code: "42P01", message: 'relation "x" does not exist' })));
    expect(report.failed).toEqual([]);
    expect(report.skipped.length).toBeGreaterThan(0);
  });

  it("beklenmeyen veritabanı hatası 'failed' olarak raporlanır, fırlatmaz", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await seedModuleData(baseCtx(failingDb({ code: "23505", message: "duplicate key" })));
    expect(report.failed.length).toBeGreaterThan(0);
  });
});

describe("modül örnek verisi — kaynak sözleşmesi", () => {
  const src = read("src/lib/sample-data/modules-seed.ts");

  it("yeni createAdminClient yok; bileşen saat API'si yok", () => {
    expect(src).not.toMatch(/createAdminClient/);
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new Date\(\)/);
  });

  it("yazma RPC'leri değil, service_role'e açık yeniden hesap yardımcıları kullanılır", () => {
    expect(src).not.toMatch(/rpc\("record_rent_payment"|rpc\("record_building_payment"|rpc\("record_owner_payout"/);
    expect(src).toContain('rpc("pm_recompute_charge"');
    expect(src).toContain('rpc("bm_recompute_charge"');
  });

  it("örnek modda is_sample işareti taşıyan tablolar işaretlenir; bütçe örnek modda yazılmaz", () => {
    expect(src).toMatch(/ctx\.sample \? \{ is_sample: true \} : \{\}/);
    expect(src).toMatch(/if \(!ctx\.sample\) \{[\s\S]*expense_budgets/);
  });

  it("ürün kararı: yalnız İstanbul büyük ilçeleri (küçük il/ilçe adı yok)", () => {
    for (const f of [
      "src/lib/sample-data/modules-seed.ts",
      "src/lib/sample-data-seed.ts",
    ]) {
      expect(read(f)).not.toMatch(/Kahramanmaraş|Onikişubat|Dulkadiroğlu/);
    }
    // demo seed yalnız normalizasyon (eski satırları taşıma) bölümünde eski adları anar
    const demo = read("scripts/seed-demo.ts");
    const outside = demo.replace(/\/\*\*\n \* Ürün kararı[\s\S]*?\nasync function normalizeDemoGeo[\s\S]*?\n}\n/, "");
    expect(outside.length).toBeLessThan(demo.length);
    expect(outside).not.toMatch(/Kahramanmaraş|marasId|onikisubatId|dulkadirogluId/);
  });
});
