/**
 * SLA yardımcıları — açık ticket'ta ilk personel yanıtı yoksa açılıştan beri
 * geçen süre renklendirilir: >4 saat amber, >24 saat kırmızı ("SLA aşıldı").
 * Sunucu tarafında render anında hesaplanır (canlı sayaç değil).
 */

export const SLA_OPEN_STATUSES = ["open", "in_progress", "waiting"] as const;

export type SlaState = {
  /** SLA takibi bu ticket için geçerli mi (açık + personel yanıtı yok)? */
  tracked: boolean;
  breached: boolean; // >24 saat
  warning: boolean; // >4 saat
  hours: number;
  label: string; // "2 sa 15 dk" gibi
};

export function slaStateOf(opts: {
  status: string;
  createdAt: string;
  hasStaffReply: boolean;
  now?: number;
}): SlaState {
  const idle: SlaState = { tracked: false, breached: false, warning: false, hours: 0, label: "" };
  if (opts.hasStaffReply) return idle;
  if (!(SLA_OPEN_STATUSES as readonly string[]).includes(opts.status)) return idle;

  const ms = Math.max(0, (opts.now ?? Date.now()) - new Date(opts.createdAt).getTime());
  const hours = ms / 3_600_000;
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const label = h >= 48 ? `${Math.floor(h / 24)} gün` : h > 0 ? `${h} sa ${m} dk` : `${m} dk`;

  return { tracked: true, breached: hours > 24, warning: hours > 4, hours, label };
}

/** Liste sıralama anahtarı: acil + SLA aşımı en öne. Küçük değer = önce. */
export function slaSortRank(priority: string, sla: SlaState): number {
  const urgent = priority === "urgent";
  if (urgent && sla.breached) return 0;
  if (sla.breached) return 1;
  if (urgent && sla.tracked) return 2;
  return 3;
}
