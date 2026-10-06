import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTenant } from "@/lib/notify";
import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";
import { resolveTeamLeads } from "@/lib/listing-control/server/escalate";
import { LOW_SCORE_TEAM_LEAD_HOURS, lowScoreEscalationTarget } from "@/lib/surveys/logic";
import { isMissingColumn, isSurveySchemaMissing } from "@/lib/surveys/server";
import { DEFAULT_SURVEY_SETTINGS } from "@/lib/surveys/types";

/**
 * Düşük puan zinciri (gorev-hatirlat cron adımı, 2 saatte bir; YENİ cron yok).
 * Görev açıldıktan (anket tamamlanınca) 24 saat içinde aksiyon notuyla kapanmazsa danışmanın takım liderine
 * (takım modeli yoksa/lider yoksa bu halka sessiz geçer), 48 saatte ofis sahibine bildirim. Kademe kaydı
 * `survey_tasks.escalation_level` iyimser kilitle ilerler: tekrar çalışma aynı kademeyi iki kez bildirmez; ayrıca
 * bildirimler kademe+kişi anahtarıyla tekildir. PB49 yoksa (sütun yok) adım sessizce atlanır.
 */

const HREF = "/app/anketler?takip=acik";
const MAX_ROWS = 1000;
const MAX_NOTIFICATIONS = 200;

type Row = {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  score: number | null;
  completed_at: string | null;
  escalation_level: number;
  contact_name: string | null;
  event_summary: string | null;
};

export type LowScoreEscalationSummary = { escalated: number; notified: number; skipped: boolean };

export async function runLowScoreEscalation(db: SupabaseClient, nowMs: number): Promise<LowScoreEscalationSummary> {
  const summary: LowScoreEscalationSummary = { escalated: 0, notified: 0, skipped: false };
  const { data, error } = await db
    .from("survey_tasks")
    .select("id, tenant_id, agent_id, score, completed_at, escalation_level, contact_name, event_summary")
    .eq("status", "completed")
    .eq("low_score_handled", false)
    .not("score", "is", null)
    .neq("event_type", "advisor_pulse")
    .lt("escalation_level", 2)
    .lte("completed_at", new Date(nowMs - LOW_SCORE_TEAM_LEAD_HOURS * 3_600_000).toISOString())
    .gte("completed_at", new Date(nowMs - 30 * 86_400_000).toISOString())
    .order("completed_at", { ascending: true })
    .limit(MAX_ROWS);
  if (error) {
    if (!isMissingColumn(error) && !isSurveySchemaMissing(error)) console.error("düşük puan zinciri", error.message);
    summary.skipped = true;
    return summary;
  }
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return summary;

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  const [disabled, { data: settingRows }, { data: ownerRows }, teamLeads] = await Promise.all([
    getDisabledModulesByTenant(db),
    db.from("survey_settings").select("tenant_id, low_score_max").in("tenant_id", tenantIds),
    db.from("profiles").select("id, tenant_id").in("tenant_id", tenantIds).eq("role", "owner").eq("is_active", true),
    resolveTeamLeads(db, rows.map((r) => r.agent_id).filter((v): v is string => Boolean(v))),
  ]);
  const lowMax = new Map(((settingRows ?? []) as { tenant_id: string; low_score_max: number }[]).map((s) => [s.tenant_id, Number(s.low_score_max) || DEFAULT_SURVEY_SETTINGS.low_score_max]));
  const owners = new Map<string, string[]>();
  for (const o of (ownerRows ?? []) as { id: string; tenant_id: string }[]) owners.set(o.tenant_id, [...(owners.get(o.tenant_id) ?? []), o.id]);

  for (const r of rows) {
    if (isDisabledFor(disabled, r.tenant_id, "surveys")) continue;
    if (Number(r.score) > (lowMax.get(r.tenant_id) ?? DEFAULT_SURVEY_SETTINGS.low_score_max)) continue;
    const target = lowScoreEscalationTarget({ completedAtMs: Date.parse(String(r.completed_at)), handled: false, nowMs });
    const current = Number(r.escalation_level) || 0;
    if (target <= current) continue;

    const { data: moved } = await db
      .from("survey_tasks")
      .update({ escalation_level: target })
      .eq("id", r.id)
      .eq("tenant_id", r.tenant_id)
      .eq("escalation_level", current)
      .eq("low_score_handled", false)
      .select("id")
      .maybeSingle();
    if (!moved) continue;
    summary.escalated += 1;

    const who = r.contact_name || r.event_summary || "Müşteri";
    const recipients: { userId: string; level: 1 | 2 }[] = [];
    if (current < 1 && target >= 1 && r.agent_id) {
      const lead = teamLeads.get(r.agent_id);
      if (lead) recipients.push({ userId: lead, level: 1 });
    }
    if (target >= 2) for (const o of owners.get(r.tenant_id) ?? []) recipients.push({ userId: o, level: 2 });

    for (const rc of recipients) {
      if (summary.notified >= MAX_NOTIFICATIONS) break;
      try {
        await notifyTenant({
          tenantId: r.tenant_id,
          userId: rc.userId,
          title: rc.level === 1 ? `Düşük puan takibi 24 saattir kapanmadı: ${who}` : `Düşük puan takibi 48 saattir kapanmadı: ${who}`,
          body: `Anket puanı ${r.score}/10. Geri arama yapılıp aksiyon notuyla kapatılması bekleniyor.`,
          href: HREF,
          kind: rc.level === 1 ? "warning" : "danger",
          prefKey: "survey",
          dedupeKey: `survey-low:${r.id}:${rc.level}:${rc.userId}`,
        });
        summary.notified += 1;
      } catch (e) {
        console.error("düşük puan zinciri bildirimi", e);
      }
    }
  }
  return summary;
}
