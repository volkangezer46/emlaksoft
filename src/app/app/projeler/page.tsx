import { ListHero, ListPage } from "@/components/ui/list-page";
import { ReportOpenLink } from "@/components/report-center/report-open-link";
import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  Clock3,
  Grid3x3,
  Layers,
  MapPin,
  Plus,
  Timer,
  X,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listProjects } from "@/app/actions/projects";
import { msUntil, DAY_MS } from "@/lib/clock";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PROJECT_STATUS_LABELS } from "@/lib/status-labels";

export const metadata = { title: "Projeler" };

const STATUS_LABELS = PROJECT_STATUS_LABELS;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  planning:  "info",
  selling:   "success",
  delivered: "default",
};

/** Durum filtreleri — KPI kartları ve çipler bu paramla listeyi süzer. */
const FILTER_LABELS: Record<string, string> = {
  aktif: "Aktif projeler",
  ...STATUS_LABELS,
};

function deliveryLabel(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

export default async function ProjelerPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; yeni?: string }>;
}) {
  const { perms } = await requireModulePage("projects", "/app/projeler");
  const canCreate = (perms.projects ?? []).includes("create");
  const params = (await searchParams) ?? {};
  if (params.yeni) redirect("/app/projeler/yeni");
  const durum = Object.keys(FILTER_LABELS).includes(params.durum ?? "") ? params.durum : undefined;

  const projects = await listProjects();

  const allUnits   = projects.flatMap((p) => p.units);
  const aktifProje = projects.filter((p) => p.status !== "delivered").length;
  const satilan    = allUnits.filter((u) => u.status === "sold").length;
  const rezerve    = allUnits.filter((u) => u.status === "reserved" || u.status === "deposit").length;
  const genelPct   = allUnits.length > 0 ? Math.round((satilan / allUnits.length) * 100) : 0;

  // Teslim radarı — teslim tarihi 120 gün içinde (veya geçmiş) olan aktif projeler
  const teslimRadar = projects
    .filter((p) => p.status !== "delivered" && p.delivery_date)
    .map((p) => ({ project: p, daysLeft: Math.ceil(msUntil(`${String(p.delivery_date)}T00:00:00`) / DAY_MS) }))
    .filter(({ daysLeft }) => daysLeft <= 120)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const filtered = projects.filter((p) => {
    if (!durum) return true;
    if (durum === "aktif") return p.status !== "delivered";
    return p.status === durum;
  });

  return (
    <ListPage>
      <ListHero
        art="proje"
        eyebrow="İnşaat proje satışı"
        title="Projeler"
        description="Müteahhit projelerinin daire stoğunu, rezervasyon ve satışlarını tek ekrandan yönetin."
        actions={
          <>
            <ReportOpenLink report="projeler" filters={{ durum: ["planning", "selling", "delivered"].includes(durum ?? "") ? durum : undefined }} />
            {canCreate ? <ButtonLink href="/app/projeler/yeni" icon={Plus}>Yeni proje</ButtonLink> : null}
          </>
        }
      />
      {allUnits.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
          <p className="text-xs font-medium text-text-muted">Genel eritme oranı</p>
          <span className="numeric font-display text-xl font-extrabold text-text">%{genelPct}</span>
          <span className="h-2 w-32 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-mint-500" style={{ width: `${genelPct}%` }} />
          </span>
        </div>
      ) : null}

      {/* KPI şeridi — her kart listeyi süzer ya da listeye döner */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aktif proje" value={aktifProje} icon={Building2} href="/app/projeler?durum=aktif" />
        <StatCard label="Toplam stok" value={allUnits.length} icon={Grid3x3} href="/app/projeler" />
        <StatCard
          label="Satılan"
          value={satilan}
          icon={BadgeCheck}
          tone="success"
          trend={satilan > 0 ? "up" : "neutral"}
          trendLabel={allUnits.length > 0 ? `%${genelPct}` : undefined}
          href="/app/projeler"
        />
        <StatCard label="Rezerve + kapora" value={rezerve} icon={Clock3} tone="warning" href="/app/projeler" />
      </div>

      {/* Teslim radarı — 120 gün penceresi; geciken teslim kırmızı işaretlenir */}
      {teslimRadar.length > 0 ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
              <Timer className="h-4 w-4 text-amber-600" /> Teslim radarı
              <span className="numeric rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {teslimRadar.length}
              </span>
            </h2>
            <p className="text-xs text-text-muted">Önümüzdeki 120 gün içinde teslimi yaklaşan projeler.</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teslimRadar.map(({ project: p, daysLeft }) => (
              <Link
                key={p.id}
                href={`/app/projeler/${p.id}`}
                className="focus-ring press lift group flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4 hover:border-brand-300"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink-950">{p.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Teslim: {deliveryLabel(String(p.delivery_date))}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  {daysLeft < 0 ? (
                    <Badge variant="danger" size="sm">{Math.abs(daysLeft)} gün gecikti</Badge>
                  ) : daysLeft === 0 ? (
                    <Badge variant="warning" size="sm">Bugün</Badge>
                  ) : (
                    <Badge variant="warning" size="sm">{daysLeft} gün kaldı</Badge>
                  )}
                  <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Durum çipleri — hızlı süzgeç */}
      {projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/projeler"
            aria-current={!durum ? "page" : undefined}
            className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              !durum
                ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            Tümü ({projects.length})
          </Link>
          {Object.entries(FILTER_LABELS).map(([key, label]) => {
            const count =
              key === "aktif" ? aktifProje : projects.filter((p) => p.status === key).length;
            if (count === 0 && durum !== key) return null;
            return (
              <Link
                key={key}
                href={`/app/projeler?durum=${key}`}
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
              href="/app/projeler"
              aria-label="Filtreyi temizle"
              className="focus-ring inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-semibold text-text-muted hover:text-danger-500"
            >
              <X className="h-3.5 w-3.5" /> Temizle
            </Link>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState illustration="portfoy"
          icon={Layers}
          title={projects.length === 0 ? "Henüz proje yok" : "Filtreye uyan proje yok"}
          description={
            projects.length === 0
              ? "İlk inşaat projenizi ekleyin; blok ve daireleri stok ızgarasında yönetin, satış eritme oranını buradan izleyin."
              : "Filtreyi temizleyip tüm projeleri görüntüleyebilirsiniz."
          }
          action={
            projects.length === 0 && canCreate
              ? { label: "Yeni proje", href: "/app/projeler/yeni" }
              : projects.length > 0
                ? { href: "/app/projeler", label: "Filtreyi temizle" }
                : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const total    = p.units.length;
            const sold     = p.units.filter((u) => u.status === "sold").length;
            const held     = p.units.filter((u) => u.status === "reserved" || u.status === "deposit").length;
            const free     = Math.max(0, total - sold - held);
            const soldPct  = total > 0 ? (sold / total) * 100 : 0;
            const heldPct  = total > 0 ? (held / total) * 100 : 0;
            return (
              <div key={p.id} className="lift group relative rounded-[var(--radius-panel)] border border-line bg-surface p-5 transition hover:border-brand-300">
                <Link
                  href={`/app/projeler/${p.id}`}
                  className="focus-ring absolute inset-0 rounded-[var(--radius-panel)]"
                  aria-label={`${p.name} proje detayını aç`}
                />
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[p.status] ?? "default"} size="sm">
                      {STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                    <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
                </div>

                <p className="mt-3 font-semibold text-ink-950">{p.name}</p>
                {p.developer_name ? <p className="text-xs text-text-muted">{p.developer_name}</p> : null}

                <div className="mt-2 space-y-1 text-xs text-text-muted">
                  {p.location ? (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {p.location}
                    </p>
                  ) : null}
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {p.delivery_date
                      ? `Teslim: ${deliveryLabel(String(p.delivery_date))}`
                      : "Teslim tarihi girilmedi"}
                  </p>
                </div>

                {/* Stok kompozisyonu — satılan / rezerve / boş tek bakışta */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-muted">
                      {total > 0 ? `${sold}/${total} satıldı` : "Henüz daire yok"}
                    </span>
                    {total > 0 ? <span className="text-mint-600">%{Math.round(soldPct)}</span> : null}
                  </div>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-ink-950/8">
                    <div className="h-full bg-mint-500 transition-all" style={{ width: `${soldPct}%` }} />
                    <div className="h-full bg-amber-400 transition-all" style={{ width: `${heldPct}%` }} />
                  </div>
                  {total > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-mint-500" /> {sold} satış
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-amber-400" /> {held} rezerve
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-ink-950/20" /> {free} boş
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Hızlı eylem — örtü linkin üstünde ayrı hedef */}
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <Link
                    href={`/app/projeler/${p.id}`}
                    className="focus-ring relative z-10 rounded-[var(--radius-control)] text-xs font-semibold text-brand-600 hover:underline"
                  >
                    Stok ızgarası →
                  </Link>
                  <span className="text-xs text-text-faint">{total} daire</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ListPage>
  );
}
