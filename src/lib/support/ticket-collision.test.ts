import { describe, expect, it } from "vitest";
import { isSeenMarker, newMessagePreviews, othersFromPresence, presenceSummary } from "./ticket-collision";

describe("personel çakışma yardımcıları (PA-8)", () => {
  it("presence durumundan kendisi hariç personel; yazan önce", () => {
    const list = othersFromPresence(
      { me: [{ name: "Ben", typing: true }], a: [{ name: "Ayşe", typing: false }], b: [{ name: "Mehmet", typing: false }, { name: "Mehmet", typing: true }] },
      "me",
    );
    expect(list).toEqual([
      { id: "b", name: "Mehmet", typing: true },
      { id: "a", name: "Ayşe", typing: false },
    ]);
    expect(presenceSummary(list)).toBe("Mehmet yazıyor, Ayşe bakıyor");
  });
  it("yeni mesaj önizlemesi kendi mesajını dışlar, adı çözer", () => {
    const rows = [
      { author_kind: "tenant", author_user_id: "u1", body: "Merhaba   yine olmadı", visibility: "public", created_at: "2026-10-15T10:00:00Z" },
      { author_kind: "staff", author_user_id: "me", body: "x", visibility: "internal", created_at: "2026-10-15T10:01:00Z" },
    ];
    expect(newMessagePreviews(rows, "me", { u1: "Ali" })).toEqual([{ author: "Ali", excerpt: "Merhaba yine olmadı", at: "2026-10-15T10:00:00Z", internal: false }]);
  });
  it("görülme işareti yalnız ISO zaman damgası", () => {
    expect(isSeenMarker("2026-10-15T10:00:00.123456+00:00")).toBe(true);
    expect(isSeenMarker("dün")).toBe(false);
    expect(isSeenMarker(null)).toBe(false);
  });
});
