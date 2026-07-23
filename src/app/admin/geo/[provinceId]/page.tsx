import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { DistrictRow, type DistrictRowData } from "./district-row";
import { NewDistrictForm } from "./new-district-form";

export default async function AdminGeoProvincePage({
  params,
  searchParams,
}: {
  params: Promise<{ provinceId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformModule("geo");
  const { provinceId } = await params;
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const admin = createAdminClient();
  const { data: province } = await admin
    .from("geo_provinces")
    .select("id, plate_code, name")
    .eq("id", provinceId)
    .maybeSingle();

  if (!province) notFound();

  let districtQuery = admin
    .from("geo_districts")
    .select("id, province_id, name, lat, lng, is_active, population")
    .eq("province_id", provinceId)
    .order("name", { ascending: true });
  if (query) districtQuery = districtQuery.ilike("name", `%${query}%`);

  const [{ data: districts }, { data: stats }] = await Promise.all([
    districtQuery,
    admin.from("geo_district_stats").select("district_id, neighborhood_count"),
  ]);

  const statMap = new Map((stats ?? []).map((s) => [s.district_id, s.neighborhood_count]));

  const rows: DistrictRowData[] = (districts ?? []).map((d) => ({
    id: d.id,
    province_id: d.province_id,
    name: d.name,
    lat: d.lat,
    lng: d.lng,
    is_active: d.is_active,
    population: d.population,
    neighborhoodCount: statMap.get(d.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <Link href="/admin/geo" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Tüm iller
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <MapPin className="h-3.5 w-3.5" /> Plaka {province.plate_code}
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">{province.name} · ilçeler</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">{rows.length} ilçe listeleniyor.</p>
        </div>
      </section>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <form className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="İlçe ara…"
              className="w-full rounded-[10px] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
          </form>
        </div>

        <NewDistrictForm provinceId={province.id} />

        <div>
          {rows.map((d) => (
            <DistrictRow key={d.id} district={d} />
          ))}
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-text-muted">Eşleşen ilçe bulunamadı.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
