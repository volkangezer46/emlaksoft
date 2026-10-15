import { MessageCircle, MessageSquareText, Phone } from "lucide-react";
import type { PublicContact } from "@/lib/public-contact";

/**
 * Herkese açık yüzeylerin TEK iletişim düğmesi çifti (SK8 B148): "Ara" (tel:) + "WhatsApp" (wa.me). Veri
 * `resolvePublicContact`'tan gelir (danışman → ofis telefonu; sahip kişisel telefonu yok).
 *
 * İletişim yoksa sahte düğme YOK: `fallbackHref` (ofisin talep formu) verilmişse tek "Ofise mesaj bırakın" bağlantısı,
 * o da yoksa hiçbir şey basılmaz. Sunucu ve istemci bileşenlerinde kullanılabilir (durum/efekt yok).
 * `tone="dark"`: koyu bant üstünde (beyaz "Ara"), `tone="light"`: açık kart üstünde (marka mavisi "Ara").
 */
export function PublicContactActions({
  contact,
  tone,
  fallbackHref = null,
  fallbackLabel = "Ofise mesaj bırakın",
  callLabel,
  className = "",
}: {
  contact: PublicContact | null;
  tone: "dark" | "light";
  fallbackHref?: string | null;
  fallbackLabel?: string;
  /** Varsayılan `contact.callLabel` ("Danışmanı ara" / "Ofisi ara"). */
  callLabel?: string;
  className?: string;
}) {
  const dark = tone === "dark";
  const base =
    "focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-card)] px-4 py-2.5 text-sm font-bold transition";
  if (!contact) {
    if (!fallbackHref) return null;
    return (
      <div className={className}>
        <a
          href={fallbackHref}
          data-public-contact="message"
          className={`${base} w-full ${
            dark
              ? "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
              : "border border-line bg-surface text-ink-950 hover:bg-canvas"
          }`}
        >
          <MessageSquareText className="h-4 w-4" aria-hidden="true" /> {fallbackLabel}
        </a>
      </div>
    );
  }
  return (
    <div className={`grid gap-2.5 ${contact.waHref ? "grid-cols-2" : "grid-cols-1"} ${className}`}>
      <a
        href={contact.telHref}
        data-public-contact="tel"
        aria-label={`${callLabel ?? contact.callLabel}: ${contact.display}`}
        className={`${base} ${
          dark ? "btn-shine bg-white text-ink-950 hover:bg-white/90" : "bg-brand-600 text-white hover:bg-brand-700"
        }`}
      >
        <Phone className="h-4 w-4" aria-hidden="true" /> {callLabel ?? contact.callLabel}
      </a>
      {contact.waHref ? (
        <a
          href={contact.waHref}
          target="_blank"
          rel="noopener noreferrer"
          data-public-contact="whatsapp"
          className={`${base} ${
            dark
              ? "border border-mint-400/30 bg-mint-500/10 text-mint-300 hover:bg-mint-500/20"
              : "border border-mint-500/40 bg-mint-500/10 text-mint-700 hover:bg-mint-500/20"
          }`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
        </a>
      ) : null}
    </div>
  );
}
