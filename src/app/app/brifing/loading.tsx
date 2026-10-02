export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-72 rounded-[var(--radius-panel)] bg-ink-950/8" />
        ))}
      </div>
      <div className="h-20 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
