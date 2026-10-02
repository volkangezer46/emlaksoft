export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-[var(--radius-card)] bg-ink-950/8" />
        ))}
      </div>
    </div>
  );
}
