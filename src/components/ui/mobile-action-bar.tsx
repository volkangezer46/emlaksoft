import Link from "@/components/ui/smart-link";
import { ArrowRight, MessageCircle, PhoneCall } from "lucide-react";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * MobileActionBar — mobil detay sayfalarında "sonraki eylem" çubuğu (SP10). Yalnız < lg: sayfanın sonunda durur ve
 * kaydırırken ekranın altına YAPIŞIR (sticky); mobil alt gezinmenin (≈4.5rem) üstünde, güvenli alan payıyla.
 * Birincil eylem (sonraki en iyi eylem) + Ara ve WhatsApp ikonları; her hedef ≥44 px. Sunucu bileşeni (istemci JS yok).
 * Masaüstünde aynı bilgi sağ sütundaki "Özet ve sonraki eylem" kartındadır; bu çubuk çizilmez.
 *
 * z-index: alt gezinme z-40, iletişim kutuları/toast'lar üstte kalsın diye çubuk z-30.
 */
export function MobileActionBar({
  primary,
  phone,
  contactName,
  className,
}: {
  /** Sonraki en iyi eylem; href yoksa yalnız başlık metni gösterilir. */
  primary: { title: string; label: string; href: string | null };
  phone?: string | null;
  contactName?: string | null;
  className?: string;
}) {
  const tel = toTelHref(phone);
  const wa = toWhatsAppLink(phone, contactName ? `Merhaba ${contactName.split(" ")[0]}, ` : undefined);
  const iconBtn =
    "focus-ring press grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-ink-950 transition hover:bg-surface-hover";
  return (
    <div
      role="region"
      aria-label="Sonraki eylem"
      className={cn(
        "mobile-action-bar sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 -mx-1 flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--elev-2)] lg:hidden",
        className,
      )}
    >
      {primary.href ? (
        <Link
          href={primary.href}
          className="focus-ring press flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-[var(--radius-control)] bg-brand-600 px-3 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <span className="min-w-0 truncate">{primary.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-white/85">
            {primary.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </Link>
      ) : (
        <p className="min-w-0 flex-1 truncate px-2 text-sm font-semibold text-text">{primary.title}</p>
      )}
      {tel ? (
        <a href={tel} className={iconBtn} aria-label={contactName ? `${contactName} kişisini ara` : "Ara"}>
          <PhoneCall className="h-[18px] w-[18px]" aria-hidden="true" />
        </a>
      ) : null}
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={iconBtn} aria-label={contactName ? `${contactName} kişisine WhatsApp mesajı` : "WhatsApp mesajı"}>
          <MessageCircle className="h-[18px] w-[18px] text-mint-600" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
