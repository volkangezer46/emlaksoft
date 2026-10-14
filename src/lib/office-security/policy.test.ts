import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICE_POLICY,
  OFFICE_IDLE_MINUTES_KEY,
  OFFICE_IP_ALLOWLIST_KEY,
  OFFICE_IP_OWNER_EXEMPT_KEY,
  OFFICE_MAX_HOURS_KEY,
  OFFICE_MFA_ROLES_KEY,
  OFFICE_NEW_DEVICE_ALERT_KEY,
  mfaSetupRequired,
  officeIpAllowed,
  officeSecurityLoginNotice,
  parseRoleList,
  policyFromSettingRows,
  policyNeedsProxy,
  validateRoleList,
} from "./policy";
import { readOfficeSecuritySnapshot, resetOfficeSecurityCache, snapshotFromRows } from "./policy-cache";
import { decideOfficeGate } from "./proxy-gate";
import { isNewDevice } from "./new-device";
import { signIdleCookie } from "@/lib/platform-security/admin-access";
import { getSettingDef } from "@/lib/settings/registry";
import { prepareWrite } from "@/lib/settings/prepare";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

describe("DG7 ofis güvenlik politikası (saf)", () => {
  it("varsayılan politika proxy'de hiçbir dala girmez (bugünkü davranış)", () => {
    expect(policyNeedsProxy(null)).toBe(false);
    expect(policyNeedsProxy(DEFAULT_OFFICE_POLICY)).toBe(false);
    expect(policyNeedsProxy(policyFromSettingRows([]))).toBe(false);
    // Yalnız bildirim açık: proxy işi yok.
    expect(policyNeedsProxy(policyFromSettingRows([{ key: OFFICE_NEW_DEVICE_ALERT_KEY, value: "on" }]))).toBe(false);
  });

  it("satırlar tipli politikaya çözülür; bozuk değer varsayılana düşer", () => {
    const p = policyFromSettingRows([
      { key: OFFICE_MFA_ROLES_KEY, value: "advisor, owner,hacker" },
      { key: OFFICE_IP_ALLOWLIST_KEY, value: "203.0.113.0/24\n# not\n10.0.0.1" },
      { key: OFFICE_IP_OWNER_EXEMPT_KEY, value: "off" },
      { key: OFFICE_IDLE_MINUTES_KEY, value: "30" },
      { key: OFFICE_MAX_HOURS_KEY, value: 99999 },
      { key: OFFICE_NEW_DEVICE_ALERT_KEY, value: true },
    ]);
    expect(p.mfaRoles).toEqual(["owner", "advisor"]);
    expect(p.ipRules).toHaveLength(2);
    expect(p.ipOwnerExempt).toBe(false);
    expect(p.idleMinutes).toBe(30);
    expect(p.maxHours).toBe(0);
    expect(p.newDeviceAlert).toBe(true);
    expect(policyNeedsProxy(p)).toBe(true);
  });

  it("rol listesi ayrıştırma ve doğrulama", () => {
    expect(parseRoleList("gm gm,readonly")).toEqual(["gm", "readonly"]);
    expect(validateRoleList("owner,advisor")).toBeNull();
    expect(validateRoleList("owner,root")).toMatch(/root/);
  });

  it("IP izni: liste dışı reddedilir; sahip muafiyeti ve acil kapatma geçirir", () => {
    const p = policyFromSettingRows([{ key: OFFICE_IP_ALLOWLIST_KEY, value: "198.51.100.0/24" }]);
    expect(officeIpAllowed(p, "advisor", "198.51.100.7")).toBe(true);
    expect(officeIpAllowed(p, "advisor", "203.0.113.9")).toBe(false);
    expect(officeIpAllowed(p, "advisor", null)).toBe(false);
    expect(officeIpAllowed(p, "owner", "203.0.113.9")).toBe(true);
    expect(officeIpAllowed({ ...p, ipOwnerExempt: false }, "owner", "203.0.113.9")).toBe(false);
    expect(officeIpAllowed({ ...p, ipOwnerExempt: false }, "owner", "203.0.113.9", "off")).toBe(true);
    expect(officeIpAllowed(DEFAULT_OFFICE_POLICY, "advisor", "203.0.113.9")).toBe(true);
  });

  it("2FA kurulumu yalnız zorunlu rolde ve 2FA kapalıyken", () => {
    const p = { mfaRoles: ["advisor"] };
    expect(mfaSetupRequired(p, "advisor", false)).toBe(true);
    expect(mfaSetupRequired(p, "advisor", true)).toBe(false);
    expect(mfaSetupRequired(p, "owner", false)).toBe(false);
  });

  it("giriş sayfası bildirimleri", () => {
    expect(officeSecurityLoginNotice("office_ip")).toMatch(/IP/);
    expect(officeSecurityLoginNotice("office_idle")).toMatch(/işlem yapılmadığı/);
    expect(officeSecurityLoginNotice("x")).toBeNull();
  });

  it("yeni cihaz: ilk giriş sayılmaz; aynı OS+tarayıcı yeni değil", () => {
    expect(isNewDevice([], CHROME_WIN)).toBe(false);
    expect(isNewDevice([CHROME_WIN], CHROME_WIN)).toBe(false);
    expect(isNewDevice([CHROME_WIN], SAFARI_IOS)).toBe(true);
  });
});

describe("DG7 kayıt defteri", () => {
  it("altı anahtar ofis kapsamı, köprü (yalnız Güvenlik ekranından), varsayılanlar bugünkü davranış", () => {
    const defaults: Record<string, unknown> = {
      [OFFICE_MFA_ROLES_KEY]: "",
      [OFFICE_IP_ALLOWLIST_KEY]: "",
      [OFFICE_IP_OWNER_EXEMPT_KEY]: true,
      [OFFICE_IDLE_MINUTES_KEY]: 0,
      [OFFICE_MAX_HOURS_KEY]: 0,
      [OFFICE_NEW_DEVICE_ALERT_KEY]: false,
    };
    for (const [key, def] of Object.entries(defaults)) {
      const d = getSettingDef(key)!;
      expect(d, key).toBeTruthy();
      expect(d.scope).toBe("tenant");
      expect(d.storage).toBe("tenant_settings");
      expect(d.group).toBe("guvenlik");
      expect(d.editMode).toBe("bridge");
      expect(d.default, key).toEqual(def);
      // Merkezden (genel yazma yolu) yazılamaz.
      expect(prepareWrite({ key, value: d.codec.format(d.default), reason: "deneme gerekçe" }).ok).toBe(false);
    }
  });

  it("köprüden geçersiz IP ve rol reddedilir", () => {
    expect(prepareWrite({ key: OFFICE_IP_ALLOWLIST_KEY, value: "999.1.1.1", reason: "deneme gerekçe", fromBridge: true }).ok).toBe(false);
    expect(prepareWrite({ key: OFFICE_MFA_ROLES_KEY, value: "root", reason: "deneme gerekçe", fromBridge: true }).ok).toBe(false);
    expect(prepareWrite({ key: OFFICE_MFA_ROLES_KEY, value: "owner,advisor", reason: "deneme gerekçe", fromBridge: true }).ok).toBe(true);
  });
});

describe("DG7 proxy kararı", () => {
  const SECRET = "s".repeat(40);
  const base = {
    userId: "u1",
    role: "advisor",
    twoFactorOn: false,
    ip: "198.51.100.7",
    claims: { amr: [{ method: "password", timestamp: 1_000_000 }] },
    idleCookieValue: undefined,
    passive: false,
    nowSec: 1_000_100,
    secret: SECRET,
  };

  it("IP → oturum ömrü → boşta → 2FA sırası", async () => {
    const p = policyFromSettingRows([
      { key: OFFICE_IP_ALLOWLIST_KEY, value: "198.51.100.0/24" },
      { key: OFFICE_MFA_ROLES_KEY, value: "advisor" },
      { key: OFFICE_MAX_HOURS_KEY, value: "1" },
    ]);
    expect(await decideOfficeGate({ ...base, policy: p, ip: "203.0.113.1" })).toEqual({ kind: "end", reason: "office_ip" });
    expect(await decideOfficeGate({ ...base, policy: p, nowSec: 1_000_000 + 3601 })).toEqual({ kind: "end", reason: "office_session" });
    expect(await decideOfficeGate({ ...base, policy: p })).toEqual({ kind: "mfa_setup" });
    expect(await decideOfficeGate({ ...base, policy: p, twoFactorOn: true })).toEqual({ kind: "pass", idleCookie: null });
  });

  it("boşta kalma: ilk istek çerez yazar, süre aşılınca oturum biter, önceden yükleme etkinlik sayılmaz", async () => {
    const p = policyFromSettingRows([{ key: OFFICE_IDLE_MINUTES_KEY, value: "15" }]);
    const first = await decideOfficeGate({ ...base, policy: p });
    expect(first.kind).toBe("pass");
    expect(first.kind === "pass" && first.idleCookie).toBeTruthy();
    const cookie = await signIdleCookie("u1", base.nowSec, SECRET);
    expect(await decideOfficeGate({ ...base, policy: p, idleCookieValue: cookie, nowSec: base.nowSec + 15 * 60 + 1 })).toEqual({ kind: "end", reason: "office_idle" });
    expect(await decideOfficeGate({ ...base, policy: p, idleCookieValue: cookie, nowSec: base.nowSec + 120, passive: true })).toEqual({ kind: "pass", idleCookie: null });
    // Başka kullanıcının çerezi sayılmaz (yeni çerez yazılır, oturum bitmez).
    const other = await signIdleCookie("u2", base.nowSec - 99_999, SECRET);
    expect((await decideOfficeGate({ ...base, policy: p, idleCookieValue: other })).kind).toBe("pass");
  });
});

describe("DG7 politika önbelleği", () => {
  it("satırlar ofis başına gruplanır; başka anahtarlar atlanır", () => {
    const snap = snapshotFromRows([
      { tenant_id: "t1", key: OFFICE_MFA_ROLES_KEY, value: "owner" },
      { tenant_id: "t1", key: "office.alert.deal_stale_days", value: "7" },
      { tenant_id: "t2", key: OFFICE_IDLE_MINUTES_KEY, value: "10" },
      { bad: true },
    ]);
    expect(snap.get("t1")?.mfaRoles).toEqual(["owner"]);
    expect(snap.get("t2")?.idleMinutes).toBe(10);
    expect(snap.has("t3")).toBe(false);
  });

  it("tek okuma 30 sn paylaşılır; hata son başarılı görüntüyü korur", async () => {
    resetOfficeSecurityCache();
    let calls = 0;
    let fail = false;
    const fetchImpl = (async () => {
      calls += 1;
      if (fail) throw new Error("ağ");
      return new Response(JSON.stringify([{ tenant_id: "t1", key: OFFICE_IP_ALLOWLIST_KEY, value: "10.0.0.0/8" }]), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = { url: "https://db.test", key: "k", fetchImpl };
    const [a, b] = await Promise.all([readOfficeSecuritySnapshot({ ...deps, nowMs: 1000 }), readOfficeSecuritySnapshot({ ...deps, nowMs: 1000 })]);
    expect(calls).toBe(1);
    expect(a.get("t1")?.ipRules).toHaveLength(1);
    expect(b).toBe(a);
    await readOfficeSecuritySnapshot({ ...deps, nowMs: 20_000 });
    expect(calls).toBe(1);
    fail = true;
    const after = await readOfficeSecuritySnapshot({ ...deps, nowMs: 40_000 });
    expect(calls).toBe(2);
    expect(after.get("t1")?.ipRules).toHaveLength(1);
    resetOfficeSecurityCache();
  });
});
