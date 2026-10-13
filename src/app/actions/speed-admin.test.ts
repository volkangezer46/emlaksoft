import { beforeEach, describe, expect, it, vi } from "vitest";

/** Hız merkezi eylemleri: yetki (ops statik anahtarı/PSI anahtarını değiştiremez), ısıtma kilidi, kota durumu. */
const h = vi.hoisted(() => ({
  role: "ops" as "ops" | "super_admin",
  writes: [] as Array<{ id: string; enabled: boolean }>,
  psiWrites: [] as Array<string | null>,
  audits: [] as string[],
  warmRelease: null as null | (() => void),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: async () => ({ id: "staff-1", email: "a@b.c", full_name: "A", role: h.role, is_active: true }),
}));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async (i: { action: string }) => void h.audits.push(i.action) }));
vi.mock("@/lib/platform-flags-cache", () => ({ resetPlatformFlagsCache: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/public-redirect", () => ({ publicOrigin: () => "https://emlaksoft.com.tr" }));
vi.mock("@/lib/perf/store", () => ({
  writeStaticToggle: async (id: string, enabled: boolean) => (h.writes.push({ id, enabled }), true),
  readStaticToggles: async () => ({}),
  readPsiKey: async () => null,
  psiKeyStatus: async () => ({ configured: false, readable: true }),
  writePsiKey: async (v: string | null) => (h.psiWrites.push(v), "ok"),
  runAndRecordPsi: async (i: { path: string; device: string; key: string | null }) => ({
    path: i.path,
    device: i.device,
    status: "quota",
    message: i.key ? "kota" : "Anahtarsız PageSpeed kotası doldu; Laboratuvar ekranından API anahtarı ekleyin.",
    score: null,
  }),
}));
vi.mock("@/lib/static-home/render", async () => {
  const { createWarmLock } = await import("@/lib/static-home/cache");
  const lock = createWarmLock({ nowMs: () => 0 });
  return {
    enabledIdsNow: async () => ["home"],
    invalidateStatic: async () => 1,
    purgeAndWarm: (ids: string[]) =>
      new Promise((resolve) => {
        h.warmRelease = () => resolve({ rev: 2, rows: ids.map((id) => ({ id, ok: true, isStatic: true, ms: 1, gzipBytes: 1 })) });
      }),
    selfOrigin: () => "http://127.0.0.1:3000",
    staticSnapshots: () => [],
    staticWarmLock: () => lock,
  };
});

beforeEach(() => {
  h.writes.length = 0;
  h.psiWrites.length = 0;
  h.audits.length = 0;
});

describe("speed-admin yetki", () => {
  it("operasyon statik anahtarı değiştiremez (yazma yok)", async () => {
    h.role = "ops";
    const { setStaticRoute } = await import("./speed-admin");
    const r = await setStaticRoute({ id: "gizlilik", enabled: true });
    expect(r.ok).toBe(false);
    expect(h.writes).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("operasyon PageSpeed anahtarını değiştiremez", async () => {
    h.role = "ops";
    const { savePsiKey } = await import("./speed-admin");
    expect((await savePsiKey({ key: "AIzaSyD-abcdefghijklmnopqrstuvwxyz012" })).ok).toBe(false);
    expect(h.psiWrites).toEqual([]);
  });

  it("süper admin açar; kalıcı kapalı ve kayıtsız kimlik reddedilir", async () => {
    h.role = "super_admin";
    const { setStaticRoute } = await import("./speed-admin");
    expect((await setStaticRoute({ id: "gizlilik", enabled: true })).ok).toBe(true);
    expect((await setStaticRoute({ id: "fiyatlar", enabled: true })).ok).toBe(false);
    expect((await setStaticRoute({ id: "kayit", enabled: true })).ok).toBe(false);
    expect(h.writes).toEqual([{ id: "gizlilik", enabled: true }]);
    expect(h.audits).toEqual(["speed.static_on"]);
  });
});

describe("temizle ve ısıt", () => {
  it("eşzamanlı ikinci istek reddedilir (süreç kilidi)", async () => {
    h.role = "ops";
    const { purgeAndWarmAll } = await import("./speed-admin");
    const first = purgeAndWarmAll();
    await new Promise((r) => setTimeout(r, 0));
    const second = await purgeAndWarmAll();
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toMatch(/zaten çalışıyor/);
    h.warmRelease?.();
    const done = await first;
    expect(done.ok).toBe(true);
    const third = await purgeAndWarmAll();
    expect(!third.ok && third.error).toMatch(/sn sonra/);
  });
});

describe("laboratuvar", () => {
  it("yalnız kayıt yolları; anahtar yokken kota dürüst mesajla döner", async () => {
    h.role = "ops";
    const { runLab } = await import("./speed-admin");
    expect((await runLab({ path: "/app" })).ok).toBe(false);
    const r = await runLab({ path: "/" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/anahtar/);
  });
});
