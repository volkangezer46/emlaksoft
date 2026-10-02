export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-[var(--radius-card)] bg-ink-950/8" />
        ))}
      </div>
    </div>
  );
}
