import { describe, expect, it } from "vitest";
import { adoptOutcomeText, adoptSelectionSummary, bulkOutcomeText, ledgerFilterParams, ledgerQueryOps, lockReasonFor, parseLedgerFilters } from "./ledger-filters";
import { nextRowIndex } from "./keyboard-nav";
import { dailyBalanceSeries, sparkPoints } from "../kasa-banka/account-sparkline";

const ID = "11111111-2222-4333-8444-555555555555";

describe("Hareketler filtre kontratı (URL -> sunucu sorgusu)", () => {
  it("her URL filtresi sorgu adımına yansır; iptal edilmiş satır hiç gelmez", () => {
    const f = parseLedgerFilters(
      { hesap: ID, tur: "gider", kategori: "portal", cari: ID, kaynak: "eski", mutabik: "hayir", belge: "yok", from: "2026-10-01", to: "2026-10-31", q: "sahibinden", sayfa: "3" },
      { canSalary: false },
    );
    expect(f.page).toBe(3);
    const ops = ledgerQueryOps(f);
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "is", col: "voided_at", val: null },
        { op: "eq", col: "account_id", val: ID },
        { op: "eq", col: "kind", val: "expense" },
        { op: "neq", col: "kind", val: "adjust" },
        { op: "eq", col: "category", val: "portal" },
        { op: "eq", col: "party_id", val: ID },
        { op: "eq", col: "origin", val: "legacy_expense" },
        { op: "is", col: "reconciled_at", val: null },
        { op: "eq", col: "attachment_count", val: 0 },
        { op: "gte", col: "entry_date", val: "2026-10-01" },
        { op: "lte", col: "entry_date", val: "2026-10-31" },
        { op: "or", val: "title.ilike.%sahibinden%,counterparty.ilike.%sahibinden%" },
      ]),
    );
    // URL'e geri yazım aynı anahtarları üretir (iki yönlü).
    expect(ledgerFilterParams(f)).toEqual({ hesap: ID, tur: "gider", kategori: "portal", cari: ID, kaynak: "eski", mutabik: "hayir", belge: "yok", from: "2026-10-01", to: "2026-10-31", q: "sahibinden" });
  });

  it("geçersiz değerler filtre değildir; maaş yetkisiz kullanıcıda süzülemez; arama PostgREST ayraçlarından arındırılır", () => {
    const f = parseLedgerFilters({ hesap: "x", tur: "hepsi", kategori: "maas", kaynak: "?", from: "13/10/2026", q: "a,b(c)%_" }, { canSalary: false });
    expect(ledgerFilterParams(f)).toEqual({ q: "a b c" });
    expect(parseLedgerFilters({ kategori: "maas" }, { canSalary: true }).kategori).toBe("maas");
  });

  it("kaynak sayaçları diğer filtreleri korur, kaynağı kendisi ekler", () => {
    const f = parseLedgerFilters({ kaynak: "hareket", tur: "gelir" }, { canSalary: false });
    const ops = ledgerQueryOps(f, { omitKaynak: true });
    expect(ops.some((o) => o.op === "eq" && o.col === "origin")).toBe(false);
    expect(ops).toContainEqual({ op: "eq", col: "kind", val: "income" });
  });

  it("gelir/gider kind ile süzülür: transfer ve düzeltme (adjust) girmez; 'mutabık değil' düzeltmeyi dışlar", () => {
    const gelir = ledgerQueryOps(parseLedgerFilters({ tur: "gelir" }, { canSalary: false }));
    expect(gelir).toContainEqual({ op: "eq", col: "kind", val: "income" });
    expect(gelir.some((o) => o.op === "eq" && o.col === "direction")).toBe(false);
    const mutabik = ledgerQueryOps(parseLedgerFilters({ mutabik: "hayir" }, { canSalary: false }));
    expect(mutabik).toEqual(expect.arrayContaining([{ op: "is", col: "reconciled_at", val: null }, { op: "eq", col: "origin", val: "entry" }, { op: "neq", col: "kind", val: "adjust" }]));
  });
});

describe("toplu işlem ve taşıma bildirimleri", () => {
  it("uygun olmayan ve reddedilen satırlar ayrı sayılır", () => {
    expect(bulkOutcomeText(3, "yeniden kategorilendi", 0, 0)).toBe("3 hareket yeniden kategorilendi");
    expect(bulkOutcomeText(2, "mutabık işaretlendi", 4, 1)).toBe("2 hareket mutabık işaretlendi; 4 satır bu işleme uygun değil, atlandı; 1 satır kaydedilemedi");
  });

  it("taşıma toplamı yalnız hesap para biriminden; TL olmayan ayrıca sayılır", () => {
    expect(adoptSelectionSummary([{ amount: 100.1, currency: "TRY" }, { amount: 50, currency: "USD" }, { amount: 0.2, currency: "TRY" }], "TRY")).toEqual({ eligible: 2, foreign: 1, total: 100.3 });
  });

  it("taşıma sonucu RPC sayısını yazar; hiç taşınmadıysa uyarı", () => {
    expect(adoptOutcomeText(3, 3, "Kasa")).toEqual({ tone: "ok", text: "3/3 gider Kasa hesabına taşındı" });
    expect(adoptOutcomeText(2, 5, "Kasa").text).toMatch(/^2\/5 gider Kasa hesabına taşındı; 3 tanesi kilitli dönemde/);
    expect(adoptOutcomeText(0, 4, "Kasa").tone).toBe("err");
  });
});

describe("dönem kilidi", () => {
  it("kilitli ay nedeni Türkçe ay adıyla; kilitsiz ay null", () => {
    const locked = new Set(["2026-09"]);
    expect(lockReasonFor("2026-09-15", locked)).toMatch(/^Eylül 2026 dönemi kapatıldı/);
    expect(lockReasonFor("2026-10-01", locked)).toBeNull();
  });
});

describe("klavye gezinme", () => {
  it("J/K sınırda durur; seçim yokken J ilk, K son satır", () => {
    expect(nextRowIndex(-1, 5, "j")).toBe(0);
    expect(nextRowIndex(-1, 5, "k")).toBe(4);
    expect(nextRowIndex(4, 5, "j")).toBe(4);
    expect(nextRowIndex(0, 5, "k")).toBe(0);
    expect(nextRowIndex(2, 5, "j")).toBe(3);
    expect(nextRowIndex(0, 0, "j")).toBe(-1);
  });
});

describe("hesap kartı 30 gün çizgisi", () => {
  it("gün sonu bakiyeleri bugünkü bakiyeden geriye kurulur; pencere dışı hareket yok sayılır", () => {
    const s = dailyBalanceSeries(1000, [
      { date: "2026-10-13", direction: "in", amount: 200 },
      { date: "2026-10-12", direction: "out", amount: 50 },
      { date: "2026-08-01", direction: "in", amount: 9999 },
    ], "2026-10-13", 3);
    expect(s).toEqual([
      { date: "2026-10-11", balance: 850 },
      { date: "2026-10-12", balance: 800 },
      { date: "2026-10-13", balance: 1000 },
    ]);
  });

  it("ileri tarihli hareket bakiyeye dahil olsa da bugünkü noktadan düşülür", () => {
    const s = dailyBalanceSeries(1500, [
      { date: "2026-10-20", direction: "in", amount: 500 },
      { date: "2026-10-13", direction: "out", amount: 100 },
    ], "2026-10-13", 2);
    expect(s).toEqual([
      { date: "2026-10-12", balance: 1100 },
      { date: "2026-10-13", balance: 1000 },
    ]);
  });

  it("düz seri orta çizgide; noktalar kutu içinde", () => {
    expect(sparkPoints([5, 5], 100, 20)).toBe("2.0,10.0 98.0,10.0");
    const pts = sparkPoints([0, 10], 100, 20).split(" ");
    expect(pts).toEqual(["2.0,18.0", "98.0,2.0"]);
  });
});
