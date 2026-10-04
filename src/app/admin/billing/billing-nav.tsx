import Link from "next/link";

const TABS = [
  { id: "genel", label: "Genel", href: "/admin/billing" },
  { id: "planlar", label: "Planlar", href: "/admin/billing/planlar" },
  { id: "kuponlar", label: "Kuponlar", href: "/admin/billing/kuponlar" },
] as const;

/** Faturalama bölümü sayfa sekmeleri (ayrı sayfa, sekmeli gezinme). */
export function BillingNav({ active }: { active: (typeof TABS)[number]["id"] | "fatura" }) {
  return (
    <nav aria-label="Faturalama bölümleri" className="flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1">
      {TABS.map((t) => (
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
