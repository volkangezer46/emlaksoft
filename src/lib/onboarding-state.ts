import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { parseSkipped, resolveSkipped, setupSkipCookieName } from "@/lib/setup-skip";
import { readOwnUiState } from "@/lib/ui-state-server";
import { loadProfileSnapshot } from "@/lib/profile-completion-data";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";
import {
  composeOnboardingSnapshot,
  loadOnboardingRawLegacy,
  loadOnboardingRawRpc,
  type OnboardingSnapshot,
} from "@/lib/onboarding-snapshot-core";

export type { OnboardingSnapshot };

/**
 * Kurulum durumunun TEK kaynağı: /app/baslangic sihirbazı, ana ekran Başlangıç kartı, Ayarlar ve Yardım aynı
 * sayımları kullanır. Tamamlanma gerçek veriden çıkar; "sonra yaparım" profilden (`ui_state`), yoksa çerezden gelir.
 *
 * Olgular TEK turda `onboarding_snapshot` RPC'sinden gelir (20261015021000, SECURITY INVOKER; eskiden 22 ayrı sayım).
 * RPC yoksa (migration uygulanmadı) ya da hata verirse eski ayrı sorgulara düşülür (`loadOnboardingRawLegacy`).
 * Çekirdek sorgulardan biri hata verirse null döner (sahte ilerleme gösterilmez).
 */
export const loadOnboardingSnapshot = cache(async (tenantId: string): Promise<OnboardingSnapshot | null> => {
  const supabase = await createClient();
  const user = await getRequestUser();
  const jar = await cookies();
  const cookieSkipped = user ? parseSkipped(jar.get(setupSkipCookieName(user.id))?.value) : [];
  const userId = user?.id ?? null;

  const [profile, content, raw, uiState] = await Promise.all([
    loadProfileSnapshot(tenantId),
    // Adminden düzenlenen adım sırası/metni/açık-kapalı/hedefleme (SN5); okunamazsa koddaki liste.
    loadOnboardingContent(),
    loadOnboardingRawRpc(supabase, tenantId).then((viaRpc) => viaRpc ?? loadOnboardingRawLegacy(supabase, tenantId, userId)),
    userId ? readOwnUiState(userId) : Promise.resolve(null),
  ]);
  if (!profile || !raw) return null;
  // "Sonra yaparım" profilden (cihazlar arası); profilde hiç kayıt yoksa (eski tercih/sütun yok) çerez yedeği.
  const skipped = resolveSkipped(uiState, cookieSkipped);
  return composeOnboardingSnapshot(raw, { profile, content, skipped });
});

/**
 * "Komisyon tahsilatını işle" ilk işinin olgusu (muhasebe): ofiste örnek olmayan en az bir ödenmiş komisyon var mı.
 * Yalnız bu iş listede açıkken sorulur (tek satırlık okuma); okunamazsa iş açık kalır (sahte "tamam" yok).
 */
export async function withFirstTaskFacts<T extends { id: string; done: boolean }>(tasks: T[], tenantId: string): Promise<T[]> {
  if (!tasks.some((t) => t.id === "commission" && !t.done)) return tasks;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("commissions")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("status", ["paid", "collected"])
      .eq("is_sample", false)
      .limit(1);
    if (error || !data || data.length === 0) return tasks;
    return tasks.map((t) => (t.id === "commission" ? { ...t, done: true } : t));
  } catch {
    return tasks;
  }
}
