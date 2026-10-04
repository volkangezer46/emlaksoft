import { describe, expect, it } from "vitest";
import { evaluateAlerts, splitByReview, type AlertFacts, type AuditFact } from "@/lib/oversight/alert-rules";
import { DEFAULT_THRESHOLDS, normalizeThresholds } from "@/lib/oversight/settings";
import { categoryOf, categoryOrExpr, feedActionLabel } from "@/lib/oversight/feed";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const A = "11111111-1111-1111-1111-111111111111";
const names = new Map([[A, "Ayşe Yılmaz"]]);

const empty: AlertFacts = { audit: [], priceChanges: [], commissionCuts: [], certs: [], stale: [], names };

function audit(over: Partial<AuditFact> & { id: string; action: string }): AuditFact {
  return {
    actorId: A,
    entityType: null,
    entityId: null,
    createdAt: "2026-10-03T10:00:00Z",
    oldValue: null,
    newValue: null,
    ...over,
  };
}

describe("evaluateAlerts", () => {
  it("olay yoksa uyarı yok", () => {
    expect(evaluateAlerts(empty, DEFAULT_THRESHOLDS, NOW)).toEqual([]);
  });

  it("büyük fiyat düşürme: eşik altı sessiz, eşik üstü açıklamalı ve ilana bağlı", () => {
    const facts: AlertFacts = {
      ...empty,
      priceChanges: [
        { id: "p1", propertyId: "prop-1", oldPrice: 1000, newPrice: 950, changedBy: A, createdAt: "2026-10-03T10:00:00Z" },
        { id: "p2", propertyId: "prop-2", oldPrice: 1000, newPrice: 700, changedBy: A, createdAt: "2026-10-03T11:00:00Z" },
      ],
    };
    const out = evaluateAlerts(facts, DEFAULT_THRESHOLDS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("price_drop:p2");
    expect(out[0].href).toBe("/app/portfoyler/prop-2");
    expect(out[0].severity).toBe("yuksek"); // %30 >= 2x eşik
    expect(out[0].explanation).toContain("Ayşe Yılmaz");
  });

  it("ilan silme uyarısı olay başına tek anahtar üretir (tekrar yok)", () => {
    const facts: AlertFacts = { ...empty, audit: [audit({ id: "e1", action: "property.delete" })] };
    const a = evaluateAlerts(facts, DEFAULT_THRESHOLDS, NOW);
    const b = evaluateAlerts(facts, DEFAULT_THRESHOLDS, NOW + 3_600_000);
    expect(a.map((x) => x.key)).toEqual(["listing_removed:e1"]);
    expect(b.map((x) => x.key)).toEqual(a.map((x) => x.key));
  });

  it("toplu müşteri silme kişi+gün bazında eşikle", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => audit({ id: `d${i}`, action: "customer.delete", createdAt: `2026-10-03T1${i % 9}:00:00Z` }));
    expect(evaluateAlerts({ ...empty, audit: mk(4) }, DEFAULT_THRESHOLDS, NOW)).toEqual([]);
    const out = evaluateAlerts({ ...empty, audit: mk(5) }, DEFAULT_THRESHOLDS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe("bulk_delete");
    expect(out[0].href).toContain("tur=customer.delete");
    expect(out[0].href).toContain(`aktor=${A}`);
  });

  it("toplu export: satır eşiği", () => {
    const small = audit({ id: "x1", action: "export.csv", newValue: { rows: 50 } });
    const big = audit({ id: "x2", action: "export.csv", newValue: { rows: 450 } });
    const out = evaluateAlerts({ ...empty, audit: [small, big] }, DEFAULT_THRESHOLDS, NOW);
    expect(out.map((x) => x.key)).toEqual(["bulk_export:x2"]);
  });

  it("mesai dışı yoğun işlem: TR saatine göre sayar", () => {
    // 21:00 UTC = 00:00 TR (mesai dışı); 20 kayıt eşik
    const rows = Array.from({ length: 20 }, (_, i) => audit({ id: `n${i}`, action: "customer.update", createdAt: `2026-10-03T21:${String(i).padStart(2, "0")}:00Z` }));
    const out = evaluateAlerts({ ...empty, audit: rows }, DEFAULT_THRESHOLDS, NOW);
    expect(out.map((x) => x.rule)).toEqual(["after_hours"]);
    // Mesai içi (10:00 UTC = 13:00 TR) aynı sayıda kayıt uyarı üretmez
    const inside = rows.map((r) => ({ ...r, createdAt: r.createdAt.replace("T21", "T10") }));
    expect(evaluateAlerts({ ...empty, audit: inside }, DEFAULT_THRESHOLDS, NOW)).toEqual([]);
  });

  it("yetki belgesi süresi dolmuş + yayında ilan; ilansızsa sessiz", () => {
    const base = { profileId: A, name: "Ayşe Yılmaz", expiresOn: "2026-09-01" };
    expect(evaluateAlerts({ ...empty, certs: [{ ...base, liveListingCount: 0 }] }, DEFAULT_THRESHOLDS, NOW)).toEqual([]);
    const out = evaluateAlerts({ ...empty, certs: [{ ...base, liveListingCount: 3 }] }, DEFAULT_THRESHOLDS, NOW);
    expect(out[0].key).toBe(`cert_expired:${A}:2026-09-01`);
    expect(out[0].href).toBe(`/app/ekip/${A}`);
  });

  it("komisyon indirimi talebi puan eşiğiyle", () => {
    const facts: AlertFacts = {
      ...empty,
      commissionCuts: [
        { id: "c1", requestedBy: A, standardRate: 3, requestedRate: 2.8, status: "bekliyor", createdAt: "2026-10-03T10:00:00Z" },
        { id: "c2", requestedBy: A, standardRate: 3, requestedRate: 1.5, status: "bekliyor", createdAt: "2026-10-03T11:00:00Z" },
      ],
    };
    const out = evaluateAlerts(facts, DEFAULT_THRESHOLDS, NOW);
    expect(out.map((x) => x.key)).toEqual(["commission_cut:c2"]);
  });

  it("kapalı kural uyarı üretmez; eşikler ayarlanabilir", () => {
    const facts: AlertFacts = { ...empty, audit: [audit({ id: "e1", action: "property.delete" })] };
    const off = normalizeThresholds({ enabled: { listing_removed: false } });
    expect(evaluateAlerts(facts, off, NOW)).toEqual([]);
    const strict = normalizeThresholds({ priceDropPct: 2 });
    const price: AlertFacts = {
      ...empty,
      priceChanges: [{ id: "p", propertyId: "x", oldPrice: 1000, newPrice: 950, changedBy: A, createdAt: "2026-10-03T10:00:00Z" }],
    };
    expect(evaluateAlerts(price, strict, NOW)).toHaveLength(1);
  });

  it("hareketsiz ilan/müşteri danışman+ay anahtarı ile bir kez", () => {
    const facts: AlertFacts = { ...empty, stale: [{ advisorId: A, name: "Ayşe", staleListings: 2, staleCustomers: 4 }] };
    const out = evaluateAlerts(facts, DEFAULT_THRESHOLDS, NOW);
    expect(out.map((x) => x.key).sort()).toEqual([`stale_customer:${A}:2026-10`, `stale_listing:${A}:2026-10`]);
    expect(out.find((x) => x.rule === "stale_listing")?.href).toBe(`/app/portfoyler?danisman=${A}`);
  });

  it("splitByReview incelenenleri ayırır", () => {
    const r = splitByReview([{ key: "a" }, { key: "b" }], new Set(["b"]));
    expect(r.open.map((x) => x.key)).toEqual(["a"]);
    expect(r.done.map((x) => x.key)).toEqual(["b"]);
  });
});

describe("normalizeThresholds", () => {
  it("bozuk değer varsayılana, sınır dışı değer sınıra çekilir", () => {
    const t = normalizeThresholds({ priceDropPct: "abc", bulkDeleteCount: 99999, workStartHour: 22, workEndHour: 6 });
    expect(t.priceDropPct).toBe(DEFAULT_THRESHOLDS.priceDropPct);
    expect(t.bulkDeleteCount).toBe(500);
    expect(t.workStartHour).toBe(DEFAULT_THRESHOLDS.workStartHour);
    expect(t.workEndHour).toBe(DEFAULT_THRESHOLDS.workEndHour);
  });
});

describe("feed kategorileri", () => {
  it("devir, export ve ilan doğru gruplanır", () => {
    expect(categoryOf("property.reassign")?.id).toBe("devir");
    expect(categoryOf("export.csv")?.id).toBe("export");
    expect(categoryOf("property.update")?.id).toBe("ilan");
    expect(categoryOf("customer_file.upload")?.id).toBe("belge");
    expect(categoryOf("customer.delete")?.id).toBe("musteri");
    expect(categoryOf("platform_staff.add")).toBeNull();
  });
  it("PostgREST ifadesi ve etiket", () => {
    expect(categoryOrExpr("export")).toBe("action.like.export.*");
    expect(categoryOrExpr("yok")).toBeNull();
    expect(feedActionLabel("customer.delete")).toBe("Müşteri silindi");
    expect(feedActionLabel("bilinmeyen.kod")).toBe("bilinmeyen.kod");
  });
});
