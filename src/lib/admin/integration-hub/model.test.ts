import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNetgsmBalance } from "@/lib/messaging/netgsm";
import { secretFingerprint } from "@/lib/settings/secrets";
import { ADMIN_NAV, activeTabHref } from "@/lib/admin/nav";
import {
  HUB_KEYS,
  HUB_META,
  INTEGRATIONS_HREF,
  cardTone,
  errorRate,
  hostOf,
  isHubKey,
  lastTestsFrom,
  latest,
  sortCards,
  testAction,
  validateVapidPair,
  type HubCard,
} from "./model";

const base = (over: Partial<HubCard> = {}): HubCard => ({
  key: "openai",
  meta: HUB_META.openai,
  configured: true,
  notes: [],
  alarm: null,
  fingerprints: [],
  lastOkAt: null,
  lastFailAt: null,
  stats: null,
  usage: null,
  lastTest: null,
  ...over,
});

describe("entegrasyon merkezi modeli", () => {
  it("istenen tüm entegrasyonlar kartta; her kartın girileceği yer söylenir", () => {
    for (const k of ["iyzico", "netgsm", "resend", "whatsapp", "google_gsc", "google_ads", "openai", "evds", "vapid", "portal_extension"]) {
      expect(HUB_KEYS).toContain(k);
    }
    for (const k of HUB_KEYS) expect(HUB_META[k].configureLabel.length, k).toBeGreaterThan(5);
    expect(isHubKey("openai")).toBe(true);
    expect(isHubKey("rm -rf")).toBe(false);
  });

  it("hata oranı: çağrı yoksa null (sahte %0 yok)", () => {
    expect(errorRate(null)).toBeNull();
    expect(errorRate({ ok: 0, fail: 0 })).toBeNull();
    expect(errorRate({ ok: 3, fail: 1 })).toBe(25);
  });

  it("ton: yapılandırılmamış off; alarm/başarısız test/yüksek hata danger; düşük hata warn", () => {
    expect(cardTone(base({ configured: false, alarm: "x" }))).toBe("off");
    expect(cardTone(base({ alarm: "401" }))).toBe("danger");
    expect(cardTone(base({ lastTest: { at: "2026-10-14T00:00:00Z", ok: false, message: null, durationMs: 1 } }))).toBe("danger");
    expect(cardTone(base({ stats: { ok: 1, fail: 1, source: "", href: "/" } }))).toBe("danger");
    expect(cardTone(base({ stats: { ok: 99, fail: 1, source: "", href: "/" } }))).toBe("warn");
    expect(cardTone(base())).toBe("ok");
    const sorted = sortCards([base({ key: "evds", configured: false }), base({ key: "iyzico", alarm: "x" }), base()]);
    expect(sorted.map((c) => c.key)).toEqual(["iyzico", "openai", "evds"]);
  });

  it("son test: entegrasyon başına en yeni kayıt; EmlakFiyati'nin eski 'state' biçimi okunur", () => {
    const t = lastTestsFrom([
      { action: testAction("openai"), created_at: "2026-10-14T10:00:00Z", meta: { ok: false, message: "OpenAI anahtarı reddedildi (yetkisiz).", duration_ms: 120 } },
      { action: testAction("openai"), created_at: "2026-10-13T10:00:00Z", meta: { ok: true } },
      { action: "integration.emlakfiyati.test", created_at: "2026-10-12T10:00:00Z", meta: { state: "connected" } },
      { action: "integration.bilinmeyen.test", created_at: "2026-10-12T10:00:00Z", meta: { ok: true } },
    ]);
    expect(t.openai).toEqual({ at: "2026-10-14T10:00:00Z", ok: false, message: "OpenAI anahtarı reddedildi (yetkisiz).", durationMs: 120 });
    expect(t.emlakfiyati?.ok).toBe(true);
    expect(Object.keys(t).sort()).toEqual(["emlakfiyati", "openai"]);
  });

  it("parmak izi sırrı sızdırmaz; webhook adresinden yalnız host", () => {
    const secret = "sk-test-1234567890abcdefghijklmnop";
    const f = secretFingerprint("openai_api_key", secret);
    expect(f).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(f).not.toContain(secret.slice(0, 6));
    expect(f).not.toContain(secret.slice(-4));
    expect(hostOf("https://hooks.example.com/t/SECRET-TOKEN?sig=abc")).toBe("hooks.example.com");
    expect(hostOf("bozuk")).toBe("—");
    expect(latest(null, "2026-10-01", "2026-10-02", undefined)).toBe("2026-10-02");
  });

  it("VAPID çifti biçim denetimi", () => {
    const pub = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
    const priv = Buffer.alloc(32, 2).toString("base64url");
    expect(validateVapidPair(pub, priv).ok).toBe(true);
    expect(validateVapidPair(null, priv).ok).toBe(false);
    expect(validateVapidPair(priv, priv).ok).toBe(false);
    expect(validateVapidPair(pub, pub).ok).toBe(false);
  });

  it("Netgsm bakiye yanıtı yorumlanır (kimlik reddi ayrı)", () => {
    expect(parseNetgsmBalance("00 157,40")).toMatchObject({ ok: true, credit: "157,40" });
    expect(parseNetgsmBalance("30")).toMatchObject({ ok: false, code: "30" });
    expect(parseNetgsmBalance("70")).toMatchObject({ ok: false, code: "70" });
    expect(parseNetgsmBalance("<xml/>")).toMatchObject({ ok: true, code: null });
  });

  it("menü: Sistem bölümünde 'Entegrasyonlar' sorgu sekmesi; ?sekme=entegrasyonlar onu etkin yapar", () => {
    const sistem = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/sistem")!;
    expect(sistem.tabs!.map((t) => t.href)).toContain(INTEGRATIONS_HREF);
    expect(activeTabHref("/admin/sistem", sistem.tabs!, "entegrasyonlar")).toBe(INTEGRATIONS_HREF);
  });
});

describe("entegrasyon merkezi sözleşmesi", () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

  it("okuyucu dış servis çağırmaz; ekrana ham sır değil parmak izi gider", () => {
    const reader = read("src/lib/admin/integration-hub/read.ts");
    expect(reader).not.toMatch(/fetchExternal\(|probe[A-Z]\w*\(/);
    expect(reader).toContain("secretFingerprint(");
    const view = read("src/app/admin/sistem/integrations-view.tsx");
    expect(view).not.toMatch(/\.apiKey\b|secretKey|password|apiToken/);
  });

  it("Test et: sistem kapısı + hız sınırı + denetim kaydı", () => {
    const action = read("src/app/actions/platform-integrations.ts");
    expect(action).toContain('module: "sistem"');
    expect(action).toContain("rate:");
    expect(action).toContain("logPlatformActivity(");
    expect(action).toContain("testAction(key)");
  });
});
