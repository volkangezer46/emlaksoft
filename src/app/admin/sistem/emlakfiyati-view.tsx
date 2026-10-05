import { Landmark } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { relativeTimeTR } from "@/lib/admin-format";
import { DAY_MS, now } from "@/lib/clock";
import { getEmlakFiyatiAdminStatus } from "@/lib/integrations/emlakfiyati/admin-status";
import { requirePlatformModule } from "@/lib/platform";
import { EmlakFiyatiPanel } from "./emlakfiyati-panel";

/** Admin > Sistem > EmlakFiyati sekmesi: anahtar yönetimi (süper admin yazar, ops salt okur). Anahtar asla geri gösterilmez. */
export async function EmlakFiyatiView() {
  const staff = await requirePlatformModule("sistem");
  const status = await getEmlakFiyatiAdminStatus();
  const previousDaysLeft = status.previous.validUntil
    ? Math.max(1, Math.ceil((new Date(status.previous.validUntil).getTime() - now()) / DAY_MS))
    : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Entegrasyon"
        icon={Landmark}
        title="EmlakFiyati API anahtarı"
        description="Piyasa endeksi çağrılarının tek anahtarı. Anahtar yalnız sunucuda, şifreli saklanır; tarayıcıya ve kayıtlara hiçbir zaman yazılmaz."
      />
      <EmlakFiyatiPanel
        canEdit={staff.role === "super_admin"}
        secretsEnabled={status.secretsEnabled}
        secretsKeySource={status.secretsKeySource}
        configured={status.configured}
        source={status.source}
        masked={status.masked}
        decryptFailed={status.decryptFailed}
        changedAtLabel={status.changedAt ? relativeTimeTR(status.changedAt) : null}
        lastOkLabel={status.lastOkAt ? relativeTimeTR(status.lastOkAt) : null}
        lastErrorClass={status.lastErrorClass}
        lastErrorLabel={status.lastErrorAt ? relativeTimeTR(status.lastErrorAt) : null}
        authAlarm={status.authAlarm}
        previousPresent={status.previous.present}
        previousDaysLeft={previousDaysLeft}
        previousUsedLabel={status.previousUsedAt ? relativeTimeTR(status.previousUsedAt) : null}
        ortakFlagOn={status.ortakFlagOn}
        ortakEndpointsVerified={status.ortakEndpointsVerified}
        ortakProbeOkLabel={status.ortakProbeOkAt ? relativeTimeTR(status.ortakProbeOkAt) : null}
        ortakProbeInfo={status.ortakProbeInfo}
      />
    </div>
  );
}
