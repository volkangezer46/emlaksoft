/* eslint-disable @next/next/no-img-element -- ofis logosu Storage public URL'sidir; 40 px sabit kutuda optimize edilmeyen <img> (next/image istemci kodu eklemez) */
import Link from "@/components/ui/smart-link";
import { ChevronRight } from "lucide-react";
import { OfficeGlyph } from "@/components/ui/art/office-glyph";

/**
 * Yan menü OFİS KARTI (v4 referansı): ofis logosu (yoksa çizimli bina rozeti) + ofis adı + "Ofis bilgileri" + paket rozeti;
 * yönetim rollerinde aynı satırda OFİS SKORU (kural tabanlı, 0–100; eskiden üst çubuktaki hap) görünür.
 * SUNUCU bileşeni (istemci JS'i yok): layout önce yalnız adla çizer, logo/şehir aynı sınırda akar (aynı ölçü, CLS yok).
 * Tek ofis vardır (çoklu ofis geçişi yok): kart ayar yetkisi olana Ofis ayarlarını açar; diğerlerinde bağlantısızdır
 * (vitrin Araçlar bölümündeki "Vitrini görüntüle" kısayolundadır; muhasebe rolü karttan vitrine gitmez). Daraltılmış menüde
 * yalnız küçük resim görünür.
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
  score = null,
}: {
  name: string;
  city?: string | null;
  logoUrl?: string | null;
  plan: string;
  href: string | null;
  /** Ofis skoru (yalnız yönetim rollerinde; hesaplanamazsa null → satırda yalnız şehir). */
  score?: { score: number; label: string } | null;
}) {
  const body = (
    <>
      <span className="sb-office-thumb relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)]">
        {logoUrl ? <img src={logoUrl} alt="" width={40} height={40} decoding="async" className="h-full w-full bg-white object-contain p-0.5" /> : <OfficeGlyph />}
      </span>
      <span className="sb-label min-w-0 flex-1">
        {/* Satır 1: ofis adı (uzunsa iki satır, daha küçük punto) + paket rozeti. */}
        <span className="flex min-w-0 items-start gap-1.5">
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-bold leading-4 text-white" title={name}>
            {name}
          </span>
          <span className="sb-plan-badge shrink-0" title={`${plan} paketi`}>
            {planBadgeText(plan)}
          </span>
        </span>
        {/* Satır 2 (v4): "Ofis bilgileri • Skor 78" + ok; şehir ipucunda (title) ve ekran okuyucu etiketinde. */}
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4 text-white/65">
          <span className="truncate" title={city ?? undefined}>
            Ofis bilgileri
          </span>
          {score ? (
            <span
              className="num inline-flex shrink-0 items-center gap-1.5 font-semibold text-mint-300"
              title="Kural tabanlı ofis skoru (yapay zekâ değil): açık talepler, canlı portal ilanları, son 7 günün randevu ve aramaları ile son 30 günün kapanışları puan ekler; gecikmiş portal teyitleri puan düşürür."
            >
              <span className="h-1 w-1 rounded-full bg-white/50" aria-hidden />
              Skor {score.score}
            </span>
          ) : null}
          {href ? <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/55" aria-hidden /> : null}
        </span>
      </span>
    </>
  );
  // Kompakt (48 px; uzun ad iki satıra inerse 60 px): 1366×768 menü sığma hesabında kart 48 px + 8 px boşluktur.
  const cls = "sb-office focus-ring mx-3 mb-2 flex min-h-12 items-center gap-2.5 rounded-[var(--radius-card)] px-2.5 py-1.5 text-left";
  const scoreText = score ? `, ofis skoru ${score.score} (${score.label})` : "";
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link href={href} className={cls} aria-label={`${name}${city ? `, ${city}` : ""}${scoreText}: ofis ayarlarını aç`}>
      {body}
    </Link>
  );
}
