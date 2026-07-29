export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-[16px] bg-ink-950/8" />
          ))}
        </div>
        <div className="h-[30rem] rounded-[20px] bg-ink-950/8" />
      </div>
    </div>
  );
}
