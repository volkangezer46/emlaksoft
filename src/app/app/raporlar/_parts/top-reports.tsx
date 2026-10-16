import Link from "@/components/ui/smart-link";
import { ArrowUpRight, FileSpreadsheet } from "lucide-react";
import { visibleTenantReports, type TenantViewer } from "@/lib/report-center/registry";
import { reportCenterHref } from "@/lib/report-center/links";

/**
 * C26: "En çok kullanılan 5 rapor" — ofis sahibinin her ay indirdiği raporlar tek dokunuşla Rapor merkezinde açılır
 * (indirme yine yalnız Rapor merkezinden; bu yalnız bağlantı). Sıra sabit ürün kararıdır; kullanıcının göremediği
 * rapor (izin / kazanç gizliliği) listeye girmez, yerine görünür raporlardan biri gelir.
 */
export const TOP_REPORTS: readonly { id: string; label: string }[] = [
  { id: "komisyonlar", label: "Aylık komisyon" },
  { id: "danisman-performansi", label: "Danışman performansı" },
  { id: "gelir-gider-dokumu", label: "Gelir ve gider" },
  { id: "portfoyler", label: "Portföy listesi" },
  { id: "musteriler", label: "Müşteri listesi" },
];

/** Saf: görünür rapor kimliklerinden en çok `limit` öğe (önce sabit sıra, eksik kalırsa katalog sırası). */
export function pickTopReports(visible: readonly { id: string; title: string }[], limit = 5): { id: string; label: string }[] {
  const ids = new Set(visible.map((r) => r.id));
  const out = TOP_REPORTS.filter((r) => ids.has(r.id)).map((r) => ({ ...r }));
  for (const r of visible) {
    if (out.length >= limit) break;
    if (!out.some((x) => x.id === r.id)) out.push({ id: r.id, label: r.title });
  }
  return out.slice(0, limit);
}

export function TopReports({ viewer }: { viewer: TenantViewer }) {
  const items = pickTopReports(visibleTenantReports(viewer));
  if (items.length === 0) return null;
  return (
    <section data-testid="en-cok-kullanilan-raporlar" aria-labelledby="top-reports-title" className="surface-card rounded-[var(--radius-panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="top-reports-title" className="flex items-center gap-2 font-display text-base font-bold text-text">
          <FileSpreadsheet className="h-4 w-4 text-accent-text" aria-hidden="true" /> En çok kullanılan {items.length} rapor
        </h2>
        <Link href="/app/raporlar?sekme=merkez" className="focus-ring inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-text hover:underline sm:min-h-0">
          Tüm raporlar <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={reportCenterHref("tenant", r.id)}
              className="focus-ring press flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm font-semibold text-text transition hover:border-brand-300 hover:text-accent-text"
            >
              {r.label}
              <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
