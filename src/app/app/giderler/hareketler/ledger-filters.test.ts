import { describe, expect, it } from "vitest";
import { ledgerFilterParams, ledgerQueryOps, lockReasonFor, parseLedgerFilters } from "./ledger-filters";
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
        { op: "eq", col: "direction", val: "out" },
        { op: "neq", col: "kind", val: "transfer" },
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
    expect(ops).toContainEqual({ op: "eq", col: "direction", val: "in" });
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

  it("düz seri orta çizgide; noktalar kutu içinde", () => {
    expect(sparkPoints([5, 5], 100, 20)).toBe("2.0,10.0 98.0,10.0");
    const pts = sparkPoints([0, 10], 100, 20).split(" ");
    expect(pts).toEqual(["2.0,18.0", "98.0,2.0"]);
  });
});
