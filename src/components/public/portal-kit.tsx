import Link from "next/link";
import { Link2Off, MessageCircle, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Müşteri/malik portallarının ortak parçaları.
 *
 * `musteri-portali` ve `malik-portali` aynı iskeleti (geçersiz link ekranı,
 * markalı üst bant, bölüm başlıkları, boş durumlar, Ara/WhatsApp aksiyonları,
 * alt not) birbirinden bağımsız iki kez taşıyordu; başlık seviyeleri h1'den
 * h3'e atlıyor, boş durumlar yalnız düz metin oluyordu. Ortak parçalar burada.
 *
 * Sayfa mantığı taşınmadı — bu dosyada veri okuma/yazma YOKTUR.
 */

/** Token geçersiz/süresi dolmuş ekranı — çıkmaz sokak bırakmaz. */
export function PortalInvalidLink({
  icon: Icon = Link2Off,
  title = "Bağlantı geçersiz veya süresi dolmuş",
  description,
}: {
  icon?: LucideIcon;
  title?: string;
  description: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm text-center motion-safe:animate-[rise_0.26s_cubic-bezier(0.16,1,0.3,1)_both]">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-danger-500/10"
        >
          <Icon className="h-8 w-8 text-danger-500" />
        </div>
        <h1 className="text-balance font-display text-lg font-bold text-ink-950">{title}</h1>
        <p className="mx-auto mt-2 text-pretty text-sm leading-relaxed text-text-muted">
          {description}
        </p>
        <Link
          href="/"
          className="focus-ring press mt-6 inline-flex min-h-11 items-center justify-center rounded-[12px] border border-hairline-strong bg-surface px-5 text-sm font-bold text-ink-950 transition hover:bg-canvas"
        >
          EmlakSoft ana sayfası
        </Link>
      </div>
    </main>
  );
}

/**
 * Portal bölümü — h2 seviyesinde başlık + ikon. Başlık atlaması (h1 → h3)
 * ekran okuyucularda gezinmeyi bozuyordu; tek giriş noktası ile düzeltildi.
 */
export function PortalSection({
  id,
  icon: Icon,
  title,
  iconClassName = "text-brand-600",
  children,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  iconClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4" aria-labelledby={id ? `${id}-baslik` : undefined}>
      <h2
        id={id ? `${id}-baslik` : undefined}
        className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"
      >
        <Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" /> {title}
      </h2>
      {children}
    </section>
  );
}

/** Anlamlı boş durum — ikon + ne olduğu + ne zaman dolacağı. */
export function PortalEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[16px] border border-dashed border-line bg-surface px-4 py-10 text-center">
      <span
        aria-hidden="true"
        className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-canvas text-text-faint"
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-text-muted">{title}</p>
      {hint ? (
        <p className="mx-auto mt-1 max-w-prose text-pretty text-xs leading-relaxed text-text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Mobilde ekranın altına yapışan iletişim çubuğu — portalın tek gerçek
 * aksiyonu "danışmana ulaşmak" ve uzun sayfada üstteki butonlar kaydırılıp
 * kayboluyordu. sm ve üzerinde gizli (orada üstteki butonlar zaten görünür).
 * `pb-[env(safe-area-inset-bottom)]` iPhone gesture bar'ının altında kalmayı
 * engeller. Sayfa sonuna eşleşen dolgu için `PortalStickySpacer` kullanılır.
 */
export function PortalContactBar({
  telHref,
  whatsAppHref,
  callLabel = "Ara",
}: {
  telHref?: string | null;
  whatsAppHref?: string | null;
  callLabel?: string;
}) {
  if (!telHref && !whatsAppHref) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:hidden">
      <div
        className={`mx-auto grid max-w-3xl gap-2.5 ${telHref && whatsAppHref ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {telHref ? (
          <a
            href={telHref}
            className="focus-ring press inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700"
          >
            <Phone className="h-4 w-4" aria-hidden="true" /> {callLabel}
          </a>
        ) : null}
        {whatsAppHref ? (
          <a
            href={whatsAppHref}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring press inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] border border-mint-500/40 bg-mint-500/10 px-4 text-sm font-bold text-mint-700 transition hover:bg-mint-500/20"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** Yapışkan çubuğun içeriği örtmemesi için mobilde ayrılan boşluk. */
export function PortalStickySpacer({ active }: { active: boolean }) {
  if (!active) return null;
  return <div aria-hidden="true" className="h-20 sm:hidden" />;
}

/** Portal alt notu — kimin hazırladığı + KVKK/gizlilik erişimi. */
export function PortalFooterNote({ office }: { office: string }) {
  return (
    <div className="space-y-2 pb-4 text-center text-xs leading-relaxed text-text-faint">
      <p>
        Bu sayfa {office} tarafından sizin için oluşturulmuştur.
        <br />
        EmlakSoft ile güçlendirilmiştir.
      </p>
      <p>
        <Link
          href="/kvkk-aydinlatma"
          className="focus-ring rounded-[4px] underline-offset-2 transition hover:text-text-muted hover:underline"
        >
          KVKK Aydınlatma Metni
        </Link>
        <span aria-hidden="true"> · </span>
        <Link
          href="/gizlilik"
          className="focus-ring rounded-[4px] underline-offset-2 transition hover:text-text-muted hover:underline"
        >
          Gizlilik Politikası
        </Link>
      </p>
    </div>
  );
}
