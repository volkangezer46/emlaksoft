import { describe, expect, it } from "vitest";
import { escapeCsvCell } from "./csv";

describe("escapeCsvCell", () => {
  it.each([
    "=HYPERLINK(\"https://example.test\")",
    "+cmd|' /C calc'!A0",
    "-cmd|' /C calc'!A0",
    "@SUM(1,2)",
    "   =SUM(1,2)",
    "\tformula",
    "\rformula",
    "\nformula",
  ])("neutralizes spreadsheet formulas in user text: %s", (value) => {
    expect(escapeCsvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });

  it("keeps numeric negatives numeric and escapes embedded quotes", () => {
    expect(escapeCsvCell(-123.45)).toBe('"-123.45"');
    expect(escapeCsvCell('satır "iki"')).toBe('"satır ""iki"""');
  });

  it("PostgREST'in numeric kolonları için döndürdüğü STRING negatif tutarları da sayısal tutar", () => {
    // platform-export.ts gibi çağıranlar `amount_try` (numeric) kolonunu
    // PostgREST'ten JS string olarak alır — bu, gerçek `number` tipiyle
    // aynı davranmalı, formül-koruması tetiklenmemeli.
    expect(escapeCsvCell("-250.00")).toBe('"-250.00"');
    expect(escapeCsvCell("+1500")).toBe('"+1500"');
    expect(escapeCsvCell("1.234,56")).toBe('"1.234,56"');
  });

  it("harf içeren '-'/'+' ile başlayan formül girişimlerini hâlâ nötrler", () => {
    // Sayısal-görünüşlü istisna, harf içeren gerçek formül saldırılarını gevşetmemeli.
    expect(escapeCsvCell("-cmd|' /C calc'!A0")).toBe("\"'-cmd|' /C calc'!A0\"");
  });
});
