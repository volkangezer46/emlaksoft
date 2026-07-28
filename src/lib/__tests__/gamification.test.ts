import { describe, expect, it } from "vitest";
import {
  BADGES,
  BADGE_BY_CODE,
  SCORE_RULES,
  SCORE_RULE_KEYS,
  computeAgentScores,
  computeStreak,
  emptyAgentStats,
  evaluateBadges,
  rankAgentScores,
  type ActivityRow,
} from "@/lib/gamification";

const AYSE = "a0000000-0000-0000-0000-000000000001";
const MEHMET = "b0000000-0000-0000-0000-000000000002";
const ZEYNEP = "c0000000-0000-0000-0000-000000000003";

/** Kısa aktivite satırı kurucu. */
const row = (staffId: string, kind: ActivityRow["kind"], at = "2026-07-10T09:00:00.000Z"): ActivityRow => ({
  staffId,
  kind,
  at,
});

describe("computeAgentScores", () => {
  it("1) puanları kural tablosuna göre toplar ve kırılımı doldurur", () => {
    const scores = computeAgentScores([
      row(AYSE, "deal_won"),
      row(AYSE, "property_new"),
      row(AYSE, "property_new"),
      row(AYSE, "appointment_done"),
      row(AYSE, "task_done"),
      row(AYSE, "nps_promoter"),
      row(AYSE, "leak_sla_response"),
    ]);

    expect(scores).toHaveLength(1);
    const a = scores[0];
    // 100 + 20*2 + 10 + 5 + 30 + 15
    expect(a.total).toBe(200);
    expect(a.activityCount).toBe(7);
    expect(a.breakdown.property_new).toEqual({ count: 2, points: 40 });
    expect(a.breakdown.deal_won).toEqual({ count: 1, points: 100 });
    // Hiç satırı olmayan kalem de anahtarı ile 0 döner (UI boş hücre görmesin)
    expect(a.breakdown.task_done.count).toBe(1);
    for (const k of SCORE_RULE_KEYS) expect(a.breakdown[k]).toBeDefined();
  });

  it("2) boş veri boş dizi döndürür (çökmeden)", () => {
    expect(computeAgentScores([])).toEqual([]);
    // Bozuk satırlar (staffId yok / bilinmeyen kural) sessizce atlanır
    const kirli = [
      { staffId: "", kind: "deal_won", at: "x" },
      { staffId: AYSE, kind: "olmayan_kural", at: "x" },
    ] as unknown as ActivityRow[];
    expect(computeAgentScores(kirli)).toEqual([]);
  });

  it("3) puana göre azalan sıralar, EŞİTLİKTE staffId ile deterministik kırar", () => {
    // Zeynep ve Ayşe eşit puanlı (1 anlaşma), Mehmet düşük.
    const scores = computeAgentScores([
      row(ZEYNEP, "deal_won"),
      row(MEHMET, "task_done"),
      row(AYSE, "deal_won"),
    ]);
    expect(scores.map((s) => s.staffId)).toEqual([AYSE, ZEYNEP, MEHMET]);
    expect(scores[0].total).toBe(scores[1].total);

    // Girdi sırası değişse de çıktı sırası AYNI kalmalı (snapshot ile ekran uyuşsun)
    const tersi = computeAgentScores([
      row(AYSE, "deal_won"),
      row(ZEYNEP, "deal_won"),
      row(MEHMET, "task_done"),
    ]);
    expect(tersi.map((s) => s.staffId)).toEqual([AYSE, ZEYNEP, MEHMET]);
  });

  it("4) özel ruleset ile puanlar yeniden ağırlıklanır", () => {
    const scores = computeAgentScores([row(AYSE, "deal_won"), row(AYSE, "task_done")], {
      ...SCORE_RULES,
      deal_won: 1,
      task_done: 1,
    });
    expect(scores[0].total).toBe(2);
  });

  it("5) rankAgentScores eşit puanı aynı sıraya koyar (1,2,2,4)", () => {
    const scores = computeAgentScores([
      row(AYSE, "deal_won"),
      row(AYSE, "deal_won"),
      row(MEHMET, "deal_won"),
      row(ZEYNEP, "deal_won"),
      row("d-4", "task_done"),
    ]);
    const ranked = rankAgentScores(scores);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked[0].staffId).toBe(AYSE);
  });
});

describe("computeStreak", () => {
  it("6) bugün dahil kesintisiz günleri sayar", () => {
    const dates = ["2026-07-28T10:00:00Z", "2026-07-27T08:00:00Z", "2026-07-26T19:00:00Z"];
    expect(computeStreak(dates, "2026-07-28")).toBe(3);
  });

  it("7) son aktivite DÜN ise seri canlıdır (gün henüz bitmedi)", () => {
    const dates = ["2026-07-27", "2026-07-26"];
    expect(computeStreak(dates, "2026-07-28")).toBe(2);
  });

  it("8) iki gün önce kesilen seri 0'dır", () => {
    const dates = ["2026-07-26", "2026-07-25", "2026-07-24"];
    expect(computeStreak(dates, "2026-07-28")).toBe(0);
  });

  it("9) aradaki boşluk seriyi keser, yalnız güncel blok sayılır", () => {
    // 28-27 var, 26 YOK, 25-24 var → seri 2
    const dates = ["2026-07-28", "2026-07-27", "2026-07-25", "2026-07-24"];
    expect(computeStreak(dates, "2026-07-28")).toBe(2);
  });

  it("10) aynı gün birden çok aktivite tek gün sayılır; boş veri 0", () => {
    const dates = ["2026-07-28T09:00:00Z", "2026-07-28T14:00:00Z", "2026-07-28T18:00:00Z"];
    expect(computeStreak(dates, "2026-07-28")).toBe(1);
    expect(computeStreak([], "2026-07-28")).toBe(0);
  });

  it("11) gelecek tarihli satırlar (ileri randevu) seriyi şişirmez", () => {
    const dates = ["2026-08-05", "2026-07-28", "2026-07-27"];
    expect(computeStreak(dates, "2026-07-28")).toBe(2);
  });

  it("12) ay ve yıl sınırını doğru geçer", () => {
    expect(computeStreak(["2026-01-01", "2025-12-31", "2025-12-30"], "2026-01-01")).toBe(3);
  });
});

describe("evaluateBadges", () => {
  it("13) eşiğin ALTINDA rozet verilmez, eşikte verilir", () => {
    expect(evaluateBadges(emptyAgentStats({ propertyCountAllTime: 9 }))).not.toContain("portfoy_10");
    expect(evaluateBadges(emptyAgentStats({ propertyCountAllTime: 10 }))).toContain("portfoy_10");

    expect(evaluateBadges(emptyAgentStats({ npsPromoterCount: 2 }))).not.toContain("bes_yildiz");
    expect(evaluateBadges(emptyAgentStats({ npsPromoterCount: 3 }))).toContain("bes_yildiz");

    expect(evaluateBadges(emptyAgentStats({ dealCount: 4 }))).not.toContain("kapanis_makinesi");
    expect(evaluateBadges(emptyAgentStats({ dealCount: 5 }))).toContain("kapanis_makinesi");
  });

  it("14) Hız Ustası: 15 dk SINIRI dahil değil, veri yoksa (null) verilmez", () => {
    expect(evaluateBadges(emptyAgentStats({ avgFirstResponseMin: 14.9 }))).toContain("hiz_ustasi");
    expect(evaluateBadges(emptyAgentStats({ avgFirstResponseMin: 15 }))).not.toContain("hiz_ustasi");
    expect(evaluateBadges(emptyAgentStats({ avgFirstResponseMin: null }))).not.toContain("hiz_ustasi");
    // 0 dk (anında yanıt) null ile karıştırılmamalı
    expect(evaluateBadges(emptyAgentStats({ avgFirstResponseMin: 0 }))).toContain("hiz_ustasi");
  });

  it("15) Ayın Şampiyonu 1. sıra + puan>0 ister; puansız lider rozet almaz", () => {
    expect(evaluateBadges(emptyAgentStats({ rank: 1, score: 500 }))).toContain("ayin_sampiyonu");
    expect(evaluateBadges(emptyAgentStats({ rank: 1, score: 0 }))).not.toContain("ayin_sampiyonu");
    expect(evaluateBadges(emptyAgentStats({ rank: 2, score: 500 }))).not.toContain("ayin_sampiyonu");
    // 2. sıra podyum rozetini yine de alır
    expect(evaluateBadges(emptyAgentStats({ rank: 2, score: 500 }))).toContain("podyum");
  });

  it("16) seri rozetleri kademelidir: 7 gün İstikrar, 30 gün Maratoncu", () => {
    expect(evaluateBadges(emptyAgentStats({ streakDays: 6 }))).toEqual([]);
    const yedi = evaluateBadges(emptyAgentStats({ streakDays: 7 }));
    expect(yedi).toContain("haftalik_seri");
    expect(yedi).not.toContain("maratoncu");
    const otuz = evaluateBadges(emptyAgentStats({ streakDays: 30 }));
    expect(otuz).toEqual(expect.arrayContaining(["haftalik_seri", "maratoncu"]));
  });

  it("17) scope filtresi aylık/ömür boyu rozetleri ayırır", () => {
    const stats = emptyAgentStats({ rank: 1, score: 900, dealCountAllTime: 3, dealCount: 6 });
    const aylik = evaluateBadges(stats, { scope: "monthly" });
    const omur = evaluateBadges(stats, { scope: "lifetime" });
    expect(aylik).toEqual(expect.arrayContaining(["ayin_sampiyonu", "podyum", "kapanis_makinesi"]));
    expect(aylik).not.toContain("ilk_anlasma");
    expect(omur).toContain("ilk_anlasma");
    expect(omur).not.toContain("ayin_sampiyonu");
  });

  it("18) boş istatistikte hiç rozet yok; katalog kodları tekil ve kayıtlı", () => {
    expect(evaluateBadges(emptyAgentStats())).toEqual([]);
    expect(BADGES.length).toBeGreaterThanOrEqual(10);
    const codes = BADGES.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(BADGE_BY_CODE.get(c)?.code).toBe(c);
    // Her rozetin "nasıl kazanılır" metni dolu olmalı (galeri soluk kart metni)
    for (const b of BADGES) expect(b.howTo.length).toBeGreaterThan(5);
  });
});
