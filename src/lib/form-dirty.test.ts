import { describe, expect, it } from "vitest";
import { isDirty, serializeEntries } from "./form-dirty";

describe("form-dirty", () => {
  it("sıradan bağımsız aynı girdiler eşit serileşir", () => {
    const a = serializeEntries([["b", "2"], ["a", "1"]]);
    const b = serializeEntries([["a", "1"], ["b", "2"]]);
    expect(a).toBe(b);
  });
  it("dosya (string olmayan) girdileri yok sayılır", () => {
    expect(serializeEntries([["a", "1"], ["f", { name: "x" }]])).toBe(serializeEntries([["a", "1"]]));
  });
  it("aynı anahtarlı çoklu değerler korunur", () => {
    expect(serializeEntries([["t", "x"], ["t", "y"]])).not.toBe(serializeEntries([["t", "x"]]));
  });
  it("kirli yalnız başlangıç alındıktan sonra ve değer değiştiyse", () => {
    expect(isDirty(null, "[]")).toBe(false);
    expect(isDirty("[]", "[]")).toBe(false);
    expect(isDirty("[]", '[["a","1"]]')).toBe(true);
  });
});
