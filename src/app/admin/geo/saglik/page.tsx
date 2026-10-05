import Link from "next/link";
import { requirePlatformModule } from "@/lib/platform";
import { getGeoHealth } from "@/lib/geo/admin-store";
import { GeoHealthCard } from "../health-card";

export default async function AdminGeoHealthPage() {
  await requirePlatformModule("geo");
  const h = await getGeoHealth();
  return (
    <div className="space-y-6">
      <GeoHealthCard />

      <section id="ilcesiz-il" className="space-y-2">
        <h2 className="font-display text-lg font-bold">İlçesi olmayan aktif iller ({h.provincesWithoutDistrict.length})</h2>
        {h.provincesWithoutDistrict.length === 0 ? (
          <p className="text-sm text-text-muted">Tutarsızlık yok.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {h.provincesWithoutDistrict.map((p) => (
              <li key={p.id}><Link href={`/admin/geo/${p.id}`} className="rounded-full border border-line px-3 py-1 text-sm font-semibold hover:border-brand-400 hover:text-brand-600">{p.name}</Link></li>
            ))}
          </ul>
        )}
      </section>

      <section id="mahallesiz-ilce" className="space-y-2">
        <h2 className="font-display text-lg font-bold">Mahallesi olmayan aktif ilçeler ({h.districtsWithoutNeighborhood.length})</h2>
        {h.districtsWithoutNeighborhood.length === 0 ? (
          <p className="text-sm text-text-muted">Tutarsızlık yok.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {h.districtsWithoutNeighborhood.slice(0, 300).map((d) => (
              <li key={d.id}><Link href={`/admin/geo/${d.provinceId}/${d.id}`} className="rounded-full border border-line px-3 py-1 text-sm font-semibold hover:border-brand-400 hover:text-brand-600">{d.name}</Link></li>
            ))}
            {h.districtsWithoutNeighborhood.length > 300 ? <li className="px-2 py-1 text-xs text-text-muted">+{h.districtsWithoutNeighborhood.length - 300} daha</li> : null}
          </ul>
        )}
      </section>
    </div>
  );
}
