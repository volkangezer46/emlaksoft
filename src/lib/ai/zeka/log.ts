import "server-only";
import { createClient } from "@/lib/supabase/server";
import { Redactor } from "@/lib/ai/redact";
import type { ZekaResult, ZekaSurface } from "./types";

/**
 * Öğrenme döngüsü günlüğü — KİŞİSEL VERİSİZ. Sorgu metni `redact.ts` ile maskelenir (telefon, TC, e-posta, IBAN, kart;
 * bilinen ad-soyad listesi verilirse adlar da) ve 300 karaktere kırpılır. Satıra niyet, motor, güven, yanıtlandı mı ve
 * (sonradan) 👍/👎 yazılır. Yazma TEK yoldan: `zeka_log_query` SECURITY DEFINER RPC'si (kiracı/kullanıcı kimliğini
 * oturumdan kendisi alır; istemci başka ofis adına yazamaz). RPC yoksa (migration uygulanmadı) sessizce atlanır.
 * Bu, Zeka'nın yazdığı TEK veridir ve iş kaydı değildir (müşteri/portföy/randevu... YAZILMAZ).
 */

export function redactQueryForLog(query: string, names: readonly string[] = []): string {
  const r = new Redactor({ names: names.filter((n) => n.trim().length >= 3) });
  return r
    .redactText(query)
    .replace(/\b\d{6,}\b/g, "[SAYI]")
    .slice(0, 300);
}

export async function logZekaQuery(input: {
  surface: ZekaSurface;
  query: string;
  result: ZekaResult;
  /** Vitrin yüzeyinde ofis kimliği (sunucuda slug'dan çözülür); diğer yüzeylerde RPC oturumdan alır. */
  tenantId?: string | null;
  names?: readonly string[];
}): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("zeka_log_query", {
      p_surface: input.surface,
      p_query: redactQueryForLog(input.query, input.names),
      p_intent: input.result.intent,
      p_engine: input.result.engine,
      p_confidence: Math.max(0, Math.min(1, input.result.confidence)),
      p_answered: input.result.answered,
      p_fallback: input.result.fallbackReason ?? null,
      p_tenant_id: input.surface === "vitrin" ? (input.tenantId ?? null) : null,
    });
    if (error) return null;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

/** 👍 (1) / 👎 (-1): satır başına bir kez, 24 saat içinde (RPC kuralı). */
export async function recordZekaFeedback(logId: string, vote: 1 | -1): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("zeka_query_feedback", { p_id: logId, p_vote: vote });
    return !error && data === true;
  } catch {
    return false;
  }
}
