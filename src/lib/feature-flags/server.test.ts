import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlagRuleWithMeta } from "./rules";

/**
 * Okuyucu kapısı (`isFeatureEnabled`) hedefleme bağlantısı: genel anahtar + kural + ofis bağlamı. Ayar defteri ve
 * kural deposu sahtedir (DB yok); değerlendirme mantığının kendisi targeting.test.ts'te.
 */

const settings: Record<string, unknown> = {};
let rules = new Map<string, FlagRuleWithMeta>();

vi.mock("@/lib/settings/read", () => ({
  getSettings: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]]))),
}));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSettingsMany: vi.fn(async () => ({})) }));
vi.mock("./rules", () => ({ loadFlagRules: vi.fn(async () => ({ rules, schemaReady: true })) }));

const { isFeatureEnabled } = await import("./server");

const tenant = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
const rule = (over: Partial<FlagRuleWithMeta> = {}): FlagRuleWithMeta => ({
  flagKey: "feature_board",
  tenantIds: [],
  plans: [],
  percentage: 10,
  startsAt: null,
  endsAt: null,
  note: null,
  updatedAt: null,
  ...over,
});

describe("isFeatureEnabled: hedefleme", () => {
  beforeEach(() => {
    for (const k of Object.keys(settings)) delete settings[k];
    rules = new Map();
  });

  it("%10 kuralı: aynı ofis her okumada aynı sonucu alır; ofislerin yaklaşık onda biri açık", async () => {
    settings["feedback.board_enabled"] = true;
    rules.set("feature_board", rule({ percentage: 10 }));
    let on = 0;
    for (let i = 0; i < 400; i++) {
      const target = { tenantId: tenant(i), plan: "office" };
      const a = await isFeatureEnabled("feature_board", target);
      const b = await isFeatureEnabled("feature_board", target);
      expect(b).toBe(a);
      if (a) on++;
    }
    expect(on).toBeGreaterThan(20);
    expect(on).toBeLessThan(65);
  });

  it("genel anahtar kapalıysa pilot ofis de kapalı; kural yoksa genel durum", async () => {
    rules.set("feature_board", rule({ tenantIds: [tenant(1)], percentage: 0 }));
    settings["feedback.board_enabled"] = false;
    expect(await isFeatureEnabled("feature_board", { tenantId: tenant(1), plan: null })).toBe(false);
    settings["feedback.board_enabled"] = true;
    expect(await isFeatureEnabled("feature_board", { tenantId: tenant(1), plan: null })).toBe(true);
    expect(await isFeatureEnabled("feature_board", { tenantId: tenant(2), plan: null })).toBe(false);
    rules = new Map();
    expect(await isFeatureEnabled("feature_board", { tenantId: tenant(2), plan: null })).toBe(true);
  });

  it("bağlamsız okuma ve hedeflenemez bayrak kuraldan etkilenmez; bilinmeyen anahtar kapalı", async () => {
    settings["feedback.board_enabled"] = true;
    settings["platform.registration_open"] = true;
    rules.set("feature_board", rule({ tenantIds: [tenant(1)], percentage: 0 }));
    rules.set("registration_open", rule({ flagKey: "registration_open", tenantIds: [tenant(1)], percentage: 0 }));
    expect(await isFeatureEnabled("feature_board")).toBe(true);
    expect(await isFeatureEnabled("registration_open", { tenantId: tenant(2), plan: null })).toBe(true);
    expect(await isFeatureEnabled("yok_boyle_bayrak", { tenantId: tenant(1), plan: null })).toBe(false);
  });
});
