export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-14 rounded-[var(--radius-card)] bg-ink-950/8" />
      <div className="h-48 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-52 rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-52 rounded-[var(--radius-panel)] bg-ink-950/8" />
      </div>
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
