import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trMonthKey, trParts } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { loadTemplateQuestions } from "@/lib/surveys/server";
import type { StoredQuestion } from "@/lib/surveys/logic";

/**
 * Ekip nabzı (danışman iç anketi, ayda bir, ANONİM).
 *  - Davet: anket-gorevleri cron'u, tetikleyici açık ofislerde ayın (1 + bekleme günü). gününden itibaren, bu dönem
 *    cevaplamamış her aktif ekip üyesine (ofis sahibi ve genel müdür HARİÇ: anketin konusu yönetimdir) tek bildirim
 *    (anahtar `advisor-pulse:<ofis>:<dönem>:<kişi>`). Davet kişiye özel bağlantı TAŞIMAZ; form uygulama içindedir.
 *  - Cevap: `survey_submit_advisor_pulse` RPC (JWT kimlikli); cevap satırı kişiye bağlanmaz.
 *  - Sonuç: yalnız yönetici, en az PULSE_MIN_RESPONSES cevapla, toplu.
 */

export const PULSE_HREF = "/app/anketler/ic-anket";
const EXCLUDED_ROLES = ["owner", "gm"];

/** Dönem anahtarı (TR ayı, "YYYY-MM"). */
export function pulsePeriod(nowMs: number): string {
  return trMonthKey(nowMs);
}

/** Bu rol ekip nabzına davet edilir / formu görür mü? */
export function pulseEligibleRole(role: string): boolean {
  return !EXCLUDED_ROLES.includes(role);
}

export async function sendPulseInvites(
  db: SupabaseClient,
  tenantId: string,
  trigger: { delay_days: number },
  nowMs: number,
): Promise<number> {
  const day = trParts(nowMs).day;
  if (day < 1 + Math.max(0, Math.min(27, Number(trigger.delay_days) || 0))) return 0;
  const period = pulsePeriod(nowMs);
  const [{ data: people }, { data: answered, error: answeredErr }] = await Promise.all([
    db.from("profiles").select("id, role").eq("tenant_id", tenantId).eq("is_active", true).limit(500),
    db.from("survey_pulse_responses").select("user_id").eq("tenant_id", tenantId).eq("period", period),
  ]);
  if (answeredErr) return 0; // PB49 uygulanmadı: davet yok
  const done = new Set(((answered ?? []) as { user_id: string }[]).map((r) => r.user_id));
  let sent = 0;
  for (const p of (people ?? []) as { id: string; role: string }[]) {
    if (!pulseEligibleRole(String(p.role)) || done.has(String(p.id))) continue;
    try {
      await notifyTenant({
        tenantId,
        userId: String(p.id),
        title: "Ekip nabzı: bu ayın kısa anketi",
        body: "Ofis içi memnuniyet ve ihtiyaçlarınızı 1 dakikada paylaşın. Cevaplar anonimdir; yalnız toplu sonuç görünür.",
        href: PULSE_HREF,
        kind: "info",
        prefKey: "survey",
        dedupeKey: `advisor-pulse:${tenantId}:${period}:${p.id}`,
      });
      sent += 1;
    } catch (e) {
      console.error("ekip nabzı daveti", e);
    }
  }
  return sent;
}

export type PulseFormState =
  | { state: "disabled" }
  | { state: "no_template" }
  | { state: "answered"; period: string }
  | { state: "open"; period: string; templateId: string; questions: StoredQuestion[] };

/** Kullanıcının bu dönemki form durumu (RLS'li kullanıcı istemcisiyle). */
export async function loadPulseFormState(db: SupabaseClient, tenantId: string, userId: string, nowMs: number): Promise<PulseFormState> {
  const period = pulsePeriod(nowMs);
  const [{ data: trigger }, { data: template }, { data: mine, error: mineErr }] = await Promise.all([
    db.from("survey_triggers").select("enabled").eq("tenant_id", tenantId).eq("event_type", "advisor_pulse").maybeSingle(),
    db.from("survey_templates").select("id").eq("tenant_id", tenantId).eq("event_type", "advisor_pulse").eq("audience", "advisor").eq("active", true).maybeSingle(),
    db.from("survey_pulse_responses").select("period").eq("tenant_id", tenantId).eq("user_id", userId).eq("period", period).maybeSingle(),
  ]);
  if (!trigger?.enabled || mineErr) return { state: "disabled" };
  if (!template?.id) return { state: "no_template" };
  if (mine) return { state: "answered", period };
  return { state: "open", period, templateId: String(template.id), questions: await loadTemplateQuestions(db, tenantId, String(template.id)) };
}
