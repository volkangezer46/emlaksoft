import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import type { FeatureKey } from "@/lib/modules/registry";

/**
 * Kayıttaki isteğe bağlı "Kaç kişisiniz?" sorusu (sadeleştirme planı C31). SAF ayrıştırıcı + provizyonda tek yazım.
 *
 * Cevap ÖDEME PLANINI DEĞİŞTİRMEZ (plan bandı `agents` alanıdır, registration-plan.ts); yalnız ofisin ilk menüsünü
 * sadeleştirir: 1–5 kişilik ofiste çok şubeli yapıya ait bölümler (Şube ve Franchise, Ofis panosu (TV), Ofisler arası ağ)
 * baştan kapalı gelir. Küçük ofis sade menüsü (ekip ≤5, şube yok) zaten varsayılandır (ui-prefs `isSmallOffice`); bu
 * kapatma onu modül düzeyinde tamamlar. Kapatma veriyi silmez; Ayarlar > Modüller'den tek tuşla açılır.
 */
export const TEAM_BAND_FIELD = "ekip";

export const TEAM_BANDS = [
  { key: "solo", label: "Sadece ben" },
  { key: "2-5", label: "2–5 kişi" },
  { key: "6+", label: "6 ve üzeri" },
] as const;

export type TeamBand = (typeof TEAM_BANDS)[number]["key"];

/** Küçük ofiste baştan kapalı gelen bölümler (çok şubeli / büyük ekip araçları). */
export const SMALL_OFFICE_CLOSED_MODULES: readonly FeatureKey[] = ["franchise", "tv_board", "network"];

export function parseTeamBand(v: unknown): TeamBand | null {
  const s = String(v ?? "").trim();
  return TEAM_BANDS.some((b) => b.key === s) ? (s as TeamBand) : null;
}

/** Cevaba göre baştan kapatılacak modüller (cevap yoksa ya da 6+ ise hiçbiri). */
export function modulesClosedForBand(band: TeamBand | null): readonly FeatureKey[] {
  return band === "solo" || band === "2-5" ? SMALL_OFFICE_CLOSED_MODULES : [];
}

/**
 * Provizyonda (çağıranın mevcut service_role istemcisiyle) küçük ofis modüllerini kapatır. En iyi çaba: hata kaydı
 * kesmez, yalnız günlüğe yazılır (tablo yoksa da sessiz geçer).
 */
export async function applySignupTeamBand(admin: SupabaseClient, tenantId: string, ownerId: string, band: TeamBand | null): Promise<void> {
  const keys = modulesClosedForBand(band);
  if (keys.length === 0) return;
  const stamp = new Date(now()).toISOString();
  const { error } = await admin.from("tenant_modules").upsert(
    keys.map((k) => ({ tenant_id: tenantId, module_key: k, enabled: false, updated_by: ownerId, updated_at: stamp })),
    { onConflict: "tenant_id,module_key" },
  );
  if (error) console.error("applySignupTeamBand", error);
}
