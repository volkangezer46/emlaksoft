import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowRight, ArrowUpRight, Lightbulb } from "lucide-react";

/**
 * InsightCard — öneri/içgörü kartı (tasarım sistemi v4). Başlık filtrelenmiş hedefe gider;
 * "neden" cümlesi, kanıt satırı (tıklanabilir kanıt bağlantılı), önem/tahmin etiketi ve
 * eylem yuvası (`actions`: Ertele / Yoksay gibi istemci düğmeleri). İçgörü kendi başına kayıt
 * DEĞİŞTİRMEZ; yalnız yönlendirir. Tahmin içgörüsü `forecast` ile açıkça etiketlenir.
 */
export type InsightEvidence = { label: string; value: string; href?: string | null };

export function InsightCard({
  title,
  why,
  href,
  severity,
  forecast,
  evidence = [],
  actions,
}: {
  title: string;
  why?: string;
  href: string;
  severity?: { label: string; tone: "danger" | "warn" | "neutral" | "brand" };
  /** "Tahmin · güven orta" gibi etiket; verilirse kartta görünür. */
  forecast?: string | null;
  evidence?: readonly InsightEvidence[];
  actions?: ReactNode;
}) {
  return (
    <article className="ds-insight">
      <div className="flex items-start gap-3">
        <span className="pm-row-ico pm-t-brand" aria-hidden="true">
          <Lightbulb />
        </span>
        <div className="min-w-0 flex-1">
          {severity || forecast ? (
            <p className="mb-1 flex flex-wrap items-center gap-1.5">
              {severity ? <span className={`ds-pill pm-t-${severity.tone}`}>{severity.label}</span> : null}
              {forecast ? <span className="ds-pill pm-t-gold">{forecast}</span> : null}
            </p>
          ) : null}
          <Link href={href} className="focus-ring line-clamp-2 rounded-[var(--radius-control)] text-sm font-semibold text-text hover:text-accent-text" title={title}>
            {title}
          </Link>
          {why ? <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-text-muted" title={why}>{why}</p> : null}
          {evidence.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
              {evidence.slice(0, 4).map((e, i) => (
                <li key={`${e.label}-${i}`} className="tabular-nums">
                  {e.label}:{" "}
                  {e.href ? (
                    <Link href={e.href} className="focus-ring font-semibold text-accent-text hover:underline">
                      {e.value}
                    </Link>
                  ) : (
                    <span className="font-semibold text-text">{e.value}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Link
          href={href}
          aria-label={`${title}: ayrıntıya git`}
          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full border border-hairline bg-surface-raised text-accent-text transition-colors hover:bg-surface-hover"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {actions ? <div className="mt-2.5 pl-11">{actions}</div> : null}
    </article>
  );
}

/** Öneriler bölümü başlığı ("ÖNERİLER" + isteğe bağlı tümü bağlantısı) ve liste kabı. */
export function InsightSection({ children, allHref, allLabel = "Tüm öneriler" }: { children: ReactNode; allHref?: string; allLabel?: string }) {
  return (
    <div className="mt-4 border-t border-hairline pt-3" aria-label="Öneriler">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="ds-eyebrow flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-[var(--pm-gold-text)]" aria-hidden="true" /> Öneriler
        </p>
        {allHref ? (
          <Link href={allHref} className="ds-link focus-ring">
            {allLabel} <ArrowUpRight aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}
