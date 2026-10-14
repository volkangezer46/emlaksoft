import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseUiState, type UiState } from "@/lib/ui-state";

/**
 * Oturum sahibinin `profiles.ui_state` değeri (RLS: kendi satırı). Sütun henüz yoksa (migration uygulanmadı) ya da
 * okuma hatasında `null`: çağıran yalnız tarayıcı önbelleğiyle (localStorage) davranır, sahte "görüldü" uydurmaz.
 */
export async function readOwnUiState(userId: string): Promise<UiState | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("ui_state").eq("id", userId).maybeSingle();
    if (error || !data) return null;
    return parseUiState((data as { ui_state?: unknown }).ui_state);
  } catch {
    return null;
  }
}
