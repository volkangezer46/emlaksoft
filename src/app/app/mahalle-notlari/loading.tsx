export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-16 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-8 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
