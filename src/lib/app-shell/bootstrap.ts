import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import { parseShellBootstrap, type ShellBootstrap } from "./bootstrap-core";

export const APP_SHELL_RPC = "app_shell_bootstrap";

/**
 * /app kabuğunun TEK TUR yükleyicisi (istek başına bir kez: React `cache()`; layout, sayfa kapısı ve modül
 * durumu aynı istekte paylaşır).
 *
 * Döner: profil + ofis özeti + ham izin override satırları + modül satırları + kullanım + rozet sayımları.
 * `null` döner → çağıran ESKİ (çok sorgulu) yola düşer: RPC yok (migration uygulanmadı; 60 sn yoklama ile
 * tekrar denenmez), RPC hata verdi, oturum yok, impersonation/tenant uyuşmazlığı (RPC kendisi NULL verir).
 * Kimlik yalnız oturumun JWT'sindendir (parametre yok); RLS SECURITY INVOKER ile aynen geçerlidir.
 */
export const loadShellBootstrap = cache(async (): Promise<ShellBootstrap | null> => {
  if (rpcKnownMissing(APP_SHELL_RPC)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(APP_SHELL_RPC);
    recordRpcOutcome(APP_SHELL_RPC, error);
    if (error || data == null) return null;
    return parseShellBootstrap(data);
  } catch (e) {
    console.error("loadShellBootstrap", e);
    return null;
  }
});

/** Hızlı yolun bu süreçte kapalı (RPC eksik) olduğu biliniyor mu? Layout spekülatif eski yolu buna göre açar. */
export function shellRpcKnownMissing(): boolean {
  return rpcKnownMissing(APP_SHELL_RPC);
}
