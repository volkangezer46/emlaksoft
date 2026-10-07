import Link from "@/components/ui/smart-link";
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
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? "page" : undefined}
          className={`focus-ring min-h-9 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition ${
            active === t.id ? "bg-ink-950 text-white" : "text-text-muted hover:bg-canvas hover:text-ink-950"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
