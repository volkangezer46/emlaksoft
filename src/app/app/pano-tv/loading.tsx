export default function Loading() {
  return (
    <div role="status" aria-label="Pano hazırlanıyor" className="fixed inset-0 z-[2147483000] grid place-items-center bg-ink-950 text-white">
      <p className="animate-pulse font-display text-2xl font-extrabold">Pano hazırlanıyor…</p>
    </div>
  );
}
