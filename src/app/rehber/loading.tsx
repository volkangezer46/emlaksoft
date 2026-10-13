/** Rehber yüklenirken iskelet (ISR'da yalnız ilk üretimde görünür). Sunucu bileşeni; istemci kodu yok. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-10 sm:px-6 sm:py-14" aria-busy="true" aria-label="Rehber yükleniyor">
      <div className="h-4 w-40 rounded bg-ink-950/8" />
      <div className="mt-4 h-10 w-2/3 rounded bg-ink-950/8" />
      <div className="mt-3 h-5 w-1/2 rounded bg-ink-950/8" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
        ))}
      </div>
    </div>
  );
}
