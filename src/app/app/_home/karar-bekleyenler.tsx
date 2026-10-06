import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadDecisions, loadExpiringAuthority, type HomeCtx } from "./data";
import { buildDecisionItems } from "./home-metrics";

/** Kart yüksekliği iskelet ve içerikte aynı (4 satır + başlık; CLS yok). */
const CARD_MIN = "lg:min-h-[13.5rem]";

export function KararBekleyenlerIskelet() {
  return (
    <div role="status" aria-busy="true" className={`${CARD_MIN} pm-c1 p-4`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-40" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Sağ kolon "KARAR BEKLEYENLER": çerçeveli birincil kart (--elev-1), kart içinde kart yok, satırlar ayırıcı çizgiyle.
 * Her satır filtrelenmiş listeye gider; hiçbiri yoksa "karar bekleyen yok" durumu (kolon boş kalmaz).
 */
export async function KararBekleyenler({ ctx }: { ctx: HomeCtx }) {
  const [d, expiring] = await Promise.all([loadDecisions(ctx), loadExpiringAuthority(ctx)]);
  const items = buildDecisionItems({
    approvals: d.approvals,
    overdueRent: d.overdueRent,
    passiveAdvisors: d.passiveAdvisors,
    passiveDays: d.passiveDays,
    expiringAuthority: expiring.data.length,
  });
  const total = items.reduce((t, i) => t + i.value, 0);

  return (
    <section aria-labelledby="karar-baslik" className={`pm-c1 ${CARD_MIN} flex flex-col p-4`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="karar-baslik" className="pm-bx-eyebrow">
          Karar bekleyenler
        </h2>
        {total > 0 ? (
          <span className="pm-num rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs">
            {total}
            <span className="sr-only"> kalem</span>
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 flex flex-1 items-center gap-2 px-1 text-sm text-text-muted">
          <span className="pm-dot pm-t-success" aria-hidden="true" />
          Karar bekleyen kalem yok.
        </p>
      ) : (
        <ul className="pm-sep mt-2">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className={`pm-r36 focus-ring group pm-t-${it.tone} min-h-11`}>
                <span className="pm-dot" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-950">{it.label}</span>
                  <span className="block truncate text-xs text-text-muted">{it.hint}</span>
                </span>
                <span className="pm-num text-lg" style={{ color: "var(--t-text)" }}>
                  {it.value}
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-[var(--text-faint)] group-hover:text-[var(--t-text)]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
