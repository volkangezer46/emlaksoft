import type { ReactNode } from "react";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { ControlLiveRefresh } from "@/components/listing-control/live-refresh";
import { VerificationWorker } from "@/components/listing-control/verification-worker";

/**
 * İlan Kontrol bölümü kabuğu: canlı sayaç yenileme (Realtime) + tarayıcı doğrulama işçisi. Sayfa kapıları her sayfada
 * ayrıca çalışır; bu düzen de aynı kapıyı çağırır (istek başına önbellekli). İşçi yalnız `portals/edit` izni olana
 * ve gerçek bir ofis bağlamı varken yüklenir.
 */
export default async function IlanKontrolLayout({ children }: { children: ReactNode }) {
  const { tenantId, perms } = await requireModulePage("portals", "/app/ilan-kontrol");
  const canWork = Boolean(tenantId) && effectiveHasPermission(perms, "portals", "edit");
  return (
    <>
      <ControlLiveRefresh tenantId={tenantId} />
      {children}
      {canWork ? <VerificationWorker /> : null}
    </>
  );
}
