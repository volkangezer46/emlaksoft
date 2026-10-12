import { Input } from "@/components/ui/input";
import { MapPin, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { attachUsage, listAdminRows } from "@/lib/geo/admin-store";
import { NewEntityForm } from "./new-entity-form";
import { GeoSyncAutoRefresh } from "./geo-sync-auto-refresh";
import { ProvinceRow, type ProvinceRowData } from "./province-row";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default async function AdminGeoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const admin = createAdminClient();
  const [{ rows: provinceList }, { data: stats }, syncResult] = await Promise.all([
    listAdminRows("province", { q: query }),
    admin.from("geo_province_stats").select("province_id, district_count, neighborhood_count"),
    admin.from("geo_province_sync_status").select("*"),
  ]);
  const provinces = await attachUsage("province", provinceList);

  const statMap = new Map((stats ?? []).map((s) => [s.province_id, s]));
  const syncMap = new Map(
    ((syncResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.province_id === "string")
      .map((row) => [row.province_id as string, row]),
  );
  const hasActiveSync = [...syncMap.values()].some((row) => (
    row.status === "queued" || row.status === "running" || row.status === "retry"
  ));
  const totalDistricts = (stats ?? []).reduce((sum, s) => sum + (s.district_count ?? 0), 0);
  const totalNeighborhoods = (stats ?? []).reduce((sum, s) => sum + (s.neighborhood_count ?? 0), 0);

  const rows: ProvinceRowData[] = provinces.map((p) => ({
    id: p.id,
    plate_code: p.plateCode ?? 0,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    is_active: p.isActive,
    population: p.population,
    usage: p.usage,
    districtCount: statMap.get(p.id)?.district_count ?? 0,
    neighborhoodCount: statMap.get(p.id)?.neighborhood_count ?? 0,
    sync: syncMap.get(p.id) ?? null,
    syncAvailable: !syncResult.error,
  }));

  return (
    <div className="space-y-6">
      <GeoSyncAutoRefresh active={hasActiveSync} />
      <PageHeader
        eyebrow="Coğrafya yönetimi"
        icon={<MapPin className="h-6 w-6 text-accent" aria-hidden />}
        title="İl · ilçe · mahalle"
        description={`TurkiyeAPI kaynağıyla il bazlı doğrulama ve eksik tamamlama. Seçilen il öne alınır; diğer il taramaları bekler. Kayıtlı: ${rows.length}/81 il · ${totalDistricts.toLocaleString("tr-TR")} ilçe · ${totalNeighborhoods.toLocaleString("tr-TR")} mahalle.`}
      />

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <form className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <Input type="text" name="q" defaultValue={query} placeholder="İl ara (örn. İstanbul)…" className="w-full pl-8" />
          </form>
          <p className="text-xs text-text-muted">Kaynakta bulunmayan mevcut kayıtlar silinmez; pasif kayıtlar otomatik açılmaz.</p>
        </div>
        {canWrite ? <NewEntityForm level="province" /> : null}
        {syncResult.error ? (
          <div className="border-b border-warning-line bg-warning-soft px-5 py-3 text-xs font-medium text-warning-strong">
            İl bazlı tarama altyapısı bu ortamda henüz etkin değil. Mevcut coğrafya kayıtları görüntülenmeye devam eder.
          </div>
        ) : null}
        <div>
          {rows.map((p) => (
            <ProvinceRow key={p.id} province={p} />
          ))}
          {rows.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={MapPin}
              title={query ? "Eşleşen il bulunamadı" : "Henüz il kaydı yok"}
              description={query ? `“${query}” için sonuç yok. Yazımı kontrol edin ya da aramayı temizleyin.` : "Coğrafya verisi yüklendiğinde iller burada listelenir."}
              action={query ? { href: "/admin/geo", label: "Aramayı temizle" } : undefined}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
