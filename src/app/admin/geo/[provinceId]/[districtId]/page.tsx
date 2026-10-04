import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPinned, Search } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { attachUsage, getAdminRow, listAdminRows } from "@/lib/geo/admin-store";
import { getProvinceOptions } from "@/lib/geo/reader";
import { GeoEntityList, type EntityRowData } from "../../entity-list";
import { NewEntityForm } from "../../new-entity-form";

const PAGE_SIZE = 300;

export default async function AdminGeoDistrictPage({
  params,
  searchParams,
}: {
  params: Promise<{ provinceId: string; districtId: string }>;
  searchParams: Promise<{ q?: string; durum?: string }>;
}) {
  const staff = await requirePlatformModule("geo");
  const canWrite = staff.role === "super_admin";
  const { provinceId, districtId } = await params;
  const { q, durum } = await searchParams;
  const query = (q ?? "").trim();
  const status = durum === "pasif" ? "inactive" : durum === "aktif" ? "active" : "all";

  const [province, district] = await Promise.all([getAdminRow("province", provinceId), getAdminRow("district", districtId)]);
  if (!province || !district || district.parentId !== provinceId) notFound();

  const [{ rows: found, total }, provinceOptions] = await Promise.all([
    listAdminRows("neighborhood", { parentId: districtId, q: query, status, limit: PAGE_SIZE }),
    getProvinceOptions({ includeInactive: true }),
  ]);
  const withUsage = await attachUsage("neighborhood", found);
  const rows: EntityRowData[] = withUsage.map((n) => ({
    id: n.id,
    name: n.name,
    parentId: n.parentId,
    isActive: n.isActive,
    lat: n.lat,
    lng: n.lng,
    postalCode: n.postalCode,
    population: n.population,
    usage: n.usage,
  }));
  const truncated = total > rows.length;

  return (
    <div className="space-y-6">
      <Link href={`/admin/geo/${provinceId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> {province.name} · ilçeler
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-300">
            <MapPinned className="h-3.5 w-3.5" /> {province.name}
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">{district.name} · mahalleler</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            {total.toLocaleString("tr-TR")} mahalle{truncated ? ` (ilk ${PAGE_SIZE} gösteriliyor — daraltmak için arayın)` : ""}
          </p>
        </div>
      </section>

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <form className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Mahalle ara…"
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
            {durum ? <input type="hidden" name="durum" value={durum} /> : null}
          </form>
          <nav aria-label="Durum süzgeci" className="flex gap-1 text-xs font-semibold">
            {[["", "Tümü"], ["aktif", "Aktif"], ["pasif", "Pasif"]].map(([v, label]) => (
              <Link
                key={v || "tum"}
                href={`/admin/geo/${provinceId}/${districtId}?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(v ? { durum: v } : {}) }).toString()}`}
                className={`rounded-full border px-2.5 py-1 ${(durum ?? "") === v ? "border-brand-400 text-brand-600" : "border-line text-text-muted"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {canWrite ? <NewEntityForm level="neighborhood" parentId={districtId} /> : null}

        <div className="max-h-[70vh] overflow-y-auto">
          <GeoEntityList level="neighborhood" rows={rows} canWrite={canWrite} provinceOptions={provinceOptions} />
        </div>
      </div>
    </div>
  );
}
