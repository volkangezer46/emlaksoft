import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCsv, CSV_BOM } from "./csv";
import { buildPdf, pdfSafeText } from "./pdf";
import { buildXlsx } from "./xlsx";
import { createZip, crc32 } from "./zip";
import { computeTotals, displayValue, excelSerial, formatDateTimeTr, formatDateTr, formatNumberTr, safeFileSlug } from "../values";
import type { ReportMeta, ReportTable } from "../types";

const meta: ReportMeta = {
  title: "Müşteri Listesi",
  officeName: "Çağdaş Gayrimenkul İşletmeleri",
  filterSummary: [{ label: "Tür", value: "Alıcı" }],
  generatedAt: "08.10.2026 14:05",
  rowCount: 3,
  truncated: false,
  personalData: true,
  platform: false,
};

const table: ReportTable = {
  columns: [
    { key: "ad", label: "Ad Soyad", type: "text" },
    { key: "tutar", label: "Tutar", type: "money", total: true },
    { key: "kayit", label: "Kayıt Tarihi", type: "date" },
    { key: "zaman", label: "Son İşlem", type: "datetime" },
    { key: "oran", label: "Oran", type: "percent" },
    { key: "adet", label: "Adet", type: "number", total: true },
    { key: "aktif", label: "Aktif", type: "bool" },
  ],
  rows: [
    ["Şükrü Işık Öztürk", 1234567.5, "2026-03-05", "2026-10-07T21:30:00+00:00", 42.5, 3, true],
    ["=HYPERLINK(\"http://kotu\")", "-250.00", "2026-12-31", null, null, 2, false],
    ["Ğüzel İpek, çiçek; \"tırnak\"", 0, null, "2026-01-01T00:00:00Z", 100, null, null],
  ],
};

describe("değer biçimleri", () => {
  it("tr-TR sayı ve tarih", () => {
    expect(formatNumberTr(1234567.891, 2)).toBe("1.234.567,89");
    expect(formatNumberTr(-0.004, 2)).toBe("0,00");
    expect(formatNumberTr(-1500, 0)).toBe("-1.500");
    expect(formatDateTr("2026-03-05")).toBe("05.03.2026");
    // 21:30 UTC = ertesi gün 00:30 TR
    expect(formatDateTimeTr("2026-10-07T21:30:00+00:00")).toBe("08.10.2026 00:30");
    expect(displayValue("1234.5", { type: "money" })).toBe("1.234,50");
    expect(displayValue(42.5, { type: "percent" })).toBe("%42,5");
    expect(displayValue(true, { type: "bool" })).toBe("Evet");
    expect(displayValue(null, { type: "money" })).toBe("");
  });

  it("Excel seri günü ve toplamlar", () => {
    expect(excelSerial("2026-03-05", false)).toBe(46086);
    expect(excelSerial("2026-10-07T21:30:00+00:00", true)).toBeCloseTo(46303 + 30 / 1440, 5);
    expect(computeTotals(table.columns, table.rows)).toEqual([null, 1234317.5, null, null, null, 5, null]);
  });

  it("dosya adı Türkçe karakterleri sadeleştirir", () => {
    expect(safeFileSlug("Müşteri Listesi — Şubat")).toBe("musteri-listesi-subat");
  });
});

describe("ZIP", () => {
  it("crc32 bilinen değer", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("geçerli imzalar", () => {
    const zip = createZip([{ name: "a.txt", data: new TextEncoder().encode("merhaba".repeat(50)) }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });
});

describe("CSV", () => {
  const csv = buildCsv(meta, table);
  it("BOM, noktalı virgül, ondalık virgül, Türkçe karakter", () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe('"Ad Soyad";"Tutar";"Kayıt Tarihi";"Son İşlem";"Oran";"Adet";"Aktif"');
    expect(lines[1]).toBe('"Şükrü Işık Öztürk";"1.234.567,50";"05.03.2026";"08.10.2026 00:30";"%42,5";"3";"Evet"');
  });
  it("formül enjeksiyonu ve tırnak kaçışı", () => {
    const lines = buildCsv(meta, table).slice(1).split("\r\n");
    expect(lines[2]!.startsWith('"\'=HYPERLINK')).toBe(true);
    expect(lines[3]).toContain('"Ğüzel İpek, çiçek; ""tırnak"""');
  });
  it("kesilme uyarısı", () => {
    expect(buildCsv({ truncated: true }, table)).toContain("UYARI");
  });
});

describe("XLSX", () => {
  it("geçerli paket: üst bilgi, dondurulmuş başlık, filtre, hücre biçimleri", async () => {
    const buf = buildXlsx(meta, table, "2026-10-08T11:05:00Z");
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const { readSheet } = await import("read-excel-file/node");
    const rows = (await readSheet(buf)) as unknown[][];
    const flat = rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c)));
    expect(String(flat[0]![0])).toBe("Müşteri Listesi");
    expect(String(flat[1]![0])).toContain("Çağdaş Gayrimenkul İşletmeleri");
    expect(String(flat[2]![0])).toContain("Tür: Alıcı");
    const header = flat.findIndex((r) => r[0] === "Ad Soyad");
    expect(header).toBeGreaterThan(2);
    expect(flat[header]!.slice(0, 3)).toEqual(["Ad Soyad", "Tutar", "Kayıt Tarihi"]);
    const first = flat[header + 1]!;
    expect(first[0]).toBe("Şükrü Işık Öztürk");
    expect(first[1]).toBe(1234567.5);
    expect(first[2]).toBe("2026-03-05");
    // formül gibi görünen metin hücrede METİN olarak kalır
    expect(flat[header + 2]![0]).toBe('=HYPERLINK("http://kotu")');
    expect(flat[header + 2]![1]).toBe(-250);
    // toplam satırı
    const totalRow = flat[flat.length - 1]!;
    expect(totalRow[0]).toBe("TOPLAM");
    expect(totalRow[1]).toBe(1234317.5);
  });

  it("OOXML parçaları: dondurma ve otomatik süzgeç tanımlı", async () => {
    const buf = buildXlsx(meta, table, "2026-10-08T11:05:00Z");
    const { inflateRawSync } = await import("node:zlib");
    // basit çıkarıcı: yerel başlıkları gez
    const files = new Map<string, string>();
    let off = 0;
    while (buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8);
      const csize = buf.readUInt32LE(off + 18);
      const nlen = buf.readUInt16LE(off + 26);
      const name = buf.subarray(off + 30, off + 30 + nlen).toString("utf8");
      const data = buf.subarray(off + 30 + nlen, off + 30 + nlen + csize);
      files.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
      off += 30 + nlen + csize;
    }
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toMatch(/<autoFilter ref="A\d+:G\d+"\/>/);
    expect(sheet).toContain("<cols>");
    const styles = files.get("xl/styles.xml")!;
    expect(styles).toContain("dd.mm.yyyy hh:mm");
    expect(styles).toContain("#,##0.00&quot; ₺&quot;");
    expect(files.get("xl/sharedStrings.xml")).toContain("Çağdaş Gayrimenkul İşletmeleri");
  });
});

describe("PDF", () => {
  it("Türkçe karakterli, çok sayfalı ve sayfa numaralı PDF üretir", async () => {
    const rows = Array.from({ length: 140 }, (_, i) => [
      `Müşteri ${i + 1} Şükrü İğdır Çiğdem ${"uzun açıklama ".repeat(i % 7)}`,
      i * 1000.25,
      "2026-03-05",
      "2026-10-07T21:30:00+00:00",
      i % 100,
      i,
      i % 2 === 0,
    ]);
    const bytes = await buildPdf({ ...meta, rowCount: rows.length }, { columns: table.columns, rows }, "2026-10-08T11:05:00Z");
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(2);
    // 7 dar sütun: dikey
    expect(doc.getPage(0).getHeight()).toBeGreaterThan(doc.getPage(0).getWidth());
    expect(doc.getTitle()).toBe("Müşteri Listesi");
  });

  it("çok sütunlu rapor yatay A4 olur", async () => {
    const cols = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, label: `Sütun ${i + 1}`, type: "text" as const }));
    const bytes = await buildPdf(meta, { columns: cols, rows: [cols.map((_, i) => `Değer ${i}`)] }, "2026-10-08T11:05:00Z");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
  });

  it("az sütunlu rapor dikey, boş rapor da geçerli", async () => {
    const narrow: ReportTable = { columns: [{ key: "a", label: "Ad", type: "text" }, { key: "b", label: "Adet", type: "number" }], rows: [] };
    const bytes = await buildPdf({ ...meta, rowCount: 0 }, narrow, "2026-10-08T11:05:00Z");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getHeight()).toBeGreaterThan(doc.getPage(0).getWidth());
  });

  it("yazı tipinde olmayan karakter güvenli karşılığa çevrilir (₺ → TL)", () => {
    const has = (cp: number) => cp < 0x250;
    expect(pdfSafeText("12 ₺ 😀 ğ\n", has)).toBe("12 TL ? ğ ");
  });
});
