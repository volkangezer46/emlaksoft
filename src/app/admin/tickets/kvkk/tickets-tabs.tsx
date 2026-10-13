import { FilterChip } from "@/components/ui/filter-chip";

const TABS = [
  { id: "talepler", label: "Talepler", href: "/admin/tickets" },
  { id: "makrolar", label: "Hazır yanıtlar", href: "/admin/tickets/makrolar" },
  { id: "kvkk", label: "KVKK talepleri", href: "/admin/tickets/kvkk" },
  { id: "raporlar", label: "Raporlar", href: "/admin/tickets/raporlar" },
  { id: "ayarlar", label: "Ayarlar", href: "/admin/tickets/ayarlar" },
] as const;

/** Destek bölümü sayfa içi sekmeleri (yeni menü satırı DEĞİL; nav.ts değişmez). */
export function TicketsTabs({ active }: { active: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="Destek bölümleri" className="flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1">
      {TABS.map((t) => (
        <FilterChip key={t.id} href={t.href} active={active === t.id}>
          {t.label}
        </FilterChip>
      ))}
    </nav>
  );
}
