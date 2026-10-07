import { describe, expect, it } from "vitest";
import { cellToText, isLegacyXls, isXlsxFile, sheetToTable, tableToCsvText } from "./xlsx-import";

describe("xlsx içe aktarma dönüştürücüleri", () => {
  it("hücre metni: tarih TR biçimi, ondalık virgül, mantıksal Evet/Hayır, boş", () => {
    expect(cellToText(new Date(Date.UTC(2026, 8, 1)))).toBe("01.09.2026");
    expect(cellToText(new Date(Date.UTC(2026, 10, 15, 14, 30)))).toBe("15.11.2026 14:30");
    expect(cellToText(25000)).toBe("25000");
    expect(cellToText(12.5)).toBe("12,5");
    expect(cellToText(true)).toBe("Evet");
    expect(cellToText(null)).toBe("");
  });

  it("ilk satır başlık; tamamen boş satırlar atılır", () => {
    const t = sheetToTable([["Ad Soyad ", "Telefon"], [null, null], ["Ayşe", 5321234567]]);
    expect(t.headers).toEqual(["Ad Soyad", "Telefon"]);
    expect(t.rows).toEqual([["Ayşe", "5321234567"]]);
  });

  it("CSV metni tırnaklar; dosya türü tanıma", () => {
    expect(tableToCsvText({ headers: ["a", "b"], rows: [["x,y", 'z"']] })).toBe('a,b\n"x,y","z"""');
    expect(isXlsxFile({ name: "liste.XLSX" })).toBe(true);
    expect(isLegacyXls({ name: "eski.xls" })).toBe(true);
    expect(isXlsxFile({ name: "eski.xls" })).toBe(false);
  });
});
