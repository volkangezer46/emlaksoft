/**
 * Oyun kitabı kural kimlikleri ve etiketleri (SAF; istemci bileşenleri de içe aktarır — sunucu modülü yok).
 * Çalıştırıcı ve değerlendirme: `cs-playbooks.ts`.
 */

export const PLAYBOOK_RULES = ["health_threshold", "health_drop", "nps_detractor", "low_csat", "cancel_request", "trial_inactive"] as const;
export type PlaybookRule = (typeof PLAYBOOK_RULES)[number];

export const PLAYBOOK_RULE_LABELS: Record<PlaybookRule, string> = {
  health_threshold: "Riskli eşiğin altına indi",
  health_drop: "Sağlık skoru düştü",
  nps_detractor: "NPS kötüleyen",
  low_csat: "Düşük destek puanı",
  cancel_request: "İptal talebi",
  trial_inactive: "Deneme: kurulum başlamadı",
};

export function isPlaybookRule(v: unknown): v is PlaybookRule {
  return typeof v === "string" && (PLAYBOOK_RULES as readonly string[]).includes(v);
}

export type TaskPriority = "normal" | "yuksek";

