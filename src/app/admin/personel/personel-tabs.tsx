import Link from "@/components/ui/smart-link";
import { KeyRound, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/personel", id: "personel", label: "Personel", icon: Users },
  { href: "/admin/personel/roller", id: "roller", label: "Roller", icon: KeyRound },
  { href: "/admin/personel/guvenlik", id: "guvenlik", label: "Güvenlik politikası", icon: ShieldCheck },
] as const;

/**
 * Personel merkezinin sayfa içi sekmeleri (menüye satır eklenmez; nav.ts değişmez). Görünüm PageTabs ile aynı;
 * fark: sekmeler ayrı yollardır (Güvenlik politikası sunucu bileşeni, personel listesi istemci bileşeni).
 */
export function PersonelTabs({ active }: { active: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="Personel sekmeleri" className="no-print -mx-1 overflow-x-auto px-1">
      <ul className="inline-flex min-w-max items-center gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={tab.id === active ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition touch:min-h-11",
                  tab.id === active ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
