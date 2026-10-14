import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { createPreviewToken, draftHash, isPreviewEnabled, isPreviewTtl, previewKey, verifyPreviewToken } from "./preview-token";

const ENV = { PLATFORM_SECRETS_KEY: "a".repeat(64) };
const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;

function make(hash = "h1", ttlHours: 1 | 24 | 168 = 24, env: Record<string, string | undefined> = ENV) {
  const r = createPreviewToken({ surface: "sitecontent", draftHash: hash, ttlHours, nowMs: T0 }, env);
  if (!r) throw new Error("belirteç üretilemedi");
  return r.token;
}

describe("önizleme belirteci", () => {
  it("imzalı belirteç doğrulanır ve taslak özetini taşır", () => {
    const v = verifyPreviewToken(make("abc"), { surface: "sitecontent", nowMs: T0 + HOUR }, ENV);
    expect(v).toMatchObject({ ok: true, draftHash: "abc", surface: "sitecontent" });
  });

  it("süre: 1 / 24 / 168 saat; süre dolunca 'expired'", () => {
    expect([1, 24, 168].every(isPreviewTtl)).toBe(true);
    expect(isPreviewTtl(2)).toBe(false);
    const t1 = make("x", 1);
    expect(verifyPreviewToken(t1, { surface: "sitecontent", nowMs: T0 + HOUR - 1000 }, ENV).ok).toBe(true);
    expect(verifyPreviewToken(t1, { surface: "sitecontent", nowMs: T0 + HOUR }, ENV)).toEqual({ ok: false, reason: "expired" });
    const t168 = make("x", 168);
    expect(verifyPreviewToken(t168, { surface: "sitecontent", nowMs: T0 + 167 * HOUR }, ENV).ok).toBe(true);
    expect(verifyPreviewToken(t168, { surface: "sitecontent", nowMs: T0 + 168 * HOUR + 1 }, ENV).ok).toBe(false);
  });

  it("sahte imza, değiştirilmiş gövde ve başka anahtar reddedilir", () => {
    const tok = make("abc");
    const [body, sig] = tok.split(".") as [string, string];
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifyPreviewToken(`${body}.${flipped}`, { surface: "sitecontent", nowMs: T0 }, ENV)).toEqual({ ok: false, reason: "signature" });
    // Gövdede özet/süre değiştirilir, imza aynı kalır.
    const forged = Buffer.from(JSON.stringify({ s: "sitecontent", h: "baska", e: Math.floor(T0 / 1000) + 9_999_999 })).toString("base64url");
    expect(verifyPreviewToken(`${forged}.${sig}`, { surface: "sitecontent", nowMs: T0 }, ENV)).toEqual({ ok: false, reason: "signature" });
    expect(verifyPreviewToken(tok, { surface: "sitecontent", nowMs: T0 }, { PLATFORM_SECRETS_KEY: "b".repeat(64) })).toEqual({ ok: false, reason: "signature" });
    for (const bad of ["", "abc", "a.b.c", "äö.xy", null, 42, `${"x".repeat(600)}.y`]) {
      expect(verifyPreviewToken(bad, { surface: "sitecontent", nowMs: T0 }, ENV).ok).toBe(false);
    }
  });

  it("taslak değişince özet uyuşmaz (eski bağlantı geçersiz)", () => {
    const a = defaultSiteContent();
    const b = structuredClone(a);
    b.hero.badge = "Yeni rozet";
    expect(draftHash(a)).toBe(draftHash(structuredClone(a)));
    expect(draftHash(a)).not.toBe(draftHash(b));
    const v = verifyPreviewToken(make(draftHash(a)), { surface: "sitecontent", nowMs: T0 }, ENV);
    expect(v.ok && v.draftHash === draftHash(b)).toBe(false);
  });

  it("anahtar alan ayrımlı türetilir; sır yoksa önizleme kapalı", () => {
    expect(previewKey({})).toBeNull();
    expect(isPreviewEnabled({ PLATFORM_SECRETS_KEY: "  ", CRON_SECRET: "" })).toBe(false);
    expect(createPreviewToken({ surface: "sitecontent", draftHash: "h", ttlHours: 24, nowMs: T0 }, {})).toBeNull();
    expect(verifyPreviewToken(make(), { surface: "sitecontent", nowMs: T0 }, {})).toEqual({ ok: false, reason: "disabled" });
    // CRON_SECRET yedek; ham sır imza anahtarı olarak KULLANILMAZ (türetilmiş anahtar sırdan farklı).
    const k = previewKey({ CRON_SECRET: "cron-secret" });
    expect(k).not.toBeNull();
    expect(k!.toString("utf8")).not.toContain("cron-secret");
    // PLATFORM_SECRETS_KEY varsa o önceliklidir.
    const viaCron = make("h", 24, { CRON_SECRET: "cron-secret" });
    expect(verifyPreviewToken(viaCron, { surface: "sitecontent", nowMs: T0 }, { CRON_SECRET: "cron-secret", PLATFORM_SECRETS_KEY: "p".repeat(64) }).ok).toBe(false);
  });

  it("doğrulama sabit zamanlı karşılaştırma kullanır", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/preview-token.ts"), "utf8");
    expect(src).toContain("timingSafeEqual(");
    expect(src).toContain('"emlaksoft-preview-v1"');
  });
});

describe("önizleme rotası sözleşmesi", () => {
  const page = readFileSync(join(process.cwd(), "src/app/onizleme/ana-sayfa/page.tsx"), "utf8");
  it("dinamik, noindex, taslağı gerçek ana sayfa işleviyle çizer", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(page).toContain("renderHome({ content: draft.content, pricing, efCatalog, preview: true })");
    expect(page).toContain("getPublicPricing()");
    expect(page).toContain('reason="stale"');
  });
  it("next.config: /onizleme no-store + X-Robots-Tag noindex", () => {
    const cfg = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    const block = cfg.slice(cfg.indexOf('source: "/onizleme/:path*"'), cfg.indexOf('source: "/onizleme/:path*"') + 300);
    expect(block).toContain("no-store");
    expect(block).toMatch(/X-Robots-Tag", value: "noindex/);
  });
  it("şematik önizlemede sabit deneme günü yok", () => {
    const preview = readFileSync(join(process.cwd(), "src/app/admin/site/sayfalar/ana-sayfa/content-preview.tsx"), "utf8");
    expect(preview).not.toMatch(/trialDays\s*=\s*\d/);
    expect(preview).not.toContain("PLANS");
  });
});
