import { beforeEach, describe, expect, it, vi } from "vitest";
import { officePolicyIp, policyFromSettingRows } from "./policy";

/**
 * DG7 proxy dışı uygulama: giriş eylemleri ve requireActiveTenant (→ /api rotaları) aynı önbellekli politikayı ve
 * proxy ile AYNI IP kaynağını kullanır.
 */
const state = vi.hoisted(() => ({ rows: [] as { key: string; value: unknown }[] }));
vi.mock("./policy-cache", () => ({
  readOfficeSecurityPolicyCached: vi.fn(async () => (state.rows.length ? policyFromSettingRows(state.rows) : null)),
}));

import { OFFICE_IP_LOGIN_ERROR, OFFICE_MFA_SETUP_ERROR, officeLoginIpAllowed, officeRequestPolicyBlock } from "./enforce";

const h = (ip: string, xff?: string) => new Headers({ "x-real-ip": ip, ...(xff ? { "x-forwarded-for": xff } : {}) });

describe("DG7 proxy dışı politika uygulaması", () => {
  beforeEach(() => {
    state.rows = [];
    delete process.env.OFFICE_IP_ALLOWLIST;
  });

  it("IP kaynağı proxy ile aynı: önce x-real-ip, sonra XFF'nin ilk değeri", () => {
    expect(officePolicyIp(h("198.51.100.7", "203.0.113.9, 10.0.0.1"))).toBe("198.51.100.7");
    expect(officePolicyIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(officePolicyIp(new Headers())).toBeNull();
  });

  it("politika yokken giriş ve istek serbest", async () => {
    expect(await officeLoginIpAllowed({ tenantId: "t1", role: "advisor", headers: h("203.0.113.9") })).toBe(true);
    expect(await officeRequestPolicyBlock({ tenantId: "t1", role: "advisor", twoFactorOn: false, headers: h("203.0.113.9") })).toBeNull();
  });

  it("izinsiz IP'den giriş ve /api isteği reddedilir; muaf sahip ve acil kapatma geçer", async () => {
    state.rows = [{ key: "office.security.ip_allowlist", value: "198.51.100.0/24" }];
    expect(await officeLoginIpAllowed({ tenantId: "t1", role: "advisor", headers: h("203.0.113.9") })).toBe(false);
    expect(await officeLoginIpAllowed({ tenantId: "t1", role: "advisor", headers: h("198.51.100.20") })).toBe(true);
    // XFF'de izinli IP olsa da proxy'nin uyguladığı x-real-ip esas alınır.
    expect(await officeLoginIpAllowed({ tenantId: "t1", role: "advisor", headers: h("203.0.113.9", "198.51.100.20") })).toBe(false);
    expect(await officeRequestPolicyBlock({ tenantId: "t1", role: "advisor", twoFactorOn: true, headers: h("203.0.113.9") })).toBe(
      OFFICE_IP_LOGIN_ERROR,
    );
    expect(await officeLoginIpAllowed({ tenantId: "t1", role: "owner", headers: h("203.0.113.9") })).toBe(true);
    process.env.OFFICE_IP_ALLOWLIST = "off";
    expect(await officeLoginIpAllowed({ tenantId: "t1", role: "advisor", headers: h("203.0.113.9") })).toBe(true);
  });

  it("2FA zorunlu rolde kurmamış kullanıcının /api isteği reddedilir", async () => {
    state.rows = [{ key: "office.security.mfa_roles", value: "advisor" }];
    expect(await officeRequestPolicyBlock({ tenantId: "t1", role: "advisor", twoFactorOn: false, headers: h("1.2.3.4") })).toBe(
      OFFICE_MFA_SETUP_ERROR,
    );
    expect(await officeRequestPolicyBlock({ tenantId: "t1", role: "advisor", twoFactorOn: true, headers: h("1.2.3.4") })).toBeNull();
    expect(await officeRequestPolicyBlock({ tenantId: "t1", role: "gm", twoFactorOn: false, headers: h("1.2.3.4") })).toBeNull();
  });
});
