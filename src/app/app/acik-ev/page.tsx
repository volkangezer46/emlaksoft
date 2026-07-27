import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DoorOpen,
  MapPin,
  Radio,
  Users,
  X,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listOpenHouses } from "@/app/actions/targets-openhouse-sources";
import { isPast, msUntil, DAY_MS } from "@/lib/clock";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { NewOpenHouseDialog } from "./new-open-house-dialog";

export const metadata = { title: "Açık Ev Takibi" };

const STATUS_LABELS: Record<string, string> = {
  planned:   "Planlandı",
  active:    "Devam ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

type PropertyRel = { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;

function propertyLabel(p: PropertyRel) {
  if (!p) return "—";
  const item = Array.isArray(p) ? p[0] : p;
  return item?.title ?? item?.property_code ?? "—";
}

const FILTER_LABELS: Record<string, string> = {
  yaklasan: "Yaklaşan",
  ...STATUS_LABELS,
};

function dateLong(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Etkinliğe kalan süre etiketi — geçmişse null. */
function countdownLabel(iso: string): string | null {
  const remain = msUntil(iso);
  if (remain < 0) return null;
  const days = Math.floor(remain / DAY_MS);
  if (days === 0) return "Bugün";
  if (days === 1) return "Yarın";
  return `${days} gün kaldı`;
}

export default async function AcikEvPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string }>;
}) {
  const { perms } = await requireModulePage("open_house");
  const params = (await searchParams) ?? {};
  const durum = Object.keys(FILTER_LABELS).includes(params.durum ?? "") ? params.durum : undefined;
  const events = await listOpenHouses();
  const canCreate = (perms.open_house ?? perms.appointments ?? []).includes("create");

  const isUpcoming = (e: (typeof events)[number]) =>
    !isPast(e.scheduled_at) && e.status !== "cancelled" && e.status !== "completed";

  const upcoming  = events.filter(isUpcoming);
  const live      = events.filter((e) => e.status === "active");
  const completed = events.filter((e) => e.status === "completed");
  const totalVisitors = events.reduce((s, e) => s + (e.visitor_count ?? 0), 0);
  const avgVisitors = completed.length > 0
    ? Math.round(completed.reduce((s, e) => s + (e.visitor_count ?? 0), 0) / completed.length)
    : 0;

  // Sıradaki etkinlik — en yakın tarihli yaklaşan
  const nextEvent = [...upcoming].sort(
    (a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)),
  )[0];

  const filtered = events.filter((e) => {
    if (!durum) return true;
    if (durum === "yaklasan") return isUpcoming(e);
    return e.status === durum;
  });

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-mint-500/25 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-300">
              <DoorOpen className="h-4 w-4" /> Açık ev günleri
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Açık Ev Takibi</h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              Portföy tanıtım günlerini planlayın, ziyaretçileri kapıda kaydedin, tamamlanan etkinliklerin verimini izleyin.
            </p>
            {canCreate ? (
              <div className="mt-4">
                <NewOpenHouseDialog />
              </div>
            ) : null}
          </div>
          {live.length > 0 ? (
            <Link
              href="/app/acik-ev?durum=active"
              className="focus-ring press lift flex items-center gap-3 rounded-[14px] border border-mint-400/40 bg-mint-500/15 px-4 py-3"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-mint-400" />
              </span>
              <div>
                <p className="text-[11px] text-white/70">Şu an canlı</p>
                <p className="text-sm font-bold text-white">{live.length} etkinlik devam ediyor</p>
              </div>
            </Link>
          ) : null}
        </div>
      </section>

      {/* KPI şeridi — hepsi listeyi süzer */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Yaklaşan etkinlik" value={upcoming.length} icon={Clock3} href="/app/acik-ev?durum=yaklasan" />
        <StatCard
          label="Devam eden"
          value={live.length}
          icon={Radio}
          tone={live.length > 0 ? "success" : "neutral"}
          href="/app/acik-ev?durum=active"
        />
        <StatCard label="Tamamlanan" value={completed.length} icon={CheckCircle2} tone="success" href="/app/acik-ev?durum=completed" />
        <StatCard
          label="Toplam ziyaretçi"
          value={totalVisitors}
          icon={Users}
          tone="warning"
          trend={avgVisitors > 0 ? "up" : "neutral"}
          trendLabel={avgVisitors > 0 ? `ort. ${avgVisitors}/etkinlik` : undefined}
          href="/app/acik-ev"
        />
      </div>

      {/* Sıradaki etkinlik — spot kart */}
      {nextEvent ? (
        <section className="relative overflow-hidden rounded-[18px] border border-mint-500/30 bg-mint-500/6 p-5">
          <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-mint-500/15 blur-[60px]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-mint-500/15 text-mint-600">
                <DoorOpen className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-mint-600">
                  Sıradaki etkinlik
                  {countdownLabel(String(nextEvent.scheduled_at)) ? (
                    <Badge variant="success" size="sm">{countdownLabel(String(nextEvent.scheduled_at))}</Badge>
                  ) : null}
                </p>
                <p className="mt-1 truncate font-display text-lg font-extrabold text-ink-950">
                  {propertyLabel(nextEvent.property)}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" /> {dateLong(String(nextEvent.scheduled_at))}
                  </span>
                  {nextEvent.location ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {nextEvent.location}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {nextEvent.visitor_count ?? 0}
                    {nextEvent.max_visitors ? ` / ${nextEvent.max_visitors} kayıt` : " kayıt"}
                  </span>
                </p>
              </div>
            </div>
            <Link
              href={`/app/acik-ev/${nextEvent.id}`}
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-900"
            >
              Etkinliği yönet <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      ) : null}

      {/* Durum çipleri */}
      {events.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/acik-ev"
            aria-current={!durum ? "page" : undefined}
            className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              !durum
                ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            Tümü ({events.length})
          </Link>
          {Object.entries(FILTER_LABELS).map(([key, label]) => {
            const count =
              key === "yaklasan" ? upcoming.length : events.filter((e) => e.status === key).length;
            if (count === 0 && durum !== key) return null;
            return (
              <Link
                key={key}
                href={`/app/acik-ev?durum=${key}`}
                aria-current={durum === key ? "page" : undefined}
                className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  durum === key
                    ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                    : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
                }`}
              >
                {label} ({count})
              </Link>
            );
          })}
          {durum ? (
            <Link
              href="/app/acik-ev"
              aria-label="Filtreyi temizle"
              className="focus-ring inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-semibold text-text-muted hover:text-danger-500"
            >
              <X className="h-3.5 w-3.5" /> Temizle
            </Link>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title={events.length === 0 ? "Henüz açık ev etkinliği yok" : "Filtreye uyan etkinlik yok"}
          description={
            events.length === 0
              ? "İlk açık ev gününüzü bu ekrandan planlayın; QR ile ziyaretçileri kapıda kaydedin, etkinlik sonrası müşteriye dönüştürün."
              : "Filtreyi temizleyip tüm etkinlikleri görebilirsiniz."
          }
          tone="mint"
          action={
            events.length === 0 && canCreate
              ? { node: <NewOpenHouseDialog /> }
              : events.length > 0
                ? { href: "/app/acik-ev", label: "Filtreyi temizle" }
                : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => {
            // Palet disi Tailwind varsayilanlari (blue/emerald/zinc/red) proje
            // token'lariyla degistirildi; ayni ekranda iki farkli mavi vardi.
            const statusColor: Record<string, string> = {
              planned:   "bg-brand-600/10 text-brand-600",
              active:    "bg-mint-500/12 text-mint-600",
              completed: "bg-ink-950/6 text-text-muted",
              cancelled: "bg-danger-500/10 text-danger-600",
            };
            const countdown = e.status === "planned" ? countdownLabel(String(e.scheduled_at)) : null;
            const fillPct = e.max_visitors
              ? Math.min(100, Math.round(((e.visitor_count ?? 0) / e.max_visitors) * 100))
              : null;
            return (
              <div key={e.id} className="lift group relative rounded-[20px] border border-line bg-surface p-5 transition hover:border-brand-300">
                {/* Ortu-link ONCEDEN PORTFOYE gidiyordu: acik ev kartina
                    tiklayinca etkinlik degil portfoy aciliyordu ve ziyaretci
                    listesine ulasilacak HICBIR yol yoktu. Artik acik ev
                    detayina gidiyor; portfoy bagi detay sayfasinda ayri kart. */}
                <Link
                  href={`/app/acik-ev/${e.id}`}
                  className="focus-ring absolute inset-0 rounded-[20px]"
                  aria-label={`${propertyLabel(e.property)} açık ev detayını aç`}
                />
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                    <DoorOpen className="h-5 w-5" />
                  </span>
                  <span className="flex items-center gap-1.5">
                    {countdown ? (
                      <span className="rounded-full bg-amber-400/14 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                        {countdown}
                      </span>
                    ) : null}
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColor[e.status] ?? statusColor.planned}`}>
                      {e.status === "active" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint-500" />
                          {STATUS_LABELS[e.status]}
                        </span>
                      ) : (
                        STATUS_LABELS[e.status] ?? e.status
                      )}
                    </span>
                  </span>
                </div>

                <p className="mt-3 font-semibold text-ink-950">{propertyLabel(e.property)}</p>

                <div className="mt-2 space-y-1 text-xs text-text-muted">
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {dateLong(String(e.scheduled_at))}
                    {e.duration_min && <span>({e.duration_min} dk)</span>}
                  </p>
                  {e.location && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {e.location}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {e.visitor_count ?? 0} ziyaretçi
                    {e.max_visitors && ` / maks. ${e.max_visitors}`}
                  </p>
                </div>

                {/* Kapasite doluluk çubuğu */}
                {fillPct !== null ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] font-semibold">
                      <span className="text-text-muted">Doluluk</span>
                      <span className={fillPct >= 90 ? "text-amber-600" : "text-mint-600"}>%{fillPct}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-950/8">
                      <div
                        className={`h-full rounded-full transition-all ${fillPct >= 90 ? "bg-amber-400" : "bg-mint-500"}`}
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <Link
                    href={`/app/acik-ev/${e.id}`}
                    className="focus-ring relative z-10 rounded-[6px] text-xs font-semibold text-brand-600 hover:underline"
                  >
                    {e.status === "completed" ? "Ziyaretçi listesi →" : "Etkinliği yönet →"}
                  </Link>
                  <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
