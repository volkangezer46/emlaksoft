import { describe, expect, it } from "vitest";
import { probeSupabaseServices, SERVICE_PROBE_PATHS } from "@/lib/health-service-probes";

describe("probeSupabaseServices", () => {
  it("hepsi 200 → ok; apikey gönderilir, yollar sabit", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, key: new Headers(init?.headers).get("apikey") });
      return new Response("{}", { status: 200 });
    };
    const r = await probeSupabaseServices("https://api.example.test/", "anon", fetchImpl);
    expect(r.overall).toBe("ok");
    expect(r.auth.status).toBe("up");
    expect(seen.map((s) => s.url).sort()).toEqual(
      Object.values(SERVICE_PROBE_PATHS).map((p) => `https://api.example.test${p}`).sort(),
    );
    expect(seen.every((s) => s.key === "anon")).toBe(true);
  });

  it("biri 503 ya da ağ hatası → degraded (fırlatmaz)", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/storage/")) return new Response("", { status: 503 });
      if (url.includes("/realtime/")) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    };
    const r = await probeSupabaseServices("https://api.example.test", "anon", fetchImpl);
    expect(r.overall).toBe("degraded");
    expect(r.auth.status).toBe("up");
    expect(r.storage).toMatchObject({ status: "degraded", httpStatus: 503 });
    expect(r.realtime).toMatchObject({ status: "degraded", httpStatus: null });
  });

  it("URL ya da anahtar yoksa çağrı yapmadan degraded", async () => {
    let calls = 0;
    const r = await probeSupabaseServices(undefined, "anon", async () => {
      calls += 1;
      return new Response("");
    });
    expect(r.overall).toBe("degraded");
    expect(calls).toBe(0);
  });
});
