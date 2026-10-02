export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-[var(--radius-panel)] bg-ink-950/8" />
        ))}
      </div>
      <div className="h-72 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
