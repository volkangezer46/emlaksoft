import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import type { Insight, InsightKind } from "@/lib/insights/types";
import { Skeleton } from "@/components/ui/skeleton";
import { evidenceChips, pickBriefing, SEVERITY_LABEL, SEVERITY_TONE } from "./home-brief";
import { homeHref, type HomeParams } from "./kapsam-anahtari";
import type { HomeCtx } from "./data";
import { loadInsightBundle } from "./insight-veri";
import { InsightEylemleri } from "./insight-eylem";
import { SiradakiEylem } from "./siradaki-eylem";

/** Odak bloğu iskelet ve içerikte aynı asgari yükseklik (CLS yok). */
export const BRIFING_MIN = "min-h-[16rem]";

export function BrifingIskelet() {
  return (
    <div role="status" aria-busy="true" className={`pm-focus ${BRIFING_MIN} p-5 sm:p-6`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-4 h-8 w-3/4" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <Skeleton className="mt-6 h-10 w-56" />
    </div>
  );
}

const KIND_LABEL: Record<InsightKind, string> = {
  call_priority: "Aranacak müşteri",
  deal_risk: "Anlaşma riski",
  price_action: "Fiyat gözden geçirme",
  match_suggestion: "Eşleşme önerisi",
  anomaly: "Anormallik",
  forecast: "Tahmin",
  compliance: "Uyum",
  deadline: "Yaklaşan son tarih",
  digest: "Özet",
};

const CONF_LABEL = { dusuk: "düşük güven", orta: "orta güven", yuksek: "yüksek güven" } as const;

function FocusCard({ insight, eyebrow, canTask }: { insight: Insight; eyebrow: string; canTask: boolean }) {
  const tone = SEVERITY_TONE[insight.severity];
  const chips = evidenceChips(insight);
  return (
    <section aria-labelledby="brifing-baslik" className={`pm-focus pm-t-${tone} ${BRIFING_MIN} flex flex-col gap-4 p-5 pl-6 sm:p-6 sm:pl-7`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="pm-bx-eyebrow">{eyebrow}</p>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--t-text)" }}>
          <span className="pm-dot" aria-hidden="true" />
          {SEVERITY_LABEL[insight.severity]}
        </span>
        <span className="text-xs text-text-muted">{KIND_LABEL[insight.kind]}</span>
        {insight.isForecast ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-text-muted">
            Tahmin{insight.confidence ? ` · ${CONF_LABEL[insight.confidence]}` : ""}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <h2 id="brifing-baslik" className="font-display text-2xl font-bold leading-tight text-ink-950 sm:text-[1.75rem]">
          {insight.title}
        </h2>
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-text-muted">
          <span className="font-semibold text-ink-950">Neden? </span>
          {insight.why}
        </p>
        {insight.narrative ? (
          <p className="mt-2 flex max-w-[68ch] items-start gap-2 text-sm text-text-muted">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
            <span>{insight.narrative}</span>
          </p>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <ul aria-label="Kanıtlar" className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const body = (
              <>
                <span className="text-text-muted">{c.label}</span> <span className="font-semibold tabular-nums text-ink-950">{c.value}</span>
              </>
            );
            return (
              <li key={`${c.label}-${c.value}`}>
                {c.href ? (
                  <Link href={c.href} className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1 text-xs hover:bg-surface-hover">
                    {body}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1 text-xs">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-auto">
        <InsightEylemleri id={insight.id} href={insight.href} canTask={canTask} />
      </div>
    </section>
  );
}

/**
 * "Bugün sizin için önemli" — brifing odak bloğu.
 *  - İçgörü varsa: en yüksek öncelik büyük odak kart (önem, neden/kanıt, tek tıkla aksiyon, ertele/yoksay/göreve çevir),
 *    altında 2-4 numaralı kompakt satır ve "Tüm içgörüler (n)".
 *  - İçgörü YOKSA (tablo yok, örnek veri, yeni ofis): mevcut kural tabanlı "Sıradaki eylem" kartı. Sahte içgörü üretilmez.
 */
export async function Brifing({
  ctx,
  params,
  eyebrow = "Bugün sizin için önemli",
  maxRows = 4,
}: {
  ctx: HomeCtx;
  params: HomeParams;
  eyebrow?: string;
  maxRows?: number;
}) {
  const { insights, total } = await loadInsightBundle(ctx);
  const brief = pickBriefing(insights, total, maxRows);

  if (brief.mode === "fallback" || !brief.focus) {
    return (
      <div className={`${BRIFING_MIN} flex flex-col [&>*]:flex-1`} data-brifing-mode="fallback">
        <SiradakiEylem ctx={ctx} />
      </div>
    );
  }

  const canTask = (ctx.perms.tasks ?? []).includes("create");
  const showAll = params.icgoru === "tum";
  const extra = showAll ? insights.filter((i) => i.id !== brief.focus!.id && !brief.rows.some((r) => r.id === i.id)) : [];
  const rows = [...brief.rows, ...extra];

  return (
    <div className="flex flex-col gap-3" data-brifing-mode="insight">
      <FocusCard insight={brief.focus} eyebrow={eyebrow} canTask={canTask} />
      {rows.length > 0 ? (
        <ol aria-label="Diğer içgörüler" className="pm-flat pm-sep">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Link href={r.href} className={`pm-r36 focus-ring group pm-t-${SEVERITY_TONE[r.severity]}`}>
                <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-[var(--t-soft)] text-xs font-bold tabular-nums text-[var(--t-text)]">{i + 2}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]">{r.title}</span>
                <span className="hidden flex-none text-xs text-text-muted sm:inline">{KIND_LABEL[r.kind]}</span>
                <ChevronRight className="h-4 w-4 flex-none text-[var(--text-faint)] group-hover:text-[var(--t-text)]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      {brief.total > 1 + rows.length || showAll ? (
        <Link
          href={homeHref(params, { icgoru: showAll ? undefined : "tum" })}
          scroll={false}
          aria-expanded={showAll}
          className="focus-ring self-start rounded-[var(--radius-control)] px-2 py-1 text-sm font-semibold text-[var(--accent-text)]"
        >
          {showAll ? "Daha az göster" : `Tüm içgörüler (${brief.total})`}
        </Link>
      ) : null}
    </div>
  );
}
