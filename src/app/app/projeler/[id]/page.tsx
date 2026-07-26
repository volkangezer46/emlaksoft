import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Building2, CalendarDays, Clock3, Grid3x3, KeyRound, MapPin, Wallet } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getProject, getProjectPaymentSummary, listProjectUnits } from "@/app/actions/projects";
import { StatCard } from "@/components/app/stat-card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { UnitsBoard } from "./units-board";
import { AddUnitsDialog } from "./add-units-dialog";

export const metadata = { title: "Proje detayı" };

const STATUS_LABELS: Record<string, string> = {
  planning:  "Planlama",
  selling:   "Satışta",
  delivered: "Teslim edildi",
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  planning:  "info",
  selling:   "success",
  delivered: "default",
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

export default async function ProjeDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("projects");
  const { id } = await params;

  const [project, units, payments] = await Promise.all([
    getProject(id),
    listProjectUnits(id),
    getProjectPaymentSummary(id),
  ]);
  if (!project) notFound();

  const canCreate = (perms.projects ?? []).includes("create");
  const canEdit   = (perms.projects ?? []).includes("edit");

  const musait  = units.filter((u) => u.status === "available").length;
  const rezerve = units.filter((u) => u.status === "reserved").length;
  const kapora  = units.filter((u) => u.status === "deposit").length;
  const satilan = units.filter((u) => u.status === "sold").length;

  return (
    <div className="space-y-6">
      <Link
        href="/app/projeler"
        className="focus-ring inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Projeler
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Building2 className="h-4 w-4" /> {project.developer_name ?? "İnşaat projesi"}
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">{project.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75">
              {project.location ? (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {project.location}
                </span>
              ) : null}
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {project.delivery_date
                  ? `Teslim: ${new Date(project.delivery_date).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}`
                  : "Teslim tarihi girilmedi"}
              </span>
            </div>
            {project.description ? <p className="mt-2 max-w-2xl text-sm text-white/60">{project.description}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={STATUS_VARIANT[project.status] ?? "default"}>
              {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
            {canCreate ? <AddUnitsDialog projectId={project.id} /> : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Müsait" value={musait} icon={Grid3x3} tone="success" />
        <StatCard label="Rezerve" value={rezerve} icon={Clock3} tone="warning" />
        <StatCard label="Kapora" value={kapora} icon={KeyRound} />
        <StatCard label="Satılan" value={satilan} icon={BadgeCheck} />
        {/* Ödeme planı KPI'ları — daire dialoglarındaki planlardan; kart daire ızgarasına iner */}
        <StatCard
          label="Bu ay beklenen tahsilat"
          value={money(payments.monthExpected)}
          icon={Wallet}
          href={`/app/projeler/${project.id}#daireler`}
        />
        <StatCard
          label="Geciken taksit"
          value={payments.overdueCount}
          icon={AlertTriangle}
          tone={payments.overdueCount > 0 ? "danger" : "neutral"}
          trend={payments.overdueCount > 0 ? "down" : undefined}
          trendLabel={payments.overdueCount > 0 ? money(payments.overdueSum) : undefined}
          href={`/app/projeler/${project.id}#daireler`}
        />
      </div>

      <div id="daireler" className="scroll-mt-24">
        <UnitsBoard projectId={project.id} units={units} canEdit={canEdit} canCreate={canCreate} />
      </div>
    </div>
  );
}
