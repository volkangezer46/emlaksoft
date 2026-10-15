/**
 * Kayıt birleştirme önizlemesi: `merge_fk_refs` (20261018010000) "tablo.sütun" anahtarlarının Türkçe etiketleri.
 * Taşıma listesi DB'de DİNAMİK (pg_constraint); bu harita yalnız gösterim içindir. Sözleşme testi
 * (`src/app/app/musteriler/cift-kayit/merge-fk-contract.test.ts`) migration'lardaki her customers(id) / properties(id)
 * FK'sinin burada etiketi olduğunu doğrular; etiketsiz yeni tablo yine taşınır ama önizlemede "diğer kayıt" görünür.
 * SAF modül (istemci + sunucu).
 */

export const CUSTOMER_MERGE_REF_LABELS: Readonly<Record<string, string>> = {
  "appointments.customer_id": "randevu",
  "building_charges.payer_customer_id": "bina tahakkuku",
  "building_units.owner_customer_id": "daire (malik)",
  "building_units.tenant_customer_id": "daire (kiracı)",
  "calls.customer_id": "çağrı",
  "campaign_recipients.customer_id": "kampanya alıcısı",
  "communications.customer_id": "görüşme",
  "contracts.customer_id": "sözleşme",
  "customer_demands.customer_id": "talep",
  "customer_files.customer_id": "dosya",
  "customer_portal_tokens.customer_id": "portal erişimi",
  "deals.customer_id": "anlaşma",
  "direct_file_uploads.customer_id": "dosya yüklemesi",
  "document_requests.customer_id": "belge talebi",
  "finance_parties.customer_id": "cari hesap",
  "fsbo_leads.customer_id": "sahibinden ilan",
  "iys_consents.customer_id": "İYS izni",
  "kvkk_requests.customer_id": "KVKK başvurusu",
  "lost_sale_dismissals.customer_id": "kayıp satış ertelemesi",
  "offers.customer_id": "teklif",
  "open_house_visitors.created_customer_id": "açık ev ziyaretçisi",
  "payment_links.customer_id": "ödeme linki",
  "portal_customer_requests.customer_id": "portal talebi",
  "portal_demand_updates.customer_id": "portal talep güncellemesi",
  "portal_match_feedback.customer_id": "portal geri bildirimi",
  "demand_property_matches.customer_id": "eşleşme durumu",
  "message_sequence_enrollments.customer_id": "takip dizisi kaydı",
  "kvkk_subject_exports.customer_id": "KVKK veri dökümü",
  "presentation_feedback.customer_id": "sunum geri bildirimi",
  "presentations.customer_id": "sunum",
  "project_units.customer_id": "proje birimi",
  "properties.owner_customer_id": "malik olunan portföy",
  "property_owner_info.customer_id": "mülk sahibi bilgisi",
  "public_lead_consent_events.customer_id": "izin kaydı",
  "referral_links.customer_id": "tavsiye linki",
  "referrals.created_customer_id": "tavsiye",
  "referrals.referrer_customer_id": "tavsiye",
  "rent_payment_notices.customer_id": "kira ödeme bildirimi",
  "rentals.renter_customer_id": "kiracılık",
  "survey_tasks.customer_id": "anket görevi",
  "surveys.customer_id": "anket",
  "tasks.customer_id": "görev",
  "share_links.entity_id": "paylaşım linki",
};

export const PROPERTY_MERGE_REF_LABELS: Readonly<Record<string, string>> = {
  "appointments.property_id": "randevu",
  "building_units.property_id": "bina dairesi",
  "cash_entries.property_id": "kasa hareketi",
  "communications.property_id": "görüşme",
  "contracts.property_id": "sözleşme",
  "deals.property_id": "anlaşma",
  "direct_file_uploads.property_id": "dosya yüklemesi",
  "document_requests.property_id": "belge talebi",
  "eids_authority_events.property_id": "EİDS yetki kaydı",
  "eids_inbound_messages.property_id": "EİDS mesajı",
  "expenses.property_id": "gider",
  "finance_open_items.property_id": "açık kalem",
  "fsbo_leads.property_id": "sahibinden ilan",
  "lc_lifecycle_events.property_id": "ilan yaşam döngüsü kaydı",
  "listing_analyses.property_id": "ilan analizi",
  "listing_anomalies.property_id": "ilan uyarısı",
  "listing_pool_entries.property_id": "havuz kaydı",
  "listing_views.property_id": "vitrin görüntülenmesi",
  "network_listings.property_id": "ağ ilanı",
  "offers.property_id": "teklif",
  "open_houses.property_id": "açık ev",
  "owner_portal_tokens.property_id": "malik portalı erişimi",
  "pool_assignments.property_id": "havuz ataması",
  "portal_listings.property_id": "portal ilanı",
  "portal_match_feedback.property_id": "portal geri bildirimi",
  "demand_property_matches.property_id": "eşleşme durumu",
  "portal_transfer_sessions.property_id": "portal aktarımı",
  "presentation_feedback.property_id": "sunum geri bildirimi",
  "property_control_state.property_id": "ilan kontrol durumu",
  "property_dues.property_id": "aidat",
  "property_keys.property_id": "anahtar",
  "property_media.property_id": "fotoğraf / medya",
  "property_owner_info.property_id": "mülk sahibi bilgisi",
  "property_price_history.property_id": "fiyat geçmişi",
  "property_price_proposals.property_id": "fiyat önerisi",
  "property_status_history.property_id": "durum geçmişi",
  "rentals.property_id": "kiralama",
  "survey_tasks.property_id": "anket görevi",
  "tasks.property_id": "görev",
  "valuations.property_id": "değerleme",
  "vitrin_price_alerts.property_id": "fiyat alarmı",
  "share_links.entity_id": "paylaşım linki",
};

export type MergeRefSummary = { counts: Array<{ label: string; count: number }>; total: number };

/** RPC'nin `{ "tablo.sütun": sayı }` çıktısını aynı etiketleri birleştirerek, büyükten küçüğe sıralı özetler. */
export function summarizeMergeRefs(labels: Readonly<Record<string, string>>, raw: unknown): MergeRefSummary {
  const byLabel = new Map<string, number>();
  let total = 0;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || n <= 0) continue;
      const label = labels[key] ?? "diğer kayıt";
      byLabel.set(label, (byLabel.get(label) ?? 0) + n);
      total += n;
    }
  }
  const counts = [...byLabel.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "tr"));
  return { counts, total };
}
