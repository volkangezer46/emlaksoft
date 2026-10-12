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
 *  5. Örnek finans kayıtları (20261012000400 `is_sample`): kasa hareketleri → düzenli ödeme kuralları → hesaplar → bütçe.
 *     Hesap silinince kalan hareket/kural/oluşum/ekstre kayıtları ON DELETE CASCADE ile gider; gerçek hesaba yazılmış örnek
 *     hareket ayrıca silinir. Gerçek (is_sample=false) hiçbir finans satırına dokunulmaz.
 *
 *  6. Örnek Sahibinden ilan adayları (`fsbo_leads.is_sample`): gözlemler ve etkinlikler lead_id ON DELETE CASCADE ile gider,
 *     `tasks.fsbo_lead_id` ON DELETE SET NULL. `fsbo_do_not_call` ofis geneli listedir (is_sample yok): DOKUNULMAZ.
 *
 * Kendiliğinden temizlenenler (ekstra adım gerekmez): kira tahsilat/sözleşme/hakediş/yansıtma (rentals kaskatı), tapu süreci adımları
 * (deals kaskatı), ilan analizi (properties kaskatı), FSBO gözlem ve etkinliği (fsbo_leads kaskatı), örnek giderler (is_sample).
 * Temizlenmeyen (bilinçli): lig ayarı (boş kural = varsayılan; zararsız).
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
  await step("fsbo_leads", () => db.from("fsbo_leads").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true));
  await step("buildings", () => db.from("buildings").delete({ count: "exact" }).eq("tenant_id", tenantId).like("notes", like));
  await step("league_challenges", () => db.from("league_challenges").delete({ count: "exact" }).eq("tenant_id", tenantId).like("description", like));
  // Örnek danışman uzmanlık/bölge satırları (20261010000800 is_sample). Havuz kayıtları ve olayları örnek portföyle birlikte kaskatlanır.
  await step("advisor_specialties", () => db.from("advisor_specialties").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true));
  await step("advisor_regions", () => db.from("advisor_regions").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true));
  // Örnek finans: önce hareket ve kurallar, sonra hesaplar, en son bütçe (20261012000400; kolon yoksa "etkin değil" sayılır).
  for (const table of ["cash_entries", "recurring_rules", "finance_accounts", "expense_budgets"] as const) {
    await step(table, () => db.from(table).delete({ count: "exact" }).eq("tenant_id", tenantId).eq("is_sample", true));
  }
  return report;
}
