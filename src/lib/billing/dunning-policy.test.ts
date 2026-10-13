import { describe, expect, it } from "vitest";
import { getSettingDef } from "@/lib/settings/registry";
import {
  DEFAULT_DUNNING_POLICY,
  DUNNING_KEYS,
  dunningMessage,
  finalWarningDay,
  policyFromSettings,
  stageOf,
} from "./dunning-policy";
import { autoRenewAttemptAllowed } from "./cards";

const vars = { ofis: "Ofis", fatura: "F-1", gun: 5, odeme_linki: "https://x/app/abonelik", kart_linki: "https://x/app/abonelik#kartlar" };

describe("dunning politikası (saf)", () => {
  it("her anahtar ayar defterinde tanımlı; varsayılanlar bugünkü davranış", () => {
    for (const k of DUNNING_KEYS) expect(getSettingDef(k), k).toBeDefined();
    const p = policyFromSettings({});
    expect(p).toEqual(DEFAULT_DUNNING_POLICY);
    expect(p.stages.map((s) => s.days)).toEqual([1, 4, 8]);
    expect(p.autoSuspendDays).toBe(0);
    expect(getSettingDef("dunning.auto_suspend_days")?.default).toBe(0);
  });

  it("kademeler güne göre sıralanır, aynı gün tekrar etmez; kanal seçimi", () => {
    const p = policyFromSettings({
      "dunning.stage1_days": 10,
      "dunning.stage2_days": 2,
      "dunning.stage3_days": 2,
      "dunning.stage1_channels": "in_app_email_sms",
    });
    expect(p.stages.map((s) => [s.stage, s.days])).toEqual([
      [1, 2],
      [2, 10],
    ]);
    expect(p.stages[1]).toMatchObject({ email: true, sms: true });
  });

  it("stageOf: 2/5/10", () => {
    const { stages } = policyFromSettings({ "dunning.stage1_days": 2, "dunning.stage2_days": 5, "dunning.stage3_days": 10 });
    expect([1, 2, 4, 5, 9, 10, 40].map((d) => stageOf(d, stages)?.stage ?? 0)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it("son uyarı yalnız askı açıkken", () => {
    expect(finalWarningDay({ autoSuspendDays: 0, finalWarningDays: 2 })).toBeNull();
    expect(finalWarningDay({ autoSuspendDays: 12, finalWarningDays: 2 })).toBe(10);
    expect(finalWarningDay({ autoSuspendDays: 1, finalWarningDays: 5 })).toBe(1);
  });

  it("şablon değişkenleri yerleşir ve kart güncelleme bağlantısı eklenir", () => {
    const m = dunningMessage({ stage: 2, template: "{ofis}: {fatura} {gun} gündür açık." }, 3, vars);
    expect(m.body).toContain("Ofis: F-1 5 gündür açık.");
    expect(m.body).toContain(vars.kart_linki);
    expect(m.kind).toBe("warning");
    const builtIn = dunningMessage({ stage: 3, template: "" }, 3, vars);
    expect(builtIn.kind).toBe("danger");
    expect(builtIn.body).toContain(vars.kart_linki);
  });

  it("otomatik yenileme deneme sınırı adminden", () => {
    const nowMs = 10 * 86_400_000;
    expect(autoRenewAttemptAllowed({ priorAttempts: 3, lastAttemptAtMs: null, nowMs, maxAttempts: 5 })).toBe(true);
    expect(autoRenewAttemptAllowed({ priorAttempts: 5, lastAttemptAtMs: null, nowMs, maxAttempts: 5 })).toBe(false);
    expect(autoRenewAttemptAllowed({ priorAttempts: 1, lastAttemptAtMs: nowMs - 2 * 86_400_000, nowMs, retryGapMs: 86_400_000 })).toBe(true);
  });
});
