import { MapPin, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { GeoSyncAutoRefresh } from "./geo-sync-auto-refresh";
import { ProvinceRow, type ProvinceRowData } from "./province-row";

export default async function AdminGeoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformModule("geo");
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const admin = createAdminClient();
  let provinceQuery = admin
    .from("geo_provinces")
    .select("id, plate_code, name, lat, lng, is_active, population")
    .order("plate_code", { ascending: true });
  if (query) provinceQuery = provinceQuery.ilike("name", `%${query}%`);

  const [{ data: provinces }, { data: stats }, syncResult] = await Promise.all([
    provinceQuery,
    admin.from("geo_province_stats").select("province_id, district_count, neighborhood_count"),
    admin.from("geo_province_sync_status").select("*"),
  ]);

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

  const rows: ProvinceRowData[] = (provinces ?? []).map((p) => ({
    id: p.id,
    plate_code: p.plate_code,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    is_active: p.is_active,
    population: p.population,
    districtCount: statMap.get(p.id)?.district_count ?? 0,
    neighborhoodCount: statMap.get(p.id)?.neighborhood_count ?? 0,
    sync: syncMap.get(p.id) ?? null,
    syncAvailable: !syncResult.error,
  }));

  return (
    <div className="space-y-6">
      <GeoSyncAutoRefresh active={hasActiveSync} />
      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-300">
              <MapPin className="h-3.5 w-3.5" /> Coğrafya yönetimi
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">İl · ilçe · mahalle</h1>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              TurkiyeAPI kaynağıyla il bazlı doğrulama ve eksik tamamlama. Seçilen il öne alınır; diğer il taramaları bekler.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-white">{rows.length}/81</p>
              <p className="text-xs text-white/50">İl</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-white">{totalDistricts.toLocaleString("tr-TR")}</p>
              <p className="text-xs text-white/50">İlçe</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-white">{totalNeighborhoods.toLocaleString("tr-TR")}</p>
              <p className="text-xs text-white/50">Mahalle</p>
            </div>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <form className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="İl ara (örn. İzmir)…"
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
          </form>
          <p className="text-xs text-text-muted">Kaynakta bulunmayan mevcut kayıtlar silinmez; pasif kayıtlar otomatik açılmaz.</p>
        </div>
        {syncResult.error ? (
          <div className="border-b border-amber-300/40 bg-amber-500/[0.06] px-5 py-3 text-xs font-medium text-amber-800">
            İl bazlı tarama altyapısı bu ortamda henüz etkin değil. Mevcut coğrafya kayıtları görüntülenmeye devam eder.
          </div>
        ) : null}
        <div>
          {rows.map((p) => (
            <ProvinceRow key={p.id} province={p} />
          ))}
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-text-muted">Eşleşen il bulunamadı.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
