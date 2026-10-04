import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VITRIN_COLUMNS,
  VITRIN_DEFAULTS,
  isMissingColumnError,
  settingsFromRow,
  type VitrinSettingsState,
} from "@/lib/vitrin-settings-logic";

/**
 * Ofis vitrin ayarlarını TEK sorguda okur. Sütunlar yokken (migration uygulanmadı) `available:false` ve
 * varsayılanlar döner; beklenmeyen hata da güvenli varsayılana düşer (vitrin hiçbir zaman ayar yüzünden kapanmaz).
 * Ana tenant sorgusundan AYRI tutulur: eksik sütun ana vitrin sorgusunu bozmasın.
 */
export async function loadVitrinSettings(client: SupabaseClient, tenantId: string): Promise<VitrinSettingsState> {
  const { data, error } = await client.from("tenants").select(VITRIN_COLUMNS).eq("id", tenantId).maybeSingle();
  if (error) {
    if (!isMissingColumnError(error)) console.error("vitrin ayarları okunamadı", error);
    return { available: false, settings: { ...VITRIN_DEFAULTS } };
  }
  return { available: true, settings: settingsFromRow(data as Record<string, unknown> | null) };
}
