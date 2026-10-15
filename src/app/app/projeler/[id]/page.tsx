import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarDays, Clock3, Grid3x3, KeyRound, MapPin, Wallet } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getProject, getProjectPaymentSummary, listProjectUnits } from "@/app/actions/projects";
import { StatCard } from "@/components/app/stat-card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { UnitsBoard } from "./units-board";
import { AddUnitsPanel, AddUnitsTrigger } from "./add-units-panel";
import { ProjectEditPanel, ProjectEditTrigger } from "./project-edit-panel";
import { PROJECT_STATUS_LABELS } from "@/lib/status-labels";
import { PrintButton } from "@/components/ui/print-button";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/base-url";
import { districtWithProvinceResult, provinceOptionsResult } from "@/lib/geo/reader";
import { loadProjectMedia } from "@/lib/projects/project-media";
import { loadProjectShare } from "@/lib/projects/project-share";
import { RepricePanel, RepriceTrigger } from "./reprice-panel";
import { ProjectShareCard } from "./project-share-card";
import { ProjectGallery } from "./project-gallery";
import { ProjectBuyers } from "./project-buyers";

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
  const { perms, tenantId } = await requireModulePage("projects", "/app/projeler");
  const { id } = await params;
  const supabase = await createClient();

  const [project, units, payments, share, media, provinces] = await Promise.all([
    getProject(id),
    listProjectUnits(id),
    getProjectPaymentSummary(id),
    tenantId ? loadProjectShare(supabase, { tenantId, projectId: id }) : null,
    tenantId ? loadProjectMedia(supabase, { tenantId, projectId: id }) : null,
    provinceOptionsResult(),
  ]);
  if (!project) notFound();
  const district = project.district_id ? (await districtWithProvinceResult(project.district_id)).data : null;

  const canCreate = (perms.projects ?? []).includes("create");
  const canEdit   = (perms.projects ?? []).includes("edit");
  const canSeeCustomers = (perms.customers ?? []).includes("view");
  const shareUrl = share?.enabled && share.token ? `${getBaseUrl()}/proje/${share.token}` : null;
  const availableUnits = units.filter((u) => u.status === "available");

  const musait  = units.filter((u) => u.status === "available").length;
  const rezerve = units.filter((u) => u.status === "reserved").length;
  const kapora  = units.filter((u) => u.status === "deposit").length;
  const satilan = units.filter((u) => u.status === "sold").length;

  return (
    <div className="space-y-6">
      <div className="no-print space-y-6">
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
              {project.location || district ? (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {[project.location, district ? `${district.name}${district.province ? ` / ${district.province.name}` : ""}` : null]
                    .filter(Boolean)
                    .join(" · ")}
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
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit ? <ProjectEditTrigger /> : null}
            {canEdit && units.length > 0 ? <RepriceTrigger /> : null}
            {canCreate ? <AddUnitsTrigger /> : null}
            {availableUnits.length > 0 ? <PrintButton tone="outline" size="sm" label="Fiyat listesi yazdır" /> : null}
          </div>
        }
      />

      {/* Sayfa içi paneller (popup değil): proje düzenleme, toplu fiyat ve daire ekleme */}
      {canEdit ? (
        <ProjectEditPanel project={project} provinces={provinces.data} provinceId={district?.province_id ?? null} />
      ) : null}
      {canEdit && units.length > 0 ? <RepricePanel projectId={project.id} units={units} /> : null}
      {canCreate ? <AddUnitsPanel projectId={project.id} /> : null}

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense
          fallback={<div className="h-48 animate-pulse rounded-[var(--radius-panel)] bg-line" role="status" aria-label="Uygun alıcılar yükleniyor" />}
        >
          {tenantId ? (
            <ProjectBuyers
              tenantId={tenantId}
              project={{ id: project.id, name: project.name, district_id: project.district_id ?? null, province_id: district?.province_id ?? null }}
              units={units}
              shareEnabled={Boolean(shareUrl)}
              canSeeCustomers={canSeeCustomers}
            />
          ) : null}
        </Suspense>
        <ProjectShareCard
          projectId={project.id}
          projectName={project.name}
          available={share?.available ?? false}
          enabled={Boolean(shareUrl)}
          showPrices={share?.showPrices ?? true}
          url={shareUrl}
          availableUnits={availableUnits.length}
          canEdit={canEdit}
        />
      </div>

      <ProjectGallery
        projectId={project.id}
        items={(media?.items ?? []).map((m) => ({ id: m.id, kind: m.kind, url: m.url, isCover: m.isCover, caption: m.caption }))}
        available={media?.available ?? false}
        canEdit={canEdit}
      />
      </div>

      {/* Yazdırılabilir fiyat listesi — yalnız çıktıda (müsait daireler). */}
      <section className="print-only print-sheet">
        <h1 className="font-display text-2xl font-extrabold text-ink-950">{project.name} — fiyat listesi</h1>
        <p className="mt-1 text-sm text-text-muted">
          {[project.developer_name, project.location, district?.name].filter(Boolean).join(" · ")}
          {project.delivery_date
            ? ` · Teslim: ${new Date(project.delivery_date).toLocaleDateString("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" })}`
            : ""}
        </p>
        <table className="mt-4 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Blok", "Kat", "Daire", "Oda", "Brüt m²", "Liste fiyatı"].map((h) => (
                <th key={h} className="py-1.5 pr-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {availableUnits.map((u) => (
              <tr key={u.id} className="border-b border-line">
                <td className="py-1 pr-3">{u.block ?? "—"}</td>
                <td className="py-1 pr-3">{u.floor == null ? "—" : u.floor === 0 ? "Zemin" : u.floor}</td>
                <td className="py-1 pr-3">{u.unit_no}</td>
                <td className="py-1 pr-3">{u.rooms ?? "—"}</td>
                <td className="py-1 pr-3">{u.gross_m2 ?? "—"}</td>
                <td className="py-1 pr-3">{u.list_price != null ? money(Number(u.list_price)) : "Fiyat için arayın"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-text-muted">Fiyatlar liste fiyatıdır; değişiklik hakkı saklıdır.</p>
      </section>
    </div>
  );
}
