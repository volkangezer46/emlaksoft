import { cn } from "@/lib/utils";

/** Progress — yatay ilerleme çubuğu (role="progressbar"). `value` 0–100'e sıkıştırılır. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function Progress({
  value,
  label,
  tone = "accent",
  className,
}: {
  value: number;
  label: string;
  tone?: "accent" | "success" | "warning" | "danger";
  className?: string;
}) {
  const pct = clampPercent(value);
  const fill = { accent: "bg-accent", success: "bg-mint-500", warning: "bg-amber-500", danger: "bg-danger-500" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <div className={cn("motion-progress-fill h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}
