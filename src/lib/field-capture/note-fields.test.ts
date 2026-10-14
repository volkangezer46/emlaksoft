import { describe, expect, it } from "vitest";
import { aiFieldsFromJson, extractNoteFields, mergeNoteFields, normalizeSpokenNumbers, readWhen, EMPTY_NOTE_FIELDS } from "./note-fields";
import type { NlGeo } from "@/lib/nl-search/parse";

const GEO: NlGeo = {
  provinces: [
    { id: "p-ist", name: "İstanbul" },
    { id: "p-ank", name: "Ankara" },
  ],
  districts: [
    { id: "d-kadikoy", name: "Kadıköy", parentId: "p-ist" },
    { id: "d-besiktas", name: "Beşiktaş", parentId: "p-ist" },
    { id: "d-cankaya", name: "Çankaya", parentId: "p-ank" },
  ],
};

// 2026-10-14 Çarşamba 11:00 (TR) = 08:00Z
const NOW = Date.UTC(2026, 9, 14, 8, 0);

describe("sesli not → yapılandırılmış alan önerisi (kural tabanlı)", () => {
  it("kabul: 'iki artı bir, 3 milyon bütçe, Kadıköy' → oda 2+1, bütçe 3.000.000, bölge Kadıköy", () => {
    const r = extractNoteFields("iki artı bir, 3 milyon bütçe, Kadıköy", { nowMs: NOW, geo: GEO });
    expect(r.rooms).toBe("2+1");
    expect(r.budgetMax).toBe(3_000_000);
    expect(r.budgetMin).toBeNull();
    expect(r.region?.districtId).toBe("d-kadikoy");
    expect(r.region?.provinceId).toBe("p-ist");
    expect(r.region?.label).toBe("Kadıköy, İstanbul");
    expect(r.source).toBe("kural");
  });

  it("konuşma dilindeki sayılar rakama çevrilir, bağlamsız 'bir' dokunulmaz", () => {
    expect(normalizeSpokenNumbers("uc arti bir")).toBe("3+1");
    expect(normalizeSpokenNumbers("iki bucuk milyon")).toBe("2 bucuk milyon");
    expect(normalizeSpokenNumbers("uc yuz elli bin")).toBe("350 bin");
    expect(normalizeSpokenNumbers("bir ev bakiyor")).toBe("bir ev bakiyor");
    expect(normalizeSpokenNumbers("saat ucte")).toBe("saat 3 te");
    expect(normalizeSpokenNumbers("alti milyon")).toBe("6 milyon");
    expect(normalizeSpokenNumbers("3 milyon alti")).toBe("3 milyon alti");
  });

  it("bütçe aralığı ve yazıyla tutar", () => {
    const r = extractNoteFields("üç artı bir, 4 ile 5 milyon arası, Beşiktaş'ta", { nowMs: NOW, geo: GEO });
    expect(r.rooms).toBe("3+1");
    expect(r.budgetMin).toBe(4_000_000);
    expect(r.budgetMax).toBe(5_000_000);
    expect(r.region?.districtName).toBe("Beşiktaş");
    const s = extractNoteFields("iki buçuk milyon bütçesi var", { nowMs: NOW, geo: GEO });
    expect(s.budgetMax).toBe(2_500_000);
  });

  it("randevu tarihi: 'cuma saat 3'te yer gösterme' → cuma 15:00 (saat varsayım)", () => {
    const r = extractNoteFields("2+1 arıyor, cuma saat 3'te yer gösterme", { nowMs: NOW, geo: GEO });
    expect(r.appointment).not.toBeNull();
    // 2026-10-16 Cuma 15:00 TR = 12:00Z
    expect(r.appointment?.iso).toBe("2026-10-16T12:00:00.000Z");
    expect(r.appointment?.label).toBe("Cuma 15:00");
    expect(r.appointment?.assumed).toBe(true);
    expect(r.rooms).toBe("2+1");
  });

  it("randevu: açık tarih ve dakikalı saat varsayım değildir", () => {
    const r = extractNoteFields("20 ekim 14:30 randevu verdik", { nowMs: NOW });
    expect(r.appointment?.iso).toBe("2026-10-20T11:30:00.000Z");
    expect(r.appointment?.assumed).toBe(false);
  });

  it("sonraki görev: 'yarın tekrar ara' → görev + yarın 09:00 (saat varsayım)", () => {
    const r = extractNoteFields("Kadıköy bakıyor. Yarın tekrar arayacağım", { nowMs: NOW, geo: GEO });
    expect(r.nextTask?.title).toBe("Yarın tekrar arayacağım");
    expect(r.nextTask?.due?.iso).toBe("2026-10-15T06:00:00.000Z");
    expect(r.nextTask?.due?.label).toBe("Yarın 09:00");
    expect(r.nextTask?.due?.assumed).toBe(true);
    expect(r.region?.districtId).toBe("d-kadikoy");
  });

  it("görev sözcüğü tarihsiz de görev olur; 'arasında' görev sayılmaz", () => {
    expect(extractNoteFields("tapu fotokopisini gönder", { nowMs: NOW }).nextTask?.title).toBe("Tapu fotokopisini gönder");
    expect(extractNoteFields("4 ile 5 milyon arasında", { nowMs: NOW }).nextTask).toBeNull();
  });

  it("haftaya salı = gelecek haftanın salısı; geçmiş tarih önerilmez", () => {
    const w = readWhen("haftaya salı", NOW, 10);
    // bugün çarşamba → bu haftaki salı geçti; haftaya salı = 2026-10-20
    expect(w?.iso).toBe("2026-10-20T07:00:00.000Z");
    expect(readWhen("bugün saat 9:00", NOW, 10)).toBeNull();
  });

  it("anlaşılmayan şey uydurulmaz", () => {
    const r = extractNoteFields("müşteri çok kibar, tekrar konuşuruz", { nowMs: NOW, geo: GEO });
    expect(r.rooms).toBeNull();
    expect(r.budgetMax).toBeNull();
    expect(r.region).toBeNull();
    expect(r.appointment).toBeNull();
    expect(extractNoteFields("", { nowMs: NOW })).toEqual(EMPTY_NOTE_FIELDS);
  });

  it("AI yalnız eksik alanları tamamlar, kural bulgusunu ezmez", () => {
    const rule = extractNoteFields("2+1, Kadıköy", { nowMs: NOW, geo: GEO });
    const merged = mergeNoteFields(rule, { rooms: "4+1", budgetMax: 7_000_000, budgetLabel: "en fazla 7 mn" });
    expect(merged.rooms).toBe("2+1");
    expect(merged.budgetMax).toBe(7_000_000);
    expect(merged.source).toBe("kural+ai");
    expect(mergeNoteFields(rule, null).source).toBe("kural");
  });
});

describe("AI tamamlaması doğrulaması", () => {
  it("geçerli alanlar alınır, uydurma görev ve geçmiş tarih düşer", () => {
    const r = aiFieldsFromJson(
      { rooms: "3+1", budget_max: "4.500.000", region: "Kadıköy", appointment_at: "2026-10-16T15:00", next_task: "Kredi teklifini gönder", next_task_at: "2020-01-01T10:00" },
      { nowMs: NOW, geo: GEO, sourceText: "3+1 istiyor, krediye uygun teklif lazım, Kadıköy" },
    );
    expect(r?.rooms).toBe("3+1");
    expect(r?.budgetMax).toBe(4_500_000);
    expect(r?.region?.districtId).toBe("d-kadikoy");
    expect(r?.appointment?.iso).toBe("2026-10-16T12:00:00.000Z");
    expect(r?.nextTask?.title).toBe("Kredi teklifini gönder");
    expect(r?.nextTask?.due).toBeNull();
    const fake = aiFieldsFromJson({ rooms: "çok", region: "Mars", next_task: "Uzay gemisi kirala" }, { nowMs: NOW, geo: GEO, sourceText: "2+1 bakıyor" });
    expect(fake).toBeNull();
  });
});
