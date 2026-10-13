import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Salt-okunur şema/migration durumu.
 *
 * NEDEN: `scripts/check-schema.ts` aynı soruyu cevaplıyor ama yalnızca terminalden
 * ve doğrudan Postgres bağlantısıyla. Panelden bakan operasyoncunun "bu ortama
 * son migration'lar uygulanmış mı?" sorusuna cevabı yoktu.
 *
 * NASIL: PostgREST `information_schema`'yı dışa açmaz; bu yüzden şema *sorgulanmaz*,
 * *yoklanır*. Her beklenen tablo/kolon için `head: true` bir sayım isteği atılır —
 * satır taşınmaz, yalnızca hata kodu okunur:
 *   42P01 → tablo yok, 42703 → kolon yok  ⇒ migration uygulanmamış.
 * Bu yüzden hiçbir şey yazmaz ve maliyeti sabittir.
 */

export type SchemaCheck = {
  label: string;
  table: string;
  /** Verilirse tablo yerine bu kolonun varlığı yoklanır. */
  column?: string;
  migration: string;
};

/**
 * Son dalga migration'lar. Yeni migration eklendiğinde buraya bir satır
 * eklemek zorunlu değil ama eklenirse panel o dalgayı da doğrular.
 */
export const SCHEMA_CHECKS: SchemaCheck[] = [
  { label: "Onay akışları", table: "approval_requests", migration: "20260728000123_approval_requests.sql" },
  { label: "Doküman merkezi", table: "documents", migration: "20260728000122_document_center.sql" },
  { label: "Oyunlaştırma", table: "gamification_events", migration: "20260728000120_gamification.sql" },
  { label: "Filigran ayarları", table: "watermark_settings", migration: "20260728000119_watermark_settings.sql" },
  { label: "Danışman vitrin profili", table: "profiles", column: "public_slug", migration: "20260728000118_agent_public_profile.sql" },
  { label: "Personel izinleri", table: "staff_leaves", migration: "20260727000117_staff_leaves.sql" },
  { label: "Yabancıya satış", table: "foreign_sale_records", migration: "20260727000116_foreign_sale.sql" },
  { label: "Playbook'lar", table: "playbooks", migration: "20260727000115_playbooks.sql" },
  { label: "Mesaj şablonları", table: "message_templates", migration: "20260727000114_message_templates.sql" },
  { label: "Tavsiye programı", table: "referrals", migration: "20260727000111_referrals.sql" },
  { label: "Randevu ayarları", table: "booking_settings", migration: "20260727000109_booking_settings.sql" },
  { label: "Anahtar takibi", table: "property_keys", migration: "20260727000108_property_keys.sql" },
  { label: "Duyurular", table: "announcements", migration: "20260727000106_announcements.sql" },
  { label: "Vitrin fiyat alarmı", table: "vitrin_price_alerts", migration: "20260727000105_vitrin_price_alerts.sql" },
  { label: "Anketler", table: "surveys", migration: "20260727000104_surveys.sql" },
  { label: "Anket sistemi (ekip nabzı, düşük puan zinciri)", table: "survey_pulse_responses", migration: "20261007000400_survey_matrix_channels.sql" },
  { label: "Anlaşma kontrol listesi", table: "deal_checklist_items", migration: "20260727000103_deal_checklist.sql" },
  { label: "Sunumlar", table: "presentations", migration: "20260726000100_presentations.sql" },
  // Canlı hata (2026-10-13): 20260722000013 ledger'da uygulanmış görünüyor ama tablo YOKTU; web push aboneliği
  // kaydedilemiyordu. Onarım: 20261013004910. Bu satır eksikliği panelde yakalar.
  { label: "Web push abonelikleri", table: "push_subscriptions", migration: "20261013004910_push_subscriptions_repair.sql (ilk: 20260722000013)" },
  { label: "Uyarı merkezi (kanal, kural, olay)", table: "alert_events", migration: "20261013004900_ops_alerts.sql" },
  { label: "Cron çalışma geçmişi ve duraklatma", table: "cron_job_state", migration: "20261013004900_ops_alerts.sql" },
  { label: "Sunucu kaynak ölçümleri", table: "host_metrics", migration: "20261013004900_ops_alerts.sql" },
  { label: "Hata triyajı (durum, atanan, not, sürüm)", table: "error_logs", column: "status", migration: "20261013004900_ops_alerts.sql" },
  { label: "Hata kayıtları", table: "error_logs", migration: "error_logs (üretim izleme)" },
  { label: "Cron kalp atışı", table: "cron_heartbeats", migration: "cron_heartbeats (zamanlanmış görevler)" },
];

export type SchemaCheckResult = SchemaCheck & { ok: boolean; detail?: string };

/** Beklenen şema parçalarını tek turda yoklar. Hiçbir şey yazmaz. */
export async function probeSchema(checks: SchemaCheck[] = SCHEMA_CHECKS): Promise<SchemaCheckResult[]> {
  const admin = createAdminClient();
  return Promise.all(
    checks.map(async (c) => {
      try {
        const { error } = await admin.from(c.table).select(c.column ?? "*", { count: "exact", head: true }).limit(1);
        if (!error) return { ...c, ok: true };
        // 42P01 = undefined_table, 42703 = undefined_column; PostgREST şema önbelleği: PGRST205 = tablo yok,
        // PGRST204 = kolon yok → migration eksik
        const missing =
          ["42P01", "42703", "PGRST205", "PGRST204"].includes(error.code ?? "") ||
          /does not exist|could not find the (table|.*column)/i.test(error.message ?? "");
        return { ...c, ok: false, detail: missing ? "Uygulanmamış" : (error.message ?? "Erişilemedi") };
      } catch {
        return { ...c, ok: false, detail: "Erişilemedi" };
      }
    }),
  );
}
