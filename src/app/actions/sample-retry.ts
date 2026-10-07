"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { seedSampleData } from "@/app/actions/sample-data";
import { DEMO_SEED_FAILED_COOKIE } from "@/lib/sample-registration-seed";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Kayıtta yüklenemeyen örnek veriyi yeniden dener. Yetki/kapı denetimleri `seedSampleData` içindedir
 * (settings:edit, boş ofis, daha önce yüklenmemiş). Yükleme başarılıysa ya da artık gereksizse
 * (ofiste kayıt var / zaten yüklü) işaret çerezi silinir; geçici hatada çerez kalır, kullanıcı tekrar dener.
 */
export async function retryRegistrationDemoSeed(): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const res = await seedSampleData({ pack: "konut" });
  const jar = await cookies();
  if (res.ok) {
    jar.delete(DEMO_SEED_FAILED_COOKIE);
    revalidatePath("/app");
    return { ok: true };
  }
  const settled = res.error?.includes("zaten yüklü") || res.error?.includes("yalnız boş ofislere");
  if (settled) jar.delete(DEMO_SEED_FAILED_COOKIE);
  return { error: res.error ?? actionErrorMessage(null, "Örnek veriler yüklenemedi. Lütfen tekrar deneyin.") };
}

/** Bandı kapatır (örnek veri istemiyorum). */
export async function dismissDemoSeedRetry(): Promise<void> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return;
  (await cookies()).delete(DEMO_SEED_FAILED_COOKIE);
  revalidatePath("/app");
}
