import { describe, expect, it } from "vitest";
import { safeAdminHref, selectPlatformReadable, PLATFORM_INSIGHT_SELECT, type PlatformInsightDbRow } from "@/lib/insights/platform-readable";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const row = (o: Partial<PlatformInsightDbRow> = {}): PlatformInsightDbRow => ({
  id: "id-1",
  kind: "system_health",
  rule_id: "system_health@1",
  severity: "yuksek",
  priority: 50,
  // Ayrı içgörüler ayrı başlık taşır (aynı tür + başlık tekilleştirilir).
  title: `Başlık ${o.id ?? "id-1"}`,
  why: "Neden",
  evidence: [{ label: "Hata", value: "3", href: "/admin/hatalar" }],
  href: "/admin/sistem",
  is_forecast: false,
  confidence: null,
  state: "new",
  snoozed_until: null,
  valid_until: "2026-10-10T00:00:00Z",
  created_at: "2026-10-05T00:00:00Z",
  ...o,
});

describe("platform içgörü okuyucu (saf)", () => {
  it("tenant kimliği seçilmez", () => {
    expect(PLATFORM_INSIGHT_SELECT).not.toMatch(/tenant_id|entity_id|entity_type/);
  });

  it("href yalnız /admin altı kalır", () => {
    expect(safeAdminHref("/admin/tenants?durum=trial")).toBe("/admin/tenants?durum=trial");
    expect(safeAdminHref("/admin")).toBe("/admin");
    expect(safeAdminHref("/app/musteriler")).toBe("/admin");
    expect(safeAdminHref("/administrator")).toBe("/admin");
    expect(safeAdminHref("//evil.com")).toBe("/admin");
  });

  it("kapanmış, süresi geçmiş ve uyanmamış ertelenmiş satırlar elenir", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", state: "dismissed" }),
      row({ id: "c", valid_until: "2026-10-01T00:00:00Z" }),
      row({ id: "d", state: "snoozed", snoozed_until: "2026-10-07T00:00:00Z" }),
      row({ id: "e", state: "snoozed", snoozed_until: "2026-10-05T00:00:00Z" }),
    ];
    expect(selectPlatformReadable(rows, NOW, "super_admin", 10).map((i) => i.id).sort()).toEqual(["a", "e"]);
  });

  it("rol süzgeci: billing sistem sağlığını, ops gelir anomalisini görmez", () => {
    const rows = [row({ id: "s", kind: "system_health" }), row({ id: "r", kind: "revenue_anomaly", href: "/admin/billing" })];
    expect(selectPlatformReadable(rows, NOW, "billing", 10).map((i) => i.id)).toEqual(["r"]);
    expect(selectPlatformReadable(rows, NOW, "ops", 10).map((i) => i.id)).toEqual(["s"]);
  });

  it("bilinmeyen tür atlanır; sıralama öncelik azalan ve limit uygulanır", () => {
    const rows = [row({ id: "x", kind: "bogus" }), row({ id: "lo", priority: 10 }), row({ id: "hi", priority: 90 }), row({ id: "mid", priority: 50 })];
    expect(selectPlatformReadable(rows, NOW, "super_admin", 2).map((i) => i.id)).toEqual(["hi", "mid"]);
  });

  it("dış kanıt bağlantısı /admin'e indirilir", () => {
    const r = selectPlatformReadable([row({ evidence: [{ label: "x", value: "1", href: "/app/x" }] })], NOW, "super_admin", 1);
    expect(r[0]!.evidence[0]!.href).toBe("/admin");
  });

  it("veri yoksa boş dizi", () => {
    expect(selectPlatformReadable([], NOW, "super_admin", 5)).toEqual([]);
  });

  it("aynı tür ve başlıkla tekrar üretilen içgörü tek kez listelenir (yüksek öncelikli/yeni kalır)", () => {
    const rows = [
      row({ id: "eski", title: "1 zamanlanmış iş hata verdi", created_at: "2026-10-04T00:00:00Z" }),
      row({ id: "yeni", title: "1 zamanlanmış iş hata verdi", created_at: "2026-10-06T00:00:00Z" }),
    ];
    expect(selectPlatformReadable(rows, NOW, "super_admin", 10).map((i) => i.id)).toEqual(["yeni"]);
  });
});
