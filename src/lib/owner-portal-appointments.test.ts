import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES } from "@/lib/workflow-state";
import {
  OWNER_APPT_STATUS_LABELS,
  ownerAppointmentBadge,
  ownerShowingSummaryText,
  summarizeOwnerShowings,
} from "./owner-portal-appointments";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const FUTURE = "2026-10-20T10:00:00Z";
const PAST = "2026-10-10T10:00:00Z";

describe("ownerAppointmentBadge", () => {
  it("her randevu durumunun Türkçe etiketi var", () => {
    for (const s of APPOINTMENT_STATUSES) expect(OWNER_APPT_STATUS_LABELS[s]).toBeTruthy();
  });

  it("tamamlanan / iptal edilen randevu 'Teyit bekliyor' görünmez", () => {
    expect(ownerAppointmentBadge("completed", PAST, NOW)).toEqual({ label: "Gerçekleşti", tone: "neutral" });
    expect(ownerAppointmentBadge("cancelled", PAST, NOW)).toEqual({ label: "İptal edildi", tone: "danger" });
    expect(ownerAppointmentBadge("cancelled", FUTURE, NOW).label).toBe("İptal edildi");
  });

  it("yaklaşan randevu teyit durumunu gösterir", () => {
    expect(ownerAppointmentBadge("pending", FUTURE, NOW)).toEqual({ label: "Teyit bekliyor", tone: "warning" });
    expect(ownerAppointmentBadge("confirmed", FUTURE, NOW)).toEqual({ label: "Onaylandı", tone: "success" });
    expect(ownerAppointmentBadge("signature", PAST, NOW).label).toBe("İmza aşamasında");
  });

  it("geçmişte kalıp kapanmamış randevu 'Sonuç bekleniyor'", () => {
    expect(ownerAppointmentBadge("pending", PAST, NOW).label).toBe("Sonuç bekleniyor");
    expect(ownerAppointmentBadge("confirmed", PAST, NOW).label).toBe("Sonuç bekleniyor");
  });

  it("bilinmeyen durum ham değer sızdırmaz", () => {
    expect(ownerAppointmentBadge("no_show", PAST, NOW)).toEqual({ label: "Durum bilinmiyor", tone: "neutral" });
  });
});

describe("summarizeOwnerShowings", () => {
  it("yalnız gerçekleşen yer göstermeleri ve olumluları sayar", () => {
    const s = summarizeOwnerShowings([
      { appointment_type: "showing", status: "completed", outcome: "olumlu" },
      { appointment_type: "showing", status: "completed", outcome: "olumsuz" },
      { appointment_type: "showing", status: "completed", outcome: null },
      { appointment_type: "showing", status: "cancelled", outcome: "olumlu" },
      { appointment_type: "showing", status: "pending", outcome: null },
      { appointment_type: "valuation", status: "completed", outcome: "olumlu" },
    ]);
    expect(s).toEqual({ showings: 3, positive: 1 });
    expect(ownerShowingSummaryText(s)).toBe("Son 30 gün: 3 gösterim, 1 olumlu");
  });

  it("boş girdide sıfır", () => {
    expect(ownerShowingSummaryText(summarizeOwnerShowings([]))).toBe("Son 30 gün: 0 gösterim, 0 olumlu");
  });
});

describe("malik portalı gizlilik", () => {
  it("randevu sorguları danışman notunu ve ziyaretçi kimliğini seçmez", () => {
    const src = readFileSync("src/app/actions/owner-portal.ts", "utf8");
    const selects = [...src.matchAll(/from\("appointments"\)\s*\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const cols of selects) {
      expect(cols).not.toMatch(/outcome_note|customer|visitor|contact|phone|name|notes/);
    }
  });
});
