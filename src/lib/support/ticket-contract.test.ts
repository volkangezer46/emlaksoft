import { describe, expect, it } from "vitest";
import {
  TICKET_LIMITS,
  isTicketTransitionAllowed,
  ticketSlaCalendarHours,
  uniqueValidTicketIds,
  validateTicketBody,
  validateTicketResolution,
  validateTicketSubject,
} from "./ticket-contract";

describe("ticket transition contract", () => {
  it("tenant yalnız kapatma ve sonuçlanan talebi yeniden açma geçişlerini yapar", () => {
    expect(isTicketTransitionAllowed("open", "closed", "tenant")).toBe(true);
    expect(isTicketTransitionAllowed("resolved", "open", "tenant")).toBe(true);
    expect(isTicketTransitionAllowed("open", "resolved", "tenant")).toBe(false);
    expect(isTicketTransitionAllowed("waiting", "in_progress", "tenant")).toBe(false);
  });

  it("staff geçişleri açıkça sınırlar ve kapalı talebi yalnız yeniden açar", () => {
    expect(isTicketTransitionAllowed("open", "resolved", "staff")).toBe(true);
    expect(isTicketTransitionAllowed("resolved", "waiting", "staff")).toBe(true);
    expect(isTicketTransitionAllowed("closed", "waiting", "staff")).toBe(false);
    expect(isTicketTransitionAllowed("closed", "open", "staff")).toBe(true);
  });
});

describe("calendar-hour SLA policy", () => {
  it("öncelik yükseldikçe ilk yanıt ve çözüm hedefini daraltır", () => {
    expect(ticketSlaCalendarHours("urgent")).toEqual({ firstResponse: 1, resolution: 8 });
    expect(ticketSlaCalendarHours("high")).toEqual({ firstResponse: 4, resolution: 24 });
    expect(ticketSlaCalendarHours("normal")).toEqual({ firstResponse: 8, resolution: 72 });
    expect(ticketSlaCalendarHours("low")).toEqual({ firstResponse: 24, resolution: 120 });
  });

  it("bilinmeyen öncelikte güvenli normal politikasına düşer", () => {
    expect(ticketSlaCalendarHours("unknown")).toEqual(ticketSlaCalendarHours("normal"));
  });
});

describe("ticket input contract", () => {
  it("konu ve mesaj sınırlarını iki tarafta da uygular", () => {
    expect(validateTicketSubject("ab")).toBeTruthy();
    expect(validateTicketSubject("a".repeat(TICKET_LIMITS.subjectMax + 1))).toBeTruthy();
    expect(validateTicketSubject("Geçerli destek konusu")).toBeNull();
    expect(validateTicketBody("ab")).toBeTruthy();
    expect(validateTicketBody("Sorunu ayrıntılı anlatan geçerli metin")).toBeNull();
  });

  it("bulk işlemde UUID, tekrarsızlık ve 50 kayıt sınırını uygular", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(uniqueValidTicketIds([id, id])).toEqual([id]);
    expect(uniqueValidTicketIds(["not-a-uuid"])).toBeNull();
    expect(
      uniqueValidTicketIds(
        Array.from({ length: 51 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`),
      ),
    ).toBeNull();
  });

  it("terminal durumlarda ölçülebilir çözüm kaydını zorunlu tutar", () => {
    expect(validateTicketResolution("resolved", "", "Geçerli özet")).toBeTruthy();
    expect(validateTicketResolution("closed", "solved", "ab")).toBeTruthy();
    expect(validateTicketResolution("resolved", "solved", "Sorun yapılandırma düzeltilerek çözüldü.")).toBeNull();
    expect(validateTicketResolution("waiting", "solved", "Eski çözüm")).toBeTruthy();
    expect(validateTicketResolution("waiting", "", "")).toBeNull();
  });
});
