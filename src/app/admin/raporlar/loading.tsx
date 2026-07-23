export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-8 w-56 rounded-lg bg-ink-950/8" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-[18px] bg-ink-950/8" />
        ))}
      </div>
      <div className="h-48 rounded-[20px] bg-ink-950/8" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-52 rounded-[20px] bg-ink-950/8" />
        <div className="h-52 rounded-[20px] bg-ink-950/8" />
      </div>
      <div className="h-40 rounded-[20px] bg-ink-950/8" />
    </div>
  );
}
