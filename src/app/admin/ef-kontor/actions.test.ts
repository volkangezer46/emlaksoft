import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string | null>());
const audit = vi.hoisted(() => vi.fn(async (_i: unknown) => undefined));
const staffRef = vi.hoisted(() => ({ role: "super_admin" as "super_admin" | "ops" }));
const rate = vi.hoisted(() => ({ allowed: true }));
const ready = vi.hoisted(() => ({ ok: true }));
const grant = vi.hoisted(() => vi.fn(async (_i: unknown, _s: string) => ({ ok: true, available: 15 })));
const tag = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: tag, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async (k: string) => store.get(k) ?? null,
  getPlatformSettingsMany: async (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, store.get(k) ?? null])),
  setPlatformSetting: async (k: string, v: string | null) => {
    store.set(k, v);
    return true;
  },
}));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: audit }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: async () => ({ id: "staff-1", role: staffRef.role }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: rate.allowed }) }));
vi.mock("@/lib/ef-credits/credit-reader", () => ({
  EF_CONFIG_CACHE_TAG: "ef-credit-config",
  getEfCreditReady: async () => ready.ok,
}));
vi.mock("@/lib/ef-credits/admin-data", () => ({ grantEfCredit: grant }));

import { grantEfCreditAction, saveEfPacks, saveEfTariff } from "./actions";
import { EF_PACKS_SETTING_KEY, EF_TARIFF_SETTING_KEY } from "@/lib/ef-credits/config";

const T = "3f1c9c2e-1f43-4b0e-9a3c-0d2b5c7e8f10";
function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
const goodPacks = JSON.stringify([{ id: "mini", name: "Mini", units: 10, priceNetTry: 175, active: true, order: 10 }]);
const grantForm = { tenantId: T, units: "10", kind: "admin", reason: "Müşteri telafisi için manuel yükleme" };

describe("admin kontör action'ları", () => {
  beforeEach(() => {
    store.clear();
    audit.mockClear();
    grant.mockClear();
    tag.mockClear();
    staffRef.role = "super_admin";
    rate.allowed = true;
    ready.ok = true;
  });

  it("ops YAZAMAZ (tarife, katalog, yükleme)", async () => {
    staffRef.role = "ops";
    const r = [
      await saveEfTariff(fd({ valuationArsa: "5", valuationKonut: "5", pdfFirst: "2", reportDetail: "0" })),
      await saveEfPacks(fd({ packs: goodPacks })),
      await grantEfCreditAction(fd(grantForm)),
    ];
    expect(r.every((x) => x.error)).toBe(true);
    expect(store.size).toBe(0);
    expect(grant).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("tarife: doğrulama, yazma, denetim, updateTag", async () => {
    expect((await saveEfTariff(fd({ valuationArsa: "-1", valuationKonut: "5", pdfFirst: "2", reportDetail: "0" }))).error).toBeTruthy();
    expect((await saveEfTariff(fd({ valuationArsa: "5", valuationKonut: "x", pdfFirst: "2", reportDetail: "0" }))).error).toBeTruthy();
    expect(store.size).toBe(0);
    const r = await saveEfTariff(fd({ valuationArsa: "5", valuationKonut: "6", pdfFirst: "2", reportDetail: "0" }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(store.get(EF_TARIFF_SETTING_KEY)!)).toMatchObject({ valuationKonut: 6, pdfFirst: 2 });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(tag).toHaveBeenCalledWith("ef-credit-config");
  });

  it("katalog: geçersiz/yinelenen kimlik reddedilir, geçerli yazılır", async () => {
    expect((await saveEfPacks(fd({ packs: "{bozuk" }))).error).toBeTruthy();
    expect((await saveEfPacks(fd({ packs: JSON.stringify([{ id: "A", name: "x", units: 1, priceNetTry: 1, active: true, order: 1 }]) }))).error).toBeTruthy();
    const dup = JSON.stringify([
      { id: "mini", name: "Mini", units: 10, priceNetTry: 175, active: true, order: 10 },
      { id: "mini", name: "Mini 2", units: 20, priceNetTry: 300, active: true, order: 20 },
    ]);
    expect((await saveEfPacks(fd({ packs: dup }))).error).toBeTruthy();
    expect(store.has(EF_PACKS_SETTING_KEY)).toBe(false);
    expect((await saveEfPacks(fd({ packs: goodPacks }))).ok).toBe(true);
    expect(store.has(EF_PACKS_SETTING_KEY)).toBe(true);
  });

  it("manuel yükleme: gerekçesiz ve negatif reddedilir", async () => {
    expect((await grantEfCreditAction(fd({ ...grantForm, reason: "" }))).error).toBeTruthy();
    expect((await grantEfCreditAction(fd({ ...grantForm, units: "-5" }))).error).toBeTruthy();
    expect(grant).not.toHaveBeenCalled();
  });

  it("manuel yükleme: hız sınırı ve cüzdan hazır değil kapıları", async () => {
    rate.allowed = false;
    expect((await grantEfCreditAction(fd(grantForm))).error).toMatch(/Çok fazla/);
    rate.allowed = true;
    ready.ok = false;
    expect((await grantEfCreditAction(fd(grantForm))).error).toMatch(/etkin değil/);
    expect(grant).not.toHaveBeenCalled();
  });

  it("manuel yükleme: başarı denetim kaydı bırakır (gerekçe dahil)", async () => {
    const r = await grantEfCreditAction(fd(grantForm));
    expect(r.ok).toBe(true);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]![0]).toMatchObject({ action: "ef_credits.manual_grant", meta: { units: 10, kind: "admin" } });
  });
});
