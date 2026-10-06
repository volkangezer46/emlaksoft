import { describe, expect, it } from "vitest";
import { evaluateAnomalyRules, priceDeviation, authorityDaysLeft, type ListingSnapshot, type PropertySnapshot } from "./anomaly-rules";
import { evaluateProperty, type EvaluationExtras } from "./engine";
import { deriveLifecycle } from "./lifecycle";
import { deriveKpiFlags } from "./kpi";
import { DEFAULT_LISTING_CONTROL_CONFIG, normalizeListingControlConfig } from "./config";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function listing(over: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    id: "l1", portal: "sahibinden", externalId: "123456789", url: "https://www.sahibinden.com/ilan/x-123456789/detay",
    state: "verified", confidence: 0.9, portalPrice: 1_000_000, portalAdvisorName: null, firstAbsentAt: null,
    lastSuccessAt: iso(NOW - H), publishedAt: iso(NOW - 10 * D), ...over,
  };
}

function snap(over: Partial<PropertySnapshot> = {}): PropertySnapshot {
  return {
    propertyId: "p1", propertyCode: "P-1", stage: "published", active: true, listings: [listing()], listPrice: 1_000_000,
    assignedTo: "u1", assignedAdvisorName: "Ayşe Yılmaz", assignedAt: iso(NOW - 10 * D), publishable: true,
    authorizationEnd: null, hasCrmClosure: false, closure: null, explainedKeys: [], ...over,
  };
}

const types = (s: PropertySnapshot, cfg = DEFAULT_LISTING_CONTROL_CONFIG) => evaluateAnomalyRules(s, NOW, cfg).map((a) => a.type);

describe("anomali kural motoru", () => {
  it("sağlıklı portföyde anomali yok", () => {
    expect(types(snap())).toEqual([]);
  });

  it("şüpheli tek başına anomali AÇMAZ; olası/onaylı kayıp açar", () => {
    expect(types(snap({ listings: [listing({ state: "suspect" })] }))).toEqual([]);
    const probable = evaluateAnomalyRules(snap({ listings: [listing({ state: "probable_missing" })] }), NOW);
    expect(probable.map((a) => [a.type, a.severity])).toEqual([["portal_missing", "high"]]);
    const confirmed = evaluateAnomalyRules(snap({ listings: [listing({ state: "confirmed_missing", firstAbsentAt: iso(NOW - 30 * H) })] }), NOW);
    expect(confirmed.find((a) => a.type === "portal_missing")?.severity).toBe("critical");
    expect(confirmed.find((a) => a.type === "portal_missing")?.dedupeKey).toBe("portal_missing:l1");
  });

  it("potansiyel kayıp işlem: onaylı kayıp + CRM kapanışı yok + 24 saat", () => {
    const young = types(snap({ listings: [listing({ state: "confirmed_missing", firstAbsentAt: iso(NOW - 5 * H) })] }));
    expect(young).not.toContain("potential_lost_deal");
    const old = evaluateAnomalyRules(snap({ listings: [listing({ state: "confirmed_missing", firstAbsentAt: iso(NOW - 80 * H) })] }), NOW);
    expect(old.find((a) => a.type === "potential_lost_deal")?.severity).toBe("critical");
    const withClosure = types(snap({ hasCrmClosure: true, listings: [listing({ state: "confirmed_missing", firstAbsentAt: iso(NOW - 80 * H) })] }));
    expect(withClosure).not.toContain("potential_lost_deal");
  });

  it("yayınlanmayan portföy: atandı + hazır + ilan yok; 24 saatte orta, 48 saatte kritik", () => {
    const at = (h: number) => types(snap({ listings: [], stage: "ready", assignedAt: iso(NOW - h * H) }));
    expect(at(10)).toEqual([]);
    const d24 = evaluateAnomalyRules(snap({ listings: [], stage: "ready", assignedAt: iso(NOW - 25 * H) }), NOW);
    expect(d24[0]).toMatchObject({ type: "not_published", severity: "medium" });
    const d49 = evaluateAnomalyRules(snap({ listings: [], stage: "ready", assignedAt: iso(NOW - 49 * H) }), NOW);
    expect(d49[0].severity).toBe("critical");
    expect(types(snap({ listings: [], publishable: false, assignedAt: iso(NOW - 90 * H) }))).toEqual([]);
  });

  it("fiyat uyuşmazlığı: portal bazında yan yana, %1 tolerans, %5 kritik", () => {
    const ok = snap({ listings: [listing({ portalPrice: 1_005_000 })] });
    expect(types(ok)).toEqual([]);
    const mid = evaluateAnomalyRules(snap({ listings: [listing({ portalPrice: 1_030_000 }), listing({ id: "l2", portal: "hepsiemlak", portalPrice: 1_000_000 })] }), NOW);
    const a = mid.find((x) => x.type === "price_mismatch")!;
    expect(a.severity).toBe("medium");
    expect((a.details.portals as unknown[]).length).toBe(2);
    expect(a.dedupeKey).toBe("price_mismatch:p1");
    const hi = evaluateAnomalyRules(snap({ listings: [listing({ portalPrice: 1_100_000 })] }), NOW);
    expect(hi.find((x) => x.type === "price_mismatch")?.severity).toBe("high");
    // portal fiyatı bilinmiyorsa ölçülemedi: anomali yok
    expect(types(snap({ listings: [listing({ portalPrice: null })] }))).toEqual([]);
    expect(priceDeviation({ listPrice: 0, listings: [listing()] })).toBeNull();
  });

  it("eşikler ofis ayarıyla değişir", () => {
    const strict = normalizeListingControlConfig({ price: { toleranceRatio: 0.001, criticalRatio: 0.002 } });
    expect(types(snap({ listings: [listing({ portalPrice: 1_005_000 })] }), strict)).toContain("price_mismatch");
  });

  it("danışman uyuşmazlığı yalnız iki ad da biliniyorsa", () => {
    expect(types(snap({ listings: [listing({ portalAdvisorName: "Mehmet Demir" })] }))).toEqual(["advisor_mismatch"]);
    expect(types(snap({ listings: [listing({ portalAdvisorName: "Ayşe Yılmaz" })] }))).toEqual([]);
    expect(types(snap({ assignedAdvisorName: null, listings: [listing({ portalAdvisorName: "Mehmet Demir" })] }))).toEqual([]);
  });

  it("satılmış portföy hâlâ portalda", () => {
    const r = evaluateAnomalyRules(snap({ stage: "sold", active: false }), NOW);
    expect(r.map((a) => a.type)).toEqual(["sold_still_listed"]);
  });

  it("eksik kapanış 7 gün sonra", () => {
    const closure = (days: number) => snap({ stage: "sold", active: false, listings: [], closure: { closedAt: iso(NOW - days * D), missingItems: ["Komisyon kaydı"] } });
    expect(types(closure(3))).toEqual([]);
    expect(types(closure(8))).toEqual(["incomplete_closure"]);
  });

  it("yetki bitişi 30/15/0 gün", () => {
    const end = (days: number) => iso(NOW + days * D).slice(0, 10);
    expect(types(snap({ authorizationEnd: end(60) }))).toEqual([]);
    const a = (days: number) => evaluateAnomalyRules(snap({ authorizationEnd: end(days) }), NOW)[0];
    expect(a(25).severity).toBe("low");
    expect(a(10).severity).toBe("medium");
    expect(a(-3).severity).toBe("high");
    expect(authorityDaysLeft(null, NOW)).toBeNull();
  });

  it("dedupe anahtarı deterministik (aynı girdi aynı anahtar)", () => {
    const s = snap({ listings: [listing({ state: "confirmed_missing", firstAbsentAt: iso(NOW - 80 * H) })] });
    expect(evaluateAnomalyRules(s, NOW).map((a) => a.dedupeKey)).toEqual(evaluateAnomalyRules(s, NOW + 1000).map((a) => a.dedupeKey));
  });
});

describe("yaşam döngüsü aşaması", () => {
  const base = { status: "ready", deleted: false, poolPending: false, assignedTo: "u1", hasLiveListing: false, hasShowings: false, dealStage: null } as const;
  it("akış", () => {
    expect(deriveLifecycle({ ...base, assignedTo: null }).stage).toBe("new");
    expect(deriveLifecycle({ ...base, assignedTo: null, poolPending: true }).stage).toBe("pool");
    expect(deriveLifecycle({ ...base, status: "draft" }).stage).toBe("preparing");
    expect(deriveLifecycle(base).stage).toBe("ready");
    expect(deriveLifecycle({ ...base, hasLiveListing: true }).stage).toBe("published");
    expect(deriveLifecycle({ ...base, hasLiveListing: true, hasShowings: true }).stage).toBe("marketing");
    expect(deriveLifecycle({ ...base, hasLiveListing: true, dealStage: "negotiation" }).stage).toBe("negotiation");
  });
  it("çıkışlar ve kapanışlar aktif değil", () => {
    expect(deriveLifecycle({ ...base, status: "sold" })).toMatchObject({ stage: "sold", active: false });
    expect(deriveLifecycle({ ...base, status: "Kiralandı" }).stage).toBe("rented");
    expect(deriveLifecycle({ ...base, status: "withdrawn" })).toMatchObject({ stage: "exited", exitKind: "owner_withdrew", active: false });
    expect(deriveLifecycle({ ...base, status: "auth_expired" }).exitKind).toBe("authority_expired");
    expect(deriveLifecycle({ ...base, isDuplicate: true }).exitKind).toBe("duplicate");
  });
  it("hem 'live' hem 'Yayında' yazımı hazır sayılır", () => {
    expect(deriveLifecycle({ ...base, status: "Yayında" }).stage).toBe("ready");
    expect(deriveLifecycle({ ...base, status: "live" }).stage).toBe("ready");
  });
});

describe("KPI bayrakları ve motor (sayı = liste)", () => {
  const extras: EvaluationExtras = { photoScore: 80, daysSinceUpdate: 3, advisorActive: true, ownerInfoPresent: true, eidsNoPresent: null, hoursUnexplained: 0, exitKind: null };

  it("sağlıklı aktif portföy: aktif + portallarda + sağlıklı, anomali yok", () => {
    const ev = evaluateProperty(snap(), extras, NOW);
    expect(ev.anomalies).toEqual([]);
    expect(ev.kpi).toMatchObject({ active: true, in_portals: true, healthy: true, portal_missing: false, awaiting_publish: false, in_review: false });
    expect(ev.health.partial).toBe(true); // EİDS belge bilgisi ölçülemedi
  });

  it("portal kaybı: portal_missing + inceleme; açıklanınca inceleme düşer", () => {
    const s = snap({ listings: [listing({ state: "confirmed_missing", firstAbsentAt: iso(NOW - 2 * H) })] });
    const ev = evaluateProperty(s, extras, NOW);
    expect(ev.kpi.portal_missing).toBe(true);
    expect(ev.kpi.in_portals).toBe(false);
    expect(ev.kpi.in_review).toBe(true);
    expect(ev.kpi.healthy).toBe(false);
    const explained = evaluateProperty({ ...s, explainedKeys: ["portal_missing:l1"] }, extras, NOW);
    expect(explained.kpi.in_review).toBe(false);
    expect(explained.risk.score).toBeLessThan(ev.risk.score + 1);
  });

  it("yayın bekleyen: aktif, ilan yok, hazır aşama", () => {
    const ev = evaluateProperty(snap({ listings: [], stage: "ready" }), extras, NOW);
    expect(ev.kpi.awaiting_publish).toBe(true);
    expect(ev.kpi.in_portals).toBe(false);
  });

  it("kontrol edilemeyen: unverifiable ya da bayat başarılı kontrol, kayıp değil", () => {
    const flags = (l: ListingSnapshot) =>
      deriveKpiFlags({ active: true, stage: "published", listings: [l], anomalies: [], explainedKeys: [], healthScore: 90, healthyMinScore: 85 }, NOW);
    expect(flags(listing({ state: "unverifiable" })).unverifiable).toBe(true);
    expect(flags(listing({ lastSuccessAt: iso(NOW - 200 * H) })).unverifiable).toBe(true);
    expect(flags(listing({ state: "confirmed_missing" })).unverifiable).toBe(false);
    expect(flags(listing()).unverifiable).toBe(false);
  });

  it("kapanmış portföy hiçbir aktif KPI'a girmez", () => {
    const ev = evaluateProperty(snap({ stage: "sold", active: false, listings: [] }), extras, NOW);
    expect(Object.entries(ev.kpi).filter(([, v]) => v)).toEqual([]);
  });
});
