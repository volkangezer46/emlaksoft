import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Yanıt gelince dur" (COM-05): müşteri WhatsApp/SMS ile yazınca, `stop_on_reply` açık dizilerdeki AKTİF kayıtları
 * durdurulur. Gelen mesaj işleyicisi (automation/inbound-intake.ts) çağırır. Tablo yoksa (migration öncesi) ya da
 * hata olursa sessizce geçer: webhook akışı bozulmaz.
 */
export async function stopSequencesOnReply(admin: SupabaseClient, tenantId: string, customerId: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from("message_sequence_enrollments")
      .select("id, sequence:message_sequences!message_sequence_enrollments_sequence_tenant_fkey!inner(stop_on_reply)")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("status", "active")
      .eq("sequence.stop_on_reply", true)
      .limit(50);
    if (error || !data || data.length === 0) return 0;
    const ids = data.map((r) => String(r.id));
    const ts = new Date().toISOString();
    const { error: upErr } = await admin
      .from("message_sequence_enrollments")
      .update({ status: "stopped", stop_reason: "reply", finished_at: ts, next_due_at: null, updated_at: ts })
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("id", ids);
    return upErr ? 0 : ids.length;
  } catch {
    return 0;
  }
}
