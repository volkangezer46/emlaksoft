export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-80 rounded-[var(--radius-panel)] bg-ink-950/8" />
      </div>
    </div>
  );
}
