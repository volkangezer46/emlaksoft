import { describe, expect, it } from "vitest";
import {
  centerScrollLeft,
  formatBadgeCount,
  parseStoredFlag,
  ringPercent,
  serializeFlag,
  statusBadge,
  tabDensity,
} from "./morph-tabs";
import { slideDirection, tabProgress } from "./form-tabs";

describe("tabDensity", () => {
  it("yatay: aktif full, pasif varsayılan icon, inactive=label -> label", () => {
    expect(tabDensity({ active: true, orientation: "horizontal" })).toBe("full");
    expect(tabDensity({ active: false, orientation: "horizontal" })).toBe("icon");
    expect(tabDensity({ active: false, orientation: "horizontal", inactive: "label" })).toBe("label");
  });
  it("dikey açık ray: aktif full, pasif label", () => {
    expect(tabDensity({ active: true, orientation: "vertical" })).toBe("full");
    expect(tabDensity({ active: false, orientation: "vertical" })).toBe("label");
  });
  it("dikey daralmış ray: hepsi icon; peek ile geri açılır", () => {
    expect(tabDensity({ active: true, orientation: "vertical", railCollapsed: true })).toBe("icon");
    expect(tabDensity({ active: false, orientation: "vertical", railCollapsed: true })).toBe("icon");
    expect(tabDensity({ active: true, orientation: "vertical", railCollapsed: true, peek: true })).toBe("full");
    expect(tabDensity({ active: false, orientation: "vertical", railCollapsed: true, peek: true })).toBe("label");
  });
});

describe("rozet ve yardımcılar", () => {
  it("statusBadge önceliği: hata > eksik > tamam", () => {
    expect(statusBadge("missing", 2, 1)).toMatchObject({ kind: "error", text: "2", label: "2 hatalı alan" });
    expect(statusBadge("missing", 0, 3)).toMatchObject({ kind: "missing", label: "3 zorunlu alan eksik" });
    expect(statusBadge("complete", 0).kind).toBe("complete");
    expect(statusBadge("empty", 0).kind).toBe("none");
    expect(statusBadge(undefined, 0).kind).toBe("none");
  });
  it("formatBadgeCount 99+ ve güvenli girdi", () => {
    expect(formatBadgeCount(7)).toBe("7");
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(-1)).toBe("0");
    expect(formatBadgeCount(Number.NaN)).toBe("0");
  });
  it("ringPercent kenarları", () => {
    expect(ringPercent(0.5)).toBe(50);
    expect(ringPercent(2)).toBe(100);
    expect(ringPercent(-1)).toBe(0);
    expect(ringPercent(null)).toBe(0);
  });
  it("tercih serileştirme", () => {
    expect(parseStoredFlag("1", false)).toBe(true);
    expect(parseStoredFlag("0", true)).toBe(false);
    expect(parseStoredFlag(null, true)).toBe(true);
    expect(parseStoredFlag("x", false)).toBe(false);
    expect(serializeFlag(true)).toBe("1");
    expect(serializeFlag(false)).toBe("0");
  });
  it("centerScrollLeft negatif olmaz", () => {
    expect(centerScrollLeft(0, 100, 300)).toBe(0);
    expect(centerScrollLeft(400, 100, 300)).toBe(300);
  });
});

describe("tabProgress / slideDirection", () => {
  const t = { fields: ["a", "b", "c"], required: ["a", "b"] };
  it("zorunlu varsa dolu zorunlu oranı", () => {
    expect(tabProgress(t, {})).toBe(0);
    expect(tabProgress(t, { a: "x" })).toBe(0.5);
    expect(tabProgress(t, { a: "x", b: " y " })).toBe(1);
    expect(tabProgress(t, { a: " ", b: "" })).toBe(0);
  });
  it("zorunlusuz sekmede en az bir alan -> 1; alansız -> 0", () => {
    expect(tabProgress({ fields: ["n"], required: [] }, { n: "v" })).toBe(1);
    expect(tabProgress({ fields: ["n"] }, {})).toBe(0);
    expect(tabProgress({ fields: [], required: [] }, {})).toBe(0);
  });
  it("slideDirection ileri/geri/yok", () => {
    const ids = ["a", "b", "c"];
    expect(slideDirection(ids, "a", "c")).toBe("next");
    expect(slideDirection(ids, "c", "b")).toBe("prev");
    expect(slideDirection(ids, "b", "b")).toBe("none");
    expect(slideDirection(ids, "x", "b")).toBe("none");
  });
});
