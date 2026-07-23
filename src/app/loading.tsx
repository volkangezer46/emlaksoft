export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center">
          <span className="grid h-10 w-10 animate-pulse place-items-center rounded-[11px] bg-[image:var(--grad-brand)] font-display text-base font-extrabold text-white">
            E
          </span>
        </div>
        <div className="mx-auto mt-4 h-1 w-32 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-[image:var(--grad-brand)]" />
        </div>
      </div>
    </div>
  );
}
