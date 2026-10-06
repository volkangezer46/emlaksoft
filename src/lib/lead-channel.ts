/**
 * Müşteri başvuru kanalı (customers.lead_channel) etiketleri — TEK kaynak.
 * Değerler `intakeLead` tarafından yazılır: başvuru formu `web_form`, API/webhook `webhook` (çağıran
 * serbest değer de gönderebilir, en çok 40 karakter). Bilinmeyen değer olduğu gibi gösterilir.
 */
export const LEAD_CHANNEL_LABELS: Record<string, string> = {
  web_form: "Web formu",
  webhook: "Entegrasyon",
  portal: "Portal",
  reklam: "Reklam",
  whatsapp: "WhatsApp",
  qr: "QR tabela",
};

/** Filtre seçicisi için bilinen kanallar (sıra: en sık). */
export const LEAD_CHANNEL_OPTIONS = ["web_form", "webhook", "portal", "reklam", "whatsapp", "qr"] as const;

export function leadChannelLabel(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return LEAD_CHANNEL_LABELS[v] ?? v;
}

/** URL `?kanal=` doğrulaması: boşluksuz, en çok 40 karakter, güvenli karakterler. */
export function normalizeLeadChannelParam(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return /^[a-z0-9_-]{1,40}$/i.test(v) ? v : "";
}
