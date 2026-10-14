"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { isUiStateKey, type UiState } from "@/lib/ui-state";
import { readOwnUiState } from "@/lib/ui-state-server";

/**
 * Arayüz durumu eylemleri (YD5): ürün turu ve davet kartı kapatma işaretleri profilde (cihazlar arası).
 * Kapı: aktif ofis oturumu; yalnız kendi satırı (RLS + SECURITY INVOKER RPC). Destek oturumu (impersonation)
 * kullanıcının durumunu DEĞİŞTİRMEZ. Sütun/fonksiyon yoksa (migration bekliyor) sessizce `null` / `ok: false`.
 */

/** Oturum sahibinin işaretleri; oturum/ofis yoksa ya da okunamazsa null (istemci localStorage ile devam eder). */
export async function loadUiState(): Promise<UiState | null> {
  const gate = await requireActiveTenant();
  if (!gate.ok || gate.impersonating) return null;
  return readOwnUiState(gate.userId);
}

/** Bir işareti kalıcı yazar (zaten varsa dokunmaz). Hata kullanıcıya gösterilmez: localStorage önbelleği çalışmaya devam eder. */
export async function markUiState(key: string): Promise<{ ok: boolean }> {
  const gate = await requireActiveTenant();
  if (!gate.ok || gate.impersonating) return { ok: false };
  if (typeof key !== "string" || !isUiStateKey(key)) return { ok: false };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("profile_ui_state_mark", { p_key: key });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
