import { describe, expect, it } from "vitest";
import {
  appointmentNextSteps,
  followUpDueIso,
  followUpTaskMarker,
  followUpTaskNotes,
  followUpTaskTitle,
} from "./appointment-follow-up";
import { readPrefillIds } from "./prefill-params";

const C = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";

function query(href: string) {
  return Object.fromEntries(new URL(href, "http://l").searchParams);
}

describe("appointmentNextSteps", () => {
  it("olumlu → ön dolgulu Teklif gir", () => {
    const [step] = appointmentNextSteps("olumlu", { customerId: C, propertyId: P });
    expect(step.label).toBe("Teklif gir");
    expect(step.href.startsWith("/app/teklifler/yeni?")).toBe(true);
    expect(readPrefillIds(query(step.href))).toEqual({ customerId: C, propertyId: P });
  });
  it("kararsız → ön dolgulu 2. gösterim", () => {
    const [step] = appointmentNextSteps("kararsiz", { customerId: C, propertyId: P });
    expect(step.label).toBe("2. gösterim planla");
    expect(step.href.startsWith("/app/randevular/yeni?")).toBe(true);
    expect(readPrefillIds(query(step.href))).toEqual({ customerId: C, propertyId: P });
  });
  it("olumsuz → müşterinin talepler sekmesi", () => {
    const [step] = appointmentNextSteps("olumsuz", { customerId: C, propertyId: P });
    expect(step).toMatchObject({ label: "Talebi güncelle", href: `/app/musteriler/${C}?sekme=talepler` });
  });
  it("sonuç ya da müşteri yoksa adım yok", () => {
    expect(appointmentNextSteps(null, { customerId: C, propertyId: P })).toEqual([]);
    expect(appointmentNextSteps("olumlu", { customerId: null, propertyId: P })).toEqual([]);
  });
  it("portföysüz olumlu yalnız müşteriyi taşır", () => {
    const [step] = appointmentNextSteps("olumlu", { customerId: C, propertyId: null });
    expect(step.href).toBe(`/app/teklifler/yeni?customer=${C}`);
  });
});

describe("takip görevi", () => {
  it("bitiş 2 iş günü sonra TR 18:00 (Cuma → Salı)", () => {
    // 2026-10-16 Cuma 15:00 TR = 12:00Z
    expect(followUpDueIso(Date.parse("2026-10-16T12:00:00Z"))).toBe("2026-10-20T15:00:00.000Z");
    // 2026-10-14 Çarşamba → Cuma 18:00 TR
    expect(followUpDueIso(Date.parse("2026-10-14T08:00:00Z"))).toBe("2026-10-16T15:00:00.000Z");
  });
  it("not, randevu izini taşır; başlık müşteri adını içerir", () => {
    expect(followUpTaskNotes(A, "Fiyat yüksek")).toContain(followUpTaskMarker(A));
    expect(followUpTaskNotes(A, "Fiyat yüksek")).toContain("Randevu notu: Fiyat yüksek");
    expect(followUpTaskNotes(A, null)).not.toContain("Randevu notu");
    expect(followUpTaskTitle("Ayşe Yılmaz")).toContain("Ayşe Yılmaz");
    expect(followUpTaskTitle(null)).toContain("Müşteri");
  });
});

describe("gelmedi (GA-14)", () => {
  it("gelmedi → ön dolgulu Yeniden planla", () => {
    const [step] = appointmentNextSteps("gelmedi", { customerId: C, propertyId: P });
    expect(step.label).toBe("Yeniden planla");
    expect(readPrefillIds(query(step.href))).toEqual({ customerId: C, propertyId: P });
  });
});
