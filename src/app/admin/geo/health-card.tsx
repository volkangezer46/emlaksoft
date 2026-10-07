import Link from "@/components/ui/smart-link";
import { AlertTriangle, CheckCircle2, MapPin } from "lucide-react";
import { getGeoHealth } from "@/lib/geo/admin-store";
import { formatDateTimeTr } from "@/lib/format";

/**
 * "Coğrafya sağlığı" kartı — admin kontrol paneli ve /admin/geo/saglik. Her sayı tıklanabilir:
 * ilgili filtreli hedefe götürür (sıfır çıkmaz metrik).
 */
export async function GeoHealthCard() {
  const h = await getGeoHealth();
  const issues =
    (h.provinceCountOk ? 0 : 1) + (h.provincesWithoutDistrict.length ? 1 : 0) + (h.districtsWithoutNeighborhood.length ? 1 : 0);

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]" aria-label="Coğrafya sağlığı">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="h-4 w-4 text-brand-600" />
        <h2 className="font-display text-base font-bold">Coğrafya sağlığı</h2>
        <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${issues === 0 ? "bg-success-500/10 text-success-600" : "bg-amber-500/10 text-amber-700"}`}>
          {issues === 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {issues === 0 ? "Tutarlı" : `${issues} tutarsızlık`}
        </span>
      </div>

      <p className="mt-2 text-xs text-text-muted">
        {h.version
          ? <>Veri sürümü: <b>{h.version.source ?? "manuel"}{h.version.sourceVersion ? ` ${h.version.sourceVersion}` : ""}</b> · {formatDateTimeTr(h.version.createdAt)} · <Link href="/admin/geo/surumler" className="font-semibold text-brand-600 hover:underline">sürümler</Link></>
          : <>Henüz sürüm kaydı yok (yönetim migration&apos;ı uygulanmamış ya da ilk içe aktarma yapılmamış). <Link href="/admin/geo/surumler" className="font-semibold text-brand-600 hover:underline">Sürümler</Link></>}
      </p>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        {([
          ["İl", h.totals.provinces, h.active.provinces, h.inactive.provinces, "/admin/geo"],
          ["İlçe", h.totals.districts, h.active.districts, h.inactive.districts, "/admin/geo"],
          ["Mahalle", h.totals.neighborhoods, h.active.neighborhoods, h.inactive.neighborhoods, "/admin/geo"],
        ] as const).map(([label, total, active, inactive, href]) => (
          <Link key={label} href={href} className="rounded-[var(--radius-card)] border border-line p-3 transition hover:border-brand-400">
            <dt className="text-xs font-semibold text-text-muted">{label}</dt>
            <dd className="font-display text-xl font-extrabold">{total.toLocaleString("tr-TR")}</dd>
            <dd className="text-xs text-text-muted">{active.toLocaleString("tr-TR")} aktif · {inactive.toLocaleString("tr-TR")} pasif</dd>
          </Link>
        ))}
      </dl>

      <ul className="mt-3 space-y-1.5 text-sm">
        <li className={h.provinceCountOk ? "text-text-muted" : "font-semibold text-amber-700"}>
          {h.provinceCountOk ? "81 il tam." : `İl sayısı ${h.totals.provinces} (81 olmalı).`}
        </li>
        <li>
          <Link href="/admin/geo/saglik#ilcesiz-il" className={`hover:underline ${h.provincesWithoutDistrict.length ? "font-semibold text-amber-700" : "text-text-muted"}`}>
            İlçesi olmayan aktif il: {h.provincesWithoutDistrict.length}
          </Link>
        </li>
        <li>
          <Link href="/admin/geo/saglik#mahallesiz-ilce" className={`hover:underline ${h.districtsWithoutNeighborhood.length ? "font-semibold text-amber-700" : "text-text-muted"}`}>
            Mahallesi olmayan aktif ilçe: {h.districtsWithoutNeighborhood.length}
          </Link>
        </li>
        <li>
          <Link href="/admin/geo/bildirimler" className="text-text-muted hover:text-brand-600 hover:underline">
            Bekleyen ofis bildirimi: {h.pendingRequests === null ? "—" : h.pendingRequests}
          </Link>
        </li>
      </ul>
    </section>
  );
}
