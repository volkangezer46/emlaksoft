import { FilterChip } from "@/components/ui/filter-chip";

/** Karne görünümü: Sıralama (aylık karne) | Kıyas (danışman karşılaştırma tablosu). URL: ?gorunum=kiyas */
export function ViewSwitch({ active }: { active: "siralama" | "kiyas" }) {
  return (
    <nav aria-label="Karne görünümü" className="flex flex-wrap items-center gap-2 text-xs">
      <FilterChip href="/app/danisman-kpi" active={active === "siralama"}>Sıralama</FilterChip>
      <FilterChip href="/app/danisman-kpi?gorunum=kiyas" active={active === "kiyas"}>Kıyas</FilterChip>
    </nav>
  );
}
