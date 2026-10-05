import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { getProvinceOptions } from "@/lib/geo/reader";
import { GeoReportForm } from "./report-form";

export const metadata = { title: "Bölge bildirimi" };

/** Ayarlar > Eksik/yanlış mahalle bildir. Menü öğesi değil, Ayarlar kartıdır. Platform ekibi kuyruktan onaylar. */
export default async function GeoReportPage() {
  const { perms } = await requireModulePage("settings");
  const canEdit = effectiveHasPermission(perms, "settings", "edit");
  const provinces = await getProvinceOptions();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        eyebrow="Ayarlar"
        title="Eksik ya da yanlış mahalle bildir"
        description="Listede bulamadığınız ya da yanlış yazılmış bir mahalleyi bildirin; platform ekibi inceleyip tüm ofisler için düzeltir."
        breadcrumbs={[{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Bölge bildirimi" }]}
      />
      {canEdit ? (
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
          <GeoReportForm provinces={provinces} />
        </section>
      ) : (
        <Alert tone="info">Bölge bildirimi için ayar yetkisi gerekir.</Alert>
      )}
    </div>
  );
}
