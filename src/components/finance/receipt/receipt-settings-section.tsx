import { createClient } from "@/lib/supabase/server";
import { readReceiptSettings } from "@/lib/finance/receipt/engine/service";
import { ReceiptSettingsCard } from "./receipt-settings-lazy";

/** Sunucu bileşeni: fiş okuma ayarlarını (sütun yoksa kapalı) okuyup ayar kartını çizer. */
export async function ReceiptSettingsSection({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const s = await readReceiptSettings(supabase, tenantId);
  return <ReceiptSettingsCard enabled={s.enabled} aiEnabled={s.aiEnabled} aiConfigured={s.aiConfigured} canEdit={canEdit} />;
}
