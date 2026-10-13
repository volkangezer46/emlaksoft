import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { buildXlsx } from "./xlsx";
import type { ReportMeta, ReportTable } from "../types";

const meta: ReportMeta = {
  title: "Muhasebeci paketi",
  officeName: "Test Ofis",
  filterSummary: [],
  generatedAt: "13.10.2026 10:00",
  rowCount: 3,
  truncated: false,
  personalData: false,
  platform: false,
};

const table: ReportTable = {
  columns: [
    { key: "bolum", label: "Bölüm", type: "text" },
    { key: "aciklama", label: "Açıklama", type: "text" },
    { key: "tutar", label: "Tutar", type: "money" },
  ],
  rows: [
    ["Defter", "Kira", 1000],
    ["Cari", "Yılmaz", 250],
    ["Defter", "Elektrik", 300],
  ],
};

function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const xlen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString("utf8");
    const data = buf.subarray(off + 30 + nlen + xlen, off + 30 + nlen + xlen + csize);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    off += 30 + nlen + xlen + csize;
  }
  return files;
}

describe("XLSX çok sayfa (sheetBy)", () => {
  it("bölüm sütununa göre ayrı sayfalar; bölüm sütunu sayfada tekrarlanmaz", async () => {
    const buf = buildXlsx(meta, table, "2026-10-13T07:00:00Z", { sheetBy: "bolum" });
    const files = unzip(buf);
    expect(files.has("xl/worksheets/sheet1.xml")).toBe(true);
    expect(files.has("xl/worksheets/sheet2.xml")).toBe(true);
    expect(files.has("xl/worksheets/sheet3.xml")).toBe(false);
    const wb = files.get("xl/workbook.xml")!;
    expect(wb).toContain('<sheet name="Defter" sheetId="1" r:id="rId1"/>');
    expect(wb).toContain('<sheet name="Cari" sheetId="2" r:id="rId2"/>');
    expect(files.get("[Content_Types].xml")).toContain("/xl/worksheets/sheet2.xml");
    expect(files.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');

    const { readSheet } = await import("read-excel-file/node");
    const defter = (await readSheet(buf, 1)) as unknown[][];
    const header = defter.findIndex((r) => r[0] === "Açıklama");
    expect(header).toBeGreaterThan(0);
    expect(defter[header]!.slice(0, 2)).toEqual(["Açıklama", "Tutar"]);
    expect(defter[header + 1]!.slice(0, 2)).toEqual(["Kira", 1000]);
    expect(defter[header + 2]!.slice(0, 2)).toEqual(["Elektrik", 300]);
    const cari = (await readSheet(buf, 2)) as unknown[][];
    expect(cari.some((r) => r[0] === "Yılmaz" && r[1] === 250)).toBe(true);
  });

  it("sheetBy yoksa tek sayfa (eski davranış)", () => {
    const files = unzip(buildXlsx(meta, table, "2026-10-13T07:00:00Z"));
    expect(files.has("xl/worksheets/sheet2.xml")).toBe(false);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Muhasebeci paketi" sheetId="1" r:id="rId1"/>');
  });
});
