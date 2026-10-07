import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { getPathLabel, usageBreakdown, usageLabel, usageRows } from "@/lib/geo/admin-store";
import { GEO_LEVEL_LABEL, type GeoLevel } from "@/lib/geo/types";
import { formatDateTimeTr } from "@/lib/format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminGeoUsagePage({ searchParams }: { searchParams: Promise<{ level?: string; id?: string; tablo?: string }> }) {
  await requirePlatformModule("geo");
  const { level, id, tablo } = await searchParams;
  if (!id || !UUID.test(id) || !["province", "district", "neighborhood"].includes(level ?? "")) notFound();
  const lv = level as GeoLevel;
  const [path, usage] = await Promise.all([getPathLabel(lv, id), usageBreakdown(lv, id)]);
  if (!path) notFound();
  const table = tablo && /^[a-z_]+$/.test(tablo) ? tablo : null;
  const rows = table ? await usageRows(lv, id, table) : null;
  const self = `/admin/geo/kullanim?level=${lv}&id=${id}`;

  return (
    <div className="space-y-5">
      <Link href="/admin/geo" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600"><ArrowLeft className="h-3.5 w-3.5" /> Coğrafya</Link>
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{GEO_LEVEL_LABEL[lv]} kullanımı</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">{path}</h1>
      </header>

      {usage === null ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800">Kullanım sayımı bu ortamda henüz etkin değil (geo yönetim migration&apos;ı uygulanmamış).</p>
      ) : usage.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-10 text-center text-sm text-text-muted">Hiçbir kayıt bu bölgeyi kullanmıyor; güvenle pasife alınabilir.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {usage.map((u) => (
            <li key={`${u.table}.${u.column}`}>
              <Link href={`${self}&tablo=${u.table}`} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition hover:border-brand-400 ${table === u.table ? "border-brand-400 text-brand-600" : "border-line"}`}>
                <b>{u.n.toLocaleString("tr-TR")}</b> {usageLabel(u.table)}
                <span className="text-xs font-normal text-text-muted">({u.column})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {table ? (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">{usageLabel(table)} · ilk 50 kayıt</h2>
          {rows === null || rows.length === 0 ? (
            <p className="text-sm text-text-muted">Liste alınamadı ya da kayıt yok.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                  <span className="font-semibold">{r.label}</span>
                  {r.tenant_id ? <Link href={`/admin/tenants/${r.tenant_id}`} className="text-xs font-semibold text-brand-600 hover:underline">Ofisi aç</Link> : null}
                  {r.created_at ? <span className="ml-auto text-xs text-text-muted">{formatDateTimeTr(r.created_at)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
