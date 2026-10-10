import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POOL_PROPERTY_DEFS, POOL_TEMPLATES, planAdvisorProfiles } from "./pool-seed";

const DIST = { Kadıköy: "d-kad", Ataşehir: "d-ata", Beşiktaş: "d-bes", Şişli: "d-sis" };

describe("ilan havuzu örnek verisi", () => {
  it("5 bekleyen + 2 atanmış kayıt; kaynak etiketleri çeşitli; yalnız İstanbul örnek ilçeleri", () => {
    const pending = POOL_PROPERTY_DEFS.filter((d) => d.assignedSlot == null);
    const assigned = POOL_PROPERTY_DEFS.filter((d) => d.assignedSlot != null);
    expect(pending).toHaveLength(5);
    expect(assigned).toHaveLength(2);
    expect(new Set(pending.map((d) => d.source))).toEqual(new Set(["portal_form", "network", "api", "extension", "manual"]));
    for (const d of POOL_PROPERTY_DEFS) expect(Object.keys(DIST)).toContain(d.district);
    expect(new Set(POOL_PROPERTY_DEFS.map((d) => d.suffix)).size).toBe(POOL_PROPERTY_DEFS.length);
  });

  it("tek profil: şablonlar birleşir, aynı anahtar iki kez yazılmaz (benzersiz dizin)", () => {
    const plan = planAdvisorProfiles(["p1"], DIST, "ist");
    const regionKeys = plan.regions.map((r) => `${r.profile_id}|${r.district_id}`);
    expect(new Set(regionKeys).size).toBe(regionKeys.length);
    const specKeys = plan.specialties.map((s) => `${s.profile_id}|${s.kind}|${s.value}|${s.transaction_type ?? ""}`);
    expect(new Set(specKeys).size).toBe(specKeys.length);
    // Ataşehir hem 3 hem 5 ağırlıklı şablonda: yüksek olan kalır.
    expect(plan.regions.find((r) => r.district_id === "d-ata")!.weight).toBe(5);
  });

  it("birden çok profil: şablonlar dağıtılır; bilinmeyen ilçe bölge satırı üretmez", () => {
    const plan = planAdvisorProfiles(["a", "b", "c"], DIST, "ist");
    expect(new Set(plan.specialties.map((s) => s.profile_id)).size).toBe(3);
    expect(planAdvisorProfiles(["a"], {}, "ist").regions).toEqual([]);
    expect(planAdvisorProfiles(["a"], DIST, null).regions).toEqual([]);
    expect(POOL_TEMPLATES.length).toBe(4);
  });

  it("modül tohumlayıcı havuz grubunu çağırır; demo-ofis üç mevcut profili verir (yeni hesap açılmaz)", () => {
    const mods = readFileSync(join(process.cwd(), "src/lib/sample-data/modules-seed.ts"), "utf8");
    expect(mods).toContain('run("listing_pool"');
    const demo = readFileSync(join(process.cwd(), "scripts/seed-demo.ts"), "utf8");
    expect(demo).toContain("poolProfileIds: [advisorId, gmId, ownerId]");
    const seed = readFileSync(join(process.cwd(), "src/lib/sample-data/pool-seed.ts"), "utf8");
    expect(seed).not.toMatch(/createUser|auth\.admin/);
    expect(seed).toMatch(/is_sample: true/);
  });
});
