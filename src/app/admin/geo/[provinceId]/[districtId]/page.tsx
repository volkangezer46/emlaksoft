import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPinned, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { NeighborhoodRow, type NeighborhoodRowData } from "./neighborhood-row";
import { NewNeighborhoodForm } from "./new-neighborhood-form";

const PAGE_SIZE = 300;

export default async function AdminGeoDistrictPage({
  params,
  searchParams,
}: {
  params: Promise<{ provinceId: string; districtId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformModule("geo");
  const { provinceId, districtId } = await params;
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const admin = createAdminClient();
  const [{ data: province }, { data: district }] = await Promise.all([
    admin.from("geo_provinces").select("id, name").eq("id", provinceId).maybeSingle(),
    admin.from("geo_districts").select("id, province_id, name").eq("id", districtId).maybeSingle(),
  ]);

  if (!province || !district || district.province_id !== provinceId) notFound();

  let neighborhoodQuery = admin
    .from("geo_neighborhoods")
    .select("id, district_id, name, postal_code, population, is_active", { count: "exact" })
    .eq("district_id", districtId)
    .order("name", { ascending: true })
    .limit(PAGE_SIZE);
  if (query) neighborhoodQuery = neighborhoodQuery.ilike("name", `%${query}%`);

  const { data: neighborhoods, count } = await neighborhoodQuery;

  const rows: NeighborhoodRowData[] = (neighborhoods ?? []).map((n) => ({
    id: n.id,
    district_id: n.district_id,
    province_id: provinceId,
    name: n.name,
    postal_code: n.postal_code,
    population: n.population,
    is_active: n.is_active,
  }));

  const total = count ?? rows.length;
  const truncated = total > rows.length;

  return (
    <div className="space-y-6">
      <Link href={`/admin/geo/${provinceId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> {province.name} · ilçeler
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <MapPinned className="h-3.5 w-3.5" /> {province.name}
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">{district.name} · mahalleler</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            {total.toLocaleString("tr-TR")} mahalle{truncated ? ` (ilk ${PAGE_SIZE} gösteriliyor — daraltmak için arayın)` : ""}
          </p>
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
              placeholder="Mahalle ara…"
              className="w-full rounded-[10px] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
          </form>
        </div>

        <NewNeighborhoodForm provinceId={provinceId} districtId={districtId} />

        <div className="max-h-[70vh] overflow-y-auto">
          {rows.map((n) => (
            <NeighborhoodRow key={n.id} neighborhood={n} />
          ))}
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-text-muted">Eşleşen mahalle bulunamadı.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
