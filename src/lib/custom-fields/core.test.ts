import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CUSTOM_FIELD_MODULE, formatValue, inputValue, keyFromLabel, parseDefInput, parseValue } from "./core";

const sel = { label: "Isınma", fieldType: "select" as const, options: ["Doğalgaz", "Klima"], required: false };

describe("özel alanlar (saf)", () => {
  it("anahtar etiketten Türkçe harf dönüşümüyle ve DB desenine uygun üretilir", () => {
    expect(keyFromLabel("Isıtma tipi")).toBe("isitma_tipi");
    expect(keyFromLabel("Kredi Onayı ✓")).toBe("kredi_onayi");
    expect(keyFromLabel("2. Kat notu")).toBe("alan_2_kat_notu");
    for (const l of ["Ş", "x", "Çok uzun bir alan adı ".repeat(5)]) expect(keyFromLabel(l)).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
  });

  it("tanım: seçim için seçenek zorunlu, tekrarlar atılır", () => {
    expect(parseDefInput({ label: "  ", fieldType: "text" }).ok).toBe(false);
    expect(parseDefInput({ label: "Isınma", fieldType: "select", options: "" }).ok).toBe(false);
    const r = parseDefInput({ label: "Isınma", fieldType: "select", options: "Doğalgaz\nKlima, Doğalgaz", required: "on" });
    expect(r.ok && r.value).toEqual({ label: "Isınma", fieldType: "select", options: ["Doğalgaz", "Klima"], required: true });
    expect(parseDefInput({ label: "X", fieldType: "json" }).ok).toBe(false);
  });

  it("değer: türe göre tek sütun; boş = sil; zorunlu boş reddedilir", () => {
    expect(parseValue({ label: "Not", fieldType: "text", options: [], required: false }, "  merhaba ")).toEqual({
      ok: true,
      empty: false,
      value: { value_text: "merhaba", value_num: null, value_date: null, value_bool: null },
    });
    const n = parseValue({ label: "Aidat", fieldType: "number", options: [], required: false }, "1.250.000,5");
    expect(n.ok && n.value.value_num).toBe(1250000.5);
    expect(parseValue({ label: "Aidat", fieldType: "number", options: [], required: false }, "abc").ok).toBe(false);
    expect(parseValue({ label: "T", fieldType: "date", options: [], required: false }, "2026-02-30").ok).toBe(false);
    expect(parseValue(sel, "Kombi").ok).toBe(false);
    expect(parseValue(sel, "Klima").ok).toBe(true);
    expect(parseValue({ ...sel, required: true }, "").ok).toBe(false);
    const empty = parseValue(sel, "");
    expect(empty.ok && empty.empty).toBe(true);
    const b = parseValue({ label: "Onay", fieldType: "boolean", options: [], required: false }, "hayir");
    expect(b.ok && b.value.value_bool).toBe(false);
  });

  it("görüntüleme ve form değeri tek kaynaktan", () => {
    expect(formatValue({ fieldType: "boolean" }, { value_text: null, value_num: null, value_date: null, value_bool: true })).toBe("Evet");
    expect(formatValue({ fieldType: "date" }, { value_text: null, value_num: null, value_date: "2026-10-07", value_bool: null })).toBe("07.10.2026");
    expect(formatValue({ fieldType: "number" }, null)).toBe("");
    expect(inputValue({ fieldType: "boolean" }, { value_text: null, value_num: null, value_date: null, value_bool: false })).toBe("hayir");
  });

  it("modül eşlemesi migration politikasıyla aynı; tenant-only yazma politikası yok", () => {
    const sql = readFileSync("supabase/migrations/20261007000310_custom_fields.sql", "utf8");
    for (const [entity, mod] of Object.entries(CUSTOM_FIELD_MODULE)) {
      expect(sql).toMatch(new RegExp(`when '${entity}'\\s+then public\\.has_effective_permission\\('${mod}', 'edit'\\)`));
    }
    expect(sql).toContain("custom_field_record_visible(entity, record_id)");
    expect(sql).not.toMatch(/for all to authenticated/);
  });
});
