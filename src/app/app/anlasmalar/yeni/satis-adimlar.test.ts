import { describe, expect, it, vi } from "vitest";
import { isSensitiveFieldName } from "@/lib/form-tabs";
import { activeSteps, firstInvalidStep, runPlan, stepIssues } from "@/components/ui/wizard/engine";
import { SALE_DRAFT_FIELDS, dealTypeForProperty, saleInitialStep, salePlan, saleSteps, type SaleStepOptions } from "./satis-adimlar";

const opts: SaleStepOptions = {
  canOffer: true,
  canSetRate: true,
  splits: [{ label: "Danışman", rate: "50" }, { label: "Ofis", rate: "50" }],
  requiredCustomFields: [{ name: "cf_1", fieldId: "yeni-cf-1", label: "Kaynak" }],
  stageName: (k) => ({ negotiation: "Müzakere" })[k] ?? k,
  today: "2026-10-17",
};
const steps = saleSteps(opts);
const byId = (id: string) => steps.find((s) => s.id === id);

describe("satış sihirbazı adımları", () => {
  it("Müşteri → Portföy → Fiyat ve komisyon → Belgeler ve teklif → Özet; teklif yetkisi yoksa adım yok", () => {
    expect(activeSteps(steps, {}).map((s) => s.id)).toEqual(["musteri", "portfoy", "fiyat", "teklif", "ozet"]);
    expect(activeSteps(saleSteps({ ...opts, canOffer: false }), {}).map((s) => s.id)).toEqual(["musteri", "portfoy", "fiyat", "ozet"]);
  });

  it("taraf kuralı: müşteri ya da portföyden en az biri", () => {
    expect(stepIssues(byId("portfoy"), {})[0]?.field).toBe("wz-deal-property");
    expect(stepIssues(byId("portfoy"), { customer_id: "c" })).toEqual([]);
  });

  it("fiyat: tutar zorunlu; müzakerede yetki belgesi ve iki taraf; zorunlu özel alan", () => {
    const base = { deal_value: "4.500.000", cf_1: "x", stage: "new" };
    expect(stepIssues(byId("fiyat"), base)).toEqual([]);
    expect(stepIssues(byId("fiyat"), { ...base, deal_value: "" }).map((i) => i.field)).toEqual(["wz-deal-value"]);
    expect(stepIssues(byId("fiyat"), { ...base, cf_1: "" }).map((i) => i.field)).toEqual(["yeni-cf-1"]);
    const neg = stepIssues(byId("fiyat"), { ...base, stage: "negotiation", customer_id: "c" }).map((i) => i.field);
    expect(neg).toEqual(["wz-deal-authority", "wz-deal-stage"]);
    expect(stepIssues(byId("fiyat"), { ...base, commission_rate: "150" }).map((i) => i.field)).toEqual(["wz-deal-rate"]);
  });

  it("teklif (isteğe bağlı): açıksa tutar ve portföy; geçmiş tarih olmaz; atlanınca doğrulanmaz", () => {
    const v = { teklif: "1", offer_amount: "", offer_valid_until: "2026-01-01" };
    expect(stepIssues(byId("teklif"), v).map((i) => i.field)).toEqual(["wz-offer-toggle", "wz-offer-amount", "wz-offer-until"]);
    expect(stepIssues(byId("teklif"), v, new Set(["teklif"]))).toEqual([]);
  });

  it("göndermeden önce ilk geçersiz adım bulunur", () => {
    expect(firstInvalidStep(activeSteps(steps, {}), {})?.stepId).toBe("portfoy");
  });

  it("bağlamdan gelen ön seçim ilgili adımdan açar; tür portföyden önerilir", () => {
    expect(saleInitialStep({ customer_id: "c", property_id: "p" })).toBe("fiyat");
    expect(saleInitialStep({ customer_id: "c" })).toBe("portfoy");
    expect(saleInitialStep({})).toBe("musteri");
    expect(dealTypeForProperty("Kiralık")).toBe("rent");
    expect(dealTypeForProperty("Satılık")).toBe("sale");
  });

  it("taslak beyaz listesi kişisel veri içermez", () => {
    for (const f of SALE_DRAFT_FIELDS) expect(isSensitiveFieldName(f), f).toBe(false);
    expect(SALE_DRAFT_FIELDS).not.toContain("customer_label" as never);
  });
});

describe("satış planı (mevcut action'lar)", () => {
  const actions = () => ({
    createDeal: vi.fn(async (_fd: FormData) => ({ ok: true, dealId: "d1" })),
    setRate: vi.fn(async () => ({ ok: true as const })),
    createOffer: vi.fn(async (_fd: FormData) => ({ ok: true, id: "o1" })),
  });

  it("anlaşma → oran (portföyde yoksa) → teklif; özel alanlar da gider", async () => {
    const a = actions();
    const v = { customer_id: "c", property_id: "p", deal_type: "sale", stage: "new", deal_value: "4.500.000", has_authority: "", commission_rate: "2", teklif: "1", offer_amount: "4.400.000", cf_1: "Web" };
    const tasks = salePlan(v, new Set(), a, ["cf_1"]);
    expect(tasks.map((t) => t.id)).toEqual(["anlasma", "oran", "teklif"]);
    const res = await runPlan(tasks, { ctx: {}, done: [] });
    expect(res.status).toBe("done");
    expect(res.ctx.dealId).toBe("d1");
    const fd = a.createDeal.mock.calls[0][0];
    expect(fd.get("deal_value")).toBe("4.500.000");
    expect(fd.get("cf_1")).toBe("Web");
    expect(a.setRate).toHaveBeenCalledWith("p", "2");
    expect(a.createOffer.mock.calls[0][0].get("amount")).toBe("4.400.000");
  });

  it("portföy oranı varsa oran yazılmaz; teklif atlandıysa açılmaz", () => {
    const v = { property_id: "p", property_rate: "3", commission_rate: "2", teklif: "1", offer_amount: "1" };
    expect(salePlan(v, new Set(["teklif"]), actions(), []).map((t) => t.id)).toEqual(["anlasma"]);
  });

  it("anlaşma düşerse hata aynen gösterilir (WP2 kapsam iletisi dahil)", async () => {
    const a = actions();
    a.createDeal.mockResolvedValueOnce({ error: "Bu kayıt sizin kapsamınızda değil." } as never);
    const res = await runPlan(salePlan({ customer_id: "c", deal_value: "1" }, new Set(), a, []), { ctx: {}, done: [] });
    expect(res.status === "failed" && res.error).toBe("Bu kayıt sizin kapsamınızda değil.");
  });
});
