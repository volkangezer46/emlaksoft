import { describe, expect, it } from "vitest";
import {
  confidenceLevel,
  errorBackoffMs,
  isAllowedProbeUrl,
  nextDelayMs,
  replyToReport,
  workerGate,
  WORKER_LIMITS,
  type WorkerEnv,
} from "./core";
import { BRIDGE_RESPONSE_SOURCE, parseBridgeMessage } from "./bridge";

const env = (over: Partial<WorkerEnv> = {}): WorkerEnv => ({
  visible: true,
  online: true,
  saveData: false,
  bridgeReady: true,
  sessionCount: 0,
  recentJobTimesMs: [],
  nowMs: 1_000_000_000,
  ...over,
});

describe("workerGate", () => {
  it("her koşul sağlanınca çalışır", () => {
    expect(workerGate(env())).toEqual({ run: true });
  });
  it("köprü yoksa, sekme gizliyse, çevrimdışıysa, veri tasarrufundaysa çalışmaz", () => {
    expect(workerGate(env({ bridgeReady: false }))).toEqual({ run: false, reason: "no_bridge" });
    expect(workerGate(env({ visible: false }))).toEqual({ run: false, reason: "hidden" });
    expect(workerGate(env({ online: false }))).toEqual({ run: false, reason: "offline" });
    expect(workerGate(env({ saveData: true }))).toEqual({ run: false, reason: "save_data" });
  });
  it("oturum ve saatlik sınır", () => {
    expect(workerGate(env({ sessionCount: WORKER_LIMITS.maxPerSession }))).toEqual({ run: false, reason: "session_cap" });
    const base = 1_000_000_000;
    const recent = Array.from({ length: WORKER_LIMITS.maxPerHour }, (_, i) => base - i * 1000);
    expect(workerGate(env({ recentJobTimesMs: recent }))).toEqual({ run: false, reason: "hour_cap" });
    const old = Array.from({ length: WORKER_LIMITS.maxPerHour }, () => base - 2 * 3_600_000);
    expect(workerGate(env({ recentJobTimesMs: old }))).toEqual({ run: true });
  });
});

describe("gecikme ve geri çekilme", () => {
  it("iş arası en az 20 sn, sapma sınırlı", () => {
    expect(nextDelayMs("done", 0, 0)).toBe(WORKER_LIMITS.minIntervalMs);
    expect(nextDelayMs("done", 0, 1)).toBe(WORKER_LIMITS.minIntervalMs + WORKER_LIMITS.jitterMs);
    expect(nextDelayMs("done", 0, 5)).toBe(WORKER_LIMITS.minIntervalMs + WORKER_LIMITS.jitterMs);
  });
  it("hata geri çekilmesi üsteldir ve 15 dakikayı aşmaz", () => {
    expect(errorBackoffMs(1)).toBe(60_000);
    expect(errorBackoffMs(2)).toBe(120_000);
    expect(errorBackoffMs(3)).toBe(240_000);
    expect(errorBackoffMs(30)).toBe(WORKER_LIMITS.errorBackoffMaxMs);
    expect(nextDelayMs("rate_limited", 0, 0)).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe("replyToReport (muhafazakâr: belirsiz asla 'yok' değildir)", () => {
  const at = "2026-10-06T10:00:00.000Z";
  it("açık 'bulunamadı' işareti ve hata yoksa absent", () => {
    expect(replyToReport({ found: false, notFound: true }, at).result).toBe("absent");
  });
  it("found=false ama notFound işareti yoksa absent DEĞİL", () => {
    expect(replyToReport({ found: false }, at).result).toBe("error");
    expect(replyToReport({}, at).result).toBe("error");
    expect(replyToReport(null, at).result).toBe("error");
  });
  it("engel/hata blocked ya da error olur, absent olmaz", () => {
    expect(replyToReport({ found: false, notFound: true, error: "captcha" }, at).result).toBe("blocked");
    expect(replyToReport({ error: "http_429" }, at).result).toBe("blocked");
    expect(replyToReport({ error: "timeout" }, at).result).toBe("blocked");
    expect(replyToReport({ error: "parse_error" }, at).result).toBe("error");
  });
  it("present yalnız izinli, sınırlı alanları taşır", () => {
    const r = replyToReport({ found: true, price: 2_500_000, title: "x".repeat(500), advisorName: "A", status: "active", html: "<b>", phone: "05" }, at);
    expect(r.result).toBe("present");
    expect(Object.keys(r.observed).sort()).toEqual(["advisor_name", "price", "status", "title"]);
    expect(r.observed.title).toHaveLength(300);
  });
  it("geçersiz fiyat atılır", () => {
    expect(replyToReport({ found: true, price: -5 }, at).observed.price).toBeUndefined();
    expect(replyToReport({ found: true, price: 1e13 }, at).observed.price).toBeUndefined();
  });
});

describe("güven seviyesi", () => {
  it("sunucu basamaklarıyla uyumlu", () => {
    expect(confidenceLevel("confirmed_missing", 0.95)).toBe("yuksek");
    expect(confidenceLevel("confirmed_missing", 0.85)).toBe("yuksek");
    expect(confidenceLevel("probable_missing", 0.7)).toBe("orta");
    expect(confidenceLevel("suspect", 0.3)).toBe("dusuk");
    expect(confidenceLevel("unverifiable", 0.9)).toBe("yok");
    expect(confidenceLevel("verified", null)).toBe("yok");
  });
});

describe("isAllowedProbeUrl", () => {
  it("yalnız adaptör host'unda https", () => {
    const hosts = ["sahibinden.com"];
    expect(isAllowedProbeUrl("https://www.sahibinden.com/ilan/x-123456/detay", hosts)).toBe(true);
    expect(isAllowedProbeUrl("http://www.sahibinden.com/ilan/x", hosts)).toBe(false);
    expect(isAllowedProbeUrl("https://sahibinden.com.evil.io/x", hosts)).toBe(false);
    expect(isAllowedProbeUrl("https://user:pw@sahibinden.com/x", hosts)).toBe(false);
    expect(isAllowedProbeUrl(null, hosts)).toBe(false);
    expect(isAllowedProbeUrl("not a url", hosts)).toBe(false);
  });
});

describe("parseBridgeMessage", () => {
  it("yalnız köprü kaynaklı geçerli iletiler", () => {
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "ready", version: "1.2" })).toEqual({ type: "ready", version: "1.2" });
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "verify-response", id: "abc", reply: { found: true } })).toEqual({
      type: "verify-response",
      id: "abc",
      reply: { found: true },
    });
    expect(parseBridgeMessage({ source: "other", type: "ready" })).toBeNull();
    expect(parseBridgeMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "verify-response", id: "" })).toBeNull();
    expect(parseBridgeMessage("x")).toBeNull();
  });
});
