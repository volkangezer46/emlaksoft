/**
 * Halka "tüp" degradesi (grafik derinlik dili; WebGL/SVG filtresi yok): iç kenarda gölge → ortada saydam → dış kenarda
 * ışık. Halka kalınlığı boyunca yumuşak geçiş, ayrı bir şerit gibi okunmaz. `gradientUnits="userSpaceOnUse"` olduğu için
 * merkez ve yarıçaplar bilinmelidir (RadialGauge, DonutRing, Recharts dilimi). Renk token'dan (`--viz-shade/--viz-sheen`).
 * Sunucu ve istemci bileşeninde kullanılabilir; `id` çağıran tarafından benzersiz verilir.
 */
export function TubeGradient({ id, cx, cy, inner, outer }: { id: string; cx: number; cy: number; inner: number; outer: number }) {
  const f = outer > 0 ? Math.max(0, Math.min(1, inner / outer)) : 0;
  const at = (t: number) => (f + (1 - f) * t).toFixed(4);
  return (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={outer}>
      <stop offset={f.toFixed(4)} stopColor="var(--viz-shade)" />
      <stop offset={at(0.38)} stopColor="var(--viz-shade)" stopOpacity={0} />
      <stop offset={at(0.6)} stopColor="var(--viz-sheen)" stopOpacity={0} />
      <stop offset="1" stopColor="var(--viz-sheen)" />
    </radialGradient>
  );
}
