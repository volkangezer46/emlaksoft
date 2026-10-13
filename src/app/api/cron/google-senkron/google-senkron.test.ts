import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * google-senkron: bağlantı yokken "atlandı" heartbeat'i yazar ve HİÇBİR dış çağrı yapmaz (spy: fetchExternal + global fetch).
 * Genel 401/503/5xx sözleşmesi cron-contract.test.ts'te (vercel.json'daki her cron için) koşar.
 */
const h = vi.hoisted(() => ({
  heartbeats: [] as { job: string; status: string; detail?: string }[],
  external: 0,
  writes: 0,
}));

vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (job: string, status: string, detail?: string) => {
    h.heartbeats.push({ job, status, detail });
    return true;
  },
}));
vi.mock("@/lib/external-fetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/external-fetch")>()),
  fetchExternal: async () => {
    h.external += 1;
    throw new Error("dış çağrı yapılmamalı");
  },
}));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSettingsMany: async (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null])),
  setPlatformSetting: async () => {
    h.writes += 1;
    return true;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("tablo erişimi beklenmiyor");
  },
}));

const SECRET = "test-cron-secret-google";

describe("google-senkron cron", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    h.heartbeats.length = 0;
    h.external = 0;
    h.writes = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("bağlantı yokken 'atlandı: bağlı değil' yazar, 0 dış çağrı, 0 yazma", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/cron/google-senkron", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
    expect(h.heartbeats).toEqual([{ job: "google-senkron", status: "ok", detail: "atlandı: bağlı değil" }]);
    expect(h.external).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.writes).toBe(0);
  });
});
