export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-[var(--radius-panel)] bg-ink-950/8" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
      </div>
      <div className="h-48 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
