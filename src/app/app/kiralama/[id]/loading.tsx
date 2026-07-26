export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-5 w-32 rounded bg-ink-950/8" />
      <div className="h-48 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-72 rounded-[20px] bg-ink-950/8" />
        <div className="h-72 rounded-[20px] bg-ink-950/8" />
      </div>
    </div>
  );
}
