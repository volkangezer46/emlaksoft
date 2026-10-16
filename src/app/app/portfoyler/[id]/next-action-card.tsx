import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/**
 * Portföy "Sonraki en iyi eylem" kartı (PF-08) — satış teşhisinin en öncelikli engeli → ilgili sekme.
 * Tek render: mobilde künyenin hemen altında (sekmelerin ÜSTÜNDE), masaüstünde sağ sütunun başında;
 * yerleşim page.tsx'teki grid/order sınıflarıyla. Dokunma hedefi ≥44 px.
 */
export function PropertyNextActionCard({
  blocker,
  diagnosable,
  href,
  label,
  hint = null,
}: {
  blocker: { title: string; action: string } | null;
  diagnosable: boolean;
  href: string;
  label: string;
  /** Duruma göre sonraki adım açıklaması (taslak/rezerve/arşiv/kapanmış); yoksa teşhis metni. */
  hint?: string | null;
}) {
  return (
    <section
      aria-label="Sonraki en iyi eylem"
      className={`rounded-[var(--radius-panel)] border bg-surface p-4 shadow-[var(--shadow-xs)] ${blocker ? "border-mint-500/30" : "border-line"}`}
    >
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-mint-600">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> Sonraki en iyi eylem
      </p>
      {blocker ? (
        <>
          <p className="mt-2 text-sm font-semibold text-ink-950">{blocker.title}</p>
          <p className="mt-1 text-xs text-text-muted">
            <span className="font-semibold text-text">Neden: </span>
            {blocker.action}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-text-muted">
          {hint ??
            (diagnosable
              ? "Satışı engelleyen belirgin bir sorun yok; aktif takipte kalın."
              : "Portföy aktif pazarlamada değil; yayına alındığında satış teşhisi burada görünür.")}
        </p>
      )}
      <Link
        href={href}
        scroll={false}
        className={buttonClass({ variant: blocker ? "primary" : "outline", size: "sm", className: "mt-3 touch:min-h-11" })}
      >
        {label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}
