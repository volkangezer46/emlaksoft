export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy>
      <div className="h-32 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-10 w-72 rounded-[var(--radius-card)] bg-ink-950/8" />
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-56 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
