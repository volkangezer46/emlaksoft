import type { ReactNode } from "react";

/**
 * IconHalo — illüstrasyonu olmayan boş durumlarda düz ikon karosu yerine katmanlı, hareketli kompozisyon:
 * eş merkezli kesikli halkalar, yörüngede üç nokta, ortada degrade ikon çekirdeği (premium v5).
 * Ton `.pm-t-*` (`--t`), renk `currentColor` + token; dekoratif (aria-hidden). Hareket `app-motion.css`
 * (`.es-halo-*`: halkalar bir kez açılır, noktalar yavaş süzülür; reduce'ta durağan). < 1 KB.
 */
export type HaloTone = "brand" | "success" | "warn" | "danger" | "gold" | "neutral";

export function IconHalo({ children, tone = "brand", size = "md" }: { children: ReactNode; tone?: HaloTone; size?: "sm" | "md" }) {
  return (
    <span aria-hidden="true" data-size={size === "sm" ? "sm" : undefined} className={`es-halo pm-t-${tone}`}>
      <svg className="es-halo-art" width="120" height="92" viewBox="0 0 120 92" fill="none" stroke="currentColor" focusable="false">
        <ellipse className="es-halo-ring" cx="60" cy="46" rx="56" ry="42" strokeOpacity="0.14" strokeDasharray="2 6" strokeLinecap="round" strokeWidth={1.5} />
        <ellipse className="es-halo-ring d2" cx="60" cy="46" rx="42" ry="32" strokeOpacity="0.22" strokeWidth={1.25} />
        <ellipse className="es-halo-ring d3" cx="60" cy="46" rx="30" ry="24" fill="currentColor" fillOpacity="0.06" stroke="none" />
        <circle className="es-halo-dot" cx="14" cy="34" r="3" fill="currentColor" fillOpacity="0.35" stroke="none" />
        <circle className="es-halo-dot d2" cx="104" cy="22" r="4" fill="currentColor" fillOpacity="0.22" stroke="none" />
        <circle className="es-halo-dot d3" cx="98" cy="74" r="2.5" fill="var(--gold-500)" fillOpacity="0.6" stroke="none" />
        <path className="es-halo-dot d2" d="M22 70l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="var(--gold-300)" fillOpacity="0.8" stroke="none" />
      </svg>
      <span className="es-halo-core">{children}</span>
    </span>
  );
}
