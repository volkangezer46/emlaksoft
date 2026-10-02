export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-pulse space-y-4" aria-busy="true">
      <div className="h-8 w-64 rounded-[var(--radius-control)] bg-line" />
      <div className="h-1.5 w-full rounded-full bg-line" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-24 rounded-[var(--radius-card)] bg-line" />
      ))}
    </div>
  );
}
