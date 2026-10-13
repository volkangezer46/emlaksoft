import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { demoUntilValid, effectiveDemoPolicy, parseDemoPolicyRow } from "./demo-policy";
import { effectiveMfaRequired, isMfaEnforced, mfaRequiredAtEdge, mfaRequiredFor, type MfaPolicyNow } from "./mfa-policy";
import {
  isPathUnderMaintenance,
  maintenanceRetryAfterSec,
  parseMaintenanceScope,
  type MaintenanceScope,
} from "./maintenance-scope";

const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const BOTH = { tenant: true, platform: true };
const TENANT_ONLY = { tenant: true, platform: false };
const NONE = { tenant: false, platform: false };

describe("effectiveDemoPolicy (env tavanı + yönetim anahtarı)", () => {
  it("env tavanı kapalıysa DB hiçbir şeyi açamaz", () => {
    expect(effectiveDemoPolicy(NONE, null, NOW)).toEqual({ tenant: false, platform: false });
    expect(effectiveDemoPolicy(NONE, { mode: "tenant_platform", until: iso(NOW + H) }, NOW)).toEqual({ tenant: false, platform: false });
    expect(effectiveDemoPolicy(TENANT_ONLY, { mode: "tenant_platform", until: iso(NOW + H) }, NOW)).toEqual({ tenant: true, platform: false });
    // Platform tavanı tek başına (ofis tavanı kapalı) platformu açmaz.
    expect(effectiveDemoPolicy({ tenant: false, platform: true }, null, NOW).platform).toBe(false);
  });

  it("DB satırı yoksa env davranışı aynen sürer (sahip kararı: yayın davranışı değişmez)", () => {
    expect(effectiveDemoPolicy(BOTH, null, NOW)).toEqual({ tenant: true, platform: true });
    expect(effectiveDemoPolicy(TENANT_ONLY, null, NOW)).toEqual({ tenant: true, platform: false });
  });

  it("off hepsini, tenant platformu kapatır", () => {
    expect(effectiveDemoPolicy(BOTH, { mode: "off", until: null }, NOW)).toEqual({ tenant: false, platform: false });
    expect(effectiveDemoPolicy(BOTH, { mode: "tenant", until: null }, NOW)).toEqual({ tenant: true, platform: false });
  });

  it("tenant_platform yalnız until gelecekteyse ve en çok 24 saatse platformu açar", () => {
    expect(effectiveDemoPolicy(BOTH, { mode: "tenant_platform", until: iso(NOW + 2 * H) }, NOW).platform).toBe(true);
    expect(effectiveDemoPolicy(BOTH, { mode: "tenant_platform", until: iso(NOW + 24 * H) }, NOW).platform).toBe(true);
    // süre dolmuş
    expect(effectiveDemoPolicy(BOTH, { mode: "tenant_platform", until: iso(NOW - 1) }, NOW)).toEqual({ tenant: true, platform: false });
    // 24 saat sınırı aşılmış (elle yazılmış bozuk satır)
    expect(effectiveDemoPolicy(BOTH, { mode: "tenant_platform", until: iso(NOW + 24 * H + 1) }, NOW).platform).toBe(false);
    // until yok
    expect(effectiveDemoPolicy(BOTH, { mode: "tenant_platform", until: null }, NOW).platform).toBe(false);
    expect(demoUntilValid("çöp", NOW)).toBe(false);
  });

  it("bozuk satır yok sayılır (env davranışı)", () => {
    expect(parseDemoPolicyRow("{bozuk")).toBeNull();
    expect(parseDemoPolicyRow('{"mode":"hepsi"}')).toBeNull();
    expect(parseDemoPolicyRow("")).toBeNull();
    expect(parseDemoPolicyRow('{"mode":"tenant","until":null,"reason":"x"}')).toMatchObject({ mode: "tenant", until: null });
  });
});

describe("effectiveMfaRequired", () => {
  it("env veya DB 'on' zorunlu kılar; ikisi de kapalıysa zorunlu değil", () => {
    expect(effectiveMfaRequired(undefined, null, null, false, NOW)).toBe(false);
    expect(effectiveMfaRequired("on", null, null, false, NOW)).toBe(true);
    expect(effectiveMfaRequired(undefined, "on", null, false, NOW)).toBe(true);
    expect(effectiveMfaRequired("off", "off", null, true, NOW)).toBe(false);
  });

  it("force-off acil kapatmadır (DB açık olsa bile)", () => {
    expect(effectiveMfaRequired("force-off", "on", null, true, NOW)).toBe(false);
    expect(isMfaEnforced("FORCE-OFF", "on")).toBe(false);
  });

  it("geçiş süresinde doğrulayıcısı olmayan serbest, olan zorunlu; süre bitince herkes zorunlu", () => {
    const grace = iso(NOW + 7 * 24 * H);
    expect(effectiveMfaRequired(undefined, "on", grace, false, NOW)).toBe(false);
    expect(effectiveMfaRequired(undefined, "on", grace, true, NOW)).toBe(true);
    expect(effectiveMfaRequired(undefined, "on", iso(NOW - 1), false, NOW)).toBe(true);
  });

  it("proxy kuralı: geçiş süresinde yönlendirme yok", () => {
    expect(mfaRequiredAtEdge(undefined, "on", iso(NOW + H), NOW)).toBe(false);
    expect(mfaRequiredAtEdge(undefined, "on", null, NOW)).toBe(true);
    const policy: MfaPolicyNow = { envMode: "unset", dbRaw: "on", dbOn: true, enforced: true, graceUntil: iso(NOW + H), graceActive: true, nowMs: NOW };
    expect(mfaRequiredFor(policy)).toBe(false);
    expect(mfaRequiredFor(policy, true)).toBe(true);
    expect(mfaRequiredFor(policy, false)).toBe(false);
  });
});

describe("isPathUnderMaintenance", () => {
  const W = { startsAt: null, endsAt: null };
  const table: [string, MaintenanceScope, boolean][] = [
    ["/", "app", false],
    ["/", "app_vitrin", false],
    ["/", "site", true],
    ["/app", "app", true],
    ["/app/musteriler", "app", true],
    ["/application", "app", false],
    ["/vitrin/ofis", "app", false],
    ["/vitrin/ofis", "app_vitrin", true],
    ["/kayit", "app_vitrin", false],
    ["/kayit", "site", true],
    ["/fiyatlar", "site", true],
    ["/admin", "site", false],
    ["/giris/mfa", "site", false],
    ["/api/statik/ana-sayfa", "site", false],
    ["/bakim", "site", false],
  ];
  it.each(table)("%s · %s → %s", (path, scope, expected) => {
    expect(isPathUnderMaintenance(path, scope, W, NOW)).toBe(expected);
  });

  it("zaman penceresi: başlamamış veya bitmişse bakım yok", () => {
    expect(isPathUnderMaintenance("/app", "app", { startsAt: iso(NOW + H), endsAt: null }, NOW)).toBe(false);
    expect(isPathUnderMaintenance("/app", "app", { startsAt: null, endsAt: iso(NOW - 1) }, NOW)).toBe(false);
    expect(isPathUnderMaintenance("/app", "app", { startsAt: iso(NOW - H), endsAt: iso(NOW + H) }, NOW)).toBe(true);
  });

  it("Retry-After bitişten hesaplanır, yoksa 600", () => {
    expect(maintenanceRetryAfterSec({ startsAt: null, endsAt: null }, NOW)).toBe(600);
    expect(maintenanceRetryAfterSec({ startsAt: null, endsAt: iso(NOW + 2 * H) }, NOW)).toBe(7200);
    expect(maintenanceRetryAfterSec({ startsAt: null, endsAt: iso(NOW + 5_000) }, NOW)).toBe(60);
  });

  it("kapsam satırı yok/bozuksa varsayılan 'app' (ana sayfa korunur)", () => {
    expect(parseMaintenanceScope(null).scope).toBe("app");
    expect(parseMaintenanceScope("{x").scope).toBe("app");
    expect(parseMaintenanceScope('{"scope":"evren"}').scope).toBe("app");
    expect(parseMaintenanceScope('{"scope":"site","endsAt":"2026-10-13T12:00:00Z"}')).toEqual({
      scope: "site",
      startsAt: null,
      endsAt: "2026-10-13T12:00:00.000Z",
    });
  });
});

describe("bayrak ekranı sözleşmesi", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  it("bayrak ekranında ve envanterde 'Vercel' geçmez (yayın sunucu ortamından)", () => {
    for (const f of [
      "src/app/admin/ayarlar/bayraklar/page.tsx",
      "src/app/admin/ayarlar/bayraklar/flag-controls.tsx",
      "src/lib/feature-flags/registry.ts",
    ]) {
      expect(read(f), f).not.toMatch(/vercel/i);
    }
  });
  it("demo girişi satırı doğru ortam değişkenlerini gösterir", () => {
    const reg = read("src/lib/feature-flags/registry.ts");
    expect(reg).toContain('"PRODUCTION_DEMO_LOGIN_OPT_IN", "PRODUCTION_PLATFORM_DEMO_OPT_IN"');
    expect(reg).not.toContain('envVar: "ENABLE_DEMO_LOGIN"');
  });
  it("üst çubuk saati Türkiye saatiyle gösterilir", () => {
    expect(read("src/components/admin/admin-topbar.tsx")).toContain('timeZone: "Europe/Istanbul"');
  });
});
