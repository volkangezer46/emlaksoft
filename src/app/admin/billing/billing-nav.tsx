import { FilterChip } from "@/components/ui/filter-chip";
import { getPlanSupport } from "@/lib/billing/plan-support";

const TABS = [
  { id: "genel", label: "Genel", href: "/admin/billing" },
  { id: "planlar", label: "Planlar", href: "/admin/billing/planlar" },
  { id: "kuponlar", label: "Kuponlar", href: "/admin/billing/kuponlar" },
  { id: "muhasebe", label: "Muhasebe", href: "/admin/muhasebe" },
  { id: "defter", label: "Fatura defteri", href: "/admin/muhasebe/defter" },
] as const;

/** Faturalama bölümü sayfa sekmeleri (ayrı sayfa). Kupon sekmesi şema yokken gizlidir. */
export async function BillingNav({ active }: { active: (typeof TABS)[number]["id"] | "fatura" }) {
  const support = await getPlanSupport();
  const tabs = TABS.filter((t) => t.id !== "kuponlar" || support.coupons);
  return (
    <nav aria-label="Faturalama bölümleri" className="flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1">
      {tabs.map((t) => (
        <FilterChip key={t.id} href={t.href} active={active === t.id}>
          {t.label}
        </FilterChip>
      ))}
    </nav>
  );
}
