export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-6 w-40 rounded-[var(--radius-control)] bg-ink-950/8" />
      <div className="h-20 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="flex gap-4 overflow-hidden">
        <div className="h-96 w-[85%] shrink-0 rounded-[var(--radius-panel)] bg-ink-950/8 sm:w-80" />
        <div className="h-96 w-[85%] shrink-0 rounded-[var(--radius-panel)] bg-ink-950/8 sm:w-80" />
        <div className="hidden h-96 w-80 shrink-0 rounded-[var(--radius-panel)] bg-ink-950/8 lg:block" />
      </div>
    </div>
  );
}
