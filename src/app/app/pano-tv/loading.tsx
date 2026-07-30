export default function Loading() {
  return (
    <div className="-m-4 min-h-[calc(100vh-4.25rem)] animate-pulse bg-ink-950/90 p-6 md:-m-6 md:p-8 lg:-m-8">
      <div className="h-12 w-72 rounded bg-white/10" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 rounded-[20px] bg-white/10" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-72 rounded-[20px] bg-white/10" />
        <div className="h-72 rounded-[20px] bg-white/10" />
      </div>
    </div>
  );
}
