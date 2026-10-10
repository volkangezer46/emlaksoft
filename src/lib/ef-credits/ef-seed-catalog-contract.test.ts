import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EF_DEFAULT_PACKS, EF_DEFAULT_TARIFF, EF_WELCOME_DEFAULT_UNITS, efPacksSchema, efTariffSchema } from "./config";

/**
 * SÖZLEŞME: 20261008001000 migration'ının yazdığı kontör varsayılanları (tarife, süreli paket kataloğu, hoş geldin)
 * config.ts varsayılanlarıyla BİREBİR. Sahip kararı 2026-10-10: kontör yalnız değerleme için, paketler süreli.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const SQL = read("supabase/migrations/20261008001000_plan_prices_ef_credit_tariff.sql");
const RB = read("supabase/rollbacks/20261008001000_plan_prices_ef_credit_tariff.rollback.sql");

/** `set value = $json$...$json$` bloklarını sırayla döner (güncelleme hedefleri). */
function setValueJson(sql: string): string[] {
  return [...sql.matchAll(/set value = \$json\$([\s\S]*?)\$json\$/g)].map((m) => m[1]!);
}

describe("20261008001000: kontör seed'i = config.ts varsayılanları", () => {
  it("paket kataloğu (12 süreli paket) TS varsayılanıyla birebir", () => {
    const [target] = setValueJson(SQL);
    const parsed = efPacksSchema.parse(JSON.parse(target!));
    expect(parsed).toEqual([...EF_DEFAULT_PACKS]);
    expect(parsed.every((p) => [1, 3, 6, 12].includes(p.months))).toBe(true);
  });

  it("tarife yalnız değerleme kalemleri; hoş geldin 100", () => {
    const m = /set value = '(\{"valuationArsa":850[^']*\})'/.exec(SQL);
    expect(m).not.toBeNull();
    expect(efTariffSchema.parse(JSON.parse(m![1]!))).toEqual(EF_DEFAULT_TARIFF);
    expect(Object.keys(JSON.parse(m![1]!))).toEqual(["valuationArsa", "valuationKonut", "valuationTicari"]);
    expect(SQL).toContain(`set value = '${EF_WELCOME_DEFAULT_UNITS}'`);
    // Yalnız dokunulmamış seed kayıtları güncellenir (jsonb eşitliği).
    expect(SQL).toContain("if j = '{\"valuationArsa\":5,\"valuationKonut\":5,\"pdfFirst\":2,\"reportDetail\":0}'::jsonb then");
    expect(SQL).not.toMatch(/listingAnalysis|"pdfFirst":0/);
  });

  it("rollback: yeni seed'i eski suresiz 4 paketlik/eski tarife kayda geri çevirir", () => {
    expect(RB).toContain("if j = '{\"valuationArsa\":850,\"valuationKonut\":700,\"valuationTicari\":1050}'::jsonb then");
    expect(RB).toContain("'{\"valuationArsa\":5,\"valuationKonut\":5,\"pdfFirst\":2,\"reportDetail\":0}'");
    const eskiPaketler = setValueJson(RB);
    expect(JSON.parse(eskiPaketler[0]!).map((p: { id: string }) => p.id)).toEqual(["ef-25", "ef-100", "ef-300", "ef-1000"]);
    expect(RB).toContain("'ef.welcome_units' and btrim(value) = '100'");
  });
});
