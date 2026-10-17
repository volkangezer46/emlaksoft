import { financePath } from "@/lib/finance/routes";
import { layoutHrefs, navLayoutFor } from "@/lib/nav-roles";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import type { ShortcutBarItem } from "@/components/ui/shortcut-bar";

/**
 * Ana ekran alt kısayol şeridi (F12): `g` kısayolu yalnız rolün menüsünde bulunan VE görme izni olan merkeze gösterilir
 * (çağrı merkezinde Portföyler/Komisyon, muhasebede Müşteriler yoktu ama şerit hepsini yazıyordu). Saf; test:
 * shortcut-items.test.ts.
 */
const GOTO: readonly { keys: readonly string[]; label: string; href: string; module: keyof EffectivePermissions }[] = [
  { keys: ["G", "M"], label: "Müşteriler", href: "/app/musteriler", module: "customers" },
  { keys: ["G", "P"], label: "Portföyler", href: "/app/portfoyler", module: "properties" },
  { keys: ["G", "K"], label: "Komisyon", href: financePath("komisyon"), module: "commissions" },
];

export function homeShortcutItems(role: string, perms: EffectivePermissions): ShortcutBarItem[] {
  const inNav = new Set(layoutHrefs(navLayoutFor(role)));
  const can = (m: keyof EffectivePermissions) => (perms[m] ?? []).includes("view");
  return [
    { keys: ["mod", "K"], label: "Ara ve komut" },
    ...GOTO.filter((g) => inNav.has(g.href) && can(g.module)).map(({ keys, label }) => ({ keys, label })),
    { keys: ["?"], label: "Tüm kısayollar" },
  ];
}
