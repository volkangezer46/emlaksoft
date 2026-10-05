import { getRequestProfile } from "@/lib/cache/request";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { effectiveCanAccessModule, getEffectivePermissions } from "@/lib/permissions-effective";
import { getGrowthFlags } from "@/lib/growth/store";
import type { NudgeMoment } from "@/lib/growth/program";
import { ReferralNudgeCard } from "./referral-nudge-card";

/**
 * Ürün içi davet önerisi (sunucu): YALNIZ gerçek bir tetik anı gerçekleştiyse (`show`), davet programı açıksa ve
 * görüntüleyen kişi /app/buyume sayfasına erişebiliyorsa çizilir. Sahte/boş vaat yok: tetik koşulunu çağıran sayfa
 * kendi verisinden hesaplar (ör. kazanılmış anlaşma var mı). Program kapalıysa hiçbir şey göstermez.
 */
export async function ReferralNudge({ moment, show }: { moment: NudgeMoment; show: boolean }) {
  if (!show) return null;
  const flags = await getGrowthFlags();
  if (!flags.referralEnabled) return null;
  const user = await getRequestUser();
  if (!user || user.app_metadata?.impersonating) return null;
  const profile = await getRequestProfile(user.id);
  const role = typeof profile?.role === "string" ? profile.role : null;
  if (!role || !profile?.tenant_id) return null;
  const perms = await getEffectivePermissions(profile.tenant_id, role, user.id);
  if (!effectiveCanAccessModule(perms, "settings")) return null;
  return <ReferralNudgeCard moment={moment} />;
}
