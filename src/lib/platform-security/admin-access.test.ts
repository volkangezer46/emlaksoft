import { describe, expect, it } from "vitest";
import {
  adminIpAllowed,
  decideIdle,
  ipMatches,
  isAdminPolicyPath,
  parseAllowlist,
  parseIp,
  sessionExpired,
  sessionStartSec,
  signIdleCookie,
  validateAllowlist,
  verifyIdleCookie,
} from "./admin-access";
import { policyFromRows, readAdminAccessPolicyCached, resetAdminAccessCache } from "./admin-access-cache";
import { parseImpersonationReason } from "./impersonation-reason";
import { normalizeStepUpCode } from "./step-up-policy";
import { validateAgeRecipient, validateRemoteTarget } from "@/lib/ops/backup-settings";
import { evaluateDrill } from "@/lib/ops/restore-drill-status";

describe("IP izin listesi", () => {
  it("IPv4/IPv6 ayrıştırır, bozuğu reddeder", () => {
    expect(parseIp("203.0.113.7")?.v).toBe(4);
    expect(parseIp("2001:db8::1")?.v).toBe(6);
    expect(parseIp("::ffff:10.1.2.3")).toEqual(parseIp("10.1.2.3"));
    for (const bad of ["", "256.1.1.1", "1.2.3", "abc", "2001:db8:::1", "1.2.3.4.5"]) expect(parseIp(bad), bad).toBeNull();
  });

  it("tekil adres ve CIDR eşleşir; yorum ve virgül desteklenir", () => {
    const { rules, invalid } = parseAllowlist("203.0.113.7  # ofis\n10.8.0.0/16, 2001:db8::/32");
    expect(invalid).toEqual([]);
    expect(rules).toHaveLength(3);
    expect(ipMatches(rules, "203.0.113.7")).toBe(true);
    expect(ipMatches(rules, "203.0.113.8")).toBe(false);
    expect(ipMatches(rules, "10.8.255.1")).toBe(true);
    expect(ipMatches(rules, "10.9.0.1")).toBe(false);
    expect(ipMatches(rules, "2001:db8:abcd::5")).toBe(true);
    expect(ipMatches(rules, "2001:db9::5")).toBe(false);
    expect(ipMatches(rules, null)).toBe(false);
  });

  it("geçersiz kural kayıtta reddedilir", () => {
    expect(validateAllowlist("10.0.0.0/33")).toMatch(/Geçersiz/);
    expect(validateAllowlist("evil; rm -rf")).toMatch(/Geçersiz/);
    expect(validateAllowlist("")).toBeNull();
    expect(validateAllowlist("1.1.1.1\n2.2.2.0/24")).toBeNull();
  });

  it("liste dışındaki IP engellenir; boş liste ve acil kapatma serbest", () => {
    const policy = { rules: parseAllowlist("198.51.100.0/24").rules };
    expect(adminIpAllowed(policy, "198.51.100.9")).toBe(true);
    expect(adminIpAllowed(policy, "203.0.113.1")).toBe(false);
    expect(adminIpAllowed(policy, null)).toBe(false);
    expect(adminIpAllowed(policy, "203.0.113.1", "off")).toBe(true);
    expect(adminIpAllowed({ rules: [] }, "203.0.113.1")).toBe(true);
  });

  it("politika yolları: /admin ve /api/admin (başka /api değil)", () => {
    for (const p of ["/admin", "/admin/personel", "/api/admin", "/api/admin/notifications"]) expect(isAdminPolicyPath(p), p).toBe(true);
    for (const p of ["/app", "/api/cron/x", "/administrator", "/giris"]) expect(isAdminPolicyPath(p), p).toBe(false);
  });

  it("ayar satırlarından politika; okuma hatasında son başarılı değer korunur", async () => {
    expect(policyFromRows([{ key: "platform.admin_ip_allowlist", value: "1.2.3.4" }, { key: "platform.session_idle_minutes", value: "15" }])).toMatchObject({
      idleMinutes: 15,
      maxHours: 12,
    });
    resetAdminAccessCache();
    const ok = async () => new Response(JSON.stringify([{ key: "platform.admin_ip_allowlist", value: "1.2.3.4" }]), { status: 200 });
    const first = await readAdminAccessPolicyCached({ nowMs: 1_000, url: "https://x", key: "k", fetchImpl: ok as typeof fetch });
    expect(first.rules).toHaveLength(1);
    const fail = async () => new Response("", { status: 500 });
    const second = await readAdminAccessPolicyCached({ nowMs: 100_000, url: "https://x", key: "k", fetchImpl: fail as typeof fetch });
    expect(second.rules).toHaveLength(1); // DB kesintisinde liste kendiliğinden açılmaz
    resetAdminAccessCache();
  });
});

describe("boşta kalma ve oturum ömrü", () => {
  it("imzalı etkinlik çerezi yalnız aynı kullanıcı ve aynı sırla doğrulanır", async () => {
    const c = await signIdleCookie("u1", 1_700_000_000, "sir");
    expect(await verifyIdleCookie(c, "u1", "sir")).toBe(1_700_000_000);
    expect(await verifyIdleCookie(c, "u2", "sir")).toBeNull();
    expect(await verifyIdleCookie(c, "u1", "baska")).toBeNull();
    expect(await verifyIdleCookie(c.replace("1700000000", "1800000000"), "u1", "sir")).toBeNull();
    expect(await verifyIdleCookie(undefined, "u1", "sir")).toBeNull();
  });

  it("süre aşımı, yenileme ve önceden yükleme kararları", () => {
    expect(decideIdle(1000, 1000 + 61 * 60, 60, false)).toEqual({ kind: "expired" });
    expect(decideIdle(1000, 1000 + 61 * 60, 60, true)).toEqual({ kind: "expired" });
    expect(decideIdle(1000, 1000 + 61 * 60, 0, false)).toEqual({ kind: "refresh" });
    expect(decideIdle(null, 5000, 60, false)).toEqual({ kind: "refresh" });
    expect(decideIdle(1000, 1030, 60, false)).toEqual({ kind: "keep" });
    expect(decideIdle(1000, 1100, 60, true)).toEqual({ kind: "keep" });
  });

  it("oturum başlangıcı JWT amr'den; ömür aşımı", () => {
    const start = sessionStartSec({ amr: [{ method: "totp", timestamp: 2000 }, { method: "password", timestamp: 1000 }] });
    expect(start).toBe(1000);
    expect(sessionStartSec({})).toBeNull();
    expect(sessionExpired(1000, 1000 + 12 * 3600 + 1, 12)).toBe(true);
    expect(sessionExpired(1000, 1000 + 3600, 12)).toBe(false);
    expect(sessionExpired(1000, 9_999_999, 0)).toBe(false);
    expect(sessionExpired(null, 9_999_999, 12)).toBe(false);
  });
});

describe("destek erişimi gerekçesi ve kritik işlem kodu", () => {
  it("gerekçe ve bilet no olmadan erişim başlamaz", () => {
    expect(parseImpersonationReason("", "T-1")).toMatchObject({ ok: false, code: "gerekce" });
    expect(parseImpersonationReason("kısa", "T-1")).toMatchObject({ ok: false, code: "gerekce" });
    expect(parseImpersonationReason("Portföy listeleme sorunu inceleniyor", "")).toMatchObject({ ok: false, code: "bilet" });
    expect(parseImpersonationReason("Portföy listeleme sorunu inceleniyor", "a b")).toMatchObject({ ok: false, code: "bilet" });
    expect(parseImpersonationReason("  Portföy   listeleme sorunu  ", "#1042")).toEqual({ ok: true, reason: "Portföy listeleme sorunu", ticketId: "#1042" });
  });

  it("TOTP kodu 6 hane", () => {
    expect(normalizeStepUpCode("123 456")).toBe("123456");
    expect(normalizeStepUpCode("12345")).toBeNull();
    expect(normalizeStepUpCode(undefined)).toBeNull();
    expect(normalizeStepUpCode("abcdef")).toBeNull();
  });
});

describe("yedek ayarları ve tatbikat durumu", () => {
  it("age açık anahtarı ve uzak hedef biçimi (seçenek enjeksiyonu yok)", () => {
    expect(validateAgeRecipient("age1" + "q".repeat(58))).toBeNull();
    expect(validateAgeRecipient("AGE-SECRET-KEY-1ABC")).not.toBeNull();
    expect(validateAgeRecipient("")).toBeNull();
    expect(validateRemoteTarget("u123@u123.your-storagebox.de:emlaksoft")).toBeNull();
    expect(validateRemoteTarget("yedek:emlaksoft-yedek/gece")).toBeNull();
    expect(validateRemoteTarget("-e sh x:y")).not.toBeNull();
    expect(validateRemoteTarget("u@h:a;rm")).not.toBeNull();
  });

  it("tatbikat kaydı: başarılı/başarısız/eski/yok", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    const ok = JSON.stringify({ at: "2026-10-11T00:40:00Z", status: "ok", durationSec: 95, tablesChecked: 10, mismatches: [] });
    expect(evaluateDrill(ok, now)).toMatchObject({ tone: "ok", record: { durationSec: 95, ok: true } });
    const bad = JSON.stringify({ at: "2026-10-11T00:40:00Z", status: "error", detail: "1 tabloda satır sayısı tutmadı" });
    expect(evaluateDrill(bad, now).tone).toBe("danger");
    const old = JSON.stringify({ at: "2026-09-01T00:00:00Z", status: "ok" });
    expect(evaluateDrill(old, now).tone).toBe("warn");
    expect(evaluateDrill(null, now)).toMatchObject({ tone: "none", record: null });
  });
});
