export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-72 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
