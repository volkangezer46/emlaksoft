import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildXlsx } from "@/lib/report-center/format/xlsx";
import type { ReportMeta, ReportTable } from "@/lib/report-center/types";
import { inspectXlsxZip, MAX_XLSX_ENTRIES, parseStatementFile } from "./file";

// readSheet casusu: gerçek okuyucuyu sarar; zip bombası reddinde HİÇ çağrılmadığını kanıtlar.
vi.mock("read-excel-file/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("read-excel-file/node")>();
  return { ...actual, readSheet: vi.fn(actual.readSheet) };
});

type FakeEntry = { name: string; comp: number; raw: number };

/** Yalnız merkezi dizin + EOCD içeren sentetik ZIP (beyan edilen boyutlar gerçek veri taşımaz; kütüphane hiçbir şey açmaz). */
function fakeZip(entries: readonly FakeEntry[]): Uint8Array {
  const cen: Buffer[] = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(e.comp, 20);
    h.writeUInt32LE(e.raw, 24);
    h.writeUInt16LE(name.length, 28);
    cen.push(h, name);
  }
  const cd = Buffer.concat(cen);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(0, 16);
  return new Uint8Array(Buffer.concat([cd, end]));
}

const GB = 1024 * 1024 * 1024;

describe("ekstre .xlsx zip merkezi dizin denetimi", () => {
  beforeEach(async () => {
    const { readSheet } = await import("read-excel-file/node");
    vi.mocked(readSheet).mockClear();
  });

  it("beyan edilen açılmış boyutu 1,9 GB olan zip reddedilir, readSheet çağrılmaz", async () => {
    const bytes = fakeZip([{ name: "xl/worksheets/sheet1.xml", comp: Math.floor(1.9 * GB) / 50, raw: Math.floor(1.9 * GB) }]);
    const res = await parseStatementFile("ekstre.xlsx", bytes);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("20 MB");
    const { readSheet } = await import("read-excel-file/node");
    expect(readSheet).not.toHaveBeenCalled();
  });

  it("51 girdili zip reddedilir, readSheet çağrılmaz", async () => {
    const entries = Array.from({ length: MAX_XLSX_ENTRIES + 1 }, (_, i) => ({ name: `xl/f${i}.xml`, comp: 100, raw: 200 }));
    const res = await parseStatementFile("ekstre.xlsx", fakeZip(entries));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("çok iç dosya");
    const { readSheet } = await import("read-excel-file/node");
    expect(readSheet).not.toHaveBeenCalled();
  });

  it("sıkıştırma oranı 1000:1 olan zip reddedilir, readSheet çağrılmaz", async () => {
    const res = await parseStatementFile("ekstre.xlsx", fakeZip([{ name: "xl/sharedStrings.xml", comp: 1000, raw: 1_000_000 }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("sıkıştırma oranı");
    const { readSheet } = await import("read-excel-file/node");
    expect(readSheet).not.toHaveBeenCalled();
  });

  it("sınır değerler: tam 50 girdi ve oran 100:1 geçer; 0 baytlık sıkıştırılmış gövde ve zip olmayan veri reddedilir", () => {
    const fifty = Array.from({ length: MAX_XLSX_ENTRIES }, (_, i) => ({ name: `f${i}`, comp: 10, raw: 1000 }));
    expect(inspectXlsxZip(fakeZip(fifty))).toBeNull();
    expect(inspectXlsxZip(fakeZip([{ name: "a", comp: 0, raw: 5 }]))).not.toBeNull();
    expect(inspectXlsxZip(new Uint8Array(100))).not.toBeNull();
    expect(inspectXlsxZip(new TextEncoder().encode("PK bozuk"))).not.toBeNull();
  });

  it("geçerli .xlsx ayrıştırılır", async () => {
    const meta: ReportMeta = {
      title: "Hesap Hareketleri",
      officeName: "Örnek Ofis",
      filterSummary: [],
      generatedAt: "08.10.2026 14:05",
      rowCount: 2,
      truncated: false,
      personalData: false,
      platform: false,
    };
    const table: ReportTable = {
      columns: [
        { key: "tarih", label: "Tarih", type: "text" },
        { key: "aciklama", label: "Açıklama", type: "text" },
        { key: "tutar", label: "Tutar", type: "number" },
      ],
      rows: [
        ["03.10.2026", "KIRA ODEMESI ORNEK", -25000],
        ["04.10.2026", "HAVALE GELEN ORNEK", 1500.5],
      ],
    };
    const buf = buildXlsx(meta, table, "2026-10-08T11:05:00Z");
    expect(inspectXlsxZip(new Uint8Array(buf))).toBeNull();
    const res = await parseStatementFile("ekstre.xlsx", new Uint8Array(buf));
    expect(res.ok).toBe(true);
    const { readSheet } = await import("read-excel-file/node");
    expect(readSheet).toHaveBeenCalledTimes(1);
  });
});
