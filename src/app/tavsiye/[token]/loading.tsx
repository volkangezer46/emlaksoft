export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md animate-pulse space-y-5">
        <div className="mx-auto h-5 w-48 rounded-full bg-ink-950/8" />
        <div className="h-[560px] rounded-[22px] bg-ink-950/8" />
      </div>
    </div>
  );
}
