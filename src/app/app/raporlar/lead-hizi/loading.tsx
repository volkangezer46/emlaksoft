export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-10 rounded-[var(--radius-card)] bg-ink-950/8" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="h-28 rounded-[var(--radius-card)] bg-ink-950/8" />
        <div className="h-28 rounded-[var(--radius-card)] bg-ink-950/8" />
        <div className="h-28 rounded-[var(--radius-card)] bg-ink-950/8" />
        <div className="h-28 rounded-[var(--radius-card)] bg-ink-950/8" />
      </div>
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
