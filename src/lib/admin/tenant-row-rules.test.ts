import { describe, expect, it } from "vitest";
import { tenantRowRisk, validateTenantRow } from "./tenant-row-rules";

const order = { advisor: 1, office: 2, professional: 3, enterprise: 5 };
const name = (id: string) => ({ advisor: "Danışman", office: "Ofis", professional: "Profesyonel", enterprise: "Kurumsal" })[id] ?? id;
const saved = { status: "active", plan: "office" };

describe("ofis satırı doğrulama", () => {
  it("askıdaki/iptal ofise paket atanamaz (aynı kayıtta askıya alma dahil)", () => {
    expect(validateTenantRow({ status: "suspended", plan: "professional" }, { status: "suspended", plan: "office" })).toMatchObject({ ok: false, reason: expect.stringContaining("Askıdaki ofise paket atanamaz") });
    expect(validateTenantRow({ status: "suspended", plan: "professional" }, saved).ok).toBe(false);
    expect(validateTenantRow({ status: "cancelled", plan: "advisor" }, saved)).toMatchObject({ ok: false, reason: expect.stringContaining("İptal edilmiş") });
  });

  it("yalnız durum değişimi ya da aktif ofiste paket değişimi geçerli", () => {
    expect(validateTenantRow({ status: "suspended", plan: "office" }, saved).ok).toBe(true);
    expect(validateTenantRow({ status: "active", plan: "professional" }, saved).ok).toBe(true);
    expect(validateTenantRow({ status: "active", plan: "office" }, { status: "suspended", plan: "office" }).ok).toBe(true);
  });
});

describe("ofis satırı risk (satır içi onay)", () => {
  it("askıya alma ve iptal erişimi keser", () => {
    expect(tenantRowRisk({ status: "suspended", plan: "office" }, saved, order, name)).toContain("erişimi anında kesilecek");
    expect(tenantRowRisk({ status: "cancelled", plan: "office" }, saved, order, name)).toContain("iptal");
  });

  it("paket düşürme riskli, yükseltme ve diğer durumlar değil", () => {
    expect(tenantRowRisk({ status: "active", plan: "advisor" }, saved, order, name)).toBe("Paket düşürülüyor (Ofis → Danışman); kullanıcı ve modül sınırları azalır.");
    expect(tenantRowRisk({ status: "active", plan: "professional" }, saved, order, name)).toBeNull();
    expect(tenantRowRisk({ status: "trial", plan: "office" }, saved, order, name)).toBeNull();
    // Zaten askıdaki ofiste durum değişmiyorsa yeniden onay istenmez.
    expect(tenantRowRisk({ status: "suspended", plan: "office" }, { status: "suspended", plan: "office" }, order, name)).toBeNull();
  });
});
