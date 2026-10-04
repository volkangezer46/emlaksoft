import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLAGS_FAIL_TTL_MS,
  FLAGS_OK_TTL_MS,
  SAFE_FLAGS,
  isMaintenanceExemptPath,
  parseFlagRows,
  readPlatformFlagsCached,
  resetPlatformFlagsCache,
} from "@/lib/platform-flags-cache";

const ok = (rows: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;

const base = { url: "https://example.supabase.co", key: "k" };

describe("bakım/kayıt bayrakları önbelleği", () => {
  beforeEach(() => resetPlatformFlagsCache());

  it("satırları çözer", () => {
    expect(
      parseFlagRows([
        { key: "maintenance_mode", value: "on" },
        { key: "maintenance_message", value: " Yarım saat " },
        { key: "registration_open", value: "off" },
      ]),
    ).toEqual({ maintenanceMode: true, maintenanceMessage: "Yarım saat", registrationOpen: false });
  });

  it("TTL içinde tek istek yapar", async () => {
    const f = ok([{ key: "maintenance_mode", value: "on" }]);
    const a = await readPlatformFlagsCached({ ...base, fetchImpl: f, nowMs: 1000 });
    const b = await readPlatformFlagsCached({ ...base, fetchImpl: f, nowMs: 1000 + FLAGS_OK_TTL_MS - 1 });
    expect(a.maintenanceMode).toBe(true);
    expect(b.maintenanceMode).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    await readPlatformFlagsCached({ ...base, fetchImpl: f, nowMs: 1000 + FLAGS_OK_TTL_MS + 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("okuma hatasında SİTE AÇIK kalır", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ağ");
    }) as unknown as typeof fetch;
    expect(await readPlatformFlagsCached({ ...base, fetchImpl: boom, nowMs: 5 })).toEqual(SAFE_FLAGS);
    const bad = vi.fn(async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    resetPlatformFlagsCache();
    expect(await readPlatformFlagsCached({ ...base, fetchImpl: bad, nowMs: 5 })).toEqual(SAFE_FLAGS);
    // hata önbelleği kısa: sonra yeniden denenir
    const good = ok([{ key: "maintenance_mode", value: "on" }]);
    const r = await readPlatformFlagsCached({ ...base, fetchImpl: good, nowMs: 5 + FLAGS_FAIL_TTL_MS + 1 });
    expect(r.maintenanceMode).toBe(true);
  });

  it("env eksikse site açık", async () => {
    expect(await readPlatformFlagsCached({ url: "", key: "", nowMs: 1 })).toEqual(SAFE_FLAGS);
  });

  it("muaf yollar: admin, giriş/mfa, api, statik; public ve /app muaf değil", () => {
    for (const p of ["/admin", "/admin/ayarlar", "/giris", "/giris/mfa", "/api/health", "/api/cron/x", "/_next/static/a", "/logo.png", "/bakim"]) {
      expect(isMaintenanceExemptPath(p), p).toBe(true);
    }
    for (const p of ["/", "/kayit", "/app", "/app/musteriler", "/vitrin/ofis", "/paylas/abc"]) {
      expect(isMaintenanceExemptPath(p), p).toBe(false);
    }
  });
});
