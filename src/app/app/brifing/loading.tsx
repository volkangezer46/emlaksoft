export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-72 rounded-[20px] bg-ink-950/8" />
        ))}
      </div>
      <div className="h-20 rounded-[18px] bg-ink-950/8" />
    </div>
  );
}
