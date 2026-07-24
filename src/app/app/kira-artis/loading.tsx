export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-40 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-[18px] bg-ink-950/8" />
        <div className="h-80 rounded-[18px] bg-ink-950/8" />
      </div>
    </div>
  );
}
