import { describe, expect, it } from "vitest";
import {
  TUFE_UNVERIFIED_NOTICE,
  builtinTufeTable,
  computeLegalIncrease,
  computeLegalIncreaseIn,
  hasOfficialTufe,
  hasOfficialTufeIn,
  latestOfficialTufeMonthIn,
  parseTufeTable,
  serializeTufeTable,
  tufeWarningFor,
  validateTufeTable,
} from "./tufe";

describe("gömülü TÜFE tablosu doğrulanmamıştır", () => {
  it("hiçbir satır resmi değil; computeLegalIncrease official=false", () => {
    const t = builtinTufeTable();
    expect(t.fromSettings).toBe(false);
    expect(Object.values(t.entries).every((e) => e.official === false)).toBe(true);
    expect(hasOfficialTufe("2025-06")).toBe(false);
    expect(computeLegalIncrease(10000, "2025-06").official).toBe(false);
    expect(latestOfficialTufeMonthIn(t)).toBe("");
  });
  it("2026-08 ve sonrası için rakam UYDURULMAZ (tabloda yok)", () => {
    const t = builtinTufeTable();
    for (const m of ["2026-08", "2026-09", "2026-10", "2026-12"]) expect(t.entries[m]).toBeUndefined();
  });
  it("resmi olmayan ay için açık uyarı verir", () => {
    const t = builtinTufeTable();
    expect(tufeWarningFor(t, "2026-09")).toContain(TUFE_UNVERIFIED_NOTICE);
    expect(tufeWarningFor(t, "2025-06")).toContain(TUFE_UNVERIFIED_NOTICE);
  });
});

describe("ayardan gelen tablo", () => {
  const input = {
    entries: { "2026-08": { rate: "31,5", official: true }, "2026-07": { rate: 30, official: false } },
    verifiedAt: "2026-10-01",
    source: "Test bülteni",
  };

  it("doğrular, virgüllü oranı çözer, resmi satırı resmi sayar", () => {
    const v = validateTufeTable(input);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(hasOfficialTufeIn(v.table, "2026-08")).toBe(true);
    expect(hasOfficialTufeIn(v.table, "2026-07")).toBe(false);
    expect(computeLegalIncreaseIn(v.table, 10000, "2026-08")).toMatchObject({ newRent: 13150, official: true, capped: false });
    expect(computeLegalIncreaseIn(v.table, 10000, "2026-07").official).toBe(false);
    expect(tufeWarningFor(v.table, "2026-08")).toBeNull();
  });
  it("resmi satır için tarih ve kaynak zorunlu", () => {
    expect(validateTufeTable({ entries: input.entries }).ok).toBe(false);
    expect(validateTufeTable({ entries: input.entries, verifiedAt: "2026-10-01" }).ok).toBe(false);
  });
  it("geçersiz ay/oran reddedilir", () => {
    expect(validateTufeTable({ entries: { "2026-13": { rate: 10, official: false } } }).ok).toBe(false);
    expect(validateTufeTable({ entries: { "2026-01": { rate: -1, official: false } } }).ok).toBe(false);
    expect(validateTufeTable({ entries: { "2026-01": { rate: 501, official: false } } }).ok).toBe(false);
    expect(validateTufeTable({ entries: {} }).ok).toBe(false);
  });
  it("serileştirme gidiş-dönüş; bozuk/boş JSON gömülü tabloya düşer", () => {
    const v = validateTufeTable(input);
    if (!v.ok) throw new Error("beklenmedik");
    const back = parseTufeTable(serializeTufeTable(v.table));
    expect(back.entries).toEqual(v.table.entries);
    expect(back.fromSettings).toBe(true);
    expect(parseTufeTable("{bozuk").fromSettings).toBe(false);
    expect(parseTufeTable(null).fromSettings).toBe(false);
  });
});
