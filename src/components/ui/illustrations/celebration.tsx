import type { CSSProperties } from "react";

/**
 * Kutlama — projedeki TEK kutlama bileşeni (eski `ui/celebrate.tsx` buna devreder).
 * Saf CSS (`src/app/motion.css`: `.confetti`, `.celebrate*`), bir kez oynar, JS yok.
 *
 *  - Varsayılan: yalnız konfeti patlaması (1.2 sn). `relative` bir kapsayıcının içine konur;
 *    dekoratiftir (aria-hidden).
 *  - `tick`: başarı diski + çizilen tik + konfeti (sihirbaz / akış sonu). `tone="neutral"`
 *    kutlanmayacak sonuçta (ör. kaybedilen anlaşma) konfetisiz gri disk çizer. `label`
 *    erişilebilir addır.
 *
 * Kullanım yerleri: anlaşma kazanıldı, kurulum/hoş geldin akışı tamamlandı. reduced-motion'da
 * konfeti hiç görünmez; disk ve tik durağan çizilir.
 */
const PIECES = Array.from({ length: 14 }, (_, i) => i);

export function Celebration({
  className = "",
  tick = false,
  tone = "success",
  label,
}: {
  className?: string;
  /** Başarı diski + tik de çizilsin (varsayılan: yalnız konfeti). */
  tick?: boolean;
  tone?: "success" | "neutral";
  /** `tick` iken erişilebilir ad (varsayılan "Tamamlandı"). */
  label?: string;
}) {
  const confetti = (
    <span aria-hidden="true" className={tick ? "confetti" : `confetti ${className}`}>
      {PIECES.map((i) => (
        <i key={i} style={{ "--i": i } as CSSProperties} />
      ))}
    </span>
  );
  if (!tick) return confetti;
  return (
    <span className={`celebrate ${className}`} role="img" aria-label={label ?? "Tamamlandı"}>
      {tone === "success" ? confetti : null}
      <span className="celebrate-disc" data-tone={tone}>
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path className="tick-draw" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}
