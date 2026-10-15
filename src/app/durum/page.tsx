import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle, Wrench } from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { buildMetadata } from "@/lib/seo/store";
import { now as clockNow } from "@/lib/clock";
import { formatDateTimeTr, formatDateTr } from "@/lib/format";
import { readPublicStatusFresh } from "@/lib/status-page/cache";
import {
  dailyUptime,
  formatDuration,
  formatUptime,
  IMPACT_LABEL,
  isClosedStatus,
  KIND_LABEL,
  maintenanceActive,
  maintenanceOverdue,
  OVERALL_LABEL,
  overallStatus,
  overallUptime,
  PAST_INCIDENT_DAYS,
  STATUS_LABEL,
  UPTIME_DAYS,
  type OverallLevel,
  type PublicIncident,
  type UptimeDay,
} from "@/lib/status-page/model";

/**
 * /durum — kamuya açık durum sayfası. ÇEREZSİZ ve HAFİF: istemci bileşeni, form, ölçüm betiği yok; çerez/başlık okumaz.
 * DİNAMİK çizilir (B017): ISR `s-maxage=60` + `stale-while-revalidate=1 yıl` uzun boşluktan sonraki ilk ziyaretçiye
 * 52 dk bayat sayfa veriyordu. Veri 30 sn paylaşılan önbellekten, en çok 60 sn yaşında gelir (`readPublicStatusFresh`;
 * olay anında ziyaretçi seli DB'ye vurmaz); "Son güncelleme" verinin okunduğu andır. Bakım modunda da açıktır
 * (maintenance-scope muaf yolu). Veri: ölçülen kesintiler (error-watch → alert_events health_down) + adminden girilen
 * olay ve planlı bakımlar (/admin/sistem?sekme=durum). Okunamazsa "durum okunamıyor" der (sahte yeşil yok).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/durum");
}

const TONE: Record<OverallLevel, { box: string; icon: typeof CheckCircle2 }> = {
  operational: { box: "border-mint-300 bg-mint-500/10 text-mint-700", icon: CheckCircle2 },
  maintenance: { box: "border-brand-300 bg-brand-600/10 text-brand-700", icon: Wrench },
  degraded: { box: "border-amber-300 bg-amber-400/15 text-amber-700", icon: AlertTriangle },
  partial: { box: "border-amber-400 bg-amber-400/20 text-amber-700", icon: AlertTriangle },
  major: { box: "border-danger-300 bg-danger-500/10 text-danger-700", icon: AlertTriangle },
  unknown: { box: "border-line-strong bg-surface text-text-muted", icon: HelpCircle },
};

const BAR: Record<UptimeDay["level"], string> = {
  ok: "bg-mint-500",
  minor: "bg-amber-400",
  major: "bg-danger-500",
  none: "bg-line-strong",
};

function dayTitle(d: UptimeDay): string {
  const date = formatDateTr(`${d.day}T12:00:00+03:00`);
  if (d.pct === null) return `${date}: ölçüm yok`;
  return d.downSec > 0 ? `${date}: ${formatUptime(d.pct)} · kesinti ${formatDuration(d.downSec)}` : `${date}: ${formatUptime(d.pct)} · kesinti yok`;
}

function IncidentCard({ i, nowMs }: { i: PublicIncident; nowMs: number }) {
  const active = i.kind === "maintenance" ? maintenanceActive(i, nowMs) : !isClosedStatus(i.status);
  const tone =
    i.kind === "maintenance"
      ? "border-brand-300"
      : isClosedStatus(i.status)
        ? "border-line"
        : i.impact === "critical"
          ? "border-danger-300"
          : "border-amber-300";
  return (
    <article className={`rounded-[var(--radius-card)] border bg-surface p-5 ${tone}`}>
      <p className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
        <span>{KIND_LABEL[i.kind]}</span>
        {i.kind === "incident" ? <span>· {IMPACT_LABEL[i.impact]}</span> : null}
        <span className={active ? "text-ink-950" : undefined}>· {STATUS_LABEL[i.status]}</span>
      </p>
      <h3 className="mt-1.5 font-display text-lg font-bold text-ink-950">{i.title}</h3>
      <p className="mt-1 text-xs text-text-muted">
        {i.kind === "maintenance" && i.scheduledStart && i.scheduledEnd
          ? `${formatDateTimeTr(i.scheduledStart)} – ${formatDateTimeTr(i.scheduledEnd)}`
          : `Başlangıç ${formatDateTimeTr(i.startedAt)}`}
        {i.resolvedAt ? ` · ${i.kind === "maintenance" ? "Tamamlandı" : "Çözüldü"} ${formatDateTimeTr(i.resolvedAt)}` : ""}
      </p>
      {i.updates.length ? (
        <ol className="mt-4 space-y-3 border-l-2 border-line pl-4">
          {i.updates.map((u, idx) => (
            <li key={`${u.at}-${idx}`}>
              <p className="text-xs font-semibold text-ink-950">
                {STATUS_LABEL[u.status]} <span className="font-normal text-text-faint">· {formatDateTimeTr(u.at)}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-text-muted">{u.message}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

export default async function StatusPage() {
  const nowMs = clockNow();
  const { at: readAt, status } = await readPublicStatusFresh();
  const days = dailyUptime(status.outages, nowMs, UPTIME_DAYS);
  const total = status.uptimeReadable ? overallUptime(days) : null;
  const level = overallStatus({ incidents: status.incidents, outageOpen: status.outageOpen, nowMs, readable: status.readable });
  const Tone = TONE[level];

  // Üstte: açık olaylar ve sürmekte/yaklaşan bakımlar (penceresi geçmiş "Planlandı" bakım gösterilmez; admin
  // ekranında "kapatılmayı bekliyor" uyarısı alır). Altta: son 14 günde kapananlar.
  const current = status.incidents.filter((i) => !isClosedStatus(i.status) && !maintenanceOverdue(i, nowMs)).sort((a, b) => {
    const rank = (x: PublicIncident) => (x.kind === "incident" ? 0 : maintenanceActive(x, nowMs) ? 1 : 2);
    return rank(a) - rank(b) || (a.scheduledStart ?? a.startedAt).localeCompare(b.scheduledStart ?? b.startedAt);
  });
  const past = status.incidents.filter((i) => isClosedStatus(i.status)).sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  const measuredDays = days.filter((d) => d.pct !== null).length;

  return (
    <main id="main-content" className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-ink-950">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Ana sayfa
          </Link>
          <Link href="/" aria-label="EmlakSoft ana sayfa" className="inline-flex min-h-11 items-center">
            <Brand variant="horizontal" tone="light" height={30} alt="" />
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        <section>
          <h1 className="font-display text-3xl font-extrabold text-ink-950">Hizmet durumu</h1>
          <div role="status" className={`mt-5 flex items-center gap-3 rounded-[var(--radius-card)] border px-5 py-4 ${Tone.box}`}>
            <Tone.icon className="h-6 w-6 shrink-0" aria-hidden />
            <p className="font-display text-lg font-bold">{OVERALL_LABEL[level]}</p>
          </div>
          <p className="mt-2 text-xs text-text-faint">Son güncelleme: {formatDateTimeTr(readAt)} (dakikada bir yenilenir)</p>
        </section>

        {current.length ? (
          <section aria-labelledby="aktif" className="space-y-3">
            <h2 id="aktif" className="font-display text-lg font-bold text-ink-950">
              Güncel olaylar ve planlı bakımlar
            </h2>
            {current.map((i) => (
              <IncidentCard key={i.id} i={i} nowMs={nowMs} />
            ))}
          </section>
        ) : null}

        <section aria-labelledby="erisim" className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="erisim" className="font-display text-lg font-bold text-ink-950">
              Erişilebilirlik · son {UPTIME_DAYS} gün
            </h2>
            <p className="font-display text-xl font-extrabold tabular-nums text-ink-950">{formatUptime(total)}</p>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            emlaksoft.com.tr sağlık kontrolü 30 saniyede bir yoklanır. {measuredDays < UPTIME_DAYS ? `Ölçüm ${measuredDays} gündür yapılıyor; öncesi gri gösterilir.` : ""}
          </p>
          <div className="mt-4 flex h-9 items-stretch gap-px" role="img" aria-label={`Son ${UPTIME_DAYS} gün günlük erişilebilirlik: ${formatUptime(total)}`}>
            {days.map((d) => (
              <span key={d.day} title={dayTitle(d)} className={`min-w-0 flex-1 rounded-[1px] ${BAR[d.level]}`} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-text-faint">
            <span>{UPTIME_DAYS} gün önce</span>
            <span>Bugün</span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <li className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-[1px] ${BAR.ok}`} aria-hidden /> Kesinti yok</li>
            <li className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-[1px] ${BAR.minor}`} aria-hidden /> 30 dk&apos;dan kısa kesinti</li>
            <li className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-[1px] ${BAR.major}`} aria-hidden /> 30 dk ve üzeri</li>
            <li className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-[1px] ${BAR.none}`} aria-hidden /> Ölçüm yok</li>
          </ul>
        </section>

        <section aria-labelledby="gecmis" className="space-y-3">
          <h2 id="gecmis" className="font-display text-lg font-bold text-ink-950">
            Son {PAST_INCIDENT_DAYS} gün
          </h2>
          {past.length ? (
            past.map((i) => <IncidentCard key={i.id} i={i} nowMs={nowMs} />)
          ) : (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
              Son {PAST_INCIDENT_DAYS} günde bildirilen olay ya da bakım yok.
            </p>
          )}
        </section>

        <p className="text-xs leading-relaxed text-text-faint">
          Bu sayfa çerez kullanmaz ve kişisel veri toplamaz. Kesinti süresi, otomatik uyarının açıldığı andan kapandığı ana kadar
          ölçülür; birkaç dakikalık dalgalanmalar sayılmaz. Sorun yaşıyorsanız uygulamadaki Yardım bölümünden destek talebi açabilirsiniz.
        </p>
      </div>
    </main>
  );
}
