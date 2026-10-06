import { createClient } from "@/lib/supabase/server";
import { getSettingDef, isSecretDef } from "./registry";
import type { SettingHistoryEntry, SettingScope } from "./types";

/**
 * Ayar geçmişi OKUMA (oturumlu istemci; RLS: platform satırları yalnız platform personeli, ofis satırları kendi ofisi).
 * Gizli ayarda değer sütunları zaten null'dır; parmak izi ve özet döner. Tablo yoksa boş liste.
 */
export async function getSettingHistory(
  key: string,
  opts?: { scope?: SettingScope; tenantId?: string; limit?: number },
): Promise<SettingHistoryEntry[]> {
  const def = getSettingDef(key);
  if (!def) return [];
  const scope = opts?.scope ?? def.scope;
  // Geçmiş satırları depo anahtarıyla yazılır (doğrudan-yazım tetikleyicisi yalnız depo anahtarını bilir).
  const storage = def.storageKey ?? def.key;
  try {
    const supabase = await createClient();
    let q = supabase
      .from("settings_history")
      .select("id, version, old_value, new_value, is_secret, fingerprint, summary, changed_by, actor_type, reason, created_at")
      .eq("scope", scope)
      .eq("key", storage)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(opts?.limit ?? 20, 1), 100));
    q = scope === "platform" ? q.is("tenant_id", null) : q.eq("tenant_id", opts?.tenantId ?? "");
    const { data, error } = await q;
    if (error) return [];
    const secret = isSecretDef(def);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      version: r.version as number,
      oldValue: secret ? null : r.old_value,
      newValue: secret ? null : r.new_value,
      isSecret: Boolean(r.is_secret) || secret,
      fingerprint: (r.fingerprint as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      changedBy: (r.changed_by as string | null) ?? null,
      actorType: r.actor_type as string,
      reason: (r.reason as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  } catch {
    return [];
  }
}