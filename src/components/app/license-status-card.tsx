import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { loadTenantLicense, tenantLicenseStatus } from "@/lib/license-server";

/**
 * Uygulama içi yetki belgesi uyarı kartı (sunucu bileşeni; kendi verisini yükler).
 * Yalnız dikkat gerektiren durumlarda görünür: eksik no, süresi dolmuş veya 60/30/7 gün içinde bitiyor.
 * Yayını ENGELLEMEZ; yeni cron/bildirim YOK (60/30/7 hatırlatması bu kart + Ayarlar rozetiyle).
 * Dayanak: Taşınmaz Ticareti Hakkında Yönetmelik m.14/2-i (AVUKAT TEYİDİ GEREKİR).
 */
export async function LicenseStatusCard({ className }: { className?: string }) {
  let status;
  try {
    status = tenantLicenseStatus(await loadTenantLicense());
  } catch {
    return null;
  }
  if (status.state === "valid" || status.state === "no_date") return null;
  return (
    <Alert
      tone={status.tone === "danger" ? "danger" : "warning"}
      title={status.label}
      className={className}
      action={
        <Link href="/app/ayarlar#marka-kimlik" className="text-xs font-semibold underline underline-offset-2">
          Firma bilgileri
        </Link>
      }
    >
      İlan ve reklamlarda yetki belgesi numarası ile işletme unvanı yer almalıdır; eksik veya süresi dolmuş belge bilgisi
      denetimde sorun çıkarabilir.
    </Alert>
  );
}
