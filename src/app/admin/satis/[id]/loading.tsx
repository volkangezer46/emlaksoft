export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-6 w-40 rounded-[8px] bg-ink-950/8" />
      <div className="h-44 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-64 rounded-[18px] bg-ink-950/8 lg:col-span-2" />
        <div className="h-64 rounded-[18px] bg-ink-950/8" />
      </div>
    </div>
  );
}
