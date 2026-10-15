/**
 * Kampanya detay raporu sözleşmesi (SAF): ?durum= değerleri, atıf penceresi, sayfa boyu ve RPC satır tipleri.
 * Veri: `campaign_report` / `campaign_recipient_page` (migration 20261018060000), çağıran `src/app/actions/campaigns.ts`.
 */

/** ?durum= kontratı: ham durumlar + "ulasan" (sent+delivered) + 7 gün atıf kümeleri (yanit / randevu / ret). */
export const CAMPAIGN_RECIPIENT_DURUMLARI = ["", "ulasan", "pending", "failed", "opted_out", "yanit", "randevu", "ret"] as const;
export type CampaignRecipientDurum = (typeof CAMPAIGN_RECIPIENT_DURUMLARI)[number];

export function parseCampaignRecipientDurum(raw: unknown): CampaignRecipientDurum {
  const v = String(Array.isArray(raw) ? raw[0] : (raw ?? ""));
  return (CAMPAIGN_RECIPIENT_DURUMLARI as readonly string[]).includes(v) ? (v as CampaignRecipientDurum) : "";
}

/** Sonuç atfı: gönderimden sonraki bu kadar gün içindeki yanıt, randevu ve ret kampanyaya yazılır. */
export const CAMPAIGN_ATTRIBUTION_DAYS = 7;
export const CAMPAIGN_RECIPIENT_PAGE_SIZE = 50;

export type CampaignRecipientRow = {
  id: string;
  customer_id: string | null;
  full_name: string | null;
  phone: string;
  status: string;
  error_msg: string | null;
  sent_at: string | null;
};

export type CampaignReport = {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  opted_out: number;
  errors: { msg: string; count: number }[];
  window_days: number;
  /** Ulaşılan (sent/delivered) farklı müşteri sayısı: oranların paydası. */
  reached_customers: number;
  replied: number;
  booked: number;
  unsubscribed: number;
};

/** Oran metni ("%12"); payda sıfırsa null. */
export function ratePct(part: number, whole: number): string | null {
  if (!whole) return null;
  return `%${Math.round((part / whole) * 100).toLocaleString("tr-TR")}`;
}
