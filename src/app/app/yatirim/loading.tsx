export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="h-[28rem] rounded-[20px] bg-ink-950/8" />
        <div className="h-[28rem] rounded-[20px] bg-ink-950/8" />
      </div>
    </div>
  );
}
