export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-40 rounded-[22px] bg-ink-950/8" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-[16px] bg-ink-950/8" />
        ))}
      </div>
    </div>
  );
}
