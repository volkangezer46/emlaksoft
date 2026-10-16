import { cn } from "@/lib/utils";

/**
 * SuccessCheck — başarı anı için çizilen tik (GIF/Lottie yerine saf SVG + CSS).
 * Disk yaylanır, halka ve tik çizilir, ışınlar bir kez saçılır (`app-motion.css` `.es-ok-*`);
 * reduce'ta ve panel dışında bitiş karesi durağan görünür. Renk `--pm-success-text` (AA) üzerinden
 * `currentColor`; `label` verilirse `role="img"` + ad, verilmezse dekoratif.
 */
export function SuccessCheck({ size = 64, label, className }: { size?: number; label?: string; className?: string }) {
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span className={cn("es-success", className)} {...a11y}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <g className="es-ok-rays" strokeWidth={2.5} opacity="0.7">
          <path d="M32 2v6M32 56v6M2 32h6M56 32h6M10.8 10.8l4.2 4.2M49 49l4.2 4.2M10.8 53.2l4.2-4.2M49 15l4.2-4.2" />
        </g>
        <circle className="es-ok-disc" cx="32" cy="32" r="22" fill="currentColor" stroke="none" opacity="0.14" />
        <circle className="es-ok-ring" cx="32" cy="32" r="24" strokeWidth={3} style={{ ["--len" as string]: 151 }} pathLength={151} />
        <path className="es-ok-tick" d="M22 33l7 7 13-15" strokeWidth={4} pathLength={40} style={{ ["--len" as string]: 40 }} />
      </svg>
    </span>
  );
}
