import { describe, expect, it } from "vitest";
import {
  averageResolutionHours,
  bulkStatusTargetsFor,
  buildTicketListHref,
  formatDurationHours,
  normalizeTicketFilters,
  resolutionRate,
  shortTicketId,
} from "./ticket-list-model";

describe("ticket list model", () => {
  it("allowlist dışı URL filtrelerini güvenli varsayılanlara indirger", () => {
    expect(
      normalizeTicketFilters({
        q: `  ${"a".repeat(100)}  `,
        durum: "drop-table",
        oncelik: "root",
        kategori: `${"x".repeat(81)}`,
        atanan: "not-a-uuid",
        tenant: "also-not-a-uuid",
        sla: "broken",
        sirala: "raw_sql",
        yon: "sideways",
        sayfa: "-4",
      }),
    ).toEqual({
      q: "a".repeat(80),
      durum: undefined,
      oncelik: undefined,
      kategori: undefined,
      atanan: undefined,
      tenant: undefined,
      sla: undefined,
      sirala: "queue",
      yon: "desc",
      sayfa: 1,
    });
  });

  it("definitions tabanlı özel kategori değerini kabul eder", () => {
    expect(normalizeTicketFilters({ kategori: "portal_integrasyonu" }).kategori).toBe(
      "portal_integrasyonu",
    );
  });

  it("birleşik açık ve çözülmüş durumlarını kabul eder", () => {
    expect(normalizeTicketFilters({ durum: "acik" }).durum).toBe("acik");
    expect(normalizeTicketFilters({ durum: "cozulmus" }).durum).toBe("cozulmus");
  });

  it("SLA filtresini doğrular ve kanonik kuyruk sırasını zorunlu tutar", () => {
    expect(normalizeTicketFilters({ sla: "breached", sirala: "subject" })).toMatchObject({
      sla: "breached",
      sirala: "queue",
    });
    expect(buildTicketListHref({ sla: "warning", sirala: "queue" })).toBe(
      "/admin/tickets?sla=warning",
    );
  });

  it("filtre değişince sayfayı sıfırlar ve diğer URL durumunu korur", () => {
    const href = buildTicketListHref(
      {
        q: "portal",
        durum: "open",
        oncelik: "urgent",
        sirala: "updated_at",
        yon: "asc",
        sayfa: 4,
      },
      { durum: "waiting" },
    );
    expect(href).toBe(
      "/admin/tickets?q=portal&durum=waiting&oncelik=urgent&sirala=updated_at&yon=asc",
    );
  });

  it("yalnız sayfa değişince aktif filtreleri korur", () => {
    expect(buildTicketListHref({ kategori: "bug", sayfa: 1 }, { sayfa: 3 })).toBe(
      "/admin/tickets?kategori=bug&sayfa=3",
    );
  });

  it("insan tarafından taranabilir kısa geriye uyumlu kimlik üretir", () => {
    expect(shortTicketId("12345678-abcd-4abc-8abc-123456789012")).toBe("#12345678");
  });

  it("çözüm süresinde bozuk ve negatif kayıtları dışarıda bırakır", () => {
    expect(
      averageResolutionHours([
        { created_at: "2026-07-01T10:00:00.000Z", resolved_at: "2026-07-01T14:00:00.000Z" },
        { created_at: "2026-07-02T10:00:00.000Z", resolved_at: "2026-07-03T10:00:00.000Z" },
        { created_at: "bozuk", resolved_at: "2026-07-03T10:00:00.000Z" },
        { created_at: "2026-07-05T10:00:00.000Z", resolved_at: "2026-07-04T10:00:00.000Z" },
      ]),
    ).toBe(14);
    expect(formatDurationHours(14)).toBe("14 saat");
    expect(formatDurationHours(72)).toBe("3 gün");
    expect(formatDurationHours(null)).toBe("—");
  });

  it("çözüm oranını 0-100 aralığında tutar", () => {
    expect(resolutionRate(0, 0)).toBe(0);
    expect(resolutionRate(5, 1)).toBe(20);
    expect(resolutionRate(2, 4)).toBe(100);
  });

  it("toplu durumda yalnız tüm seçili talepler için geçerli aktif hedefleri sunar", () => {
    expect(bulkStatusTargetsFor(["open", "waiting"])).toEqual([
      "open",
      "in_progress",
      "waiting",
    ]);
    expect(bulkStatusTargetsFor(["closed", "open"])).toEqual(["open"]);
    expect(bulkStatusTargetsFor(["resolved", "open"])).toEqual([
      "open",
      "waiting",
    ]);
    expect(bulkStatusTargetsFor([])).toEqual(["open", "in_progress", "waiting"]);
  });
});
