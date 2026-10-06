import Link from "next/link";
import { CONTROL_BASE } from "./helpers";

const ITEMS = [
  { id: "genel", href: CONTROL_BASE, label: "Genel görünüm" },
  { id: "anomaliler", href: `${CONTROL_BASE}/anomaliler`, label: "Uyarı kuyruğu" },
  { id: "liste", href: `${CONTROL_BASE}/liste?kpi=active`, label: "Portföy listesi" },
  { id: "rapor", href: `${CONTROL_BASE}/rapor`, label: "Günlük / haftalık rapor" },
] as const;

export type ControlTab = (typeof ITEMS)[number]["id"];

/** İlan Kontrol alt gezinti (sayfa içi sekme: yollar sabit; etkin sekme aria-current). */
export function ControlSubNav({ active }: { active: ControlTab }) {
  return (
    <nav aria-label="İlan kontrol bölümleri" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {ITEMS.map((i) => {
        const on = i.id === active;
        return (
          <Link
            key={i.id}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={`focus-ring -mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition ${on ? "border-brand-600 text-text" : "border-transparent text-text-muted hover:text-text"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
