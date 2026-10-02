export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-28 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
