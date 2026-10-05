import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string | null>());
const audit = vi.hoisted(() => vi.fn(async (_i: unknown) => undefined));
const staffRef = vi.hoisted(() => ({ role: "super_admin" as "super_admin" | "ops" }));
const rate = vi.hoisted(() => ({ allowed: true }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async (key: string) => store.get(key) ?? null,
  getPlatformSettingsMany: async (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, store.get(k) ?? null])),
  setPlatformSetting: async (key: string, value: string | null) => {
    store.set(key, value);
    return true;
  },
}));
vi.mock("@/lib/platform-notify", () => ({ notifyPlatformStaff: vi.fn() }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: audit }));
vi.mock("@/lib/platform", () => ({
  requirePlatformStaff: async () => ({ id: "staff-1", role: staffRef.role }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: rate.allowed }) }));

import {
  clearEmlakFiyatiKey,
  deletePreviousEmlakFiyatiKey,
  saveEmlakFiyatiKey,
  setEmlakFiyatiOrtakFlag,
  testEmlakFiyatiConnection,
} from "./platform-emlakfiyati";
import { EF_SETTING, invalidateEmlakFiyatiKeyCache } from "@/lib/integrations/emlakfiyati/keys";
import { resetEmlakFiyatiStateForTests } from "@/lib/integrations/emlakfiyati/adapter";
import { ALL_FAKE_KEYS, FAKE_KEY, FAKE_KEY_2, FAKE_SECRETS_KEY } from "@/lib/integrations/emlakfiyati/test-fixtures";

function form(value: string) {
  const fd = new FormData();
  fd.set("api_key", value);
  return fd;
}

describe("platform-emlakfiyati actions", () => {
  beforeEach(() => {
    store.clear();
    audit.mockClear();
    staffRef.role = "super_admin";
    rate.allowed = true;
    resetEmlakFiyatiStateForTests();
    invalidateEmlakFiyatiKeyCache();
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ops YAZAMAZ: hiçbir action ayar yazmaz ve ağa çıkmaz", async () => {
    staffRef.role = "ops";
    const results = [
      await saveEmlakFiyatiKey(form(FAKE_KEY)),
      await deletePreviousEmlakFiyatiKey(),
      await clearEmlakFiyatiKey(),
      await testEmlakFiyatiConnection(),
      await setEmlakFiyatiOrtakFlag(true),
    ];
    for (const r of results) expect(r.error).toMatch(/yetkiniz yok|yalnız süper admin/);
    expect(store.size).toBe(0);
    expect(audit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hız sınırı aşılınca reddeder", async () => {
    rate.allowed = false;
    const r = await saveEmlakFiyatiKey(form(FAKE_KEY));
    expect(r.error).toMatch(/Çok sık/);
    expect(store.size).toBe(0);
  });

  it("PLATFORM_SECRETS_KEY yoksa 'etkin değil' der ve KAYDETMEZ", async () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    const r = await saveEmlakFiyatiKey(form(FAKE_KEY));
    expect(r.error).toBe("etkin değil: PLATFORM_SECRETS_KEY tanımlı değil");
    expect(store.size).toBe(0);
  });

  it("biçimi geçersiz anahtarı reddeder (önek/uzunluk/başlık enjeksiyonu)", async () => {
    for (const bad of ["", "abc", "sk_live_" + "x".repeat(30), `${FAKE_KEY}\r\nX-Evil: 1`]) {
      const r = await saveEmlakFiyatiKey(form(bad));
      expect(r.error).toBeTruthy();
    }
    expect(store.size).toBe(0);
  });

  it("kaydeder (şifreli), rotasyonda previous üretir; denetim kaydı ve sonuç anahtar içermez", async () => {
    const first = await saveEmlakFiyatiKey(form(FAKE_KEY));
    expect(first).toEqual({ ok: true, rotated: false });
    const second = await saveEmlakFiyatiKey(form(FAKE_KEY_2));
    expect(second).toEqual({ ok: true, rotated: true });
    expect(store.get(EF_SETTING.previous)).toBeTruthy();
    expect(store.get(EF_SETTING.previousUntil)).toBeTruthy();

    expect(await saveEmlakFiyatiKey(form(FAKE_KEY_2))).toEqual({ error: "Bu anahtar zaten tanımlı." });

    const dump = JSON.stringify({ audit: audit.mock.calls, results: [first, second] });
    for (const k of ALL_FAKE_KEYS) expect(dump).not.toContain(k);
    expect(dump).not.toContain(FAKE_KEY.slice(-4));
    expect(dump).not.toContain("****");
    expect(audit.mock.calls[0]![0]).toMatchObject({ action: "integration.emlakfiyati.key_change", meta: { changed: true } });
    // Saklanan değerler düz metin değil.
    for (const [k, v] of store.entries()) {
      if (k === EF_SETTING.current || k === EF_SETTING.previous) for (const key of ALL_FAKE_KEYS) expect(v).not.toContain(key);
    }
  });

  it("'eskiyi şimdi sil' previous'u siler; 'kaldır' admin anahtarlarını siler", async () => {
    await saveEmlakFiyatiKey(form(FAKE_KEY));
    await saveEmlakFiyatiKey(form(FAKE_KEY_2));
    expect((await deletePreviousEmlakFiyatiKey()).ok).toBe(true);
    expect(store.get(EF_SETTING.previous)).toBeNull();
    expect(store.get(EF_SETTING.current)).toBeTruthy();
    expect((await clearEmlakFiyatiKey()).ok).toBe(true);
    expect(store.get(EF_SETTING.current)).toBeNull();
  });

  it("bağlantı denemesi sonucu yalnız durum içerir", async () => {
    await saveEmlakFiyatiKey(form(FAKE_KEY));
    const r = await testEmlakFiyatiConnection();
    expect(r).toEqual({ ok: true, state: "connected" });
    for (const k of ALL_FAKE_KEYS) expect(JSON.stringify([r, audit.mock.calls])).not.toContain(k);
  });

  it("ortak uç bayrağı yazılır ('1'/'0')", async () => {
    expect((await setEmlakFiyatiOrtakFlag(true)).ok).toBe(true);
    expect(store.get(EF_SETTING.ortakEnabled)).toBe("1");
    await setEmlakFiyatiOrtakFlag(false);
    expect(store.get(EF_SETTING.ortakEnabled)).toBe("0");
  });
});
