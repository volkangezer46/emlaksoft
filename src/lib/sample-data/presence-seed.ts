import type { SupabaseClient } from "@supabase/supabase-js";
import type { PresenceStatus } from "@/lib/presence";

/**
 * DEMO EKİP DURUMU (`user_presence`, migration 20261024030000). Demo ekip üyeleri farklı durumlarda ve farklı zamanlarda
 * görünür ("Ofiste · Şu an aktif", "Görüşmede · 18 dk önce", "Sahada · 47 dk önce"...). Satırlar `is_sample=true`: gün
 * sonunda bitmez, yaşı 6 saatlik pencerede döner (`effectivePresence`) — demo her gün canlı görünür. Yalnız service_role
 * yazabilir (tetik istemcide is_sample'ı sıfırlar). Purge: profil silinince kaskat, pasifleşince tetik siler.
 * Tablo yoksa (migration bekliyor) sessizce atlanır.
 */
export const SAMPLE_PRESENCE_PLAN: readonly { status: PresenceStatus; note: string | null; minutesAgo: number }[] = [
  { status: "office", note: null, minutesAgo: 2 },
  { status: "meeting", note: "Moda'da alıcıyla görüşme", minutesAgo: 18 },
  { status: "field", note: "Kadıköy yer gösterimi", minutesAgo: 47 },
  { status: "break", note: null, minutesAgo: 12 },
  { status: "away", note: "15:00'te dönerim", minutesAgo: 96 },
];

export type SamplePresenceRow = { user_id: string; tenant_id: string; status: PresenceStatus; note: string | null; is_sample: true; updated_at: string };

/** Saf: kişi sırasına göre plan satırı (plan biterse baştan; zaman her turda biraz kayar). */
export function buildSamplePresence(tenantId: string, userIds: readonly string[], nowMs: number): SamplePresenceRow[] {
  return userIds.map((id, i) => {
    const p = SAMPLE_PRESENCE_PLAN[i % SAMPLE_PRESENCE_PLAN.length]!;
    const lap = Math.floor(i / SAMPLE_PRESENCE_PLAN.length);
    return { user_id: id, tenant_id: tenantId, status: p.status, note: p.note, is_sample: true, updated_at: new Date(nowMs - (p.minutesAgo + lap * 7) * 60_000).toISOString() };
  });
}

/** Demo ekip durumlarını yazar (idempotent: kişi başı tek satır). Yazılan satır sayısı; tablo yoksa 0. */
export async function seedSamplePresence(db: Pick<SupabaseClient, "from">, tenantId: string, userIds: readonly string[], nowMs: number): Promise<number> {
  if (userIds.length === 0) return 0;
  const { error } = await db.from("user_presence").upsert(buildSamplePresence(tenantId, userIds, nowMs), { onConflict: "user_id" });
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("seedSamplePresence", { code: error.code });
    return 0;
  }
  return userIds.length;
}
