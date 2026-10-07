import Link from "@/components/ui/smart-link";
import { ArrowUpRight, BellRing, CheckCircle2 } from "lucide-react";
import type { OversightAlertView } from "@/lib/oversight/load";
import { SEVERITY_LABEL, type AlertSeverity } from "@/lib/oversight/alert-rules";
import { ALERT_RULE_META } from "@/lib/oversight/settings";
import { EmptyState } from "@/components/ui/empty-state";
import { ReviewForm } from "./review-form";

const SEV_CHIP: Record<AlertSeverity, string> = {
  yuksek: "bg-danger-500/10 text-danger-600",
  orta: "bg-amber-400/15 text-amber-700",
  bilgi: "bg-brand-600/10 text-brand-700",
};

const dtFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

/** Uyari satirlari: aciklama + "kayda git" + incelendi. `showReview=false`: danisman kendi gorunumu (salt okunur). */
export function AlertList({
  alerts,
  names,
  advisorHref,
  ruleHref,
  canReview,
  reviewsAvailable,
  emptyTitle,
  emptyDescription,
}: {
  alerts: readonly OversightAlertView[];
  names: ReadonlyMap<string, string>;
  /** Danisman adina tiklayinca gidilecek filtreli liste (null: baglanti yok). */
  advisorHref: ((advisorId: string) => string) | null;
  ruleHref: (rule: string) => string;
  canReview: boolean;
  reviewsAvailable: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (alerts.length === 0) {
    return <EmptyState icon={BellRing} tone="mint" title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      {alerts.map((a) => (
        <li key={a.key} className="space-y-2 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${SEV_CHIP[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>
            <Link
              href={ruleHref(a.rule)}
              title="Bu kurala göre filtrele"
              className="rounded-full bg-ink-950/[0.06] px-2 py-0.5 text-xs font-semibold text-text-muted transition hover:ring-1 hover:ring-brand-300"
            >
              {ALERT_RULE_META[a.rule].label}
            </Link>
            <time dateTime={a.at} className="text-xs tabular-nums text-text-muted">
              {dtFmt.format(new Date(a.at))}
            </time>
          </div>
          <p className="text-sm font-semibold text-ink-950">
            <Link href={a.href} className="focus-ring inline-flex items-center gap-1 hover:text-brand-600 hover:underline">
              {a.title}
              <ArrowUpRight className="h-3.5 w-3.5 text-text-faint" aria-hidden />
            </Link>
          </p>
          <p className="text-sm text-text-muted">{a.explanation}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {a.advisorId && advisorHref ? (
              <Link href={advisorHref(a.advisorId)} className="focus-ring font-semibold text-brand-600 hover:underline">
                {names.get(a.advisorId) ?? "Danışman"} · tüm uyarıları
              </Link>
            ) : null}
            {a.review ? (
              <span className="inline-flex items-center gap-1 font-semibold text-mint-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                İncelendi · {dtFmt.format(new Date(a.review.at))}
                {a.review.by ? ` · ${names.get(a.review.by) ?? "Yönetici"}` : ""}
                {a.review.note ? ` · “${a.review.note}”` : ""}
              </span>
            ) : canReview ? (
              <ReviewForm alertKey={a.key} disabled={!reviewsAvailable} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
