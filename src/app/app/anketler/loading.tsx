export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-16 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-12 rounded-[var(--radius-card)] bg-ink-950/8" />
      <div className="h-20 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
      </div>
    </div>
  );
}
