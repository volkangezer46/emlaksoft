import Link from "@/components/ui/smart-link";

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
          <Link
            key={t.id}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={`focus-ring press rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              isActive
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            {t.label}
            {t.id === "uyarilar" && openAlerts ? (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 tabular-nums ${isActive ? "bg-white/20" : "bg-amber-400/20 text-amber-700"}`}>
                {openAlerts}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
