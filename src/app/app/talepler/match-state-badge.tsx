import { Send } from "lucide-react";
import { MATCH_BADGE_CLS, matchStateBadge, type MatchStateRow } from "@/lib/match-state";

/**
 * Eşleşme satırı durum rozeti (CRM-G4): "3 gün önce WhatsApp ile gönderildi · açıldı", "Uygun değil · Fiyat uymuyor".
 * Sunucu bileşeni; `nowMs` çağırandan gelir (bileşende saat okunmaz).
 */
export function MatchStateBadge({ state, nowMs, opened = false }: { state: MatchStateRow | null; nowMs: number; opened?: boolean }) {
  const badge = matchStateBadge(state, nowMs, { opened });
  if (!badge) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${MATCH_BADGE_CLS[badge.tone]}`}
      title={badge.title}
    >
      {state?.sent_at && badge.tone !== "neutral" ? <Send className="h-3 w-3" aria-hidden="true" /> : null}
      {badge.label}
    </span>
  );
}
