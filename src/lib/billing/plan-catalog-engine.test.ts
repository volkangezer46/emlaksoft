import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_CATALOG,
  RECOMMENDED_CATALOG_OVERRIDES,
  applyPlanOverrides,
  catalogPlanDefs,
  customPlanRecord,
  findSellablePlan,
  isCatalogPlanKey,
  isCustomPlanIdFormat,
  parsePlanCatalogSettings,
  quoteFromDefinition,
  resolveCatalogSettings,
  sanitizeCustomPlan,
  serializePlanCatalogSettings,
  DEFAULT_CAMPAIGN,
  type PlanCatalogSettings,
} from "./plan-overrides";
import { PLAN_GATES, gatesIncludedIn, gatesLockedAfterTrial, lockedGate, lockedHrefs, planIncludesGate } from "./page-gates";
import { BASE_PLAN_IDS, getPlan, planAmountOf, planLabel, planLabelIn, planTierOf, resolvePlanDef, visiblePlans, type PlanDef } from "./plans";
import { evaluatePlanChange } from "./plan-change-core";
import { defaultTeamSizeForPlan, registrationPlanForTeamSize } from "./registration-plan";
import { buildComparison } from "@/lib/pricing-page-model";

/**
 * PLAN KATALOG MOTORU (DG2) — golden + davranış testleri.
 *  1) Taban paketlerin fiyat/limit/modül davranışı motor öncesiyle BİREBİR aynı (sabit golden tablo + eski yol karşılaştırması).
 *  2) Adminden eklenen paket katalogda, fiyat sayfası karşılaştırmasında ve paket değiştirme seçeneklerinde görünür;
 *     arşivlenince satış listelerinden düşer.
 *  3) Fiyat değişikliği fiyat kilitli aboneliği etkilemez.
 */

const CUSTOM_RAW = {
  custom: true,
  tier: "professional",
  name: "Ofis Plus",
  monthlyTry: 3990,
  blurb: "Büyüyen ofis",
  eyebrow: "YENİ",
  features: ["10 kullanıcı dahil", "Profesyonel modüller"],
  limits: { seats: 10, customers: null, activeProperties: null, branches: 5 },
  yearlyPaidMonths: 10,
  extraSeatMonthlyTry: 449,
  maxSeats: 30,
  seatRounding: "x9",
  efCreditsMonthly: 1000,
  efCreditsPerExtraSeat: 50,
};

function catalogWithCustom(extra: Record<string, unknown> = {}): PlanCatalogSettings {
  const raw = JSON.stringify({ v: 2, plans: { ...RECOMMENDED_CATALOG_OVERRIDES, ofis_plus: { ...CUSTOM_RAW, ...extra } }, campaign: DEFAULT_CAMPAIGN });
  return resolveCatalogSettings(raw);
}

/** Motor öncesi (2026-10-14) etkin katalog: sabit golden tablo. */
const GOLDEN: Record<string, { monthly: number; yearly: number; seats: number; customers: number | null; properties: number | null; branches: number | null; maxSeats: number; ef: number; gates: number }> = {
  advisor: { monthly: 749, yearly: 7490, seats: 1, customers: 1000, properties: 150, branches: 1, maxSeats: 3, ef: 100, gates: 0 },
  office: { monthly: 2790, yearly: 27900, seats: 5, customers: null, properties: null, branches: 3, maxSeats: 15, ef: 700, gates: 14 },
  professional: { monthly: 5490, yearly: 54900, seats: 15, customers: null, properties: null, branches: 10, maxSeats: 50, ef: 2100, gates: 26 },
  business: { monthly: 8990, yearly: 89900, seats: 40, customers: null, properties: null, branches: 20, maxSeats: 100, ef: 3500, gates: 26 },
  enterprise: { monthly: 14900, yearly: 149000, seats: 50, customers: null, properties: null, branches: null, maxSeats: 500, ef: 7000, gates: 28 },
};

describe("golden: taban paketler motorla birebir aynı", () => {
  for (const raw of [null, "", JSON.stringify({ v: 2, plans: RECOMMENDED_CATALOG_OVERRIDES, campaign: DEFAULT_CAMPAIGN })]) {
    it(`fiyat, limit, kota ve modül sayısı (kayıt: ${raw === null ? "yok" : raw === "" ? "boş" : "önerilen"})`, () => {
      const defs = catalogPlanDefs(resolveCatalogSettings(raw));
      expect(defs.map((d) => d.id)).toEqual(["advisor", "office", "professional", "business", "enterprise"]);
      for (const def of defs) {
        const g = GOLDEN[def.id]!;
        expect(def.monthlyTry).toBe(g.monthly);
        expect(planAmountOf(def, "yearly")).toBe(g.yearly);
        expect(def.limits).toEqual({ seats: g.seats, customers: g.customers, activeProperties: g.properties, branches: g.branches });
        expect(def.maxSeats).toBe(g.maxSeats);
        expect(def.efCreditsMonthly).toBe(g.ef);
        expect(gatesIncludedIn(def)).toHaveLength(g.gates);
        expect(planTierOf(def)).toBe(def.id);
      }
    });
  }

  it("eklenen paket varken taban tanımları eski yolla (applyPlanOverrides) derin eşit", () => {
    const settings = catalogWithCustom();
    const legacy = applyPlanOverrides(settings.overrides);
    const withCustom = catalogPlanDefs(settings).filter((d) => !d.custom);
    expect(withCustom).toEqual(legacy);
  });

  it("sayfa kilidi: taban kimlikte `tier` verilse de verilmese de sonuç aynı", () => {
    const ctx = { trial: false, tenantCreatedAt: "2026-10-05T00:00:00.000Z" };
    for (const plan of BASE_PLAN_IDS) {
      for (const gate of PLAN_GATES) {
        expect(lockedGate(gate.href, { ...ctx, plan })).toEqual(lockedGate(gate.href, { ...ctx, plan, tier: plan }));
      }
      expect(lockedHrefs({ ...ctx, plan })).toEqual(lockedHrefs({ ...ctx, plan, tier: plan }));
    }
    // Bilinmeyen kimlik eski davranışla Ofis kademesi.
    expect(lockedHrefs({ ...ctx, plan: "bilinmeyen" })).toEqual(lockedHrefs({ ...ctx, plan: "office" }));
  });

  it("fiyat sayfası karşılaştırması taban paketlerde aynı (Dahil/Pakette yok)", () => {
    const defs = catalogPlanDefs(resolveCatalogSettings(null));
    const groups = buildComparison(visiblePlans(defs)).slice(1);
    const included = groups.flatMap((g) => g.rows.flatMap((r) => r.cells.map((c) => c.included)));
    expect(included.filter(Boolean)).toHaveLength(14 + 26 + 28);
  });
});

describe("adminden eklenen paket", () => {
  it("kimlik biçimi: taban kimlik ve geçersiz slug reddedilir", () => {
    expect(isCustomPlanIdFormat("ofis_plus")).toBe(true);
    expect(isCustomPlanIdFormat("office")).toBe(false);
    expect(isCustomPlanIdFormat("Ofis")).toBe(false);
    expect(isCustomPlanIdFormat("ab")).toBe(false);
    expect(isCatalogPlanKey("office")).toBe(true);
    expect(isCatalogPlanKey("ofis_plus")).toBe(true);
    expect(isCatalogPlanKey("../x")).toBe(false);
  });

  it("katalog belgesinden okunur, yazılıp yeniden okunduğunda aynı kalır", () => {
    const settings = catalogWithCustom();
    expect(settings.customPlans).toHaveLength(1);
    const def = settings.customPlans![0]!;
    expect(def).toMatchObject({ id: "ofis_plus", tier: "professional", custom: true, monthlyTry: 3990, limits: { seats: 10, branches: 5 } });
    const again = parsePlanCatalogSettings(serializePlanCatalogSettings(settings));
    expect(again.customPlans).toEqual(settings.customPlans);
    expect(again.overrides).toEqual(settings.overrides);
    // SQL plan_monthly_amount aynı alanı okur: plans.<id>.monthlyTry + custom=true
    const doc = JSON.parse(serializePlanCatalogSettings(settings)) as { plans: Record<string, { custom?: boolean; monthlyTry?: number }> };
    expect(doc.plans.ofis_plus).toMatchObject({ custom: true, monthlyTry: 3990 });
  });

  it("eksik/bozuk kayıt katalog dışı kalır (sessiz yedek yok)", () => {
    expect(sanitizeCustomPlan("ofis_plus", { ...CUSTOM_RAW, custom: false })).toBeNull();
    expect(sanitizeCustomPlan("ofis_plus", { ...CUSTOM_RAW, tier: "yok" })).toBeNull();
    expect(sanitizeCustomPlan("ofis_plus", { ...CUSTOM_RAW, monthlyTry: -5 })).toBeNull();
    expect(sanitizeCustomPlan("office", CUSTOM_RAW)).toBeNull();
    const def = sanitizeCustomPlan("ofis_plus", CUSTOM_RAW)!;
    expect(sanitizeCustomPlan("ofis_plus", customPlanRecord(def))).toEqual(def);
  });

  it("yayındaysa fiyat sayfası listesinde ve karşılaştırmasında görünür; modülleri kademeden gelir", () => {
    const defs = catalogPlanDefs(catalogWithCustom());
    const visible = visiblePlans(defs);
    expect(visible.map((d) => d.id)).toContain("ofis_plus");
    const custom = visible.find((d) => d.id === "ofis_plus")!;
    expect(gatesIncludedIn(custom)).toHaveLength(26);
    expect(PLAN_GATES.every((g) => planIncludesGate(custom, g) === planIncludesGate({ id: "professional" }, g))).toBe(true);
    const cmp = buildComparison(visible);
    expect(cmp[0]!.rows[0]!.cells).toHaveLength(visible.length);
  });

  it("paket değiştirme seçeneklerinde görünür; arşivlenince satıştan düşer", () => {
    const now = Date.parse("2026-10-14T00:00:00Z");
    const base = {
      fromPlanId: "office",
      toPlanId: "ofis_plus",
      cycle: "monthly" as const,
      periodStartMs: now - 10 * 86_400_000,
      periodEndMs: now + 20 * 86_400_000,
      nowMs: now,
    };
    const live = catalogPlanDefs(catalogWithCustom());
    expect(findSellablePlan(live, "ofis_plus")?.name).toBe("Ofis Plus");
    expect(evaluatePlanChange({ ...base, plans: live }).status).toBe("upgrade");

    const archived = catalogPlanDefs(catalogWithCustom({ archived: true }));
    expect(visiblePlans(archived).map((d) => d.id)).not.toContain("ofis_plus");
    expect(findSellablePlan(archived, "ofis_plus")).toBeNull();
    expect(evaluatePlanChange({ ...base, plans: archived }).status).toBe("not_sold");
    // Arşivli paketteki ofis kendi paketini görmeye devam eder (tanım katalogda kalır).
    expect(archived.find((d) => d.id === "ofis_plus")?.monthlyTry).toBe(3990);
  });

  it("kilit bağlamı: eklenen paketin kademesi uygulanır, deneme sonrası kilit listesi kademeden", () => {
    const ctx = { trial: false, tenantCreatedAt: "2026-10-05T00:00:00.000Z", plan: "ofis_plus" };
    expect(lockedGate("/app/kayip-kacak", { ...ctx, tier: "professional" })).toBeNull();
    expect(lockedGate("/app/projeler", { ...ctx, tier: "professional" })?.minPlan).toBe("enterprise");
    expect(gatesLockedAfterTrial({ ...ctx, tier: "professional" })).toHaveLength(2);
  });

  it("kayıt: yayındaki eklenen paket korunur, bant tabanı altına düşürülmez", () => {
    const defs = catalogPlanDefs(catalogWithCustom());
    expect(registrationPlanForTeamSize("ofis_plus", "2-10", defs)).toBe("ofis_plus");
    expect(registrationPlanForTeamSize("ofis_plus", "50+", defs)).toBe("enterprise");
    expect(registrationPlanForTeamSize("ofis_plus", "2-10")).toBe("office");
    expect(defaultTeamSizeForPlan("ofis_plus", "professional")).toBe("10-50");
    const archived = catalogPlanDefs(catalogWithCustom({ archived: true }));
    expect(registrationPlanForTeamSize("ofis_plus", "2-10", archived)).toBe("office");
  });
});

describe("fiyat değişikliği fiyat kilitli aboneliği etkilemez", () => {
  const office = BASE_CATALOG.find((p) => p.id === "office")!;
  const campaign = { ...DEFAULT_CAMPAIGN, active: false };

  it("liste fiyatı artınca kilitli abone kilitli tutarı öder", () => {
    for (const listPrice of [2790, 3290, 9990]) {
      const def: PlanDef = { ...office, monthlyTry: listPrice };
      const q = quoteFromDefinition(def, "monthly", { lockedMonthlyTry: 1990, campaign, campaignOpen: false });
      expect(q).toMatchObject({ source: "locked", monthlyTry: 1990, amountTry: 1990 });
      expect(quoteFromDefinition(def, "yearly", { lockedMonthlyTry: 1990, campaign, campaignOpen: false }).amountTry).toBe(19900);
    }
  });

  it("liste fiyatı kilidin altına inerse düşük liste fiyatı (kilit zam aracı değil)", () => {
    const def: PlanDef = { ...office, monthlyTry: 1490 };
    expect(quoteFromDefinition(def, "monthly", { lockedMonthlyTry: 1990, campaign, campaignOpen: false })).toMatchObject({ source: "list", amountTry: 1490 });
  });

  it("kilitsiz abone yeni liste fiyatını öder; kampanya yalnız açıkken", () => {
    const def: PlanDef = { ...office, monthlyTry: 3290, campaignMonthlyTry: 2490 };
    expect(quoteFromDefinition(def, "monthly", { campaign, campaignOpen: true }).amountTry).toBe(3290);
    expect(quoteFromDefinition(def, "monthly", { campaign: { ...campaign, active: true }, campaignOpen: true })).toMatchObject({ source: "campaign", amountTry: 2490 });
  });

  it("SQL tarafı: migration abonelik tutarı ve fiyat kilidi alanlarına yazmaz", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261014002000_plan_catalog_engine.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/update\s+public\.(subscriptions|invoices)/i);
    expect(sql).not.toMatch(/price_lock_/i);
    // Taban fiyat yedeği değişmedi (749/2790/5490/8990/14900)
    for (const [id, g] of Object.entries(GOLDEN)) expect(sql).toContain(`when '${id}' then ${g.monthly}`);
  });
});

describe("eklenen paketin limit ve adı (resolvePlanDef / planLabelIn)", () => {
  const custom: PlanDef = {
    ...getPlan("office"),
    id: "ofis_plus",
    tier: "office",
    custom: true,
    name: "Ofis Plus",
    limits: { seats: 10, customers: null, activeProperties: null, branches: 5 },
  };
  const catalog = [...catalogPlanDefs({ overrides: {} }), custom];

  it("eklenen pakette limit ve ad katalog kaydından (Ofis'e düşmez)", () => {
    expect(resolvePlanDef("ofis_plus", catalog).limits).toEqual(custom.limits);
    expect(planLabelIn("ofis_plus", catalog)).toBe("Ofis Plus");
  });

  it("taban kimlikte davranış aynı (kod tanımı; katalog verilse de)", () => {
    for (const id of BASE_PLAN_IDS) {
      expect(resolvePlanDef(id, catalog)).toBe(getPlan(id));
      expect(planLabelIn(id, catalog)).toBe(planLabel(id));
    }
    expect(resolvePlanDef(null)).toBe(getPlan("office"));
  });

  it("katalog yoksa / kayıt bulunamazsa eski davranış: limit Ofis, ad kimlik", () => {
    expect(resolvePlanDef("ofis_plus")).toBe(getPlan("office"));
    expect(planLabelIn("ofis_plus")).toBe("ofis_plus");
  });
});
