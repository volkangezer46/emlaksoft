import { describe, expect, it } from "vitest";
import { diffJson, moreLabel, previewValue } from "./diff";

describe("diffJson", () => {
  it.each([
    ["aynı nesne", { a: 1, b: { c: "x" } }, { b: { c: "x" }, a: 1 }, []],
    ["alan değişti", { hero: { title: "Eski" } }, { hero: { title: "Yeni" } }, [{ path: "hero.title", kind: "changed", before: "Eski", after: "Yeni" }]],
    ["alan eklendi", { hero: {} }, { hero: { title: "Yeni" } }, [{ path: "hero.title", kind: "added", before: undefined, after: "Yeni" }]],
    ["alan silindi", { hero: { title: "Eski", sub: "x" } }, { hero: { title: "Eski" } }, [{ path: "hero.sub", kind: "removed", before: "x", after: undefined }]],
    ["indeksle dizi", { tags: ["a", "b"] }, { tags: ["a", "c", "d"] }, [
      { path: "tags[1]", kind: "changed", before: "b", after: "c" },
      { path: "tags[2]", kind: "added", before: undefined, after: "d" },
    ]],
    ["null -> değer eklendi sayılır", { a: null }, { a: "x" }, [{ path: "a", kind: "added", before: null, after: "x" }]],
    ["tür değişti", { a: 1 }, { a: "1" }, [{ path: "a", kind: "changed", before: 1, after: "1" }]],
  ] as const)("%s", (_name, a, b, rows) => {
    expect(diffJson(a, b).rows).toEqual(rows);
  });

  it("id taşıyan dizi öğeleri id ile eşlenir (araya ekleme kaydırma üretmez)", () => {
    const a = { groups: [{ id: "g1", label: "Ürün" }, { id: "g2", label: "Fiyat" }] };
    const b = { groups: [{ id: "g0", label: "Yeni" }, { id: "g1", label: "Ürün" }, { id: "g2", label: "Fiyatlar" }] };
    expect(diffJson(a, b).rows).toEqual([
      { path: "groups[g2].label", kind: "changed", before: "Fiyat", after: "Fiyatlar" },
      { path: "groups[g0]", kind: "added", before: undefined, after: { id: "g0", label: "Yeni" } },
    ]);
  });

  it("id ile eşlenen dizide silme ve yalnız sıra değişimi", () => {
    const a = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    expect(diffJson(a, { items: [{ id: 1 }, { id: 3 }] }).rows).toEqual([{ path: "items[2]", kind: "removed", before: { id: 2 }, after: undefined }]);
    expect(diffJson(a, { items: [{ id: 3 }, { id: 1 }, { id: 2 }] }).rows).toEqual([
      { path: "items (sıra)", kind: "changed", before: [1, 2, 3], after: [3, 1, 2] },
    ]);
  });

  it("en çok 200 satır; fazlası özetlenir", () => {
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};
    for (let i = 0; i < 250; i += 1) {
      a[`k${i}`] = i;
      b[`k${i}`] = i + 1;
    }
    const d = diffJson(a, b);
    expect(d.rows).toHaveLength(200);
    expect(d.total).toBe(250);
    expect(d.more).toBe(50);
    expect(moreLabel(d.more)).toBe("ve 50 değişiklik daha");
    expect(moreLabel(0)).toBe("");
  });

  it("kök değer değişimi ve önizleme kırpma", () => {
    expect(diffJson("a", "b").rows).toEqual([{ path: "(tümü)", kind: "changed", before: "a", after: "b" }]);
    expect(previewValue(undefined)).toBe("—");
    expect(previewValue(null)).toBe("(boş)");
    expect(previewValue({ a: 1 })).toBe('{"a":1}');
    expect(previewValue("x".repeat(500)).length).toBe(240);
  });
});
