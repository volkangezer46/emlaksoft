export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-40 rounded-[22px] bg-ink-950/8" />
      <div className="h-10 rounded-[14px] bg-ink-950/8" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
        <div className="h-32 rounded-[18px] bg-ink-950/8" />
      </div>
      <div className="h-72 rounded-[20px] bg-ink-950/8" />
      <div className="h-64 rounded-[20px] bg-ink-950/8" />
      <div className="h-[460px] rounded-[16px] bg-ink-950/8" />
    </div>
  );
}
