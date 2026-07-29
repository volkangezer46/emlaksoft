export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-44 rounded-[22px] bg-ink-950/8" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-[18px] bg-ink-950/8" />
        ))}
      </div>
      <div className="h-72 rounded-[20px] bg-ink-950/8" />
    </div>
  );
}
