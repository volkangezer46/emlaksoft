"use client";

import Link from "@/components/ui/smart-link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/admin/geo", label: "Gezgin", match: (p) => p === "/admin/geo" || /^\/admin\/geo\/[0-9a-f-]{36}/i.test(p) },
  { href: "/admin/geo/ice-aktar", label: "İçe aktar", match: (p) => p.startsWith("/admin/geo/ice-aktar") },
  { href: "/admin/geo/surumler", label: "Sürümler", match: (p) => p.startsWith("/admin/geo/surumler") },
  { href: "/admin/geo/bildirimler", label: "Bildirimler", match: (p) => p.startsWith("/admin/geo/bildirimler") },
  { href: "/admin/geo/saglik", label: "Sağlık", match: (p) => p.startsWith("/admin/geo/saglik") },
  { href: "/admin/geo/eslestir", label: "Eşleştir", match: (p) => p.startsWith("/admin/geo/eslestir") },
];

/** Coğrafya bölümü sekmeleri (popup yok; her sekme kendi sayfası). */
export function GeoTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Coğrafya bölümleri" className="flex flex-wrap gap-1 border-b border-line pb-px">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-t-[var(--radius-control)] border-b-2 px-3.5 py-2 text-sm font-semibold transition ${active ? "border-brand-600 text-brand-600" : "border-transparent text-text-muted hover:text-ink-950"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
