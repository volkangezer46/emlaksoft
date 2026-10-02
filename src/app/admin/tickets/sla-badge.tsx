import { Timer } from "lucide-react";
import type { SlaState } from "./sla";

/** Aktif ilk yanıt / çözüm hedefi için renkli SLA rozeti. */
export function SlaBadge({ sla }: { sla: SlaState }) {
  if (!sla.tracked) return null;

  const cls = sla.breached
    ? "bg-danger-500/10 text-danger-500"
    : sla.warning
      ? "bg-amber-400/15 text-amber-600"
      : "bg-mint-500/12 text-mint-600";

  const phaseLabel = sla.phase === "resolution" ? "Çözüm" : "İlk yanıt";
  const text = sla.breached
    ? `${phaseLabel} SLA aşıldı · ${sla.label}`
    : `${phaseLabel} · ${sla.label} kaldı`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}
      title={`${phaseLabel} SLA hedefi`}
    >
      <Timer className="h-3 w-3" />
      {text}
    </span>
  );
}
