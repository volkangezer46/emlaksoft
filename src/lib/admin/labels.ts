/**
 * Admin arayüzü için Türkçe etiket sözlükleri (B192): ham İngilizce kod ("professional · active", "in_progress · high",
 * "monthly") ekranda görünmez. SAF modül (istemci ve sunucu). Bilinmeyen anahtar alt çizgisiz ham değere düşer.
 */
export const TENANT_STATUS_LABEL: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikti",
  suspended: "Askıda",
  cancelled: "İptal edildi",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikti",
  cancelled: "İptal edildi",
  paused: "Duraklatıldı",
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

export const TICKET_PRIORITY_LABEL: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };

export const BILLING_CYCLE_LABEL: Record<string, string> = { monthly: "Aylık", yearly: "Yıllık" };

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
  refunded: "İade edildi",
};

/** Sözlükten etiket; yoksa ham değer (alt çizgi boşluk olur), boşsa "". */
export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "";
  return map[key] ?? key.replace(/_/g, " ");
}
