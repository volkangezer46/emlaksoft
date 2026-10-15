import { describe, expect, it } from "vitest";
import { parseQuickTask } from "@/lib/quick-task-parse";
import { duePresetLocal, duePresetMs } from "@/lib/due-presets";

// 2026-10-15 Perşembe 12:00 TR
const NOW = Date.parse("2026-10-15T09:00:00.000Z");

describe("parseQuickTask (Türkçe doğal dil)", () => {
  it("yarın 10'da Ahmet'i ara", () => {
    const p = parseQuickTask("yarın 10'da Ahmet'i ara", NOW);
    expect(p.title).toBe("Ahmet'i ara");
    expect(p.dueIso).toBe("2026-10-16T07:00:00.000Z");
    expect(p.dueLabel).toBe("Yarın 10:00");
    expect(p.kind).toBe("call");
    expect(p.personHint).toBe("Ahmet");
    expect(p.assumed).toBe(false);
  });

  it("Ayşe Hanım'ı cuma 3'te ara → 15:00 (varsayım), ad Ayşe", () => {
    const p = parseQuickTask("Ayşe Hanım'ı cuma 3'te ara", NOW);
    expect(p.title).toBe("Ayşe Hanım'ı ara");
    expect(p.dueLabel).toBe("Yarın 15:00");
    expect(p.personHint).toBe("Ayşe");
    expect(p.assumed).toBe(true);
  });

  it("geçmiş saat ertesi güne kayar; tarih yoksa vade yok", () => {
    expect(parseQuickTask("saat 9 tapu evrakı", NOW).dueLabel).toBe("Yarın 09:00");
    const plain = parseQuickTask("tapu evrakını hazırla", NOW);
    expect(plain.dueIso).toBeNull();
    expect(plain.title).toBe("Tapu evrakını hazırla");
    expect(plain.kind).toBeNull();
  });

  it("yalnız gün söylenirse 10:00 varsayılır; başlık temizlenir", () => {
    const p = parseQuickTask("pazartesi sözleşmeyi gönder", NOW);
    expect(p.dueLabel).toBe("Pazartesi 10:00");
    expect(p.title).toBe("Sözleşmeyi gönder");
    expect(p.assumed).toBe(true);
  });

  it("açık tarih: 28 ekim 14:30", () => {
    const p = parseQuickTask("28 ekim 14:30 Mehmet Bey'e teklif", NOW);
    expect(p.dueLabel).toBe("28 Ekim 14:30");
    expect(p.title).toBe("Mehmet Bey'e teklif");
    expect(p.personHint).toBe("Mehmet");
  });
});

describe("hazır vade seçenekleri", () => {
  it("TR saatiyle", () => {
    expect(duePresetLocal("today18", NOW)).toBe("2026-10-15T18:00");
    expect(duePresetLocal("tomorrow10", NOW)).toBe("2026-10-16T10:00");
    expect(duePresetLocal("monday10", NOW)).toBe("2026-10-19T10:00");
    expect(duePresetLocal("nextweek", NOW)).toBe("2026-10-22T10:00");
  });
  it("bugün 18:00 geçtiyse yok; +1 hafta mevcut vadeden", () => {
    expect(duePresetMs("today18", Date.parse("2026-10-15T16:00:00.000Z"))).toBeNull();
    const base = Date.parse("2026-10-20T11:00:00.000Z");
    expect(duePresetMs("nextweek", NOW, base)).toBe(base + 7 * 86_400_000);
  });
  it("pazartesi günü 'Pazartesi' gelecek haftanınkidir", () => {
    const monday = Date.parse("2026-10-19T09:00:00.000Z");
    expect(duePresetLocal("monday10", monday)).toBe("2026-10-26T10:00");
  });
});
