import Link from "@/components/ui/smart-link";
import { BadgeCheck, BellRing, Inbox, Lightbulb, ReceiptText, ArrowRight, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { financeHref } from "@/lib/finance/routes";
import { DecisionControls } from "../onaylar/decision-controls";
import { loadAttention, loadOverdueReceivables, loadPendingApprovals, loadUnassignedListings, type HomeCtx } from "./data";
import { loadInsightBundle } from "./insight-veri";
import { pickBriefing } from "./home-brief";
import { InsightEylemKisa } from "./insight-eylem";
import type { HomeParams } from "./kapsam-anahtari";

/** Önem dili (referans öncelik listesi): ton + kısa etiket; renk tek başına anlam taşımaz (etiket yazılı). */
const SEVERITY: Record<string, { tone: "danger" | "warn" | "brand"; label: string }> = {
  tahsilat: { tone: "danger", label: "Acil" },
  onay: { tone: "warn", label: "Karar bekliyor" },
  atanmamis: { tone: "brand", label: "Dağıtılmalı" },
};

type Kart = { key: string; label: string; count: number; href: string; hint: string; Icon: LucideIcon };

export function SendenBekleyenlerIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad flex min-h-[18rem] flex-col gap-3">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-5 w-44" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * PATRON PANOSU (1) "SENDEN BEKLEYENLER" (sadeleştirme planı 2.4 / C08): onay, atanmamış portföy ve geciken tahsilat için
 * büyük dokunma kartları (her sayı filtreli listeye gider); onaylar satır içinde verilir (Onaylar sayfasının kendi karar
 * bileşeni). Altında EN ÇOK 1 öneri ("Aç" ve "…"). Diğer uyarılar ilk ekrandaki "Dikkat gerektirenler" listesindedir ("Tüm uyarılar (n)" → `#dikkat`).
 * Yetkisi olmayan kart çizilmez; okunamayan sayı gösterilmez (sahte 0 yok).
 */
export async function SendenBekleyenler({ ctx, hideSuggestion = false }: { ctx: HomeCtx; params?: HomeParams; hideSuggestion?: boolean }) {
  const [approvals, unassigned, overdueRecv, bundle, attention] = await Promise.all([
    loadPendingApprovals(ctx).catch(() => null),
    loadUnassignedListings(ctx).catch(() => null),
    loadOverdueReceivables(ctx).catch(() => null),
    hideSuggestion ? Promise.resolve({ insights: [], total: 0 }) : loadInsightBundle(ctx).catch(() => ({ insights: [], total: 0 })),
    loadAttention(ctx).catch(() => []),
  ]);

  const kartlar: Kart[] = [];
  if (approvals) {
    kartlar.push({ key: "onay", label: "Onay bekliyor", count: approvals.count, href: "/app/onaylar?kim=bana&durum=bekliyor", hint: "Kararınızı bekleyen talepler", Icon: BadgeCheck });
  }
  if (unassigned && unassigned.count !== null) {
    kartlar.push({
      key: "atanmamis",
      label: "Atanmamış portföy",
      count: unassigned.count,
      href: "/app/ilan-havuzu",
      hint: unassigned.poolEnabled ? "Danışmana dağıtın" : "Portföy dağıtımını açın",
      Icon: Inbox,
    });
  }
  if (overdueRecv !== null) {
    kartlar.push({
      key: "tahsilat",
      label: "Geciken tahsilat",
      count: overdueRecv,
      href: financeHref("cari", { gorunum: "acik", yon: "alacak", kova: "gecikmis" }),
      hint: "Vadesi geçen alacaklar",
      Icon: ReceiptText,
    });
  }

  const brief = pickBriefing(bundle.insights, bundle.total, 1);
  const oneri = brief.focus;
  const canTask = (ctx.perms.tasks ?? []).includes("create");
  const restCount = attention.length;
  const totalWaiting = kartlar.reduce((n, k) => n + k.count, 0);

  return (
    <section aria-labelledby="bekleyen-baslik" className="ds-card ds-pad flex h-full flex-col gap-4" data-tour="brifing">
      <header className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="pm-ico pm-t-warn" aria-hidden="true">
            <BellRing />
          </span>
          <span className="min-w-0">
            <h2 id="bekleyen-baslik" className="ds-title">
              Senden bekleyenler
            </h2>
            <p className="text-xs text-text-muted">Önem sırasıyla ele almanız gereken işler</p>
          </span>
        </span>
        {restCount > 0 ? (
          <a href="#dikkat" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[var(--accent-text)]">
            Tüm uyarılar ({restCount}) <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </header>

      {kartlar.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-3">
          {kartlar.map((k) => {
            const sev = k.count > 0 ? SEVERITY[k.key] ?? SEVERITY.onay : null;
            return (
              <li key={k.key}>
                <Link
                  href={k.href}
                  data-bekleyen={k.key}
                  data-sev={sev ? sev.tone : "ok"}
                  className={`wait-tile ds-lift focus-ring press pm-t-${sev ? sev.tone : "success"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="pm-ico" aria-hidden="true">
                      <k.Icon />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-tight text-text">{k.label}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-display text-3xl font-bold leading-none tabular-nums text-ink-950">{k.count}</span>
                    <span className="wait-sev">{sev ? sev.label : "Temiz"}</span>
                  </span>
                  <span className="text-sm leading-snug text-text-muted">{k.count > 0 ? k.hint : "Bekleyen yok"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {approvals && approvals.rows.length > 0 ? (
        <ul aria-label="Onay bekleyen talepler" className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {approvals.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Link href="/app/onaylar?kim=bana&durum=bekliyor" className="focus-ring min-h-11 min-w-0 flex-1 content-center truncate rounded-sm text-[15px] font-medium text-ink-950">
                {r.title}
              </Link>
              <DecisionControls requestId={r.id} requestTitle={r.title} />
            </li>
          ))}
        </ul>
      ) : kartlar.length > 0 && totalWaiting === 0 ? (
        <p className="text-sm text-text-muted">Şu an kararınızı bekleyen iş yok.</p>
      ) : null}

      {oneri ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-[var(--surface-sunken)] p-3" data-oneri="">
          <p className="flex items-center gap-2 text-sm font-semibold text-text-muted">
            <Lightbulb className="h-4 w-4" aria-hidden="true" /> Öneri
          </p>
          <p className="text-[15px] font-semibold text-ink-950">{oneri.title}</p>
          {oneri.why ? <p className="text-sm text-text-muted">{oneri.why}</p> : null}
          <InsightEylemKisa id={oneri.id} href={oneri.href} canTask={canTask} />
        </div>
      ) : null}
    </section>
  );
}
