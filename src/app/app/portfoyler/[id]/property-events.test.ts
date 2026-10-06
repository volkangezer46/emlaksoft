import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/property-timeline", () => ({ getPropertyTimeline: vi.fn() }));
vi.mock("@/components/listing-control/readers", () => ({ loadLifecycleEvents: vi.fn() }));
vi.mock("@/lib/activity-timeline-sources", () => ({ dealAuditEvents: vi.fn(), fetchActorNames: vi.fn(), fetchDealAudit: vi.fn(), tl: (n: number) => String(n) }));

const { lifecycleToTimeline, PROPERTY_TIMELINE_CATEGORIES } = await import("./property-events");

/** Portföy detayında TEK zaman tüneli: CRM olayları + İlan Kontrol olayları aynı akışta. */
describe("tek zaman tüneli", () => {
  it("İlan Kontrol olayları kategoriye eşlenir; fiyat ve oluşturma atlanır (CRM kaynağında var)", () => {
    const out = lifecycleToTimeline([
      { at: "2026-10-01T10:00:00Z", kind: "price", title: "Fiyat değişti" },
      { at: "2026-10-01T09:00:00Z", kind: "created", title: "Portföy oluşturuldu" },
      { at: "2026-10-02T10:00:00Z", kind: "stage", title: "Aşama: Yayında → Satıldı", detail: "Ali" },
      { at: "2026-10-03T10:00:00Z", kind: "removed", title: "Sahibinden ilanı kaldırıldı", detail: "Neden: Satıldı" },
      { at: "2026-10-04T10:00:00Z", kind: "missing", title: "İlan portalda bulunamadı" },
    ]);
    expect(out.map((e) => e.category)).toEqual(["ilan-kontrol", "portal", "ilan-kontrol"]);
    expect(out[1]).toMatchObject({ title: "Sahibinden ilanı kaldırıldı", detail: "Neden: Satıldı", tone: "warn" });
    expect(PROPERTY_TIMELINE_CATEGORIES.some((c) => c.key === "ilan-kontrol")).toBe(true);
  });

  it("İlan Kontrol paneli ikinci bir zaman çizelgesi çizmez; olaylar sekmeye bağlanır", () => {
    const panel = readFileSync("src/components/listing-control/property-lifecycle-panel.tsx", "utf8");
    expect(panel).not.toContain('title="Zaman çizelgesi"');
    expect(panel).toContain("sekme=zaman&kategori=ilan-kontrol");
    const readers = readFileSync("src/components/listing-control/readers.ts", "utf8");
    expect(readers).toContain("export async function loadLifecycleEvents(");
  });
});
