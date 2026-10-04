import Link from "next/link";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadOwnedProperties } from "@/lib/property-owner/server";
import { OWNER_RELATIONS } from "@/lib/property-owner/info";

/**
 * Müşteri sayfası: bu müşterinin İLAN SAHİBİ olduğu ilanlar ve her birinin bilgi tamamlama durumu.
 * RLS gereği ofis yönetimi tüm kayıtları, diğer danışmanlar yalnız kendi ilanlarına ait satırları görür.
 * Kayıt yoksa (veya veritabanı güncellemesi bekliyorsa) hiçbir şey çizilmez.
 */
export async function CustomerOwnedListings({ tenantId, customerId }: { tenantId: string; customerId: string }) {
  const rows = await loadOwnedProperties(await createClient(), tenantId, customerId);
  if (!rows.length) return null;
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Building2 className="h-4 w-4 text-brand-600" /> İlan sahibi olduğu ilanlar
        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-text-muted">{rows.length}</span>
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.propertyId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <Link href={`/app/portfoyler/${r.propertyId}?sekme=sahip`} className="font-semibold text-ink-950 hover:text-brand-600">
              {r.title}
            </Link>
            <span className="flex items-center gap-2 text-xs">
              {r.relation ? <span className="text-text-muted">{OWNER_RELATIONS.find((o) => o.value === r.relation)?.label ?? r.relation}</span> : null}
              <span className={`rounded-full px-2 py-0.5 font-semibold ${r.complete ? "bg-mint-500/10 text-mint-700" : "bg-amber-500/10 text-amber-700"}`}>
                {r.complete ? "Bilgiler tam" : "Bilgi eksik"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
