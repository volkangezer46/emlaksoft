export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[var(--radius-panel)] bg-ink-950/8" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-[var(--radius-panel)] bg-ink-950/8 p-5">
          <div className="h-6 w-56 rounded bg-ink-950/10" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-14 rounded-[var(--radius-card)] bg-ink-950/10" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
