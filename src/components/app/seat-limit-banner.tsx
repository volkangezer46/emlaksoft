import Link from "@/components/ui/smart-link";
import { Users2 } from "lucide-react";
import type { SeatUsageSummary } from "@/lib/billing/seat-purchase";

/**
 * Koltuk doluluk uyarısı (%eşik ve %100). Tıklanınca koltuk satın alma paneline götürür.
 * Eşik altında hiçbir şey çizmez (gürültü yok).
 */
export function SeatLimitBanner({ summary, href = "/app/abonelik#koltuk" }: { summary: SeatUsageSummary | null; href?: string }) {
  if (!summary || summary.level === "ok") return null;
  const full = summary.level === "full";
  return (
    <Link
      href={href}
      className={`focus-ring block rounded-[var(--radius-card)] border px-4 py-3 text-sm font-medium transition hover:opacity-90 ${
        full ? "border-danger-500/30 bg-danger-500/10 text-danger-600" : "border-amber-400/40 bg-amber-400/10 text-amber-700"
      }`}
    >
      <span className="inline-flex flex-wrap items-center gap-2">
        <Users2 className="h-4 w-4" />
        <span className="numeric">
          Kullanıcı koltuğu {summary.used}/{summary.limit}
        </span>
        {full
          ? "— koltuk limiti doldu; yeni kullanıcı eklenemez. Koltuk eklemek için tıklayın."
          : `— doluluk %${Math.round(summary.ratio * 100)} (uyarı eşiği %${summary.warnPercent}). Koltuk eklemek için tıklayın.`}
      </span>
    </Link>
  );
}
