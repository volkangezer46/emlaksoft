const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Odometre tarzı sayı — her basamak dikey kayarak yerine oturur.
 * Tamamen CSS animasyonu (odometer-roll: translateY(0) → hedef basamak),
 * state/effect yok; SSR ile birebir aynı çıktı. Basamak başına 40ms kademe.
 * prefers-reduced-motion'da global kural animasyonu keser → düz görünüm.
 * Ekran okuyucu için gerçek değer sr-only olarak her zaman mevcut.
 */
export function OdometerNumber({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span className="odometer" aria-hidden="true">
        {value.split("").map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={i} className="odometer-digit">
              <span
                className="odometer-track"
                style={{
                  transform: `translateY(-${Number(ch)}em)`,
                  animationDelay: `${i * 40}ms`,
                }}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i} className="odometer-char">
              {ch}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
