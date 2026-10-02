export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="h-[28rem] rounded-[var(--radius-panel)] bg-ink-950/8" />
        <div className="h-[28rem] rounded-[var(--radius-panel)] bg-ink-950/8" />
      </div>
    </div>
  );
}
