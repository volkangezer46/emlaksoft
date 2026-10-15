import { type AppAction, type AppModule } from "@/lib/permissions";
import {
  effectiveHasPermission,
  getEffectivePermissions,
  immutableReadonlyPermissions,
} from "@/lib/permissions-effective";
import { moduleActionBlock } from "@/lib/modules/guard";
import { pausedWriteBlock } from "@/lib/billing/pause-guard";
import {
  requireActiveTenant,
  requireTenantForPayment,
  type ActiveTenantResult,
} from "@/lib/tenant-guard";

export type PermissionGate =
  | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
  | { ok: false; error: string };

/** Salt okunur tavanının reddi (SK10 / B168): metin "yetkiniz yok" içerir (arayüz ve testler bu ifadeyi bekler). */
export const READONLY_WRITE_DENIED = "Bu işlem için yetkiniz yok (salt okunur hesap).";

/**
 * Salt okunur YAZMA TAVANI (saf; SK10 / B168). Salt okunur rol ve destek oturumu (impersonation) hiçbir yazma eylemine
 * geçemez: matris, ofis rol istisnası ya da kişi istisnası ne derse desin. `write: true`, modül `view` kapısıyla korunan
 * ama veri YAZAN eylemleri (onay talebi açma, onay notu ...) da tavana sokar.
 * MUAF (sözleşme m): bildirim okundu ve arayüz durumu (ui_state) eylemleri `requirePermission`'dan HİÇ geçmez
 * (`requireActiveTenant` kullanır); `src/lib/readonly-ceiling-contract.test.ts` bunu kilitler.
 */
export function readonlyWriteBlocked(input: { role: string; impersonating: boolean; action: AppAction; write?: boolean }): boolean {
  if (input.role !== "readonly" && !input.impersonating) return false;
  return input.action !== "view" || input.write === true;
}

/**
 * Canonical active tenant plus role/module authorization.
 * Platform operations use requirePlatform* separately; inside a tenant,
 * platform staff also receives the canonical tenant role (readonly while impersonating).
 *
 * İstek içi tekrar çağrı ek DB turu yapmaz: aktif kiracı, etkin izin, modül durumu ve duraklatma okumaları React
 * `cache()` ile tekilleşir (`moduleActionBlock` dahil).
 */
export async function requirePermission(
  mod: AppModule,
  action: AppAction,
  opts?: { allowSuspended?: boolean; write?: boolean },
): Promise<PermissionGate> {
  const gate: ActiveTenantResult = opts?.allowSuspended
    ? await requireTenantForPayment()
    : await requireActiveTenant();
  if (!gate.ok) return gate;

  const role = gate.role;
  // Salt okunur tavanı: DB turu atmadan, izin okumasından ÖNCE reddedilir.
  if (readonlyWriteBlocked({ role, impersonating: gate.impersonating, action, write: opts?.write })) {
    return { ok: false, error: READONLY_WRITE_DENIED };
  }
  // Yetki, modül ve duraklatma kontrolleri bağımsızdır: paralel çalışır (önbellek yok), hata önceliği
  // aşağıda korunur: yetki -> modül -> duraklatma. Destek oturumu salt-okunur olduğundan duraklatma atlanır.
  const [perms, moduleBlock, pauseBlock] = await Promise.all([
    gate.impersonating
      ? Promise.resolve(immutableReadonlyPermissions())
      : getEffectivePermissions(gate.tenantId, role, gate.userId),
    moduleActionBlock(gate.tenantId, mod, action),
    gate.impersonating ? Promise.resolve(null) : pausedWriteBlock(gate.tenantId, mod, action),
  ]);
  if (!effectiveHasPermission(perms, mod, action)) {
    return { ok: false, error: "Bu işlem için yetkiniz yok." };
  }
  // Ofisin kapattığı modülün yazma eylemleri doğrudan POST ile de reddedilir.
  if (moduleBlock) return { ok: false, error: moduleBlock };
  // Duraklatılmış abonelik: veri salt-okunur (abonelik/ödeme modülü devam ettirmek için serbest).
  if (pauseBlock) return { ok: false, error: pauseBlock };

  return {
    ok: true,
    userId: gate.userId,
    tenantId: gate.tenantId,
    role,
    impersonating: gate.impersonating,
  };
}
