export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-16 rounded-[var(--radius-card)] bg-ink-950/8" />
      <div className="h-9 rounded-[var(--radius-card)] bg-ink-950/8" />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 rounded-[var(--radius-card)] bg-ink-950/8" />
        ))}
      </div>
    </div>
  );
}
