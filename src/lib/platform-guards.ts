import { requirePlatformStaff, type PlatformStaff } from "@/lib/platform";
import { gateAction } from "@/lib/platform-action-phase";
import { platformCan, type PlatformAction, type PlatformModule, type PlatformRole } from "@/lib/platform-access";
import { checkRateLimit } from "@/lib/rate-limit";

export type GuardResult = { staff: PlatformStaff } | { error: string };

/**
 * Server action kapısı: oturum + modül eylem yetkisi + (isteğe bağlı) rol listesi + hız sınırı.
 * Sayfa kapılarının aksine yönlendirmez, `{ error }` döner (form sonucu mesajı gösterilsin).
 * `action`: istenen eylem düzeyi (DG1); verilmezse action yürütülürken `write` (bkz. `gateAction`).
 * `rate`: aynı personel için pencere başına izin verilen yazma sayısı.
 */
export async function guardPlatformAction(opts: {
  module: PlatformModule;
  action?: PlatformAction;
  roles?: readonly PlatformRole[];
  rate?: { key: string; limit: number; windowSec: number };
}): Promise<GuardResult> {
  const staff = await requirePlatformStaff();
  if (!platformCan(staff, opts.module, gateAction(opts.action))) return { error: "Bu işlem için yetkiniz yok." };
  if (opts.roles && !opts.roles.includes(staff.role)) {
    return { error: "Bu işlem yalnız süper admin içindir." };
  }
  if (opts.rate) {
    const { allowed } = await checkRateLimit(`${opts.rate.key}:${staff.id}`, {
      limit: opts.rate.limit,
      windowSec: opts.rate.windowSec,
      failurePolicy: "deny",
    });
    if (!allowed) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };
  }
  return { staff };
}
