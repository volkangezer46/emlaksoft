import { describe, expect, it } from "vitest";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "@/lib/listing-control/config";
import { computeHealthScore } from "@/lib/listing-control/health-score";
import { averageLeadHours, averageResolveHours, buildHealthInputs, buildLifecycleTimeline, rankAdvisors, tristateLabel, unionPublishedDays } from "./lifecycle-model";

const NOW = Date.parse("2026-10-06T12:00:00Z");

describe("zaman çizelgesi", () => {
  it("yeniden eskiye sıralar; ilan no değişimi tek olay, tarihsiz kayıt alınmaz", () => {
    const tl = buildLifecycleTimeline({
      createdAt: "2026-08-01T09:00:00Z",
      assignedAt: "2026-08-02T09:00:00Z",
      stage: null,
      listings: [
        { id: "a", portal: "Sahibinden", externalId: "1234567", status: "superseded", publishedAt: "2026-09-01T00:00:00Z", removedAt: "2026-10-06T00:00:00Z", supersedesId: null },
        { id: "b", portal: "Sahibinden", externalId: "2345678", status: "live", publishedAt: "2026-10-06T00:00:00Z", removedAt: null, supersedesId: "a" },
        { id: "c", portal: "Emlakjet", externalId: null, status: "live", publishedAt: null, removedAt: null, supersedesId: null },
      ],
      verifications: [{ checkedAt: "2026-10-06T08:00:00Z", portal: "Sahibinden", result: "present", stateAfter: "verified" }],
      prices: [{ at: "2026-09-15T00:00:00Z", oldPrice: 4_000_000, newPrice: 3_900_000 }],
      anomalies: [],
    });
    const titles = tl.map((e) => e.title);
    expect(titles[0]).toContain("doğrulandı");
    expect(titles).toContain("Sahibinden ilan numarası değişti");
    expect(titles.filter((t) => t.includes("kaldırıldı"))).toHaveLength(0); // superseded kaldırma sayılmaz
    expect(titles.some((t) => t.includes("Emlakjet"))).toBe(false);
    expect(tl.at(-1)?.title).toBe("Portföy oluşturuldu");
    expect(tl.find((e) => e.kind === "id_changed")?.detail).toBe("1234567 → 2345678");
    for (let i = 1; i < tl.length; i++) expect(Date.parse(tl[i - 1]!.at)).toBeGreaterThanOrEqual(Date.parse(tl[i]!.at));
  });
});

describe("sağlık girdileri", () => {
  const base = { hasAdvisor: true, listPrice: 1_000_000, updatedAt: "2026-10-01T00:00:00Z", authorizationEnd: null, listings: [] as never[] };

  it("ilan yoksa portal bileşeni ölçülemez; ölçülemeyenler paydadan çıkar", () => {
    const inputs = buildHealthInputs(base, NOW, DEFAULT_LISTING_CONTROL_CONFIG);
    expect(inputs.onPortal).toBeNull();
    expect(inputs.photos).toBeNull();
    const res = computeHealthScore(inputs);
    expect(res.partial).toBe(true);
    expect(res.score).not.toBeNull();
    expect(res.components.find((c) => c.key === "photos")?.value).toBeNull();
  });

  it("doğrulanmış ilan + uyumlu fiyat + yetki geçerli -> yüksek skor", () => {
    const inputs = buildHealthInputs(
      { ...base, authorizationEnd: "2027-01-01T00:00:00Z", listings: [{ live: true, verified: true, externalId: "1", url: null, portalPrice: 1_000_000, lastSuccessAt: "2026-10-06T10:00:00Z" }] },
      NOW,
      DEFAULT_LISTING_CONTROL_CONFIG,
    );
    expect(inputs.onPortal).toBe(1);
    expect(inputs.price).toBe(1);
    expect(inputs.authority).toBe(1);
    expect(inputs.checkRecency).toBe(1);
    expect(computeHealthScore(inputs).score).toBeGreaterThanOrEqual(85);
  });

  it("eski kontrol ve fiyat sapması skoru düşürür", () => {
    const inputs = buildHealthInputs(
      { ...base, listings: [{ live: true, verified: false, externalId: "1", url: null, portalPrice: 1_200_000, lastSuccessAt: "2026-09-01T00:00:00Z" }] },
      NOW,
      DEFAULT_LISTING_CONTROL_CONFIG,
    );
    expect(inputs.price).toBe(0);
    expect(inputs.checkRecency).toBe(0);
    expect(inputs.onPortal).toBe(0.5);
  });
});

describe("süre ortalamaları ve sıralama", () => {
  it("yayına alma süresi: eksik ve negatif çiftler dışlanır", () => {
    expect(
      averageLeadHours([
        { assignedAt: "2026-10-01T00:00:00Z", firstPublishedAt: "2026-10-01T10:00:00Z" },
        { assignedAt: "2026-10-01T00:00:00Z", firstPublishedAt: "2026-10-02T00:00:00Z" },
        { assignedAt: "2026-10-01T00:00:00Z", firstPublishedAt: null },
        { assignedAt: "2026-10-02T00:00:00Z", firstPublishedAt: "2026-10-01T00:00:00Z" },
      ]),
    ).toBe(17);
    expect(averageLeadHours([])).toBeNull();
    expect(averageResolveHours([{ firstSeenAt: "2026-10-01T00:00:00Z", resolvedAt: "2026-10-01T06:00:00Z" }])).toBe(6);
  });

  it("danışman sıralaması: en az 3 aktif portföy, en az iki kişi", () => {
    const rows = [
      { id: "a", name: "Ayşe", total_active: 10, healthy: 9, portal_missing: 0, in_review: 0 },
      { id: "b", name: "Burak", total_active: 10, healthy: 4, portal_missing: 3, in_review: 2 },
      { id: "c", name: "Can", total_active: 2, healthy: 0, portal_missing: 2, in_review: 0 },
      { id: null, name: "Atanmamış", total_active: 20, healthy: 0, portal_missing: 9, in_review: 9 },
    ];
    const r = rankAdvisors(rows);
    expect(r.best?.name).toBe("Ayşe");
    expect(r.worst?.name).toBe("Burak");
    expect(rankAdvisors(rows.slice(0, 1))).toEqual({ best: null, worst: null });
  });

  it("üç durumlu etiket", () => {
    expect(tristateLabel(null)).toBe("Ölçülemedi");
    expect(tristateLabel(true)).toBe("Tamam");
    expect(tristateLabel(false)).toBe("Eksik");
  });
});

describe("yaşam döngüsü kaydı ve toplam yayın süresi", () => {
  it("aşama geçişleri kim/ne zaman/neden ile; çıkarılan kullanıcı etiketli; portal kaldırma nedeni ve kaldıran", () => {
    const tl = buildLifecycleTimeline({
      createdAt: null,
      assignedAt: null,
      stage: { stage: "sold", since: "2026-10-05T10:00:00Z" },
      stageEvents: [
        { at: "2026-10-05T10:00:00Z", from: "published", to: "sold", actorName: "Ayşe Yılmaz", actorSource: "inferred", reason: "live -> sold" },
        { at: "2026-09-01T10:00:00Z", from: null, to: "published", actorName: null, actorSource: "system", reason: null },
      ],
      listings: [
        { id: "a", portal: "Sahibinden", externalId: "1234567", status: "removed", publishedAt: "2026-09-01T00:00:00Z", removedAt: "2026-10-05T09:00:00Z", supersedesId: null, endedReason: "sold", removedByName: "Ayşe Yılmaz" },
      ],
      verifications: [],
      prices: [],
      anomalies: [],
    });
    const stage = tl.filter((e) => e.kind === "stage");
    expect(stage.map((e) => e.title)).toEqual(["Aşama: Portalda yayında → Satıldı", "Aşama: Portalda yayında"]);
    expect(stage[0]?.detail).toBe("Ayşe Yılmaz (ilgili kayıttan) · live -> sold");
    expect(stage[1]?.detail).toBe("Sistem tespit etti");
    expect(tl.find((e) => e.kind === "removed")?.detail).toBe("Neden: Satıldı · Kaldıran: Ayşe Yılmaz");
  });
  it("toplam yayın süresi: portallar arası çakışma bir kez sayılır; canlı ilan bugüne kadar", () => {
    const r = unionPublishedDays(
      [
        { publishedAt: "2026-09-01T00:00:00Z", removedAt: "2026-09-11T00:00:00Z", status: "superseded" },
        { publishedAt: "2026-09-05T00:00:00Z", removedAt: "2026-09-15T00:00:00Z", status: "removed" },
        { publishedAt: "2026-10-01T00:00:00Z", removedAt: null, status: "live" },
        { publishedAt: null, removedAt: null, status: "live" },
      ],
      Date.parse("2026-10-06T00:00:00Z"),
    );
    expect(r).toEqual({ days: 19, firstPublishedAt: "2026-09-01T00:00:00Z", liveNow: true });
    expect(unionPublishedDays([], NOW)).toBeNull();
  });
});
