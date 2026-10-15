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
 * Tembel ilk iş olguları: yalnız ilgili iş listede AÇIKKEN tek satırlık okuma yapılır; okunamazsa iş açık kalır (sahte
 * "tamam" yok).
 *  - "Komisyon tahsilatını işle" (muhasebe): ofiste örnek olmayan en az bir ödenmiş komisyon var mı.
 *  - "Vitrininizi Google'da görünür yapın": ofis vitrin arama onayı (tenants.vitrin_seo_optin) verilmiş mi.
 */
export async function withFirstTaskFacts<T extends { id: string; done: boolean }>(tasks: T[], tenantId: string): Promise<T[]> {
  const open = (id: string) => tasks.some((t) => t.id === id && !t.done);
  const needCommission = open("commission");
  const needVitrin = open("vitrin");
  if (!needCommission && !needVitrin) return tasks;
  try {
    const supabase = await createClient();
    const [commissionDone, vitrinDone] = await Promise.all([
      needCommission
        ? supabase
            .from("commissions")
            .select("id")
            .eq("tenant_id", tenantId)
            .in("status", ["paid", "collected"])
            .eq("is_sample", false)
            .limit(1)
            .then(({ data, error }) => !error && Boolean(data && data.length > 0))
        : Promise.resolve(false),
      needVitrin
        ? supabase
            .from("tenants")
            .select("vitrin_seo_optin")
            .eq("id", tenantId)
            .maybeSingle()
            .then(({ data, error }) => !error && (data as { vitrin_seo_optin?: boolean | null } | null)?.vitrin_seo_optin === true)
        : Promise.resolve(false),
    ]);
    if (!commissionDone && !vitrinDone) return tasks;
    return tasks.map((t) => (t.id === "commission" && commissionDone) || (t.id === "vitrin" && vitrinDone) ? { ...t, done: true } : t);
  } catch {
    return tasks;
  }
}
