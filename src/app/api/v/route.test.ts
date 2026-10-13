import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/v beacon sözleşmesi: kapsam (özel yollar sayılmaz), DNT/GPC/önceden yükleme/bot, köken, 4 KB sınırı,
 * süreç içi kova (DB'ye HİÇ gidilmez) ve sayaçların tampona yazılması.
 */
const h = vi.hoisted(() => ({
  adminCalls: 0,
  settings: { pageviews: true, vitals: true, attribution: false, attributionLegalAt: null as string | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.adminCalls += 1;
    return { rpc: async () => ({ data: null, error: null }) };
  },
}));
vi.mock("@/lib/measure/settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/measure/settings")>()),
  getMeasureSettings: async () => h.settings,
}));

import { POST } from "./route";
import { measureBufferStats, resetMeasureBufferForTest } from "@/lib/measure/buffer";
import { beaconBucket } from "@/lib/measure/rate-bucket";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
let ipSeq = 0;

function beacon(body: unknown, headers: Record<string, string> = {}, ip?: string): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://emlaksoft.com.tr/api/v", {
    method: "POST",
    body: text,
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "sec-fetch-site": "same-origin",
      "user-agent": UA,
      "x-forwarded-for": ip ?? `10.0.0.${++ipSeq % 250}`,
      ...headers,
    },
  });
}

const pending = () => measureBufferStats().pendingPageviews + measureBufferStats().pendingVitals;
const valid = (p = "/") => ({ p, r: "www.google.com", u: { s: "google", m: "cpc", c: "ekim" }, d: "m", v: [["LCP", 1800]], s: 0, n: 1 });

describe("/api/v beacon", () => {
  const prevUrl = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://emlaksoft.com.tr";
    resetMeasureBufferForTest();
    beaconBucket.clear();
    h.adminCalls = 0;
    h.settings = { pageviews: true, vitals: true, attribution: false, attributionLegalAt: null };
  });
  afterEach(() => {
    resetMeasureBufferForTest();
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevUrl;
  });

  it("geçerli herkese açık sayfa sayılır (sayfa + hız), DB'ye istek anında gidilmez", async () => {
    const res = await POST(beacon(valid("/fiyatlar?utm_source=x")));
    expect(res.status).toBe(204);
    const s = measureBufferStats();
    expect(s.pendingPageviews).toBe(1);
    expect(s.pendingVitals).toBe(1);
    expect(h.adminCalls).toBe(0);
  });

  it.each(["/app/x", "/admin", "/giris", "/kayit/tamamla", "/sifre-yenile", "/malik-portali/x", "/musteri-portali/abc", "/api/v", "/r/abc12345"])(
    "kapsam dışı %s reddedilir (204, yazma yok)",
    async (p) => {
      const res = await POST(beacon(valid(p)));
      expect(res.status).toBe(204);
      expect(pending()).toBe(0);
    },
  );

  it.each([
    ["DNT", { dnt: "1" }],
    ["GPC", { "sec-gpc": "1" }],
    ["prefetch", { "sec-purpose": "prefetch" }],
    ["prefetch (Purpose)", { purpose: "prefetch" }],
    ["bot UA", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }],
    ["Lighthouse", { "user-agent": "Mozilla/5.0 Chrome-Lighthouse" }],
    ["UA yok", { "user-agent": "" }],
  ])("%s isteği sayılmaz", async (_n, headers) => {
    const res = await POST(beacon(valid(), headers));
    expect(res.status).toBe(204);
    expect(pending()).toBe(0);
  });

  it("köken uyuşmazlığında yazma yapılmaz; Origin eşleşirse kabul edilir", async () => {
    const cross = await POST(beacon(valid(), { "sec-fetch-site": "cross-site", origin: "https://kotu.example" }));
    expect(cross.status).toBe(204);
    const none = await POST(beacon(valid(), { "sec-fetch-site": "", origin: "https://kotu.example" }));
    expect(none.status).toBe(204);
    expect(pending()).toBe(0);
    const ok = await POST(beacon(valid(), { "sec-fetch-site": "", origin: "https://emlaksoft.com.tr" }));
    expect(ok.status).toBe(204);
    expect(measureBufferStats().pendingPageviews).toBe(1);
  });

  it("4 KB üstü gövde 413 döner (Content-Length ile ya da okurken)", async () => {
    const big = JSON.stringify({ ...valid(), pad: "x".repeat(5000) });
    const declared = await POST(beacon(big, { "content-length": String(big.length) }));
    expect(declared.status).toBe(413);
    const streamed = await POST(beacon(big));
    expect(streamed.status).toBe(413);
    expect(pending()).toBe(0);
  });

  it("geçersiz gövde 400, yazma yok", async () => {
    expect((await POST(beacon("{bozuk"))).status).toBe(400);
    expect((await POST(beacon({ p: "/", d: "tablet" }))).status).toBe(400);
    expect(pending()).toBe(0);
  });

  it("kova: aynı IP saniyede 20 istek → sınırlanır ve DB çağrısı 0", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await POST(beacon(valid(), {}, "203.0.113.7"))).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 204).length).toBeLessThan(20);
    expect(h.adminCalls).toBe(0);
    // Başka IP etkilenmez.
    expect((await POST(beacon(valid(), {}, "203.0.113.8"))).status).toBe(204);
  });

  it("ayarlar: sayaç kapalıyken sayfa, hız kapalıyken ölçüm yazılmaz; n=0 gönderim sayfa saymaz", async () => {
    h.settings = { ...h.settings, pageviews: false };
    await POST(beacon(valid()));
    expect(measureBufferStats().pendingPageviews).toBe(0);
    expect(measureBufferStats().pendingVitals).toBe(1);
    resetMeasureBufferForTest();
    h.settings = { ...h.settings, pageviews: true, vitals: false };
    await POST(beacon({ ...valid(), n: 0 }));
    expect(pending()).toBe(0);
  });
});
