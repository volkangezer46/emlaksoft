export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-40 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
      </div>
      <div className="h-64 rounded-[20px] bg-ink-950/8" />
    </div>
  );
}
