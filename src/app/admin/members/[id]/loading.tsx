export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-5 w-32 rounded bg-ink-950/8" />
      <div className="h-52 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-[20px] bg-ink-950/8" />
        <div className="h-80 rounded-[20px] bg-ink-950/8" />
      </div>
    </div>
  );
}
