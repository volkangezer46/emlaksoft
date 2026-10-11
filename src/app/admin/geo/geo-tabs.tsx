"use client";

import { usePathname } from "next/navigation";
import { SegmentTabs } from "@/components/ui/segment-tabs";

const TABS: Array<{ id: string; href: string; label: string; match: (p: string) => boolean }> = [
  { id: "gezgin", href: "/admin/geo", label: "Gezgin", match: (p) => p === "/admin/geo" || /^\/admin\/geo\/[0-9a-f-]{36}/i.test(p) },
  { id: "ice-aktar", href: "/admin/geo/ice-aktar", label: "İçe aktar", match: (p) => p.startsWith("/admin/geo/ice-aktar") },
  { id: "surumler", href: "/admin/geo/surumler", label: "Sürümler", match: (p) => p.startsWith("/admin/geo/surumler") },
  { id: "bildirimler", href: "/admin/geo/bildirimler", label: "Bildirimler", match: (p) => p.startsWith("/admin/geo/bildirimler") },
  { id: "saglik", href: "/admin/geo/saglik", label: "Sağlık", match: (p) => p.startsWith("/admin/geo/saglik") },
  { id: "eslestir", href: "/admin/geo/eslestir", label: "Eşleştir", match: (p) => p.startsWith("/admin/geo/eslestir") },
];

/** Coğrafya bölümü sekmeleri: kanonik SegmentTabs (popup yok; her sekme kendi sayfası). */
export function GeoTabs() {
  const pathname = usePathname() ?? "";
  const active = TABS.find((t) => t.match(pathname))?.id ?? "gezgin";
  return (
    <SegmentTabs
      items={TABS.map(({ id, href, label }) => ({ id, href, label }))}
      active={active}
      label="Coğrafya bölümleri"
    />
  );
}
