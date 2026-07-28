export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-64 rounded-[22px] bg-ink-950/8" />
      <div className="h-14 rounded-[16px] bg-ink-950/8" />
      <div className="h-48 rounded-[20px] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-52 rounded-[20px] bg-ink-950/8" />
        <div className="h-52 rounded-[20px] bg-ink-950/8" />
      </div>
      <div className="h-40 rounded-[20px] bg-ink-950/8" />
    </div>
  );
}
