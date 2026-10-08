export default function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-5 animate-pulse p-4 py-6">
      <div className="h-5 w-32 rounded bg-ink-950/8" />
      <div className="h-80 rounded-[var(--radius-panel)] bg-ink-950/8" />
    </div>
  );
}
