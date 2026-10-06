import { Timer } from "lucide-react";
import type { SlaState } from "./sla";

/** Aktif ilk yanıt / çözüm hedefi için SLA rozeti: tema token'lı ton hapı (.ds-pill + .pm-t-*; açık ve koyu temada AA). */
export function SlaBadge({ sla }: { sla: SlaState }) {
  if (!sla.tracked) return null;

  const tone = sla.breached ? "pm-t-danger" : sla.warning ? "pm-t-warn" : "pm-t-success";

  const phaseLabel = sla.phase === "resolution" ? "Çözüm" : "İlk yanıt";
  const text = sla.breached
    ? `${phaseLabel} SLA aşıldı · ${sla.label}`
    : `${phaseLabel} · ${sla.label} kaldı`;

  return (
    <span className={`ds-pill ${tone}`} title={`${phaseLabel} SLA hedefi`}>
      <Timer className="h-3 w-3" aria-hidden="true" />
      {text}
    </span>
  );
}
