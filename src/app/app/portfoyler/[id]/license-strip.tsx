import Link from "@/components/ui/smart-link";
import { TriangleAlert } from "lucide-react";
import { settingsTabHref } from "@/app/app/ayarlar/_sekmeler/tabs";
import { loadTenantLicense, tenantLicenseStatus } from "@/lib/license-server";

/**
 * Portföy detayındaki yetki belgesi uyarısı (sadeleştirme C20): ofis düzeyindeki eksik her ilanda 5 satırlık kırmızı
 * kart olarak ilk ekranın yarısını kaplıyordu. Burada TEK satırlık sarı şerit: durum + "Tamamla" (Firma bilgileri).
 * Yasal açıklama Ayarlar'daki kartta durur. Yalnız dikkat gerektiren durumda çizilir (geçerli/tarihsiz: hiçbir şey).
 */
export async function LicenseStrip() {
  let status;
  try {
    status = tenantLicenseStatus(await loadTenantLicense());
  } catch {
    return null;
  }
  if (status.state === "valid" || status.state === "no_date") return null;
  return (
    <p
      role="status"
      data-license-strip=""
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/12 pl-3 text-sm font-semibold text-amber-800"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={status.label}>{status.label}</span>
      <Link
        href={settingsTabHref("kimlik")}
        className="focus-ring inline-flex min-h-11 shrink-0 items-center px-3 font-bold text-amber-900 underline underline-offset-2"
      >
        Tamamla
      </Link>
    </p>
  );
}
