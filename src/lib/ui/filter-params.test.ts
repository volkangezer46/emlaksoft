import { describe, expect, it } from "vitest";
import {
  buildHref,
  countActiveFilters,
  formatCount,
  isRangeInvalid,
  mergeParams,
  toSearchParams,
} from "./filter-params";

describe("filter-params", () => {
  it("boş değerleri atar, dizileri korur", () => {
    expect(toSearchParams({ q: "", a: "1", t: ["x", "y"], z: undefined }).toString()).toBe(
      "a=1&t=x&t=y",
    );
  });
  it("merge: patch uygular, boşla siler, sayfayı sıfırlar", () => {
    const sp = mergeParams({ q: "ev", durum: "aktif", page: "3" }, { durum: "" });
    expect(sp.toString()).toBe("q=ev");
  });
  it("merge: açık page verilirse korunur; resetPage=false", () => {
    expect(mergeParams({ page: "2" }, { page: "5" }).get("page")).toBe("5");
    expect(mergeParams({ page: "2", q: "a" }, { q: "b" }, { resetPage: false }).get("page")).toBe("2");
  });
  it("buildHref", () => {
    expect(buildHref("/app/x", new URLSearchParams())).toBe("/app/x");
    expect(buildHref("/app/x", new URLSearchParams("a=1"))).toBe("/app/x?a=1");
  });
  it("countActiveFilters", () => {
    expect(countActiveFilters({ a: "1", b: "", c: ["", "x"], d: undefined }, ["a", "b", "c", "d"])).toBe(2);
  });
  it("formatCount ve aralık", () => {
    expect(formatCount(1234)).toBe("1.234");
    expect(isRangeInvalid("2026-02-01", "2026-01-01")).toBe(true);
    expect(isRangeInvalid("2026-01-01", "2026-01-01")).toBe(false);
    expect(isRangeInvalid("2026-01-01", undefined)).toBe(false);
  });
});
