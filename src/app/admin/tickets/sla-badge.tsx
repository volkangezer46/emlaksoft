import { Timer } from "lucide-react";
import type { SlaState } from "./sla";

/** İlk personel yanıtı bekleyen ticket için renkli süre rozeti. */
export function SlaBadge({ sla }: { sla: SlaState }) {
  if (!sla.tracked) return null;

  const cls = sla.breached
    ? "bg-danger-500/10 text-danger-500"
    : sla.warning
      ? "bg-amber-400/15 text-amber-600"
      : "bg-mint-500/12 text-mint-600";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`}
      title="İlk personel yanıtı bekleniyor — açılıştan beri geçen süre"
    >
      <Timer className="h-3 w-3" />
      {sla.breached ? `SLA aşıldı · ${sla.label}` : `Yanıtsız · ${sla.label}`}
    </span>
  );
}
