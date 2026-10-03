import { describe, expect, it } from "vitest";
import {
  WEEK_MS,
  barHeights,
  bucketByWeek,
  buildActiveChips,
  buildCategoryChips,
  densityOf,
  hasSeries,
  hiddenFields,
  isoDateParam,
  pageHrefOf,
  pageWindow,
  parsePage,
  trendOf,
  uuidParam,
  weeklySeriesOf,
} from "./list-logic";

describe("uuidParam / isoDateParam / parsePage", () => {
  it("yalnız geçerli uuid kabul edilir, bozuk değer sorguya sızmaz", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(uuidParam(id)).toBe(id);
    expect(uuidParam(` ${id} `)).toBe(id);
    expect(uuidParam([id, "x"])).toBe(id);
    expect(uuidParam("x' or 1=1")).toBe("");
    expect(uuidParam(undefined)).toBe("");
  });
  it("tarih paramı YYYY-MM-DD dışını reddeder", () => {
    expect(isoDateParam("2026-10-03")).toBe("2026-10-03");
    expect(isoDateParam("03.10.2026")).toBe("");
    expect(isoDateParam("")).toBe("");
  });
  it("sayfa paramı en az 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe("weeklySeriesOf", () => {
  it("tarama tavana dayandıysa seri güvenilmez (undefined)", () => {
    expect(weeklySeriesOf([ago(0), ago(1)], NOW, 2)).toBeUndefined();
    expect(weeklySeriesOf([ago(0), ago(1)], NOW, 10)?.reduce((a, c) => a + c, 0)).toBe(2);
  });
});

describe("pageWindow / pageHrefOf", () => {
  it("gerçek toplamdan aralık ve sayfa sayısı üretir", () => {
    const w = pageWindow(2, 120, 50, 50);
    expect(w).toMatchObject({ totalPages: 3, offset: 50, rangeStart: 51, rangeEnd: 100, hasPrev: true, hasNext: true });
    const last = pageWindow(3, 120, 50, 20);
    expect(last).toMatchObject({ rangeStart: 101, rangeEnd: 120, hasNext: false });
    expect(pageWindow(1, 0, 50, 0)).toMatchObject({ totalPages: 1, rangeStart: 0, rangeEnd: 0 });
  });
  it("sayfa linki filtreleri korur, 1. sayfada param yok", () => {
    expect(pageHrefOf("/app/x", { q: "ev", sayfa: "4", durum: "a" }, 2)).toBe("/app/x?q=ev&durum=a&sayfa=2");
    expect(pageHrefOf("/app/x", { q: "ev", sayfa: "4" }, 1)).toBe("/app/x?q=ev");
  });
});

const NOW = Date.UTC(2026, 9, 3, 12);
const ago = (weeks: number) => new Date(NOW - weeks * WEEK_MS - 1000).toISOString();

describe("bucketByWeek", () => {
  it("son haftayı sona, eskiyi başa koyar; pencere dışı ve geçersizi atar", () => {
    const b = bucketByWeek([ago(0), ago(0), ago(1), ago(7), ago(8), null, "bozuk", new Date(NOW + 5000).toISOString()], NOW, 8);
    expect(b[7]).toBe(2);
    expect(b[6]).toBe(1);
    expect(b[0]).toBe(1);
    expect(b.reduce((a, c) => a + c, 0)).toBe(4);
  });
});

describe("trendOf", () => {
  it("veri yoksa null (trend uydurulmaz)", () => {
    expect(trendOf([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(trendOf([3])).toBeNull();
  });
  it("yükseliş/düşüş yüzdesi", () => {
    expect(trendOf([1, 1, 1, 1, 2, 2, 2, 2])).toEqual({ dir: "up", pct: 100, label: "%100" });
    expect(trendOf([2, 2, 2, 2, 1, 1, 1, 1])).toEqual({ dir: "down", pct: -50, label: "%50" });
    expect(trendOf([1, 1, 1, 1, 1, 1, 1, 1])?.dir).toBe("flat");
  });
  it("önceki dönem 0 iken yüzde hesaplanmaz", () => {
    expect(trendOf([0, 0, 0, 0, 0, 0, 1, 2])).toEqual({ dir: "up", pct: null, label: "yeni" });
  });
});

describe("hasSeries / barHeights", () => {
  it("tamamı sıfırsa çubuk yok", () => {
    expect(hasSeries([0, 0, 0])).toBe(false);
    expect(hasSeries(undefined)).toBe(false);
    expect(hasSeries([0, 2, 0])).toBe(true);
  });
  it("sıfır olmayan değer en az %12, en büyük %100", () => {
    expect(barHeights([0, 1, 100])).toEqual([0, 12, 100]);
  });
});

describe("buildCategoryChips", () => {
  const options = [
    { value: "Daire", label: "Daire" },
    { value: "Arsa", label: "Arsa" },
    { value: "Depo", label: "Depo" },
  ];
  const base = { options, total: 10, active: "", pathname: "/app/portfoyler", params: { q: "x", sayfa: "3" } };

  it("sayacı 0 olan pasif çipi gizler, href sayfalamayı sıfırlayıp filtreyi korur", () => {
    const chips = buildCategoryChips({ ...base, counts: { Daire: 7, Arsa: 3 } });
    expect(chips.map((c) => c.label)).toEqual(["Tümü", "Daire", "Arsa"]);
    expect(chips[1]!.href).toBe("/app/portfoyler?q=x&kategori=Daire");
    expect(chips[0]!.active).toBe(true);
    expect(chips[0]!.count).toBe(10);
  });
  it("aktif çip sayacı 0 olsa da görünür", () => {
    const chips = buildCategoryChips({ ...base, active: "Depo", counts: { Daire: 7 } });
    expect(chips.find((c) => c.value === "Depo")?.active).toBe(true);
  });
  it("tanımsız ama sayımda geçen değer sona eklenir", () => {
    const chips = buildCategoryChips({ ...base, counts: { Daire: 1, Bina: 2 } });
    expect(chips.at(-1)).toMatchObject({ value: "Bina", count: 2 });
  });
  it("sayımlar güvenilir değilse çipler sayısız çıkar", () => {
    const chips = buildCategoryChips({ ...base, counts: null, total: null });
    expect(chips).toHaveLength(4);
    expect(chips.every((c) => c.count === undefined)).toBe(true);
  });
  it("özel param adı", () => {
    const chips = buildCategoryChips({ ...base, counts: { Daire: 1 }, paramName: "type" });
    expect(chips[1]!.href).toContain("type=Daire");
  });
});

describe("buildActiveChips / hiddenFields / densityOf", () => {
  it("yalnız dolu filtreler için tek tek kaldırılabilir çip üretir", () => {
    const chips = buildActiveChips("/p", { q: "ev", status: "live", saglik: "", sayfa: "2" }, [
      { key: "q", label: "Arama" },
      { key: "status", label: "Durum", format: (v) => (v === "live" ? "Yayında" : v) },
      { key: "saglik", label: "Sağlık" },
    ]);
    expect(chips.map((c) => c.text)).toEqual(["Arama: ev", "Durum: Yayında"]);
    expect(chips[0]!.clearHref).toBe("/p?status=live");
  });
  it("gizli alanlar kendi anahtarlarını ve sayfalamayı taşımaz", () => {
    expect(hiddenFields({ q: "a", gorunum: "harita", sayfa: "2", status: "live" }, ["q", "status"])).toEqual([["gorunum", "harita"]]);
  });
  it("yoğunluk yalnız kompakt'ı tanır", () => {
    expect(densityOf("kompakt")).toBe("kompakt");
    expect(densityOf("x")).toBe("rahat");
    expect(densityOf(undefined)).toBe("rahat");
  });
});
