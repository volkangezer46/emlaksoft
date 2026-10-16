import { describe, expect, it } from "vitest";
import {
  DEFAULT_TV_CONFIG,
  TV_SCENES,
  buildTvEvents,
  burnInOffset,
  canViewTv,
  dailySeries,
  formatTvConfig,
  initialsOf,
  isNightHour,
  leadSourceLabel,
  monthWindowCounts,
  msUntilTrHour,
  newIds,
  paceProjection,
  parseTvConfig,
  pctChange,
  perItemMs,
  planScenes,
  reconcileIndex,
  sceneEmphasis,
  shortName,
  stepIndex,
  windowAroundNow,
} from "./tv-logic";

const TR = 3 * 3_600_000;
/** İstanbul duvar saati → epoch ms. */
const tr = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - TR;

describe("shortName (TV'de kişi adı: 'Ahmet Y.')", () => {
  it("ad + soyadın baş harfi", () => {
    expect(shortName("Ahmet Yılmaz")).toBe("Ahmet Y.");
    expect(shortName("ayşe nur YILMAZ")).toBe("Ayşe Y.");
  });
  it("Türkçe büyük/küçük harf (i/İ, ı/I)", () => {
    expect(shortName("ismail ışık")).toBe("İsmail I.");
  });
  it("etiket ve numara sözcükleri atlanır", () => {
    expect(shortName("[SAHA] Ali Er")).toBe("Ali E.");
    expect(shortName("Müşteri 46186")).toBe("Müşteri");
    expect(shortName("0532 123 45 67")).toBe("Müşteri");
  });
  it("tek sözcük, boş ve yedek", () => {
    expect(shortName("Zeynep")).toBe("Zeynep");
    expect(shortName("")).toBe("Müşteri");
    expect(shortName(null, "Danışman")).toBe("Danışman");
  });
  it("tam ad (soyad) asla çıktıda bulunmaz", () => {
    for (const full of ["Mehmet Ali Karaca", "Elif Bayraktar", "Serkan Koç"]) {
      const out = shortName(full);
      const last = full.split(" ").at(-1)!;
      expect(out).not.toContain(last);
      expect(out.length).toBeLessThan(full.length);
    }
  });
  it("baş harfler", () => {
    expect(initialsOf("Ahmet Y.")).toBe("AY");
  });
});

describe("ayar modeli (office.tv.config)", () => {
  it("varsayılan: yedi sahne açık, koyu tema, para KAPALI, gece modu açık", () => {
    expect(DEFAULT_TV_CONFIG.scenes.map((s) => s.id)).toEqual([...TV_SCENES]);
    expect(DEFAULT_TV_CONFIG.scenes.every((s) => s.on)).toBe(true);
    expect(DEFAULT_TV_CONFIG.showMoney).toBe(false);
    expect(DEFAULT_TV_CONFIG.theme).toBe("dark");
    expect(DEFAULT_TV_CONFIG.nightMode).toBe(true);
  });
  it("bozuk / yabancı değer güvenli varsayılana düşer", () => {
    expect(parseTvConfig("{bozuk")).toEqual(DEFAULT_TV_CONFIG);
    expect(parseTvConfig(null)).toEqual(DEFAULT_TV_CONFIG);
    expect(parseTvConfig(42)).toEqual(DEFAULT_TV_CONFIG);
  });
  it("sıra korunur, bilinmeyen/tekrarlı sahne atılır, eksik sahne sona açık eklenir, süre sınırlanır", () => {
    const c = parseTvConfig({
      scenes: [
        { id: "lig", on: true, sec: 30 },
        { id: "hack", on: true, sec: 5 },
        { id: "lig", on: false, sec: 10 },
        { id: "bugun", on: false, sec: 9999 },
      ],
      theme: "light",
      showMoney: "evet",
    });
    expect(c.scenes.slice(0, 2)).toEqual([
      { id: "lig", on: true, sec: 30 },
      { id: "bugun", on: false, sec: 20 },
    ]);
    expect(c.scenes).toHaveLength(TV_SCENES.length);
    expect(c.scenes.slice(2).every((s) => s.on)).toBe(true);
    expect(c.theme).toBe("light");
    expect(c.showMoney).toBe(false); // yalnız gerçek true açar
  });
  it("biçim-ayrıştır turu kayıpsız ve fazladan alan yazılmaz", () => {
    const c = parseTvConfig({ ...DEFAULT_TV_CONFIG, showMoney: true, extra: "x" });
    const text = formatTvConfig(c);
    expect(parseTvConfig(text)).toEqual(c);
    expect(text).not.toContain("extra");
  });
});

describe("sahne planlama", () => {
  const all = Object.fromEntries(TV_SCENES.map((s) => [s, true]));
  it("açık + içerikli sahneler ayar sırasıyla, süre ms", () => {
    const plan = planScenes(DEFAULT_TV_CONFIG, all, 13);
    expect(plan.map((p) => p.id)).toEqual([...TV_SCENES]);
    expect(plan[0]).toEqual({ id: "bugun", ms: 20_000 });
  });
  it("içeriği olmayan sahne atlanır (boş ekran dönmez)", () => {
    const plan = planScenes(DEFAULT_TV_CONFIG, { ...all, duyurular: false, ilanlar: false }, 13);
    expect(plan.map((p) => p.id)).not.toContain("duyurular");
    expect(plan.map((p) => p.id)).not.toContain("ilanlar");
  });
  it("kapalı sahne atlanır; hiçbiri kalmazsa 'bugün' tek başına döner", () => {
    const off = { ...DEFAULT_TV_CONFIG, scenes: DEFAULT_TV_CONFIG.scenes.map((s) => ({ ...s, on: false })) };
    expect(planScenes(off, all, 13)).toEqual([{ id: "bugun", ms: 20_000 }]);
  });
  it("günün saatine göre vurgu: sabah bugün 1,5×, akşam lig 1,25×", () => {
    expect(sceneEmphasis("bugun", 9)).toBe(1.5);
    expect(sceneEmphasis("bugun", 11)).toBe(1);
    expect(sceneEmphasis("lig", 17)).toBe(1.25);
    expect(planScenes(DEFAULT_TV_CONFIG, all, 9)[0].ms).toBe(30_000);
  });
  it("adım sarılır; plan değişince aynı sahnede kalınır", () => {
    expect(stepIndex(6, 7, 1)).toBe(0);
    expect(stepIndex(0, 7, -1)).toBe(6);
    expect(stepIndex(0, 0, 1)).toBe(0);
    const plan = planScenes(DEFAULT_TV_CONFIG, { ...all, performans: false }, 13);
    expect(plan[reconcileIndex("lig", 2, plan)].id).toBe("lig");
    // Sahne plandan düştüyse aynı konumda (taşmadan) devam
    expect(reconcileIndex("performans", 9, plan)).toBe(plan.length - 1);
  });
  it("sahne içi döngü: öğe başına süre en az 6 sn", () => {
    expect(perItemMs(30_000, 3)).toBe(10_000);
    expect(perItemMs(30_000, 12)).toBe(6000);
    expect(perItemMs(30_000, 1)).toBe(30_000);
  });
});

describe("zaman: gece modu, 04:00 yeniden yükleme, burn-in", () => {
  it("gece 22:00–07:00", () => {
    expect(isNightHour(22)).toBe(true);
    expect(isNightHour(3)).toBe(true);
    expect(isNightHour(7)).toBe(false);
    expect(isNightHour(21)).toBe(false);
  });
  it("bir sonraki İstanbul 04:00'e kalan süre", () => {
    expect(msUntilTrHour(tr(2026, 10, 16, 3, 0), 4)).toBe(3_600_000);
    expect(msUntilTrHour(tr(2026, 10, 16, 4, 0), 4)).toBe(24 * 3_600_000);
    expect(msUntilTrHour(tr(2026, 10, 16, 23, 30), 4)).toBe(4.5 * 3_600_000);
  });
  it("burn-in kayması her zaman ±2 px içinde ve hareket eder", () => {
    const seen = new Set<string>();
    for (let m = 0; m < 60; m++) {
      const o = burnInOffset(m);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(2);
      seen.add(`${o.x},${o.y}`);
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("göstergeler", () => {
  const now = tr(2026, 10, 16, 15, 0);
  it("değişim yüzdesi; önceki 0 → null (yeni)", () => {
    expect(pctChange(12, 10)).toBe(20);
    expect(pctChange(5, 10)).toBe(-50);
    expect(pctChange(3, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
  });
  it("günlük seri: son 14 TR günü, bugün en sonda; pencere dışı atılır", () => {
    const s = dailySeries(
      [new Date(tr(2026, 10, 16, 0, 30)).toISOString(), new Date(tr(2026, 10, 15, 23, 59)).toISOString(), new Date(tr(2026, 9, 1)).toISOString(), "bozuk", null],
      now,
      14,
    );
    expect(s).toHaveLength(14);
    expect(s[13]).toBe(1);
    expect(s[12]).toBe(1);
    expect(s.reduce((a, b) => a + b, 0)).toBe(2);
  });
  it("bu ay vs geçen ayın aynı günleri (adil kıyas)", () => {
    const monthStart = tr(2026, 10, 1);
    const prevStart = tr(2026, 9, 1);
    const isos = [tr(2026, 10, 2), tr(2026, 10, 10), tr(2026, 9, 5), tr(2026, 9, 20)].map((t) => new Date(t).toISOString());
    expect(monthWindowCounts(isos, monthStart, prevStart, now)).toEqual({ current: 2, previous: 1 });
  });
  it("ay sonu hız tahmini (ilk 3 günde yok)", () => {
    expect(paceProjection(8, 16, 31)).toBe(16);
    expect(paceProjection(2, 2, 31)).toBeNull();
  });
  it("randevu penceresi şimdi etrafında, sıradaki işaretli", () => {
    const at = (h: number) => ({ id: `a${h}`, at: new Date(tr(2026, 10, 16, h)).toISOString() });
    const items = [9, 10, 11, 12, 13, 14, 16, 17, 18, 19].map(at);
    const w = windowAroundNow(items, now, 5, 2);
    expect(w.items.map((x) => x.id)).toEqual(["a13", "a14", "a16", "a17", "a18"]);
    expect(w.nextId?.id).toBe("a16");
    const late = windowAroundNow(items, tr(2026, 10, 16, 23), 5, 2);
    expect(late.nextId).toBeNull();
    expect(late.items).toHaveLength(5);
  });
});

describe("olay akışı ve kaynaklar kişisel veri taşımaz", () => {
  it("en yeni N olay, sabit etiketler, geçersiz zaman atılır", () => {
    const ev = buildTvEvents(
      [
        { id: "1", kind: "customer", at: "2026-10-16T10:00:00Z" },
        { id: "2", kind: "deal", at: "2026-10-16T11:00:00Z" },
        { id: "3", kind: "property", at: "bozuk" },
      ],
      10,
    );
    expect(ev.map((e) => e.id)).toEqual(["deal:2", "customer:1"]);
    expect(ev[0].label).toBe("Teklif kabul edildi");
  });
  it("kaynak etiketi: bilinen etiket, bilinmeyen/boş null", () => {
    expect(leadSourceLabel("portal_sahibinden")).toBe("Sahibinden");
    expect(leadSourceLabel("web")).toBe("Web sitesi");
    expect(leadSourceLabel("x")).toBeNull();
    expect(leadSourceLabel("")).toBeNull();
  });
  it("newIds: ilk yüklemede boş (kutlama yok), sonra yalnız yeni kimlikler", () => {
    expect(newIds(null, ["a"]).size).toBe(0);
    expect([...newIds(new Set(["a"]), ["a", "b"])]).toEqual(["b"]);
  });
});

describe("veri kapsamı", () => {
  it("yalnız ofis geneli roller TV görür", () => {
    expect(canViewTv("owner")).toBe(true);
    expect(canViewTv("gm")).toBe(true);
    expect(canViewTv("branch_manager")).toBe(true);
    expect(canViewTv("advisor")).toBe(false);
    expect(canViewTv(null)).toBe(false);
  });
});
