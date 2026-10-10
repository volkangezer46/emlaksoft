import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSampleSchema } from "@/lib/sample-clear";
import { SAMPLE_MARKER } from "@/lib/sample-data/markers";

/**
 * "Gerçek kullanıma geç" ön adımı — `purge_tenant_sample_data` RPC'sinin BİLMEDİĞİ örnek kayıtları temizler (RPC değişmez;
 * yeni migration yok). RPC'den ÖNCE çalışır. Yalnız `tenantId` + örnek işaretli satırlara dokunur:
 *
 *  1. Örnek kiralardaki `deal_id` boşaltılır: `rentals.deal_id -> deals` ON DELETE RESTRICT; RPC önce anlaşmaları sildiği için
 *     bağlı kira kalırsa temizlik FK hatasıyla düşerdi. (Kira zaten arkasından silinir.)
 *  2. Örnek bina/site (notu `[Örnek veri]` ile başlar; `buildings`'te is_sample yok): silme daire, tahakkuk ve tahsilatı kaskatlar.
 *     Mahsup bağlantıları (`owner_charge_links.unit_charge`) kira silinirken kaskatlanır.
 *  3. Örnek meydan okumalar (açıklaması `[Örnek veri]` ile başlar; `league_challenges`'ta is_sample yok).
 *  4. Örnek danışman uzmanlık/bölge satırları (`is_sample`; profiller silinmez). Havuz kayıtları örnek portföyle kaskatlanır.
 *
 * Kendiliğinden temizlenenler (ekstra adım gerekmez): kira tahsilat/sözleşme/hakediş/yansıtma (rentals kaskatı), tapu süreci adımları
 * (deals kaskatı), ilan analizi (properties kaskatı), örnek giderler (is_sample).
 * Temizlenmeyen (bilinçli): gider bütçesi (örnek modda hiç yazılmaz) ve lig ayarı (boş kural = varsayılan; zararsız).
 */
export type PurgeExtrasReport = { deleted: Record<string, number>; failed: string[] };

export async function purgeSampleModuleData(db: SupabaseClient, tenantId: string): Promise<PurgeExtrasReport> {
  const report: PurgeExtrasReport = { deleted: {}, failed: [] };
  const like = `${SAMPLE_MARKER}%`;

  const step = async (label: string, run: () => PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>) => {
    const { count, error } = await run();
    if (error) {
      if (isMissingSampleSchema(error)) return; // tablo/sütun yok: etkin değil
      console.error(`purgeSampleModuleData:${label}`, error);
      report.failed.push(label);
      return;
    }
    report.deleted[label] = count ?? 0;
  };

  await step("rentals.deal_id", () =>
    db.from("rentals").update({ deal_id: null }, { count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true).not("deal_id", "is", null),
  );
  await step("buildings", () => db.from("buildings").delete({ count: "exact" }).eq("tenant_id", tenantId).like("notes", like));
  await step("league_challenges", () => db.from("league_challenges").delete({ count: "exact" }).eq("tenant_id", tenantId).like("description", like));
  // Örnek danışman uzmanlık/bölge satırları (20261010000800 is_sample). Havuz kayıtları ve olayları örnek portföyle birlikte kaskatlanır.
  await step("advisor_specialties", () => db.from("advisor_specialties").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true));
  await step("advisor_regions", () => db.from("advisor_regions").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true));
  return report;
}
