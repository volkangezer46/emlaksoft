import { Download } from "lucide-react";
import { EXPORT_ENTITIES } from "@/lib/export-entities";

/**
 * Arşivlenmiş ofisin sahibi için veri paketi: her varlık ayrı CSV (tam, sayfalı akış).
 * Yalnız sahip + arşiv + açılmış kapatma/indirme talebi varken gösterilir (rota aynı kuralı sunucuda uygular).
 */
export function ClosureDataPanel() {
  const entities = Object.values(EXPORT_ENTITIES);
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Download className="h-4 w-4 text-brand-600" /> Ofis veri paketiniz
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">
        Hesabınız kapatıldı; verileriniz silinmedi. Her başlık ayrı bir CSV dosyası olarak indirilir. Dosyalar kişisel veri
        içerir; güvenli saklayın.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((e) => (
          <li key={e.slug}>
            <a
              href={`/api/export/kapanis/${e.slug}`}
              className="focus-ring press flex min-h-[42px] items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm font-semibold text-text transition hover:border-brand-300 hover:text-brand-600"
            >
              <span className="capitalize">{e.filenameBase.replace(/-/g, " ")}</span>
              <Download className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
