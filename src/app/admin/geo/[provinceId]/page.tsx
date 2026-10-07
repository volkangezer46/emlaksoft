import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { attachUsage, getAdminRow, listAdminRows } from "@/lib/geo/admin-store";
import { getProvinceOptions } from "@/lib/geo/reader";
import { GeoEntityList, type EntityRowData } from "../entity-list";
import { NewEntityForm } from "../new-entity-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export default async function AdminGeoProvincePage({
  params,
  searchParams,
}: {
  params: Promise<{ provinceId: string }>;
  searchParams: Promise<{ q?: string; durum?: string }>;
}) {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  const { provinceId } = await params;
  const { q, durum } = await searchParams;
  const query = (q ?? "").trim();
  const status = durum === "pasif" ? "inactive" : durum === "aktif" ? "active" : "all";

  const province = await getAdminRow("province", provinceId);
  if (!province) notFound();

  const [{ rows: districts }, provinceOptions] = await Promise.all([
    listAdminRows("district", { parentId: provinceId, q: query, status }),
    getProvinceOptions({ includeInactive: true }),
  ]);
  const withUsage = await attachUsage("district", districts);
  const admin = createAdminClient();
  const { data: stats } = await admin.from("geo_district_stats").select("district_id, neighborhood_count");
  const statMap = new Map((stats ?? []).map((s) => [s.district_id, s.neighborhood_count]));

  const rows: EntityRowData[] = withUsage.map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    isActive: d.isActive,
    lat: d.lat,
    lng: d.lng,
    postalCode: null,
    population: d.population,
    usage: d.usage,
    childCount: statMap.get(d.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <Link href="/admin/geo" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Tüm iller
      </Link>

      <AdminPageHeader eyebrow={`Plaka ${province.plateCode}`} icon={MapPin} title={`${province.name} · ilçeler`} description={`${rows.length} ilçe listeleniyor.`} />

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <form className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="İlçe ara…"
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
            {durum ? <input type="hidden" name="durum" value={durum} /> : null}
          </form>
          <nav aria-label="Durum süzgeci" className="flex gap-1 text-xs font-semibold">
            {[["", "Tümü"], ["aktif", "Aktif"], ["pasif", "Pasif"]].map(([v, label]) => (
              <Link
                key={v || "tum"}
                href={`/admin/geo/${provinceId}?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(v ? { durum: v } : {}) }).toString()}`}
                className={`rounded-full border px-2.5 py-1 ${(durum ?? "") === v ? "border-brand-400 text-brand-600" : "border-line text-text-muted"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {canWrite ? <NewEntityForm level="district" parentId={province.id} /> : null}

        <GeoEntityList
          level="district"
          rows={rows}
          canWrite={canWrite}
          provinceOptions={provinceOptions}
          childBase={`/admin/geo/${provinceId}`}
          childLabel="Mahalleler"
        />
      </div>
    </div>
  );
}
