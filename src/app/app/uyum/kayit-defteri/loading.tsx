export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="h-20 rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-20 rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-20 rounded-[var(--radius-panel)] bg-ink-950/8" />
      </div>
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
