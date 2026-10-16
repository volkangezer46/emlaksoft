import { describe, expect, it } from "vitest";
import { modulesClosedForBand, parseTeamBand, SMALL_OFFICE_CLOSED_MODULES, TEAM_BANDS } from "./team-band";
import { FEATURE_KEYS } from "@/lib/modules/registry";

describe("kayıtta 'Kaç kişisiniz?' (C31)", () => {
  it("üç seçenek; geçersiz cevap yok sayılır", () => {
    expect(TEAM_BANDS.map((b) => b.label)).toEqual(["Sadece ben", "2–5 kişi", "6 ve üzeri"]);
    expect(parseTeamBand("2-5")).toBe("2-5");
    expect(parseTeamBand("10")).toBeNull();
    expect(parseTeamBand(null)).toBeNull();
  });

  it("1–5 kişide çok şubeli yapı bölümleri kapalı gelir; 6+ ya da cevapsızda dokunulmaz", () => {
    expect(modulesClosedForBand("solo")).toEqual(SMALL_OFFICE_CLOSED_MODULES);
    expect(modulesClosedForBand("2-5")).toEqual(SMALL_OFFICE_CLOSED_MODULES);
    expect(modulesClosedForBand("6+")).toEqual([]);
    expect(modulesClosedForBand(null)).toEqual([]);
    for (const k of SMALL_OFFICE_CLOSED_MODULES) expect(FEATURE_KEYS).toContain(k);
  });
});
