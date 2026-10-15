import { describe, expect, it, vi } from "vitest";

/** /api/health/lb: Traefik havuz yoklaması DB'siz; yalnız boşaltma işaretinde 503. */
const state = vi.hoisted(() => ({ drain: false }));

vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  return { ...real, existsSync: (p: string) => (p === "/tmp/emlaksoft-drain" ? state.drain : real.existsSync(p)) };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("lb yoklaması DB'ye gitmemeli");
  },
}));

import { GET } from "./route";

describe("/api/health/lb", () => {
  it("boşaltma yokken 200, DB'ye gitmez", async () => {
    state.drain = false;
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("boşaltma işaretinde 503 (Traefik sunucuyu havuzdan çıkarır)", async () => {
    state.drain = true;
    const res = GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
