import { beforeEach, describe, expect, it, vi } from "vitest";

const started: string[] = [];
let permsOk = true;
let moduleBlock: string | null = null;
let pauseBlock: string | null = null;
let impersonating = false;

const tick = () => new Promise((r) => setTimeout(r, 5));

vi.mock("@/lib/tenant-guard", () => ({
  requireActiveTenant: async () => ({ ok: true, userId: "u1", tenantId: "t1", role: "advisor", impersonating }),
  requireTenantForPayment: async () => ({ ok: true, userId: "u1", tenantId: "t1", role: "advisor", impersonating }),
}));
vi.mock("@/lib/permissions-effective", () => ({
  getEffectivePermissions: async () => {
    started.push("perms");
    await tick();
    return {};
  },
  immutableReadonlyPermissions: () => ({}),
  effectiveHasPermission: () => permsOk,
}));
vi.mock("@/lib/modules/guard", () => ({
  moduleActionBlock: async () => {
    started.push("module");
    await tick();
    return moduleBlock;
  },
}));
vi.mock("@/lib/billing/pause-guard", () => ({
  pausedWriteBlock: async () => {
    started.push("pause");
    await tick();
    return pauseBlock;
  },
}));

import { requirePermission } from "./require-permission";

describe("requirePermission: paralel kontrol, sabit hata önceliği", () => {
  beforeEach(() => {
    started.length = 0;
    permsOk = true;
    moduleBlock = null;
    pauseBlock = null;
    impersonating = false;
  });

  it("üç kontrol aynı anda başlar (ardışık değil)", async () => {
    const res = await requirePermission("customers", "edit");
    expect(res.ok).toBe(true);
    expect(started.sort()).toEqual(["module", "pause", "perms"]);
  });

  it("öncelik: yetki yoksa modül/duraklatma mesajı değil yetki hatası döner", async () => {
    permsOk = false;
    moduleBlock = "Modül kapalı.";
    pauseBlock = "Abonelik duraklatıldı.";
    expect(await requirePermission("customers", "edit")).toEqual({ ok: false, error: "Bu işlem için yetkiniz yok." });
  });

  it("öncelik: modül engeli duraklatma engelinden önce gelir; yalnız duraklatma varsa o döner", async () => {
    moduleBlock = "Modül kapalı.";
    pauseBlock = "Abonelik duraklatıldı.";
    expect(await requirePermission("customers", "edit")).toEqual({ ok: false, error: "Modül kapalı." });
    moduleBlock = null;
    expect(await requirePermission("customers", "edit")).toEqual({ ok: false, error: "Abonelik duraklatıldı." });
  });

  it("destek oturumunda (salt-okunur) duraklatma kontrolü hiç başlamaz", async () => {
    impersonating = true;
    pauseBlock = "Abonelik duraklatıldı.";
    const res = await requirePermission("customers", "view");
    expect(res.ok).toBe(true);
    expect(started).not.toContain("pause");
  });

  it("SK10 salt okunur tavanı: destek oturumunda yazma eylemi DB turu atmadan reddedilir", async () => {
    impersonating = true;
    const res = await requirePermission("customers", "edit");
    expect(res).toEqual({ ok: false, error: "Bu işlem için yetkiniz yok (salt okunur hesap)." });
    expect(started).toEqual([]);
  });
});
