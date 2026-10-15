import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SÖZLEŞME (m) — SK10 / B168 salt okunur YAZMA TAVANI.
 *
 *  1. `requirePermission` salt okunur rolde ve destek oturumunda her yazma eylemini (action != view ya da
 *     `write: true`) izin/modül/duraklatma okumasından ÖNCE reddeder; metin "yetkiniz yok" içerir.
 *  2. MUAF: bildirim okundu (SK5) ve arayüz durumu (ui_state, profile_ui_state_mark) eylemleri `requirePermission`'dan
 *     HİÇ geçmez (yalnız `requireActiveTenant`) — salt okunur kullanıcı bildirimini okur, turu kapatır.
 *  3. İstek içi tekrar çağrı ek DB turu atmaz: kapının bütün okumaları React `cache()` ile tekilleşir.
 */

let role = "readonly";
let impersonating = false;
const calls: string[] = [];

vi.mock("@/lib/tenant-guard", () => ({
  requireActiveTenant: async () => ({ ok: true, userId: "u1", tenantId: "t1", role, impersonating }),
  requireTenantForPayment: async () => ({ ok: true, userId: "u1", tenantId: "t1", role, impersonating }),
}));
vi.mock("@/lib/permissions-effective", () => ({
  getEffectivePermissions: async () => {
    calls.push("perms");
    return { customers: ["view", "create", "edit", "delete"], commissions: ["view"] };
  },
  immutableReadonlyPermissions: () => ({ customers: ["view"], commissions: ["view"] }),
  effectiveHasPermission: (perms: Record<string, string[]>, mod: string, action: string) => (perms[mod] ?? []).includes(action),
}));
vi.mock("@/lib/modules/guard", () => ({
  moduleActionBlock: async () => {
    calls.push("module");
    return null;
  },
}));
vi.mock("@/lib/billing/pause-guard", () => ({
  pausedWriteBlock: async () => {
    calls.push("pause");
    return null;
  },
}));

import { readonlyWriteBlocked, READONLY_WRITE_DENIED, requirePermission } from "./require-permission";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Dışa açık bir eylemin gövdesi (bir sonraki `export` ya da dosya sonuna kadar). */
function exportedBody(src: string, name: string): string {
  const start = src.search(new RegExp(`export async function ${name}\\(`));
  expect(start, `${name} bulunamadı`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next >= 0 ? src.slice(start, start + 1 + next) : src.slice(start);
}

describe("sözleşme (m): salt okunur yazma tavanı", () => {
  beforeEach(() => {
    role = "readonly";
    impersonating = false;
    calls.length = 0;
  });

  it("saf kural: readonly/destek oturumu yazamaz; view okunur; write:true view kapılı yazmayı da durdurur", () => {
    expect(readonlyWriteBlocked({ role: "readonly", impersonating: false, action: "edit" })).toBe(true);
    expect(readonlyWriteBlocked({ role: "readonly", impersonating: false, action: "view" })).toBe(false);
    expect(readonlyWriteBlocked({ role: "readonly", impersonating: false, action: "view", write: true })).toBe(true);
    expect(readonlyWriteBlocked({ role: "advisor", impersonating: true, action: "create" })).toBe(true);
    expect(readonlyWriteBlocked({ role: "advisor", impersonating: false, action: "delete" })).toBe(false);
    expect(readonlyWriteBlocked({ role: "gm", impersonating: false, action: "view", write: true })).toBe(false);
    expect(READONLY_WRITE_DENIED).toMatch(/yetkiniz yok/);
  });

  it("requirePermission: salt okunur yazma DB turu atmadan 'yetkiniz yok' döner", async () => {
    expect(await requirePermission("portals", "edit")).toEqual({ ok: false, error: READONLY_WRITE_DENIED });
    expect(await requirePermission("commissions", "view", { write: true })).toEqual({ ok: false, error: READONLY_WRITE_DENIED });
    expect(calls).toEqual([]);
  });

  it("requirePermission: salt okunur okuma (view) geçer", async () => {
    const res = await requirePermission("customers", "view");
    expect(res.ok).toBe(true);
  });

  it("yazma yetkili rol tavana takılmaz", async () => {
    role = "advisor";
    const res = await requirePermission("customers", "edit");
    expect(res.ok).toBe(true);
  });

  it("MUAF: bildirim okundu ve ui_state eylemleri requirePermission'dan geçmez", () => {
    const notifications = read("src/app/actions/notifications.ts");
    for (const name of ["markNotificationRead", "markAllNotificationsRead", "markNotificationReadForm", "markAllNotificationsReadForm"]) {
      const body = exportedBody(notifications, name);
      expect(body, `${name} requirePermission çağırmamalı`).not.toMatch(/\brequirePermission\s*\(/);
    }
    const uiState = read("src/app/actions/ui-state.ts");
    expect(uiState).not.toMatch(/\brequirePermission\s*\(/);
    expect(uiState).toMatch(/requireActiveTenant\(\)/);
    expect(uiState).toMatch(/profile_ui_state_mark/);
  });

  it("DB tarafı: profile_ui_state_mark SECURITY DEFINER, yalnız auth.uid() satırı; readonly tetikleyicisi değişmez", () => {
    const sql = read("supabase/migrations/20261016100200_trp_gm_guard_readonly_support.sql").toLowerCase();
    expect(sql).toMatch(/function public\.profile_ui_state_mark\(p_key text\)[\s\S]*security definer/);
    expect(sql).toMatch(/where id = v_uid/);
    expect(sql).not.toMatch(/create or replace function public\.block_readonly_identity_writes/);
  });

  it("istek içi tekilleşme: kapı okumaları React cache() ile sarılı (ikinci çağrı ek DB turu yapmaz)", () => {
    expect(read("src/lib/modules/guard.ts")).toMatch(/export const moduleActionBlock = cache\(/);
    expect(read("src/lib/tenant-guard.ts")).toMatch(/export const requireActiveTenant = cache\(/);
    expect(read("src/lib/permissions-effective.ts")).toMatch(/export const getEffectivePermissions = cache\(/);
    expect(read("src/lib/billing/pause-guard.ts")).toMatch(/const isTenantPaused = cache\(/);
    expect(read("src/lib/modules/state.ts")).toMatch(/export const getTenantModuleState = cache\(/);
  });
});
