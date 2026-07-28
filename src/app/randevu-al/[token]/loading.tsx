export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg animate-pulse space-y-5">
        <div className="mx-auto h-5 w-48 rounded-full bg-ink-950/8" />
        <div className="space-y-4 rounded-[22px] border border-line bg-surface p-6">
          <div className="mx-auto h-12 w-12 rounded-[14px] bg-ink-950/8" />
          <div className="mx-auto h-5 w-32 rounded-full bg-ink-950/8" />
          {/* gün şeridi */}
          <div className="flex gap-1.5 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[76px] min-w-[74px] rounded-[12px] bg-ink-950/8" />
            ))}
          </div>
          {/* saat ızgarası */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 rounded-[11px] bg-ink-950/8" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
