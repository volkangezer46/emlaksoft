export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 py-6 animate-pulse">
      <div className="h-6 w-40 rounded-[var(--radius-control)] bg-ink-950/8" />
      <div className="h-40 rounded-[var(--radius-panel)] bg-ink-950/8" />
      <div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
