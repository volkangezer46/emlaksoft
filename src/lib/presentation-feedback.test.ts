import { describe, expect, it } from "vitest";
import {
  isMissingFeedbackTable,
  isPresentationFeedbackVerdict,
  normalizeFeedbackNote,
  noteTooLong,
  presentationFeedbackHref,
  presentationFeedbackNotification,
  summarizePresentationFeedback,
} from "./presentation-feedback";

describe("presentation-feedback yardımcıları", () => {
  it("yalnız iki seçim geçerli", () => {
    expect(isPresentationFeedbackVerdict("interested")).toBe(true);
    expect(isPresentationFeedbackVerdict("not_interested")).toBe(true);
    expect(isPresentationFeedbackVerdict("liked")).toBe(false);
    expect(isPresentationFeedbackVerdict(null)).toBe(false);
  });

  it("not: kontrol karakteri atılır, boş not null, sınır kesmez reddeder", () => {
    expect(normalizeFeedbackNote("  merhaba\u0007 dünya \r\n\r\n\r\n\r\nson  ")).toBe("merhaba  dünya \n\nson");
    expect(normalizeFeedbackNote("   ")).toBeNull();
    expect(normalizeFeedbackNote(42)).toBeNull();
    expect(noteTooLong("a".repeat(500))).toBe(false);
    expect(noteTooLong("a".repeat(501))).toBe(true);
    expect(noteTooLong(null)).toBe(false);
  });

  it("bağlantı: müşteri varsa kartın geçmişi, yoksa Sunumlar", () => {
    expect(presentationFeedbackHref("c-1")).toBe("/app/musteriler/c-1?sekme=gecmis&kategori=portal");
    expect(presentationFeedbackHref(null)).toBe("/app/portfoyler/sunumlar");
  });

  it("bildirim metni seçimi, ilanı ve notu taşır", () => {
    const n = presentationFeedbackNotification({
      verdict: "not_interested",
      customerName: null,
      presentationTitle: "Seçki",
      propertyLabel: "Daire",
      note: null,
    });
    expect(n.kind).toBe("info");
    expect(n.body).toBe('Müşteriniz, "Seçki" sunumundaki Daire için "İlgilenmiyorum" dedi.');
  });

  it("sunum başına özet", () => {
    const m = summarizePresentationFeedback([
      { presentation_id: "p1", verdict: "interested" },
      { presentation_id: "p1", verdict: "not_interested" },
      { presentation_id: "p1", verdict: "interested" },
      { presentation_id: "p2", verdict: "bilinmeyen" },
    ]);
    expect(m.get("p1")).toEqual({ interested: 2, notInterested: 1 });
    expect(m.get("p2")).toEqual({ interested: 0, notInterested: 0 });
  });

  it("tablo yok hatası tanınır", () => {
    expect(isMissingFeedbackTable({ code: "42P01" })).toBe(true);
    expect(isMissingFeedbackTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingFeedbackTable({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMissingFeedbackTable(null)).toBe(false);
  });
});
