import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarDays, Clock3, Grid3x3, KeyRound, MapPin, Wallet } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getProject, getProjectPaymentSummary, listProjectUnits } from "@/app/actions/projects";
import { StatCard } from "@/components/app/stat-card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { UnitsBoard } from "./units-board";
import { AddUnitsDialog } from "./add-units-dialog";
import { PROJECT_STATUS_LABELS } from "@/lib/status-labels";

export const metadata = { title: "Proje detayı" };

const STATUS_LABELS = PROJECT_STATUS_LABELS;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  planning:  "info",
  selling:   "success",
  delivered: "default",
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

export default async function ProjeDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("projects", "/app/projeler");
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

      <PageHeader
        eyebrow={project.developer_name ?? "İnşaat projesi"}
        title={project.name}
        description={
          <>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
            </span>
            {project.description ? <span className="mt-1 block">{project.description}</span> : null}
          </>
        }
        meta={
          <Badge variant={STATUS_VARIANT[project.status] ?? "default"}>
            {STATUS_LABELS[project.status] ?? project.status}
          </Badge>
        }
        actions={canCreate ? <AddUnitsDialog projectId={project.id} /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Durum kartları daire ızgarasına iner (orada durum çipiyle süzülür) — sıfır çıkmaz metrik */}
        <StatCard label="Müsait" value={musait} icon={Grid3x3} tone="success" href="#daireler" />
        <StatCard label="Rezerve" value={rezerve} icon={Clock3} tone="warning" href="#daireler" />
        <StatCard label="Kapora" value={kapora} icon={KeyRound} href="#daireler" />
        <StatCard label="Satılan" value={satilan} icon={BadgeCheck} href="#daireler" />
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
