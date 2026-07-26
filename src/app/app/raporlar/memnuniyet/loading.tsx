export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-56 rounded-[22px] bg-ink-950/8" />
      <div className="h-64 rounded-[20px] bg-ink-950/8" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-[20px] bg-ink-950/8" />
        <div className="h-72 rounded-[20px] bg-ink-950/8" />
      </div>
      <div className="h-64 rounded-[20px] bg-ink-950/8" />
    </div>
  );
}
