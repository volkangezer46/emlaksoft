export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-52 rounded-[22px] bg-ink-950/8" />
      <div className="h-8 w-64 rounded-lg bg-ink-950/8" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-[16px] bg-ink-950/8" />
        ))}
      </div>
    </div>
  );
}
