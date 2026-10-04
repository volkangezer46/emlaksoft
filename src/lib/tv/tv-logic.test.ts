import { describe, expect, it } from "vitest";
import {
  DEFAULT_TV_SETTINGS,
  TV_SECTIONS,
  buildTvEvents,
  burnInOffset,
  canShowRevenue,
  canViewTv,
  isSectionVisible,
  newIds,
  pageAt,
  pageCount,
  parseTvSettings,
  resolveTvDark,
  shortName,
  shouldCelebrate,
  templateSections,
} from "./tv-logic";

describe("shortName (TV'de müşteri adı)", () => {
  it("baş harf + soyad", () => {
    expect(shortName("Ayşe Yılmaz")).toBe("A. Yılmaz");
    expect(shortName("Ayşe Nur Yılmaz")).toBe("A. Yılmaz");
  });
  it("Türkçe büyük/küçük harf (i/İ, ı/I)", () => {
    expect(shortName("ismail ıŞIK")).toBe("İ. Işık");
  });
  it("tek sözcük ve boş", () => {
    expect(shortName("Mehmet")).toBe("M.");
    expect(shortName("   ")).toBe("Müşteri");
    expect(shortName(null)).toBe("Müşteri");
  });
  it("tam ad asla çıktıda bulunmaz", () => {
    expect(shortName("Zeynep Kaya")).not.toContain("Zeynep");
  });
});

describe("rotasyon sayfalama", () => {
  it("sayfa sayısı", () => {
    expect(pageCount(0, 6)).toBe(1);
    expect(pageCount(6, 6)).toBe(1);
    expect(pageCount(7, 6)).toBe(2);
  });
  it("tick sayfalar arasında döner ve sarılır", () => {
    const items = Array.from({ length: 13 }, (_, i) => i);
    expect(pageAt(items, 6, 0).slice).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pageAt(items, 6, 1).slice).toEqual([6, 7, 8, 9, 10, 11]);
    expect(pageAt(items, 6, 2).slice).toEqual([12]);
    expect(pageAt(items, 6, 3).page).toBe(0);
    expect(pageAt(items, 6, -1).page).toBe(2);
  });
  it("boş liste güvenli", () => {
    expect(pageAt([], 6, 5)).toEqual({ page: 0, pages: 1, slice: [] });
  });
});

describe("bölüm görünürlük kuralları", () => {
  it("varsayılan: tüm bölümler açık, gelir kapalı", () => {
    expect(DEFAULT_TV_SETTINGS.showRevenue).toBe(false);
    for (const s of TV_SECTIONS) expect(isSectionVisible(DEFAULT_TV_SETTINGS, s)).toBe(true);
  });
  it("şablon bölüm kümesini daraltır", () => {
    expect(templateSections("satis")).not.toContain("appointments");
    expect(templateSections("randevu")).not.toContain("league");
    expect(isSectionVisible({ ...DEFAULT_TV_SETTINGS, template: "satis" }, "appointments")).toBe(false);
  });
  it("kullanıcı kapatması ve duyuru şeridi anahtarı", () => {
    expect(isSectionVisible({ ...DEFAULT_TV_SETTINGS, hidden: ["events"] }, "events")).toBe(false);
    expect(isSectionVisible({ ...DEFAULT_TV_SETTINGS, ticker: false }, "ticker")).toBe(false);
  });
  it("gelir ancak ayar VE sunucu izni birlikte varsa", () => {
    expect(canShowRevenue({ ...DEFAULT_TV_SETTINGS, showRevenue: true }, true)).toBe(true);
    expect(canShowRevenue({ ...DEFAULT_TV_SETTINGS, showRevenue: true }, false)).toBe(false);
    expect(canShowRevenue(DEFAULT_TV_SETTINGS, true)).toBe(false);
  });
  it("saklanan bozuk/yabancı değer güvenli ayara düşer", () => {
    expect(parseTvSettings("{bozuk")).toEqual(DEFAULT_TV_SETTINGS);
    expect(parseTvSettings({ template: "x", theme: "y", hidden: ["events", "zzz"], showRevenue: "evet" })).toEqual({
      ...DEFAULT_TV_SETTINGS,
      hidden: ["events"],
    });
    expect(parseTvSettings(JSON.stringify({ showRevenue: true, theme: "dark" })).showRevenue).toBe(true);
  });
  it("tema çözümü", () => {
    expect(resolveTvDark("auto", true)).toBe(true);
    expect(resolveTvDark("light", true)).toBe(false);
    expect(resolveTvDark("dark", false)).toBe(true);
  });
});

describe("veri kapsamı", () => {
  it("yalnız ofis geneli roller TV görür", () => {
    for (const r of ["owner", "gm", "branch_manager"]) expect(canViewTv(r)).toBe(true);
    for (const r of ["team_lead", "advisor", "call_center", "accounting", "readonly", "", null, undefined]) {
      expect(canViewTv(r as string)).toBe(false);
    }
  });
});

describe("olay akışı kişisel veri taşımaz", () => {
  it("en yeni 10 olay, sabit etiketler", () => {
    const raw = Array.from({ length: 14 }, (_, i) => ({
      id: String(i),
      kind: (["customer", "appointment", "deal", "property"] as const)[i % 4],
      at: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
    }));
    const ev = buildTvEvents(raw);
    expect(ev).toHaveLength(10);
    expect(ev[0].id).toBe("appointment:13");
    expect(Object.keys(ev[0]).sort()).toEqual(["at", "id", "kind", "label"]);
    expect(ev.map((e) => e.label).join(" ")).not.toMatch(/\d{10}|@/);
  });
  it("geçersiz zamanlı kayıt atılır", () => {
    expect(buildTvEvents([{ id: "1", kind: "customer", at: null }, { id: "2", kind: "customer", at: "bozuk" }])).toEqual([]);
  });
});

describe("kutlama ve yeni öğe", () => {
  it("ilk yüklemede kutlama yok, artışta var", () => {
    expect(shouldCelebrate(null, 5)).toBe(false);
    expect(shouldCelebrate(5, 5)).toBe(false);
    expect(shouldCelebrate(5, 6)).toBe(true);
    expect(shouldCelebrate(5, 4)).toBe(false);
  });
  it("newIds yalnız yeni kimlikleri verir; ilk yüklemede boş", () => {
    expect([...newIds(null, ["a"])]).toEqual([]);
    expect([...newIds(new Set(["a"]), ["a", "b"])]).toEqual(["b"]);
  });
});

describe("burn-in kayması", () => {
  it("her zaman ±2 px içinde", () => {
    for (let m = -20; m < 200; m++) {
      const { x, y } = burnInOffset(m);
      expect(Math.abs(x)).toBeLessThanOrEqual(2);
      expect(Math.abs(y)).toBeLessThanOrEqual(2);
    }
  });
});
