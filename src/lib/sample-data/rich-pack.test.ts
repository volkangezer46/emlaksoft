import { describe, expect, it } from "vitest";
import { calculateCommission } from "@/lib/commission";
import { DAY_MS, trDayKey, trDayStartMs } from "@/lib/clock";
import { isSamplePhone, SAMPLE_CUSTOMERS } from "./catalog";
import { buildSamplePlan, locative } from "./rich-pack";
import { FUTURE_GUARD_MS, after, createRng, shareInCurrentMonth, spreadOverMonths } from "./timeline";

const NOW = Date.parse("2026-10-17T11:30:00Z");
const plan = buildSamplePlan({ nowMs: NOW, seed: "tenant-1", pack: "konut", teamSize: 4 });
const ms = (s: string) => Date.parse(s);

describe("timeline: 6 aya yayılım", () => {
  it("tam sayıda, sıralı, gelecekte değil ve mesai saatinde damga üretir", () => {
    const stamps = spreadOverMonths({ count: 30, nowMs: NOW, months: 6, rng: createRng("x") });
    expect(stamps).toHaveLength(30);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    for (const s of stamps) {
      expect(s).toBeLessThanOrEqual(NOW - FUTURE_GUARD_MS);
      const minutes = (s - trDayStartMs(s)) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(minutes).toBeLessThan(19 * 60);
    }
  });

  it("bu ay şişkin değil (ayın 17'sinde ≤ %20) ve son 6 ayın her birinde kayıt var", () => {
    const stamps = spreadOverMonths({ count: 30, nowMs: NOW, months: 6, rng: createRng("y") });
    expect(shareInCurrentMonth(stamps, NOW)).toBeLessThanOrEqual(0.2);
    const months = new Set(stamps.map((s) => trDayKey(s).slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(6);
    expect(Math.min(...stamps)).toBeGreaterThan(NOW - 200 * DAY_MS);
  });

  it("aynı tohum aynı diziyi verir; after() tabandan önceye ya da geleceğe düşmez", () => {
    expect(spreadOverMonths({ count: 5, nowMs: NOW, rng: createRng("z") })).toEqual(spreadOverMonths({ count: 5, nowMs: NOW, rng: createRng("z") }));
    const rng = createRng("a");
    for (let i = 0; i < 50; i++) {
      const base = NOW - i * DAY_MS;
      const t = after(base, 0, 30, NOW, rng);
      expect(t).toBeGreaterThan(base);
      expect(t).toBeLessThanOrEqual(Math.max(base + 60_000, NOW - FUTURE_GUARD_MS));
    }
  });

  it("Türkçe bulunma eki", () => {
    expect(locative("Caferağa")).toBe("Caferağa'da");
    expect(locative("Levent")).toBe("Levent'te");
    expect(locative("Teşvikiye")).toBe("Teşvikiye'de");
    expect(locative("Kuzguncuk")).toBe("Kuzguncuk'ta");
    expect(locative("Kadıköy")).toBe("Kadıköy'de");
  });
});

describe("zengin örnek ofis planı: tutarlılık", () => {
  const cust = new Map(plan.customers.map((c) => [c.key, c]));
  const prop = new Map(plan.properties.map((p) => [p.code, p]));

  it("deterministik ve dolu: 30 müşteri, 24 portföy, her anlaşma aşaması", () => {
    expect(buildSamplePlan({ nowMs: NOW, seed: "tenant-1", pack: "konut", teamSize: 4 })).toEqual(plan);
    expect(plan.customers).toHaveLength(SAMPLE_CUSTOMERS.length);
    expect(plan.properties).toHaveLength(24);
    expect(new Set(plan.deals.map((d) => d.stage))).toEqual(new Set(["new", "qualified", "negotiation", "won", "lost"]));
    expect(new Set(plan.customers.flatMap((c) => c.customer_types))).toEqual(new Set(["Alıcı", "Satıcı", "Kiracı", "Mülk sahibi", "Yatırımcı"]));
    expect(buildSamplePlan({ nowMs: NOW, seed: "t", pack: "ticari", teamSize: 1 }).properties).toHaveLength(26);
  });

  it("hiçbir created_at gelecekte değil; müşteriler bu aya yığılmıyor", () => {
    const all = [
      ...plan.customers, ...plan.properties, ...plan.demands, ...plan.deals, ...plan.commissions, ...plan.offers, ...plan.contracts,
      ...plan.rentals, ...plan.tasks, ...plan.appointments, ...plan.messages, ...plan.campaigns, ...plan.notifications,
    ];
    for (const r of all) expect(ms(r.created_at), JSON.stringify(r).slice(0, 80)).toBeLessThanOrEqual(NOW);
    expect(shareInCurrentMonth(plan.customers.map((c) => ms(c.created_at)), NOW)).toBeLessThanOrEqual(0.25);
  });

  it("anlaşmalar gerçek örnek müşteri ve portföye bağlı; zaman sırası korunur; kazanılmış satışın portföyü satıldı", () => {
    for (const d of plan.deals) {
      const c = cust.get(d.customerKey);
      const p = prop.get(d.propertyCode);
      expect(c, d.key).toBeDefined();
      expect(p, d.key).toBeDefined();
      expect(ms(d.created_at)).toBeGreaterThanOrEqual(Math.max(ms(c!.created_at), ms(p!.created_at)));
      expect(ms(d.updated_at)).toBeGreaterThanOrEqual(ms(d.created_at));
      if (d.stage === "won") expect(p!.status).toBe("sold");
      expect(Number.isInteger(d.deal_value)).toBe(true);
    }
    // Her satılmış portföyün tek kazanılmış anlaşması var
    const wonByProp = plan.deals.filter((d) => d.stage === "won").map((d) => d.propertyCode);
    expect(new Set(wonByProp).size).toBe(wonByProp.length);
    expect(plan.properties.filter((p) => p.status === "sold").map((p) => p.code).sort()).toEqual([...wonByProp].sort());
  });

  it("komisyon = kazanma akışının formülü (anlaşma fiyatı × portföy oranı); anlaşmadan sonra oluşur", () => {
    const won = plan.deals.filter((d) => d.stage === "won");
    expect(plan.commissions).toHaveLength(won.length);
    for (const c of plan.commissions) {
      const d = won.find((x) => x.key === c.dealKey)!;
      const expected = calculateCommission({ amount: d.deal_value, rate: prop.get(d.propertyCode)!.rate });
      expect(c.gross_amount).toBe(expected.net);
      expect(c.vat_amount).toBe(expected.vat);
      expect(c.splits.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(expected.net, 2);
      expect(ms(c.created_at)).toBeGreaterThanOrEqual(ms(d.created_at));
    }
    expect(plan.commissions.some((c) => c.status === "paid")).toBe(true);
  });

  it("fiyatlar tam TL ve ilçe bandında; telefonlar kurgusal aralıkta; test görünümlü ad yok", () => {
    for (const p of plan.properties) {
      expect(Number.isInteger(p.price), p.code).toBe(true);
      if (p.tx === "Satılık" && p.type !== "Arsa") expect(p.price / p.sqm, p.code).toBeGreaterThan(40_000);
      if (p.tx === "Kiralık") expect(p.price, p.code).toBeLessThan(400_000);
      expect(p.title).not.toMatch(/\[|test|örnek|ORNEK/i);
    }
    for (const c of plan.customers) {
      expect(isSamplePhone(c.phone), c.phone).toBe(true);
      expect(c.full_name).not.toMatch(/\[SAHA\]|test|deneme|örnek/i);
    }
    expect(new Set(plan.customers.map((c) => c.phone)).size).toBe(plan.customers.length);
  });

  it("kira: kiradaki portföye bağlı, en az bir gecikmiş tahakkuk; görev/randevu geçmiş-bugün-ileri karışık", () => {
    for (const r of plan.rentals) expect(prop.get(r.propertyCode)!.status).toBe("rented");
    expect(plan.rentals.flatMap((r) => r.charges).some((c) => c.status === "overdue")).toBe(true);
    const today = trDayKey(NOW);
    const open = plan.tasks.filter((t) => t.status === "open");
    expect(open.some((t) => ms(t.due_at) < trDayStartMs(NOW))).toBe(true); // gecikmiş
    expect(open.some((t) => trDayKey(ms(t.due_at)) === today)).toBe(true);
    expect(open.some((t) => ms(t.due_at) > NOW + DAY_MS)).toBe(true);
    expect(plan.tasks.some((t) => t.status === "done")).toBe(true);
    expect(plan.appointments.some((a) => a.status === "completed" && ms(a.scheduled_at) < NOW)).toBe(true);
    expect(plan.appointments.some((a) => trDayKey(ms(a.scheduled_at)) === today)).toBe(true);
    expect(plan.appointments.some((a) => ms(a.scheduled_at) > NOW + DAY_MS)).toBe(true);
    for (const a of plan.appointments) expect(cust.has(a.customerKey)).toBe(true);
  });

  it("ekip arasında dağıtılır (sahip + 3 demo ekip)", () => {
    expect(new Set(plan.customers.map((c) => c.assignee))).toEqual(new Set([0, 1, 2, 3]));
    const solo = buildSamplePlan({ nowMs: NOW, seed: "tenant-1", teamSize: 1 });
    expect(new Set(solo.customers.map((c) => c.assignee))).toEqual(new Set([0]));
  });
});
