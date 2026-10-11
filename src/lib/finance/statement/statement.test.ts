import { describe, expect, it } from "vitest";
import { parseStatementFile, sha256Hex, toStagePayload } from "./file";
import { buildDecision, guessCategory, isoFromDayNumber, shiftIso, suggestAll, dayNumber, type MatchContext } from "./match";
import { parseOfx } from "./ofx";
import {
  applyColumnMapping,
  csvTextToTable,
  guessColumnMapping,
  isCompleteMapping,
  lineKeys,
  mappingFits,
  parseStatementDate,
  parseStatementNumber,
  tableFromRawRows,
  type ColumnMapping,
} from "./parse";

// Örnek dosyalar tamamen uydurmadır (gerçek müşteri/hesap verisi yok); yalnız yaygın sütun düzenlerini taklit eder.
const ISBANK_LIKE = [
  "Hesap Hareketleri",
  "Hesap No;TR00 0000 0000 0000 0000 0000 00",
  "",
  "Tarih;Saat;Açıklama;Tutar;Bakiye",
  "03.10.2026;10:15;KIRA ODEMESI ORNEK APT;-25.000,00;75.000,00",
  "04.10.2026;11:00;HAVALE GELEN ORNEK;1.500,50;76.500,50",
  "04.10.2026;11:00;HAVALE GELEN ORNEK;1.500,50;78.001,00",
  "",
].join("\n");

const GARANTI_LIKE = ["Tarih;Açıklama;Etiket;Tutar;Bakiye", "05/10/2026;ELEKTRIK FATURASI;Fatura;-312,40;1.000,00", "06/10/2026;EFT GELEN;;2500,00;3.500,00"].join("\r\n");

const ZIRAAT_LIKE = [
  "İşlem Tarihi;Valör;Açıklama;Borç;Alacak;Bakiye",
  "07.10.2026;07.10.2026;SGK PRIM ODEMESI;8.400,00;;12.000,00",
  "08.10.2026;08.10.2026;KOMISYON TAHSILATI;;45.000,00;57.000,00",
].join("\n");

describe("sayı ve tarih ayrıştırma", () => {
  it("Türk ve İngiliz biçimli tutarları okur", () => {
    expect(parseStatementNumber("1.234,56")).toBe(1234.56);
    expect(parseStatementNumber("-1.234,56")).toBe(-1234.56);
    expect(parseStatementNumber("(250,00)")).toBe(-250);
    expect(parseStatementNumber("+500,00")).toBe(500);
    expect(parseStatementNumber("1,234.56")).toBe(1234.56);
    expect(parseStatementNumber("1234.5")).toBe(1234.5);
    expect(parseStatementNumber("12.500")).toBe(12500);
    expect(parseStatementNumber("0.500")).toBe(0.5);
    expect(parseStatementNumber("1.234,56 TL")).toBe(1234.56);
    expect(parseStatementNumber("500,00-")).toBe(-500);
    expect(parseStatementNumber("")).toBeNull();
    expect(parseStatementNumber("abc")).toBeNull();
    expect(parseStatementNumber("1,2,3")).toBeNull();
  });

  it("tarih biçimlerini ve geçersiz tarihi ayırır", () => {
    expect(parseStatementDate("03.10.2026")).toBe("2026-10-03");
    expect(parseStatementDate("3/10/2026 14:30")).toBe("2026-10-03");
    expect(parseStatementDate("03-10-26")).toBe("2026-10-03");
    expect(parseStatementDate("2026-10-03T10:00:00")).toBe("2026-10-03");
    expect(parseStatementDate("20261003120000[3:TRT]")).toBe("2026-10-03");
    expect(parseStatementDate("31.02.2026")).toBeNull();
    expect(parseStatementDate("Toplam")).toBeNull();
  });
});

describe("CSV: banka düzenleri", () => {
  it("İş Bankası benzeri: başlık öncesi satırlar atılır, tek imzalı tutar", () => {
    const table = csvTextToTable(ISBANK_LIKE);
    expect(table.headers).toEqual(["Tarih", "Saat", "Açıklama", "Tutar", "Bakiye"]);
    const map = guessColumnMapping(table.headers);
    expect(map).toEqual({ date: 0, amount: 3, balance: 4, description: 2 });
    expect(isCompleteMapping(map)).toBe(true);
    const res = applyColumnMapping(table, map as ColumnMapping);
    expect(res.lines).toHaveLength(3);
    expect(res.lines[0]).toMatchObject({ date: "2026-10-03", dir: "out", amount: 25000, description: "KIRA ODEMESI ORNEK APT", balance: 75000 });
    expect(res.lines[1]).toMatchObject({ dir: "in", amount: 1500.5 });
  });

  it("Garanti benzeri: CRLF, GG/AA/YYYY, etiket sütunu açıklama sayılmaz", () => {
    const table = csvTextToTable(GARANTI_LIKE);
    const map = guessColumnMapping(table.headers) as ColumnMapping;
    expect(map).toMatchObject({ date: 0, description: 1, amount: 3, balance: 4 });
    const res = applyColumnMapping(table, map);
    expect(res.lines.map((l) => [l.date, l.dir, l.amount])).toEqual([["2026-10-05", "out", 312.4], ["2026-10-06", "in", 2500]]);
  });

  it("Ziraat benzeri: Borç / Alacak ayrı sütunlar, valör tarih sütunu seçilmez", () => {
    const table = csvTextToTable(ZIRAAT_LIKE);
    const map = guessColumnMapping(table.headers) as ColumnMapping;
    expect(map).toMatchObject({ date: 0, description: 2, debit: 3, credit: 4, balance: 5 });
    expect(map.amount).toBeUndefined();
    const res = applyColumnMapping(table, map);
    expect(res.lines.map((l) => [l.dir, l.amount])).toEqual([["out", 8400], ["in", 45000]]);
  });

  it("okunamayan satır geçersiz sayılır; sıfır tutar atlanır; eşleme genişliğe sığmazsa reddedilir", () => {
    const table = { headers: ["Tarih", "Açıklama", "Tutar"], rows: [["01.10.2026", "A", "10,00"], ["Toplam", "", "10,00"], ["02.10.2026", "B", "0,00"], ["03.10.2026", "C", "abc"]] };
    const res = applyColumnMapping(table, { date: 0, description: 1, amount: 2 });
    expect(res.lines).toHaveLength(1);
    expect(res.invalid).toBe(2);
    expect(mappingFits({ date: 0, description: 1, amount: 5 }, 3)).toBe(false);
    expect(mappingFits({ date: 0, description: 1, amount: 2 }, 3)).toBe(true);
  });

  it("Excel ham satırları: başlık öncesi satırlar atılır", () => {
    const table = tableFromRawRows([["Ekstre"], ["", ""], ["Tarih", "Açıklama", "Tutar"], ["03.10.2026", "Deneme", "-10,5"]]);
    expect(table.headers).toEqual(["Tarih", "Açıklama", "Tutar"]);
    expect(table.rows).toEqual([["03.10.2026", "Deneme", "-10,5"]]);
  });
});

describe("OFX", () => {
  const SGML = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20261003120000\n<TRNAMT>-25000.00\n<FITID>A1\n<NAME>KIRA\n<MEMO>OCAK KIRASI\n</STMTTRN>
<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20261004\n<TRNAMT>1500.50\n<FITID>A2\n<NAME>HAVALE\n</STMTTRN>
<STMTTRN>\n<DTPOSTED>bozuk\n<TRNAMT>1\n</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("SGML biçimini okur; FITID satır anahtarına girer", () => {
    const res = parseOfx(SGML);
    expect(res.lines).toHaveLength(2);
    expect(res.invalid).toBe(1);
    expect(res.lines[0]).toMatchObject({ date: "2026-10-03", dir: "out", amount: 25000, description: "KIRA - OCAK KIRASI", ref: "A1" });
    expect(res.lines[1]).toMatchObject({ dir: "in", amount: 1500.5 });
  });
});

describe("satır anahtarı ve karma (idempotans)", () => {
  it("aynı içerikli satırlar dosya içinde sırayla ayrışır; aynı dosya aynı karmaları üretir", () => {
    const table = csvTextToTable(ISBANK_LIKE);
    const lines = applyColumnMapping(table, guessColumnMapping(table.headers) as ColumnMapping).lines;
    const keys = lineKeys(lines);
    expect(new Set(keys).size).toBe(keys.length);
    const again = toStagePayload(lines).map((p) => p.h);
    expect(toStagePayload(lines).map((p) => p.h)).toEqual(again);
    expect(new Set(again).size).toBe(again.length);
    expect(again[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("satır karması tarih/tutar/açıklama değişince değişir", () => {
    const base = { date: "2026-10-03", dir: "out" as const, amount: 10, description: "A", balance: null };
    const [a] = toStagePayload([base]);
    expect(toStagePayload([{ ...base, amount: 11 }])[0]!.h).not.toBe(a!.h);
    expect(toStagePayload([{ ...base, date: "2026-10-04" }])[0]!.h).not.toBe(a!.h);
  });
});

describe("sunucu dosya ayrıştırıcı", () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it("CSV'yi okur, aynı baytlar aynı dosya karmasını verir", async () => {
    const a = await parseStatementFile("ekstre.csv", enc(ISBANK_LIKE));
    const b = await parseStatementFile("baska-ad.csv", enc(ISBANK_LIKE));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.fileHash).toBe(b.fileHash);
    expect(a.ok && a.fileHash).toBe(sha256Hex(enc(ISBANK_LIKE)));
  });

  it("OFX uzantısı ve içeriği tanınır; boyut ve tür sınırları uygulanır", async () => {
    const ofx = await parseStatementFile("hareket.ofx", enc("<OFX><STMTTRN><DTPOSTED>20261003<TRNAMT>-5.00<NAME>X</STMTTRN></OFX>"));
    expect(ofx.ok && ofx.format).toBe("ofx");
    expect(await parseStatementFile("a.csv", new Uint8Array(0))).toMatchObject({ ok: false });
    expect(await parseStatementFile("a.csv", new Uint8Array(2 * 1024 * 1024 + 1))).toMatchObject({ ok: false });
    expect(await parseStatementFile("a.xls", enc("x"))).toMatchObject({ ok: false });
    expect(await parseStatementFile("a.exe", enc("x"))).toMatchObject({ ok: false });
  });

  it("bozuk xlsx Türkçe hata verir", async () => {
    const res = await parseStatementFile("a.xlsx", enc("PK bozuk"));
    expect(res).toMatchObject({ ok: false });
  });
});

describe("eşleştirme önerileri", () => {
  const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ entries: [], collections: [], rules: [], canSalary: true, ...over });
  const L = (id: string, date: string, dir: "in" | "out", amount: number, description = "") => ({ id, date, dir, amount, description });

  it("tarih aralığı (±3 gün) ve tutar kuralı: zaten kayıtlı", () => {
    const entries = [{ id: "e1", date: "2026-10-05", dir: "out" as const, amount: 300, title: "Elektrik", counterparty: null }];
    const hit = suggestAll([L("a", "2026-10-07", "out", 300, "ELEKTRIK FATURASI")], ctx({ entries })).get("a")!;
    expect(hit).toMatchObject({ kind: "existing", entryId: "e1" });
    expect(suggestAll([L("a", "2026-10-09", "out", 300)], ctx({ entries })).get("a")!.kind).not.toBe("existing");
    expect(suggestAll([L("a", "2026-10-05", "out", 300.01)], ctx({ entries })).get("a")!.kind).not.toBe("existing");
    expect(suggestAll([L("a", "2026-10-05", "in", 300)], ctx({ entries })).get("a")!.kind).not.toBe("existing");
  });

  it("her hareket en çok bir satırla eşleşir; açıklama benzerliği doğru çifti seçer", () => {
    const entries = [
      { id: "e1", date: "2026-10-05", dir: "out" as const, amount: 100, title: "Kırtasiye alışverişi", counterparty: null },
      { id: "e2", date: "2026-10-05", dir: "out" as const, amount: 100, title: "Temizlik malzemesi", counterparty: null },
    ];
    const res = suggestAll([L("a", "2026-10-05", "out", 100, "TEMIZLIK MALZEMESI"), L("b", "2026-10-05", "out", 100, "KIRTASIYE ALISVERISI"), L("c", "2026-10-05", "out", 100, "BASKA")], ctx({ entries }));
    expect(res.get("a")).toMatchObject({ kind: "existing", entryId: "e2" });
    expect(res.get("b")).toMatchObject({ kind: "existing", entryId: "e1" });
    expect(res.get("c")!.kind).not.toBe("existing");
  });

  it("tahsilat eşleşmesi: kira makbuzu tutar+tarih, komisyon yalnız tutar", () => {
    const collections = [
      { source: "rent" as const, id: "r1", date: "2026-10-05", amounts: [4500], label: "Kira tahsilatı (makbuz 7)" },
      { source: "commission" as const, id: "c1", date: null, amounts: [45000, 53100], label: "Komisyon tutarıyla eşleşiyor" },
    ];
    const res = suggestAll([L("a", "2026-10-06", "in", 4500), L("b", "2026-10-08", "in", 53100), L("c", "2026-10-20", "in", 4500)], ctx({ collections }));
    expect(res.get("a")).toMatchObject({ kind: "collection", source: "rent", sourceId: "r1", category: "kira_tahsilat" });
    expect(res.get("b")).toMatchObject({ kind: "collection", source: "commission", category: "komisyon" });
    expect(res.get("c")!.kind).not.toBe("collection");
  });

  it("düzenli ödeme kuralı: tutar + ödeme gününe yakınlık", () => {
    const rules = [{ id: "u1", dir: "out" as const, amount: 1200, payDay: 5, title: "Muhasebe ücreti", category: "muhasebe" }];
    expect(suggestAll([L("a", "2026-10-07", "out", 1200)], ctx({ rules })).get("a")).toMatchObject({ kind: "recurring", ruleId: "u1", category: "muhasebe" });
    expect(suggestAll([L("a", "2026-10-20", "out", 1200)], ctx({ rules })).get("a")!.kind).not.toBe("recurring");
  });

  it("düzenli ödeme önerisi karara ruleId ile 'recurring' olarak gider, 'create' olarak ÜRETİLMEZ", () => {
    const rules = [{ id: "u1", dir: "out" as const, amount: 1200, payDay: 5, title: "Muhasebe ücreti", category: "muhasebe" }];
    const s = suggestAll([L("a", "2026-10-07", "out", 1200)], ctx({ rules })).get("a")!;
    expect(s).toMatchObject({ kind: "recurring", ruleId: "u1" });
    const d = buildDecision("a", s, { action: "create", category: "muhasebe" });
    expect(d).toEqual({ lineId: "a", action: "recurring", ruleId: "u1" });
    expect(d.action).not.toBe("create");
    // Kategori önerilenden değiştirilirse sıradan hareket oluşturulur (kural dönemi tüketilmez).
    expect(buildDecision("a", s, { action: "create", category: "diger_gider" })).toMatchObject({ action: "create", category: "diger_gider" });
    expect(buildDecision("a", s, { action: "skip", category: "muhasebe" })).toEqual({ lineId: "a", action: "skip" });
    const coll = { kind: "collection" as const, source: "commission" as const, sourceId: "c1", category: "komisyon", label: "x" };
    expect(buildDecision("b", coll, { action: "create", category: "komisyon" })).toMatchObject({ action: "create", sourceType: "commission", sourceId: "c1" });
  });

  it("kategori tahmini: anahtar sözcükler, maaş yalnız yetkiliye", () => {
    expect(guessCategory("KIRA BEDELI OCAK", "out", true)).toEqual({ category: "kira", matched: true });
    expect(guessCategory("SGK PRIM", "out", true).category).toBe("sgk");
    expect(guessCategory("SAHIBINDEN.COM UYELIK", "out", true).category).toBe("portal");
    expect(guessCategory("ENERJISA ELEKTRIK", "out", true).category).toBe("ofis");
    expect(guessCategory("PERSONEL MAAS", "out", true).category).toBe("maas");
    expect(guessCategory("PERSONEL MAAS", "out", false)).toEqual({ category: "diger_gider", matched: false });
    expect(guessCategory("KOMISYON ODEMESI", "in", true).category).toBe("komisyon");
    expect(guessCategory("BILINMEYEN", "in", true)).toEqual({ category: "diger_gelir", matched: false });
    expect(suggestAll([L("a", "2026-10-05", "out", 5, "BILINMEYEN")], ctx()).get("a")).toEqual({ kind: "none" });
  });

  it("gün hesapları Date nesnesi olmadan tutarlı", () => {
    expect(isoFromDayNumber(dayNumber("2026-10-11"))).toBe("2026-10-11");
    expect(shiftIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
