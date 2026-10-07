/**
 * Eşleşen portföyü müşteriye gönderme mesajı (SAF). WhatsApp ve SMS aynı metni kullanır; bağlantı token'lı paylaşım sayfasıdır
 * (/paylas/<token>, 30 gün). Fiyat yalnız liste fiyatı; kişisel veri (müşteri telefonu vb.) metne girmez, yalnız ilk ad.
 */
import { formatTry } from "@/lib/format";

export type MatchShareInput = {
  customerName: string | null;
  propertyTitle: string | null;
  propertyCode: string | null;
  listPrice: number | null;
  url: string;
  advisorName: string | null;
  officeName: string | null;
};

export function buildMatchShareMessage(i: MatchShareInput): string {
  const first = (i.customerName ?? "").trim().split(/\s+/)[0];
  const title = (i.propertyTitle ?? "").trim() || (i.propertyCode ?? "").trim() || "bir portföy";
  const price = i.listPrice != null && i.listPrice > 0 ? ` (${formatTry(i.listPrice)})` : "";
  const sign = [i.advisorName?.trim(), i.officeName?.trim()].filter(Boolean).join(" · ");
  return [
    `Merhaba${first ? ` ${first}` : ""},`,
    `aradığınız kriterlere uyan "${title}"${price} ilanını sizin için seçtim. Fotoğraflar ve ayrıntılar:`,
    i.url,
    "Görmek isterseniz uygun olduğunuz bir zamanı yazmanız yeterli.",
    ...(sign ? [sign] : []),
  ].join("\n");
}

/** `sms:` bağlantısı (iOS/Android ortak: `?&body=`). Numara yoksa null. */
export function toSmsHref(phone: string | null | undefined, body: string): string | null {
  const p = String(phone ?? "").replace(/[^\d+]/g, "");
  if (p.replace(/\D/g, "").length < 7) return null;
  return `sms:${p}?&body=${encodeURIComponent(body)}`;
}
