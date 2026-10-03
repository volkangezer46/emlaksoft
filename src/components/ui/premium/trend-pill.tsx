import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Trend } from "./premium-math";

/**
 * TrendPill — önceki döneme göre yön + yüzde. Ton: iyi değişim yeşil, kötü kırmızı,
 * düz nötr, "yeni" altın. Renk tek başına anlam taşımaz: ok yönü + metin + sr-only
 * cümle vardır.
 */
export function TrendPill({ trend, className }: { trend: Trend; className?: string }) {
  const Icon =
    trend.dir === "up" ? ArrowUpRight : trend.dir === "down" ? ArrowDownRight : trend.dir === "new" ? Sparkles : ArrowRight;
  const tone =
    trend.dir === "new" ? "gold" : trend.dir === "flat" || trend.good === null ? "neutral" : trend.good ? "success" : "danger";
  return (
    <span
      className={cn(`pm-pill pm-t-${tone}`, className)}
      style={{ background: "var(--t-soft)", color: "var(--t-text)" }}
    >
      <Icon aria-hidden="true" />
      <span aria-hidden="true">{trend.label}</span>
      <span className="sr-only">{trend.sr}</span>
    </span>
  );
}
