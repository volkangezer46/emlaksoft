import { MessageCircle } from "lucide-react";
import { buildWhatsAppLink, buildWhatsAppShareLink } from "@/lib/whatsapp-link";

/**
 * "WhatsApp'tan yaz" düğmesi — wa.me deep-link'i yeni sekmede açar.
 * Telefon yoksa/geçersizse devre dışıdır ve nedenini söyler.
 */
export function WhatsAppLink({
  phone,
  message,
  label = "WhatsApp'tan yaz",
  variant = "dark",
  share = false,
}: {
  phone?: string | null;
  message?: string | null;
  label?: string;
  /** dark: koyu hero üstünde; light: açık zemin. */
  variant?: "dark" | "light";
  /** true: alıcı seçilmeden paylaşım (telefon gerekmez, mesaj gerekir). */
  share?: boolean;
}) {
  const href = share ? buildWhatsAppShareLink(message) : buildWhatsAppLink(phone, message);
  const tone =
    variant === "dark"
      ? "border-white/15 bg-white/5 text-white hover:bg-white/10"
      : "border-line bg-surface text-text hover:bg-surface-2";
  const base = `inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 py-2 text-sm font-semibold transition ${tone}`;

  if (!href) {
    return (
      <span
        className={`${base} cursor-not-allowed opacity-50`}
        aria-disabled="true"
        title={share ? "Paylaşılacak mesaj üretilemedi" : "Geçerli bir cep telefonu kayıtlı değil"}
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" /> {label}
        <span className="text-xs font-normal">({share ? "mesaj yok" : "geçerli telefon yok"})</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={base}
      aria-label={`${label} (yeni sekmede açılır)`}
    >
      <MessageCircle className="h-4 w-4" aria-hidden="true" /> {label}
    </a>
  );
}
