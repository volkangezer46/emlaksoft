import { describe, expect, it } from "vitest";
import { calculateCommission } from "@/lib/commission";
import { DAY_MS, trDayKey, trDayStartMs } from "@/lib/clock";
import { isSamplePhone, SAMPLE_CUSTOMERS } from "./catalog";
import { DEMO_PHOTO_SETS, type DemoPhotoSetMeta } from "@/lib/media/demo-photos";
import { buildSamplePlan, locative, priceInBand } from "./rich-pack";
import { FUTURE_GUARD_MS, after, createRng, shareInCurrentMonth, spreadOverMonths } from "./timeline";
import { buildCallCenterDemoPlan, demoRowId } from "./call-center-demo";
import { duplicateMonthlyExpenseIds, listingSignalPlan, recurringExpenseDates } from "./modules-seed";
import { planCommissionSpread, type SpreadCommission } from "./commission-spread";

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

  it("deterministik ve dolu: 30 müşteri, 22 portföy, her anlaşma aşaması", () => {
    expect(buildSamplePlan({ nowMs: NOW, seed: "tenant-1", pack: "konut", teamSize: 4 })).toEqual(plan);
    expect(plan.customers).toHaveLength(SAMPLE_CUSTOMERS.length);
    expect(plan.properties).toHaveLength(22);
    expect(new Set(plan.deals.map((d) => d.stage))).toEqual(new Set(["new", "qualified", "negotiation", "won", "lost"]));
    expect(new Set(plan.customers.flatMap((c) => c.customer_types))).toEqual(new Set(["Alıcı", "Satıcı", "Kiracı", "Mülk sahibi", "Yatırımcı"]));
    expect(buildSamplePlan({ nowMs: NOW, seed: "t", pack: "ticari", teamSize: 1 }).properties).toHaveLength(22);
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

  it("HER ilan bir fotoğraf setinden: başlık/tür/oda/m²/il-ilçe setle aynı, fiyat bant içinde tam TL, set tekrar etmez", () => {
    const sets = new Map<string, DemoPhotoSetMeta>(DEMO_PHOTO_SETS.map((x) => [x.id, x]));
    expect(sets.size).toBeGreaterThanOrEqual(22);
    const used = plan.properties.map((p) => p.setId);
    expect(used.every(Boolean)).toBe(true);
    expect(new Set(used).size).toBe(used.length);
    for (const p of plan.properties) {
      const set = sets.get(p.setId!)!;
      expect(p.title, p.code).toBe(set.title);
      expect(p.rooms, p.code).toBe(set.rooms);
      expect(p.sqm, p.code).toBe(set.areaM2);
      expect([p.city, p.districtName], p.code).toEqual([set.city, set.district]);
      expect(p.tx === "Kiralık", p.code).toBe(set.listingType === "kiralik");
      expect(set.priceBand.period === "aylik", p.code).toBe(p.tx === "Kiralık");
      expect(Number.isInteger(p.price), p.code).toBe(true);
      expect(p.price, p.code).toBeGreaterThanOrEqual(set.priceBand.min);
      expect(p.price, p.code).toBeLessThanOrEqual(set.priceBand.max);
    }
  });

  it("bant içi fiyat yardımcısı: adım ve sınırlar", () => {
    expect(priceInBand({ min: 26_000, max: 38_000 }, 0.5, true)).toBe(32_000);
    expect(priceInBand({ min: 350_000, max: 600_000 }, 1, true)).toBe(600_000);
    expect(priceInBand({ min: 9_500_000, max: 13_500_000 }, 0, false)).toBe(9_500_000);
    expect(priceInBand({ min: 9_520_000, max: 9_990_000 }, 0, false) % 50_000).toBe(0);
  });

  it("telefonlar kurgusal aralıkta; test görünümlü ad yok", () => {
    for (const p of plan.properties) expect(p.title).not.toMatch(/\[|test|örnek|ORNEK/i);
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

  it("ilana bağlı talepler ilanla eşleşir (tür, ilçe, bütçe ilan fiyatını kapsar)", () => {
    const linked = plan.demands.filter((d) => d.status === "matched");
    expect(linked.length).toBeGreaterThanOrEqual(3);
    for (const d of linked) {
      const p = plan.properties.find((x) => x.type === d.property_type && x.districtName === d.districtName && x.price >= d.budget_min && x.price <= d.budget_max);
      expect(p, d.customerKey).toBeDefined();
    }
  });

  it("ekip arasında dağıtılır (sahip + 3 demo ekip)", () => {
    expect(new Set(plan.customers.map((c) => c.assignee))).toEqual(new Set([0, 1, 2, 3]));
    const solo = buildSamplePlan({ nowMs: NOW, seed: "tenant-1", teamSize: 1 });
    expect(new Set(solo.customers.map((c) => c.assignee))).toEqual(new Set([0]));
  });
});

/* ------------------------------------------------------------------------------------------------------------------------
   PKG-2 demo tohumu: çağrı merkezi günü (F2), ayda tek Sahibinden gideri (F11), yeni ilanların fiyat sağlığı (F9),
   komisyon çeşitliliği (F4).
   ------------------------------------------------------------------------------------------------------------------------ */

describe("F2 çağrı merkezi günü", () => {
  const CC = "cc-1";
  const at0630 = Date.parse("2026-10-17T03:37:00Z"); // gece sıfırlaması (06:37 TR)
  const p = buildCallCenterDemoPlan({ tenantId: "t-demo", callCenterId: CC, nowMs: at0630, existingCustomerIds: ["c1", "c2", "c3"], likedPropertyIds: ["p1", "p2"] });
  const dayStart = trDayStartMs(at0630);

  it("çağrı merkezi kişisinin BUGÜN gelen, cevapsız ve giden araması var; hiçbiri gelecekte değil", () => {
    const today = p.calls.filter((c) => Date.parse(String(c.started_at)) >= dayStart);
    expect(today.length).toBeGreaterThanOrEqual(5);
    for (const dir of ["inbound", "missed", "outbound"]) expect(today.some((c) => c.direction === dir)).toBe(true);
    for (const c of p.calls) {
      expect(c.handled_by).toBe(CC);
      expect(Date.parse(String(c.started_at))).toBeLessThan(at0630);
    }
    const yesterday = p.calls.filter((c) => Date.parse(String(c.started_at)) < dayStart && Date.parse(String(c.started_at)) >= dayStart - DAY_MS);
    expect(yesterday.length).toBeGreaterThanOrEqual(2);
  });

  it("bugün vadeli görevler ve sıcak (ısı ≥ 70) yeni müşteriler çağrı merkezine atanır", () => {
    expect(p.tasks.length).toBeGreaterThanOrEqual(3);
    for (const t of p.tasks) {
      expect(t.assigned_to).toBe(CC);
      expect(trDayKey(String(t.due_at))).toBe(trDayKey(at0630));
    }
    expect(p.customers.every((c) => c.assigned_to === CC)).toBe(true);
    // Isı: bugün temas 35 + 2 açık talep 20 + 2 portal beğenisi 15 + yeni kayıt 6 = 76 ≥ 70 (heat.ts).
    for (const c of p.customers) {
      expect(p.demands.filter((d) => d.customer_id === c.id && ["new", "active", "matched"].includes(String(d.status)))).toHaveLength(2);
      expect(p.feedback.filter((f) => f.customer_id === c.id && f.verdict === "liked")).toHaveLength(2);
      expect(p.calls.some((k) => k.customer_id === c.id && trDayKey(String(k.started_at)) === trDayKey(at0630))).toBe(true);
    }
  });

  it("idempotent: kimlikler deterministik ve kiracıya özgü", () => {
    const again = buildCallCenterDemoPlan({ tenantId: "t-demo", callCenterId: CC, nowMs: at0630 + 3_600_000, existingCustomerIds: ["c1"], likedPropertyIds: [] });
    expect(again.calls.map((c) => c.id)).toEqual(p.calls.map((c) => c.id));
    expect(demoRowId("t-demo", "x")).not.toBe(demoRowId("t-diger", "x"));
    expect(demoRowId("t-demo", "x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("örnek paket (deneme ofisi): bugün ve dün aramaları giriş yapan kullanıcıya", () => {
    const start = trDayStartMs(NOW);
    const today = plan.calls.filter((c) => ms(c.started_at) >= start);
    for (const dir of ["inbound", "missed", "outbound"]) expect(today.some((c) => c.direction === dir && c.assignee === 0)).toBe(true);
    expect(plan.calls.every((c) => ms(c.started_at) < NOW)).toBe(true);
    expect(plan.calls.some((c) => ms(c.started_at) < start && ms(c.started_at) >= start - DAY_MS)).toBe(true);
  });
});

describe("F11 ayda tek Sahibinden gideri", () => {
  const TITLE = "Sahibinden.com mağaza paketi";
  it("vade günlü aylık giderin tarihleri ayda bir", () => {
    const dates = recurringExpenseDates({ dueDay: 5, days: [] }, "2026-10-17");
    expect(dates).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
    expect(new Set(dates.map((d) => d.slice(0, 7))).size).toBe(dates.length);
  });
  it("zaman kaydırmasıyla çoğalmış satırlar: ayda vade gününe en yakın olan kalır", () => {
    const rows = [
      { id: "1", title: TITLE, expense_date: "2026-08-04" },
      { id: "2", title: TITLE, expense_date: "2026-08-05" },
      { id: "3", title: TITLE, expense_date: "2026-09-03" },
      { id: "4", title: TITLE, expense_date: "2026-09-04" },
      { id: "5", title: TITLE, expense_date: "2026-09-05" },
      { id: "6", title: TITLE, expense_date: "2026-10-03" },
      { id: "7", title: TITLE, expense_date: "2026-10-04" },
      { id: "8", title: TITLE, expense_date: "2026-10-05" },
      { id: "9", title: "Ofis interneti ve telefon hatları", expense_date: "2026-10-04" },
    ];
    const dup = duplicateMonthlyExpenseIds(rows, [{ title: TITLE, dueDay: 5 }]);
    expect(dup.sort()).toEqual(["1", "3", "4", "6", "7"]);
    const left = rows.filter((r) => r.title === TITLE && !dup.includes(r.id));
    const perMonth = new Map<string, number>();
    for (const r of left) perMonth.set(r.expense_date.slice(0, 7), (perMonth.get(r.expense_date.slice(0, 7)) ?? 0) + 1);
    expect([...perMonth.values()].every((n) => n === 1)).toBe(true);
  });
  it("örnek paketin aylık portal gideri ayda bir kez", () => {
    const portal = plan.expenses.filter((x) => x.title === "Portal premium ilan paketi");
    expect(new Set(portal.map((x) => x.expense_date.slice(0, 7))).size).toBe(portal.length);
  });
});

describe("F9 yeni ilanların fiyat sağlığı / portal geçmişi", () => {
  it("DEMO-H01..H05 ve DEMO-Y01..Y05 fiyat sağlığı taşır; kiradakilerin kapanmış portal ilanı var", () => {
    const p = listingSignalPlan("DEMO");
    const codes = p.map((x) => x.code);
    for (let i = 1; i <= 5; i++) {
      expect(codes).toContain(`DEMO-H0${i}`);
      expect(codes).toContain(`DEMO-Y0${i}`);
    }
    for (const x of p) expect(["green", "yellow", "red"]).toContain(x.price_health);
    expect(p.filter((x) => x.code.includes("-Y")).every((x) => x.portal !== null)).toBe(true);
    expect(p.filter((x) => x.code.includes("-H")).every((x) => x.portal === null)).toBe(true);
    expect(new Set(p.flatMap((x) => (x.portal ? [x.portal.portal_listing_id] : []))).size).toBe(5);
  });
});

describe("F4 komisyon çeşitliliği", () => {
  const split = (lead?: string) => [
    { kind: "advisor", rate: 50, label: "Danışman", profile_id: "adv" },
    { kind: "office", rate: 50, label: "Ofis" },
    ...(lead ? [{ kind: "advisor", rate: 15, label: "Takım lideri", profile_id: lead }] : []),
  ];
  const rows: SpreadCommission[] = Array.from({ length: 8 }, (_, i) => ({
    id: `k${i}`,
    status: "paid",
    created_at: new Date(Date.UTC(2026, 9, 10 - i)).toISOString(),
    splits: split(),
    gross_amount: 100_000,
    hasCashEntry: i === 1,
    hasPayout: false,
  }));
  it("en yeni kasa hareketsiz 3 komisyon bekleyen; 3 komisyona takım lideri payı (oranlar 100)", () => {
    const ch = planCommissionSpread(rows, "lead");
    expect(ch.filter((c) => c.status === "calculated").map((c) => c.id)).toEqual(["k0", "k2", "k3"]);
    const shared = ch.filter((c) => c.splits);
    expect(shared).toHaveLength(3);
    for (const c of shared) {
      expect(c.splits!.reduce((t, s) => t + Number(s.rate), 0)).toBe(100);
      expect(c.splits!.some((s) => s.profile_id === "lead" && s.rate === 15)).toBe(true);
    }
  });
  it("idempotent: hedef durum varsa değişiklik yok", () => {
    const done = rows.map((r, i) => ({ ...r, status: [0, 2, 3].includes(i) ? "calculated" : r.status, splits: [1, 4, 5].includes(i) ? split("lead") : r.splits }));
    expect(planCommissionSpread(done, "lead")).toEqual([]);
  });
});
