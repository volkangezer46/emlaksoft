import "server-only";
import { trDayStartIso } from "@/lib/clock";
import { formatPhoneDisplay } from "@/lib/phone";
import type { createClient } from "@/lib/supabase/server";
import {
  callbackMarkerPattern,
  callbackTaskNotes,
  callbackTaskTitle,
  pickCallbackAssignee,
} from "@/lib/calls/callback";

type Db = Awaited<ReturnType<typeof createClient>>;

export type CallbackEnsureResult =
  | { created: true; taskId: string; assignedTo: string | null; title: string }
  | { created: false; reason: "exists" | "error" };

/**
 * Cevapsız çağrı için "Geri ara" görevi açar (çağıranın oturumuyla; RLS + tasks yetkisi geçerli).
 * İdempotent: aynı numaraya bağlı AÇIK görev varsa ya da bugün (TR günü) zaten görev açıldıysa yenisi açılmaz.
 * ASLA fırlatmaz — arama kaydı akışı görev hatasından etkilenmez.
 */
export async function ensureMissedCallbackTask(
  supabase: Db,
  input: { tenantId: string; actorId: string; phone: string; customerId: string | null },
): Promise<CallbackEnsureResult> {
  try {
    const pattern = callbackMarkerPattern(input.phone);
    const { data: existing, error: existingErr } = await supabase
      .from("tasks")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("kind", "call")
      .like("notes", pattern)
      .or(`status.eq.open,created_at.gte.${trDayStartIso()}`)
      .limit(1);
    if (existingErr) {
      console.error("ensureMissedCallbackTask lookup", existingErr);
      return { created: false, reason: "error" };
    }
    if ((existing ?? []).length > 0) return { created: false, reason: "exists" };

    // Müşteri: verilen kayıt; yoksa aynı (saklanan biçimdeki) numaralı ilk müşteri.
    let customer: { id: string; full_name: string | null; assigned_to: string | null } | null = null;
    if (input.customerId) {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, assigned_to")
        .eq("tenant_id", input.tenantId)
        .eq("id", input.customerId)
        .maybeSingle();
      customer = data ?? null;
    } else {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, assigned_to")
        .eq("tenant_id", input.tenantId)
        .eq("phone", input.phone)
        .is("deleted_at", null)
        .limit(1);
      customer = (data ?? [])[0] ?? null;
    }

    const assignedTo = pickCallbackAssignee({ customerAdvisorId: customer?.assigned_to, actorId: input.actorId });
    const title = callbackTaskTitle(customer?.full_name, formatPhoneDisplay(input.phone));
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        tenant_id: input.tenantId,
        title,
        notes: callbackTaskNotes(input.phone),
        kind: "call",
        priority: "high",
        status: "open",
        due_at: new Date().toISOString(),
        assigned_to: assignedTo,
        customer_id: customer?.id ?? null,
        created_by: input.actorId,
      })
      .select("id")
      .single();
    if (error || !task) {
      console.error("ensureMissedCallbackTask insert", error);
      return { created: false, reason: "error" };
    }
    return { created: true, taskId: task.id as string, assignedTo, title };
  } catch (e) {
    console.error("ensureMissedCallbackTask", e instanceof Error ? e.message : e);
    return { created: false, reason: "error" };
  }
}

/**
 * Numaraya giden arama kaydedildi: o numaraya bağlı AÇIK "Geri ara" görevlerini tamamlar.
 * Çağıranın oturumuyla çalışır (kapsam dışındaki görev RLS gereği dokunulmadan kalır). ASLA fırlatmaz.
 * Tamamlanan görev kimliklerini döndürür.
 */
export async function completeCallbackTasksForPhone(
  supabase: Db,
  input: { tenantId: string; phone: string },
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("tenant_id", input.tenantId)
      .eq("status", "open")
      .eq("kind", "call")
      .like("notes", callbackMarkerPattern(input.phone))
      .select("id");
    if (error) {
      console.error("completeCallbackTasksForPhone", error);
      return [];
    }
    return (data ?? []).map((r) => r.id as string);
  } catch (e) {
    console.error("completeCallbackTasksForPhone", e instanceof Error ? e.message : e);
    return [];
  }
}
