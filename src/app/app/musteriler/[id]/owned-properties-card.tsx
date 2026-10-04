import Link from "next/link";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/format";
import { loadOwnedProperties } from "@/lib/owner-link/read";

/**
 * "Malik olduğu taşınmazlar" — salt okunur. Kolon yoksa (migration bekliyor) ya da müşterinin
 * bağlı taşınmazı yoksa HİÇBİR ŞEY çizmez (boş vaat yok). Bağlama işlemi ilan sahibi sekmesindedir.
 */
export async function OwnedPropertiesCard({ customerId, tenantId }: { customerId: string; tenantId: string | null }) {
  const supabase = await createClient();
  const res = await loadOwnedProperties(supabase, customerId, tenantId);
  if (!res.enabled || res.properties.length === 0) return null;
  return (
    <section
      aria-label="Malik olduğu taşınmazlar"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]"
    >
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-brand-600">
        <Building2 className="h-3.5 w-3.5" /> Malik olduğu taşınmazlar ({res.total})
      </p>
      <ul className="mt-3 space-y-2">
        {res.properties.map((p) => (
          <li key={p.id}>
            <Link
              href={`/app/portfoyler/${p.id}`}
              className="focus-ring block rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm transition hover:bg-brand-600/8"
            >
              <span className="block truncate font-semibold text-ink-950">{p.title || p.propertyCode || "Portföy"}</span>
              <span className="block text-xs text-text-muted">
                {[p.transactionType, p.listPrice !== null ? formatTry(p.listPrice) : null].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {res.total > res.properties.length ? (
        <p className="mt-2 text-xs text-text-faint">İlk {res.properties.length} taşınmaz gösteriliyor.</p>
      ) : null}
    </section>
  );
}
