import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  API_KEY_PATTERN,
  WEBHOOK_EVENTS,
  deriveEndpointSecret,
  generateApiKey,
  hashApiKey,
  parseBearerKey,
  signWebhookBody,
  validateWebhookUrl,
  verifyWebhookSignature,
} from "./core";

const SERVER = "x".repeat(48);

describe("API anahtarı", () => {
  it("biçim DB desenine uyar; özet 64 hex; anahtarın kendisi saklanmaz", () => {
    const { key, prefix } = generateApiKey();
    expect(prefix).toMatch(/^es_[a-z0-9]{8}$/);
    expect(key).toMatch(API_KEY_PATTERN);
    expect(key.startsWith(`${prefix}_`)).toBe(true);
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateApiKey().key).not.toBe(key);
    const action = readFileSync("src/app/actions/integrations-api.ts", "utf8");
    expect(action).toContain("key_hash: hashApiKey(key)");
    expect(action).not.toMatch(/insert\(\{[^}]*\bkey,/);
  });

  it("Bearer ayrıştırma yalnız geçerli biçimi kabul eder", () => {
    const { key } = generateApiKey();
    expect(parseBearerKey(`Bearer ${key}`)).toBe(key);
    expect(parseBearerKey(`bearer ${key}`)).toBe(key);
    expect(parseBearerKey("Bearer abc")).toBeNull();
    expect(parseBearerKey(null)).toBeNull();
  });
});

describe("webhook", () => {
  it("URL: yalnız https + herkese açık alan adı", () => {
    expect(validateWebhookUrl("https://ornek.com/hook").ok).toBe(true);
    for (const bad of ["http://ornek.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://servis.internal/x", "https://user:p@ornek.com", "https://ornek.com:8443/x", "ftp://ornek.com", "https://[::1]/x"]) {
      expect(validateWebhookUrl(bad).ok, bad).toBe(false);
    }
  });

  it("imza: uç + sürümden türetilir; doğrulama zaman toleranslı ve sabit-zamanlı", () => {
    const s1 = deriveEndpointSecret(SERVER, "ep1", 1);
    expect(s1).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(deriveEndpointSecret(SERVER, "ep1", 2)).not.toBe(s1);
    expect(deriveEndpointSecret(SERVER, "ep2", 1)).not.toBe(s1);
    const body = JSON.stringify({ event: "customer.created" });
    const header = signWebhookBody(s1, 1_800_000_000, body);
    expect(verifyWebhookSignature(s1, header, body, 1_800_000_100)).toBe(true);
    expect(verifyWebhookSignature(s1, header, body, 1_800_001_000)).toBe(false);
    expect(verifyWebhookSignature(s1, header, `${body} `, 1_800_000_100)).toBe(false);
    expect(verifyWebhookSignature(deriveEndpointSecret(SERVER, "ep1", 2), header, body, 1_800_000_100)).toBe(false);
  });

  it("olay listesi migration CHECK'iyle aynı; anon RPC yalnız okuma; sır kolonu yok", () => {
    const sql = readFileSync("supabase/migrations/20261007000320_webhooks_api_keys.sql", "utf8");
    for (const e of WEBHOOK_EVENTS) expect(sql).toContain(`'${e}'`);
    expect(sql).toMatch(/grant execute on function public\.api_v1_list\(text, text, integer, timestamptz\) to anon/);
    expect(sql).not.toMatch(/grant execute on function public\.webhook_enqueue[^;]*anon/);
    expect(sql).not.toMatch(/\bsecret\s+text\b/);
    expect(sql).toContain("is_sample = false");
  });

  it("teslim yalnız SSRF korumalı safeWebhookPost (teslim anı DNS denetimi, yönlendirme yok, zaman sınırı) ile; yeni cron yok", () => {
    const src = readFileSync("src/lib/integrations-api/webhooks.ts", "utf8");
    expect(src).toContain("safeWebhookPost(");
    expect(src).not.toContain("fetchExternal(");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    const vercel = readFileSync("vercel.json", "utf8");
    expect(vercel).not.toContain("webhook");
  });
});
