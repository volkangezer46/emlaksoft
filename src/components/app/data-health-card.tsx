import Link from "@/components/ui/smart-link";
import { AlertTriangle, CheckCircle2, ChevronDown, HeartPulse } from "lucide-react";
import type { DataHealthItem } from "@/lib/duplicate-finders";

/**
 * Veri sağlığı kartı (çift kayıt sayfaları): eksik/hatalı alanların sayısı + açılır örnek kayıt listesi.
 * Sunucu bileşeni (JS yok; açılır liste yerel <details>). Her sayı tıklanınca o kümenin kayıtlarını açar, her kayıt
 * doğrudan kendi sayfasına gider ("sıfır çıkmaz metrik").
 */
export function DataHealthCard({ title, items }: { title: string; items: DataHealthItem[] }) {
  const sorunlu = items.filter((i) => i.count > 0).length;
  return (
    <section aria-labelledby="veri-sagligi-baslik" className="surface-card rounded-[var(--radius-panel)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <HeartPulse className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="veri-sagligi-baslik" className="font-display text-base font-bold text-ink-950">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {sorunlu === 0 ? "Eksik ya da hatalı alan bulunmadı." : `${sorunlu} başlıkta düzeltilmesi gereken kayıt var.`}
          </p>
        </div>
      </div>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="rounded-[var(--radius-card)] border border-line bg-canvas">
            {item.count === 0 ? (
              <div className="flex min-h-11 items-start gap-3 p-3.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-950">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">Sorun yok.</span>
                </span>
              </div>
            ) : (
              <details className="group">
                <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-[var(--radius-card)] p-3.5 [&::-webkit-details-marker]:hidden">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-600" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="numeric font-display text-lg font-extrabold text-ink-950">
                        {item.capped ? "≥ " : ""}
                        {item.count}
                      </span>
                      <span className="text-sm font-semibold text-ink-950">{item.label}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{item.desc}</span>
                  </span>
                  <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-text-faint transition group-open:rotate-180" />
                </summary>
                <ul className="space-y-1 border-t border-line p-2">
                  {item.samples.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={s.href}
                        className="focus-ring flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-sm hover:bg-surface-hover"
                      >
                        <span className="min-w-0 truncate font-medium text-ink-950">{s.label}</span>
                        {s.detail ? <span className="numeric shrink-0 truncate text-xs text-text-muted">{s.detail}</span> : null}
                      </Link>
                    </li>
                  ))}
                  {item.count > item.samples.length ? (
                    <li className="px-2.5 py-1.5 text-xs text-text-faint">
                      En yeni {item.samples.length} kayıt gösteriliyor; düzelttikçe liste yenilenir.
                    </li>
                  ) : null}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Yükleniyor iskeleti (Suspense yedeği). */
export function DataHealthCardSkeleton() {
  return (
    <div
      className="surface-card h-40 animate-pulse rounded-[var(--radius-panel)] motion-reduce:animate-none"
      role="status"
      aria-label="Veri sağlığı yükleniyor"
    />
  );
}
