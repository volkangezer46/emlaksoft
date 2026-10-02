import { describe, expect, it } from "vitest";
import {
  ariaSortFor,
  checkState,
  DENSITY_META,
  isDensity,
  nextRowIndex,
  nextSort,
  normalizeText,
  parseStoredDensity,
  parseStoredHidden,
  pruneSelection,
  selectionLabel,
  splitByPriority,
} from "./data-table-logic";

describe("yoğunluk", () => {
  it("satır yükseklikleri 44 / 40 / 32 px", () => {
    expect(DENSITY_META.comfortable.height).toBe(44);
    expect(DENSITY_META.normal.height).toBe(40);
    expect(DENSITY_META.compact.height).toBe(32);
  });
  it("geçersiz kayıtlı değerde varsayılana düşer", () => {
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("x")).toBe(false);
    expect(parseStoredDensity("compact", "normal")).toBe("compact");
    expect(parseStoredDensity("bozuk", "normal")).toBe("normal");
    expect(parseStoredDensity(null, "comfortable")).toBe("comfortable");
  });
  it("gizli sütun listesi bozuksa boş döner", () => {
    expect(parseStoredHidden('["a","b"]')).toEqual(["a", "b"]);
    expect(parseStoredHidden("{")).toEqual([]);
    expect(parseStoredHidden('{"a":1}')).toEqual([]);
    expect(parseStoredHidden('["a",1]')).toEqual(["a"]);
    expect(parseStoredHidden(null)).toEqual([]);
  });
});

describe("arama ve sıralama", () => {
  it("Türkçe karakterleri sadeleştirir", () => {
    expect(normalizeText("Şişli")).toBe(normalizeText("sisli"));
    expect(normalizeText("IŞIK")).toBe("isik");
  });
  it("aria-sort yalnız aktif başlıkta", () => {
    expect(ariaSortFor(false, "asc")).toBeUndefined();
    expect(ariaSortFor(true, "asc")).toBe("ascending");
    expect(ariaSortFor(true, "desc")).toBe("descending");
  });
  it("aynı sütunda yön çevirir, yeni sütunda artan başlar", () => {
    expect(nextSort({ key: "a", dir: "asc" }, "a")).toEqual({ key: "a", dir: "desc" });
    expect(nextSort({ key: "a", dir: "desc" }, "a")).toEqual({ key: "a", dir: "asc" });
    expect(nextSort({ key: "a", dir: "desc" }, "b")).toEqual({ key: "b", dir: "asc" });
  });
});

describe("klavye gezinme", () => {
  it("j/k ve oklar sınırda durur", () => {
    expect(nextRowIndex(-1, "j", 5)).toBe(0);
    expect(nextRowIndex(0, "ArrowDown", 5)).toBe(1);
    expect(nextRowIndex(4, "j", 5)).toBe(4);
    expect(nextRowIndex(0, "k", 5)).toBe(0);
    expect(nextRowIndex(3, "ArrowUp", 5)).toBe(2);
  });
  it("Home/End/PageDown", () => {
    expect(nextRowIndex(2, "Home", 30)).toBe(0);
    expect(nextRowIndex(2, "End", 30)).toBe(29);
    expect(nextRowIndex(2, "PageDown", 30)).toBe(12);
    expect(nextRowIndex(25, "PageDown", 30)).toBe(29);
    expect(nextRowIndex(5, "PageUp", 30)).toBe(0);
  });
  it("boş listede ve tanımsız tuşta null", () => {
    expect(nextRowIndex(0, "j", 0)).toBeNull();
    expect(nextRowIndex(0, "x", 5)).toBeNull();
  });
});

describe("seçim", () => {
  it("görünmeyen id'leri budar, değişmediyse aynı kümeyi döndürür", () => {
    const sel = new Set(["a", "b"]);
    expect(pruneSelection(sel, new Set(["a"]))).toEqual(new Set(["a"]));
    expect(pruneSelection(sel, new Set(["a", "b", "c"]))).toBe(sel);
  });
  it("başlık onay kutusu durumu", () => {
    expect(checkState(0, 5)).toBe("none");
    expect(checkState(2, 5)).toBe("some");
    expect(checkState(5, 5)).toBe("all");
    expect(checkState(0, 0)).toBe("none");
  });
  it("etiket", () => {
    expect(selectionLabel(3)).toBe("3 kayıt seçili");
  });
});

describe("mobil kart önceliği", () => {
  it("öncelik verilmezse ilk sütun başlık, kalanı ikincil", () => {
    const r = splitByPriority<{ key: string; priority?: "primary" | "secondary" | "hidden" }>([{ key: "a" }, { key: "b" }, { key: "c" }]);
    expect(r.primary.map((c) => c.key)).toEqual(["a"]);
    expect(r.secondary.map((c) => c.key)).toEqual(["b", "c"]);
  });
  it("açık priority kuralları: primary seçilir, hidden atılır", () => {
    const r = splitByPriority([
      { key: "a", priority: "secondary" as const },
      { key: "b", priority: "primary" as const },
      { key: "c", priority: "hidden" as const },
    ]);
    expect(r.primary.map((c) => c.key)).toEqual(["b"]);
    expect(r.secondary.map((c) => c.key)).toEqual(["a"]);
  });
});
