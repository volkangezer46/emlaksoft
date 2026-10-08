"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { DAY_MS, now, parseTrLocalDateTime } from "@/lib/clock";
import { SCORE_RULE_KEYS } from "@/lib/gamification";
import { rulesToStore } from "@/lib/league/settings";
import { isScoreRuleKey } from "@/lib/league/challenge";

export type LeagueResult = { ok?: boolean; error?: string; id?: string };

const MAX_CHALLENGE_DAYS = 120;

/**
 * Lig puan kuralları + tutar gösterimi (yalnız yönetici: Hedefler/düzenle izni).
 * `show_amounts` (P12): tutar bazlı sıralama; VARSAYILAN KAPALI, burada yalnız bilinçli açılır.
 */
export async function saveLeagueSettings(_prev: LeagueResult, fd: FormData): Promise<LeagueResult> {
  const gate = await requirePermission("targets", "edit");
  if (!gate.ok) return { error: gate.error };

  const input: Record<string, unknown> = {};
  for (const key of SCORE_RULE_KEYS) {
    const raw = fd.get(`rule_${key}`);
    if (raw !== null) input[key] = String(raw).trim();
  }
  const rules = rulesToStore(input);
  const showAmounts = fd.get("show_amounts") === "on";

  const supabase = await createClient();
  const { error } = await supabase.from("league_settings").upsert(
    {
      tenant_id: gate.tenantId,
      rules,
      show_amounts: showAmounts,
      updated_by: gate.userId,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { error: actionErrorMessage(error, "Lig kuralları kaydedilemedi.") };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "league.settings",
    entityType: "league_settings",
    entityId: gate.tenantId,
    newValue: { rules, show_amounts: showAmounts },
  });
  revalidatePath("/app/lig");
  return { ok: true };
}

function dayStartIso(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return parseTrLocalDateTime(`${date}T00:00`);
}

/** Süreli ekip/bireysel meydan okuma açar. Bitiş tarihi DAHİL (gün sonunda biter). */
export async function createChallenge(_prev: LeagueResult, fd: FormData): Promise<LeagueResult> {
  const gate = await requirePermission("targets", "create");
  if (!gate.ok) return { error: gate.error };

  const title = String(fd.get("title") ?? "").trim();
  if (title.length < 3 || title.length > 120) return { error: "Başlık 3-120 karakter olmalı." };
  const description = String(fd.get("description") ?? "").trim().slice(0, 500) || null;
  const rewardText = String(fd.get("reward_text") ?? "").trim().slice(0, 200) || null;
  const metric = String(fd.get("metric") ?? "").trim();
  if (!isScoreRuleKey(metric)) return { error: "Geçerli bir ölçüt seçin." };
  const scope = String(fd.get("scope") ?? "team") === "individual" ? "individual" : "team";
  const target = parseInt(String(fd.get("target_value") ?? ""), 10);
  if (!Number.isFinite(target) || target < 1 || target > 100000) return { error: "Hedef 1 ile 100000 arasında olmalı." };

  const start = dayStartIso(String(fd.get("starts_on") ?? ""));
  const endDay = dayStartIso(String(fd.get("ends_on") ?? ""));
  if (!start || !endDay) return { error: "Başlangıç ve bitiş tarihini seçin." };
  const end = new Date(endDay.getTime() + DAY_MS);
  if (end.getTime() <= start.getTime()) return { error: "Bitiş tarihi başlangıçtan önce olamaz." };
  if (end.getTime() <= now()) return { error: "Bitiş tarihi geçmişte olamaz." };
  if (end.getTime() - start.getTime() > MAX_CHALLENGE_DAYS * DAY_MS) {
    return { error: `Meydan okuma en çok ${MAX_CHALLENGE_DAYS} gün sürebilir.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("league_challenges")
    .insert({
      tenant_id: gate.tenantId,
      title,
      description,
      reward_text: rewardText,
      metric,
      scope,
      target_value: target,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { error: actionErrorMessage(error, "Meydan okuma açılamadı.") };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "league.challenge.create",
    entityType: "league_challenge",
    entityId: data.id,
    newValue: { title, metric, scope, target },
  });
  revalidatePath("/app/lig");
  return { ok: true, id: data.id };
}

/** Süren meydan okumayı iptal eder (sonuç mühürlenmez, kutlama gitmez). */
export async function cancelChallenge(formData: FormData): Promise<void> {
  const gate = await requirePermission("targets", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("league_challenges")
    .update({ status: "cancelled", finished_at: new Date(now()).toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active");
  if (!error) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "league.challenge.cancel",
      entityType: "league_challenge",
      entityId: id,
    });
  }
  revalidatePath("/app/lig");
}
