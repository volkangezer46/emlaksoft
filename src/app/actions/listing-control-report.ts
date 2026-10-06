"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { daysAgoIso } from "@/lib/clock";
import { generateListingControlSummary } from "@/lib/ai/listing-control-summary";
import { getChangesSince, getControlSummary } from "@/lib/listing-control/server/readers";
import { sumSummaryRows } from "@/components/listing-control/helpers";
import {
  buildReportFacts,
  factsToPromptInput,
  ruleBasedSummary,
  type ReportAudience,
  type ReportFact,
  type ReportPeriod,
} from "@/components/listing-control/report-facts";
import type { Db } from "@/lib/listing-control/server/db";

/**
 * İlan Kontrol AI özeti (kullanıcı tıklaması). Okuma KULLANICI OTURUMUYLA (RLS + rol kapsamı: danışman kendi, müdür
 * şubesi, owner/gm ofis); service_role YOK. Olgular veritabanından gelir, AI yalnız bunları anlatır ve çıktıdaki her sayı
 * doğrulanır; doğrulanamazsa `ai: null` döner ve kural tabanlı özet gösterilir.
 */

export type ControlSummaryResult =
  | { ok: true; ai: string | null; rules: string[]; facts: ReportFact[] }
  | { ok: false; error: string };

export async function generateControlSummary(periodRaw: string, audienceRaw: string): Promise<ControlSummaryResult> {
  const gate = await requirePermission("portals", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const period: ReportPeriod = periodRaw === "week" ? "week" : "day";
  const audience: ReportAudience = audienceRaw === "advisor" ? "advisor" : "manager";

  const db = (await createClient()) as unknown as Db;
  const [summary, changes] = await Promise.all([getControlSummary(db, "tenant"), getChangesSince(db, daysAgoIso(period === "week" ? 7 : 1))]);
  if (!summary.available) return { ok: false, error: "İlan kontrol sistemi henüz etkin değil." };

  const facts = buildReportFacts(sumSummaryRows(summary.rows), changes.available ? changes.changes : null);
  const rules = ruleBasedSummary(period, facts);
  const total = facts.find((f) => f.key === "total_active")?.value ?? 0;
  if (total === 0) return { ok: true, ai: null, rules, facts };

  const ai = await generateListingControlSummary(factsToPromptInput(period, audience, facts), audience, { tenantId: gate.tenantId, actorId: gate.userId });
  return { ok: true, ai, rules, facts };
}
