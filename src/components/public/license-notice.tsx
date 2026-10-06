import { formatPhoneDisplay } from "@/lib/phone";

/**
 * Public ilan/paylaşım/PDF yüzeylerinde işletme unvanı + yetki belgesi no + iletişim bilgisi (okunaklı, ayrı blok).
 * Dayanak: Taşınmaz Ticareti Hakkında Yönetmelik m.14/2-i (docs/MEVZUAT_SABITLERI.md).
 * Yetki belgesi no yoksa public yüzeyde "eksik" yazılmaz (ofise uygulama içinde uyarı gösterilir); unvan/iletişim yine görünür.
 * Sunucu bileşeni (hook yok) — yazdırma çıktısında da görünür.
 */
export function LicenseNotice({
  officeName,
  licenseNo,
  phone,
  addressLine,
  className = "",
}: {
  officeName: string | null | undefined;
  licenseNo: string | null | undefined;
  phone?: string | null;
  addressLine?: string | null;
  className?: string;
}) {
  const name = officeName?.trim();
  const no = licenseNo?.trim();
  const tel = phone?.trim() ? formatPhoneDisplay(phone) : "";
  const addr = addressLine?.trim();
  if (!name && !no && !tel && !addr) return null;
  return (
    <section
      aria-label="İşletme ve yetki belgesi bilgileri"
      data-license-notice
      className={`rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted ${className}`}
    >
      {name ? <p className="text-sm font-semibold text-ink-950">{name}</p> : null}
      {no ? (
        <p>
          <span className="font-semibold text-ink-950">Yetki Belgesi No:</span> {no}
        </p>
      ) : null}
      {tel ? (
        <p>
          <span className="font-semibold text-ink-950">Telefon:</span> {tel}
        </p>
      ) : null}
      {addr ? <p>{addr}</p> : null}
    </section>
  );
}
