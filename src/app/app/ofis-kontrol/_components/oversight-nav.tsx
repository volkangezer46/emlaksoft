import { FilterChip } from "@/components/ui/filter-chip";

export type OversightTab = "akis" | "uyarilar" | "karne" | "kurallar" | "benim";

const TABS: { id: OversightTab; label: string; href: string; officeOnly: boolean }[] = [
  { id: "akis", label: "İşlem akışı", href: "/app/ofis-kontrol", officeOnly: true },
  { id: "uyarilar", label: "Uyarılar", href: "/app/ofis-kontrol/uyarilar", officeOnly: true },
  { id: "karne", label: "Danışman karnesi", href: "/app/ofis-kontrol/karne", officeOnly: true },
  { id: "kurallar", label: "Kurallar ve eşikler", href: "/app/ofis-kontrol/kurallar", officeOnly: true },
  { id: "benim", label: "Benim akışım", href: "/app/ofis-kontrol/benim", officeOnly: false },
];

/** Ofis Kontrol alt gezinmesi (sunucu bileşeni). Danışman yalnız "Benim akışım" sekmesini görür. */
export function OversightNav({
  active,
  office,
  openAlerts,
}: {
  active: OversightTab;
  office: boolean;
  openAlerts?: number;
}) {
  const tabs = TABS.filter((t) => office || !t.officeOnly);
  return (
    <nav aria-label="Ofis kontrol bölümleri" className="-mt-2 mb-5 flex flex-wrap gap-2">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <FilterChip key={t.id} href={t.href} active={isActive} count={t.id === "uyarilar" && openAlerts ? openAlerts : null}>
            {t.label}
          </FilterChip>
        );
      })}
    </nav>
  );
}
