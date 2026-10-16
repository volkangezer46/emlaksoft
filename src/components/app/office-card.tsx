/* eslint-disable @next/next/no-img-element -- ofis logosu Storage public URL'sidir; 40 px sabit kutuda optimize edilmeyen <img> (next/image istemci kodu eklemez) */
import Link from "@/components/ui/smart-link";
import { ChevronRight } from "lucide-react";
import { OfficeGlyph } from "@/components/ui/art/office-glyph";

/**
 * Yan menü OFİS KARTI (kurumsal referans): ofis logosu (yoksa çizimli bina rozeti) + ofis adı + şehir + paket rozeti.
 * SUNUCU bileşeni (istemci JS'i yok): layout önce yalnız adla çizer, logo/şehir aynı sınırda akar (aynı ölçü, CLS yok).
 * Tek ofis vardır (çoklu ofis geçişi yok): kart ayar yetkisi olana Ofis ayarlarını, diğerlerine vitrini açar; ikisi de
 * yoksa bağlantısız kalır. Daraltılmış menüde yalnız küçük resim görünür.
 */
export function planBadgeText(plan: string): string {
  const word = plan.trim().split(/\s+/)[0] ?? "";
  const up = word.toLocaleUpperCase("tr-TR");
  return up.length > 8 ? up.slice(0, 3) : up;
}

export function OfficeCard({
  name,
  city = null,
  logoUrl = null,
  plan,
  href,
}: {
  name: string;
  city?: string | null;
  logoUrl?: string | null;
  plan: string;
  href: string | null;
}) {
  const body = (
    <>
      <span className="sb-office-thumb relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)]">
        {logoUrl ? <img src={logoUrl} alt="" width={40} height={40} decoding="async" className="h-full w-full bg-white object-contain p-0.5" /> : <OfficeGlyph />}
      </span>
      <span className="sb-label min-w-0 flex-1">
        {/* Uzun ofis adı iki satıra iner (daha küçük punto; "Gezertaşar Em…" kesilmesi yok), kart yüksekliği sabit kalır. */}
        <span className="line-clamp-2 break-words text-xs font-semibold leading-4 text-white" title={name}>
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-white/65">
          <span className="truncate">{city ?? "Ofis bilgileri"}</span>
        </span>
      </span>
      <span className="sb-label flex shrink-0 flex-col items-end gap-1">
        <span className="sb-plan-badge" title={`${plan} paketi`}>
          {planBadgeText(plan)}
        </span>
        {href ? <ChevronRight className="h-3.5 w-3.5 text-white/55" aria-hidden /> : null}
      </span>
    </>
  );
  const cls = "sb-office focus-ring mx-3 mb-2 flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] px-2.5 py-2 text-left";
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link href={href} className={cls} aria-label={`${name}${city ? `, ${city}` : ""}: ${href === "/app/ayarlar" ? "ofis ayarlarını aç" : "ofis vitrinini aç"}`}>
      {body}
    </Link>
  );
}
