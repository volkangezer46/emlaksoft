"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { getFeatureFlagDef } from "@/lib/feature-flags/registry";
import { resetFlagRulesCache } from "@/lib/feature-flags/rules";
import { validateFlagRuleInput } from "@/lib/feature-flags/targeting";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";

/**
 * Özellik bayrağı HEDEFLEME yazımı (DG8): Ayarlar > Özellik bayrakları ekranındaki kural formu. Bayrak aç/kapa ile
 * aynı kapı: `sistem` modülü + yalnız süper admin + gerekçe (≥10 karakter) + denetim izi (önce/sonra). Yalnız
 * envanterde `targetable` işaretli bayrak hedeflenebilir (tek kaynak registry). Kural yazınca bu örneğin kural
 * önbelleği hemen tazelenir; diğer örnekler en geç 30 sn içinde görür.
 */

const RATE = { key: "feature-flag-rules", limit: 30, windowSec: 600 } as const;
const MIN_REASON = 10;

export type FlagRuleResult = { ok?: boolean; error?: string };

export type FlagRuleFormInput = {
  flagKey: string;
  tenantIds: string[];
  plans: string[];
  percentage: number;
  /** datetime-local (Türkiye saati) ya da boş. */
  startsLocal: string;
  endsLocal: string;
  note: string;
  reason: string;
};

function localToIso(raw: string, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null };
  const d = parseTrLocalDateTime(s);
  return d ? { ok: true, value: d.toISOString() } : { ok: false, error: `${label} geçersiz.` };
}

async function gate(reason: string) {
  await requirePlatformModule("sistem");
  const g = await guardPlatformAction({ module: "sistem", roles: ["super_admin"], rate: RATE });
  if ("error" in g) return { error: g.error } as const;
  if ((reason ?? "").trim().length < MIN_REASON) return { error: `Gerekçe en az ${MIN_REASON} karakter olmalı.` } as const;
  return { staff: g.staff } as const;
}

async function currentRule(flagKey: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("feature_flag_rules")
    .select("tenant_ids, plans, percentage, starts_at, ends_at, note")
    .eq("flag_key", flagKey)
    .maybeSingle();
  return data ?? null;
}

function afterWrite() {
  resetFlagRulesCache();
  revalidatePath("/admin/ayarlar/bayraklar");
  revalidatePath("/app", "layout");
}

/** Kural oluşturur/değiştirir (bayrak başına tek kural). */
export async function saveFeatureFlagRule(input: FlagRuleFormInput): Promise<FlagRuleResult> {
  const g = await gate(input.reason);
  if ("error" in g) return { error: g.error };
  const def = getFeatureFlagDef(input.flagKey);
  if (!def?.targetable) return { error: "Bu bayrak ofis bazında hedeflenemez." };
  const starts = localToIso(input.startsLocal, "Başlangıç");
  if (!starts.ok) return { error: starts.error };
  const ends = localToIso(input.endsLocal, "Bitiş");
  if (!ends.ok) return { error: ends.error };
  if (ends.value && new Date(ends.value).getTime() <= now()) return { error: "Bitiş geçmişte olamaz." };
  const v = validateFlagRuleInput({
    tenantIds: Array.isArray(input.tenantIds) ? input.tenantIds : [],
    plans: Array.isArray(input.plans) ? input.plans : [],
    percentage: Number(input.percentage),
    startsAt: starts.value,
    endsAt: ends.value,
    note: (input.note ?? "").trim() || null,
  });
  if (!v.ok) return { error: v.error };

  const before = await currentRule(def.key);
  const admin = createAdminClient();
  const row = {
    flag_key: def.key,
    tenant_ids: v.value.tenantIds,
    plans: v.value.plans,
    percentage: v.value.percentage,
    starts_at: v.value.startsAt,
    ends_at: v.value.endsAt,
    note: v.value.note,
    updated_by: g.staff.id,
    updated_at: new Date(now()).toISOString(),
  };
  const { error } = await admin.from("feature_flag_rules").upsert(row, { onConflict: "flag_key" });
  if (error) {
    if (isSchemaMissing(error)) return { error: "Hedefleme tablosu henüz kurulmadı (veritabanı güncellemesi bekleniyor)." };
    return { error: actionErrorMessage(error, "Hedefleme kaydedilemedi") };
  }
  await logPlatformActivity({
    actorId: g.staff.id,
    action: before ? "feature_flag.rule_update" : "feature_flag.rule_create",
    entityType: "feature_flag_rules",
    entityId: def.key,
    before,
    after: { tenant_ids: row.tenant_ids, plans: row.plans, percentage: row.percentage, starts_at: row.starts_at, ends_at: row.ends_at, note: row.note },
    meta: { flag: def.key, reason: input.reason.trim() },
  });
  afterWrite();
  return { ok: true };
}

/** Kuralı kaldırır: bayrak yeniden genel anahtarla herkese uygulanır. */
export async function deleteFeatureFlagRule(input: { flagKey: string; reason: string }): Promise<FlagRuleResult> {
  const g = await gate(input.reason);
  if ("error" in g) return { error: g.error };
  const def = getFeatureFlagDef(input.flagKey);
  if (!def?.targetable) return { error: "Bu bayrak ofis bazında hedeflenemez." };
  const before = await currentRule(def.key);
  if (!before) return { ok: true };
  const admin = createAdminClient();
  const { error } = await admin.from("feature_flag_rules").delete().eq("flag_key", def.key);
  if (error) return { error: actionErrorMessage(error, "Hedefleme kaldırılamadı") };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "feature_flag.rule_delete",
    entityType: "feature_flag_rules",
    entityId: def.key,
    before,
    after: null,
    meta: { flag: def.key, reason: input.reason.trim() },
  });
  afterWrite();
  return { ok: true };
}
