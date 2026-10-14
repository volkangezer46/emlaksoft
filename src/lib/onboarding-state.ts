import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { parseSkipped, setupSkipCookieName } from "@/lib/setup-skip";
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
 * sayımları kullanır. Tamamlanma gerçek veriden çıkar; yalnız "sonra yaparım" çerezden gelir.
 *
 * Olgular TEK turda `onboarding_snapshot` RPC'sinden gelir (20261015021000, SECURITY INVOKER; eskiden 22 ayrı sayım).
 * RPC yoksa (migration uygulanmadı) ya da hata verirse eski ayrı sorgulara düşülür (`loadOnboardingRawLegacy`).
 * Çekirdek sorgulardan biri hata verirse null döner (sahte ilerleme gösterilmez).
 */
export const loadOnboardingSnapshot = cache(async (tenantId: string): Promise<OnboardingSnapshot | null> => {
  const supabase = await createClient();
  const user = await getRequestUser();
  const jar = await cookies();
  const skipped = user ? parseSkipped(jar.get(setupSkipCookieName(user.id))?.value) : [];
  const userId = user?.id ?? null;

  const [profile, content, raw] = await Promise.all([
    loadProfileSnapshot(tenantId),
    // Adminden düzenlenen adım sırası/metni/açık-kapalı/hedefleme (SN5); okunamazsa koddaki liste.
    loadOnboardingContent(),
    loadOnboardingRawRpc(supabase, tenantId).then((viaRpc) => viaRpc ?? loadOnboardingRawLegacy(supabase, tenantId, userId)),
  ]);
  if (!profile || !raw) return null;
  return composeOnboardingSnapshot(raw, { profile, content, skipped });
});
