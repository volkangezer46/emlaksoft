import Link from "@/components/ui/smart-link";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/format";
import { loadOwnedProperties as loadOwnerLinked } from "@/lib/owner-link/read";
import { loadOwnedProperties as loadOwnerInfoRows } from "@/lib/property-owner/server";
import { OWNER_RELATIONS } from "@/lib/property-owner/info";
import { propertyStatusLabel } from "@/lib/property-labels";

type Row = {
  id: string;
  title: string;
  meta: string | null;
  /** properties.owner_customer_id bu müşteri (malik bağı). */
  isOwnerLink: boolean;
  /** İlan sahibi bilgisi (property_owner_info) varsa yakınlık ve tamlık. */
  relation: string | null;
  complete: boolean | null;
};

/**
 * "Sahibi olduğu portföyler" — TEK kart (CRM-G13). İki kaynak portföy id'si üzerinden birleşir:
 *  - malik bağı (`properties.owner_customer_id`, @/lib/owner-link/read),
 *  - ilan sahibi bilgisi (`property_owner_info.customer_id`, @/lib/property-owner/server; yakınlık + "Bilgiler tam/eksik").
 * Aynı portföy bir kez görünür; her satır her iki bilgiyi birlikte taşır. Kaynaklardan biri okunamazsa (migration
 * bekliyor / RLS) diğeriyle devam eder; hiç kayıt yoksa HİÇBİR ŞEY çizmez (boş vaat yok).
 */
export async function OwnedPropertiesCard({ customerId, tenantId }: { customerId: string; tenantId: string | null }) {
  const supabase = await createClient();
  const [linked, info] = await Promise.all([
    loadOwnerLinked(supabase, customerId, tenantId),
    tenantId ? loadOwnerInfoRows(supabase, tenantId, customerId) : Promise.resolve([]),
  ]);

  const rows = new Map<string, Row>();
  const linkedProps = linked.enabled ? linked.properties : [];
  for (const p of linkedProps) {
    rows.set(p.id, {
      id: p.id,
      title: p.title || p.propertyCode || "Portföy",
      meta: [p.transactionType, p.listPrice !== null ? formatTry(p.listPrice) : null, p.status ? propertyStatusLabel(p.status) : null]
        .filter(Boolean)
        .join(" · ") || null,
      isOwnerLink: true,
      relation: null,
      complete: null,
    });
  }
  for (const r of info) {
    const prev = rows.get(r.propertyId);
    if (prev) {
      prev.relation = r.relation || null;
      prev.complete = r.complete;
    } else {
      rows.set(r.propertyId, {
        id: r.propertyId,
        title: r.title || r.code || "Portföy",
        meta: r.code && r.title !== r.code ? r.code : null,
        isOwnerLink: false,
        relation: r.relation || null,
        complete: r.complete,
      });
    }
  }
  if (rows.size === 0) return null;

  const list = [...rows.values()];
  // Malik bağlı kayıtların toplamı ilk 20'yi aşabilir: görünmeyen kalan sayısı dürüstçe yazılır.
  const hiddenLinked = linked.enabled ? Math.max(0, linked.total - linked.properties.length) : 0;

  return (
    <section
      aria-labelledby="sahip-portfoyler-baslik"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]"
    >
      <h2 id="sahip-portfoyler-baslik" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-brand-600">
        <Building2 className="h-3.5 w-3.5" aria-hidden /> Sahibi olduğu portföyler ({list.length + hiddenLinked})
      </h2>
      <ul className="mt-3 space-y-2">
        {list.map((r) => (
          <li key={r.id}>
            <Link
              href={`/app/portfoyler/${r.id}?sekme=sahip`}
              className="focus-ring block rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm transition hover:bg-brand-600/8 touch:min-h-11"
            >
              <span className="block truncate font-semibold text-ink-950">{r.title}</span>
              {r.meta ? <span className="block truncate text-xs text-text-muted">{r.meta}</span> : null}
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                {r.isOwnerLink ? (
                  <span className="rounded-full bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-700">Malik</span>
                ) : null}
                {r.relation ? (
                  <span className="text-text-muted">{OWNER_RELATIONS.find((o) => o.value === r.relation)?.label ?? r.relation}</span>
                ) : null}
                {r.complete === null ? null : (
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${r.complete ? "bg-mint-500/10 text-mint-700" : "bg-amber-500/10 text-amber-700"}`}>
                    {r.complete ? "Bilgiler tam" : "Bilgi eksik"}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hiddenLinked > 0 ? (
        <p className="mt-2 text-xs text-text-faint">İlk {linked.enabled ? linked.properties.length : 0} malik kaydı gösteriliyor.</p>
      ) : null}
    </section>
  );
}
