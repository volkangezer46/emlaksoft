import { describe, expect, it } from "vitest";
import { getAppActions, getAppGoItems, matchesQuery, mergeRecent, parseRecents } from "./palette-core";

describe("palette-core", () => {
  it("Türkçe duyarlı süzgeç", () => {
    expect(matchesQuery("Işık Raporu", "ışık")).toBe(true);
    expect(matchesQuery("İlan", "ilan")).toBe(true);
    expect(matchesQuery("Müşteriler", "")).toBe(true);
    expect(matchesQuery("Müşteriler", "xyz")).toBe(false);
  });

  it("Git yalnız yetkili modüllerin sayfalarını verir", () => {
    const items = getAppGoItems(["customers"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.href === "/app/musteriler")).toBe(true);
    expect(items.some((i) => i.href === "/app/portfoyler")).toBe(false);
    expect(getAppGoItems([])).toEqual([]);
  });

  it("Eylemler yetkiye göre süzülür", () => {
    expect(getAppActions(["tasks"]).map((a) => a.href)).toEqual(["/app/gorevler?yeni=1"]);
    expect(getAppActions(["customers", "tasks"], "müşteri").map((a) => a.label)).toEqual(["Yeni müşteri"]);
    expect(getAppActions([])).toEqual([]);
  });

  it("son görülenler: bozuk veri güvenli, tekrar yok, en fazla 8", () => {
    expect(parseRecents("{bozuk")).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
    let list = parseRecents(null);
    for (let i = 0; i < 12; i++) list = mergeRecent(list, { label: `s${i}`, href: `/a/${i}`, kind: "page" });
    list = mergeRecent(list, { label: "tekrar", href: "/a/10", kind: "page" });
    expect(list).toHaveLength(8);
    expect(list[0]!.label).toBe("tekrar");
    expect(list.filter((r) => r.href === "/a/10")).toHaveLength(1);
  });
});
