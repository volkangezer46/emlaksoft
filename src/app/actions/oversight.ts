"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import {
  ALERT_RULE_IDS,
  APPROVAL_ACTION_TYPES,
  THRESHOLD_LIMITS,
  normalizeApprovalRules,
  normalizeThresholds,
  type ThresholdNumField,
} from "@/lib/oversight/settings";
import { isMissingTable } from "@/lib/oversight/store";

export type OversightResult = { ok?: boolean; error?: string };

const PATH = "/app/ofis-kontrol";
const KEY_RE = /^[a-z_]+:[A-Za-z0-9:_.|-]{1,160}$/;

/**
 * Uyariyi "incelendi" isaretle. Yalniz ofis geneli veri kapsamli roller (sahip, GM, sube muduru):
 * danisman baskasinin uyarisini goremez, dolayisiyla isaretleyemez de.
 */
export async function reviewAlert(_prev: OversightResult, fd: FormData): Promise<OversightResult> {
  const gate = await requirePermission("team", "view");
  if (!gate.ok) return { error: gate.error };
  if (!hasOfficeWideDataScope(gate.role)) return { error: "Uyarıları yalnızca ofis yöneticileri inceleyebilir." };

  const key = String(fd.get("key") ?? "").trim();
  if (!KEY_RE.test(key) || key.length > 200) return { error: "Geçersiz uyarı." };
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("oversight_alert_reviews")
    .upsert(
      { tenant_id: gate.tenantId, alert_key: key, reviewed_by: gate.userId, reviewed_at: new Date().toISOString(), note },
      { onConflict: "tenant_id,alert_key", ignoreDuplicates: true },
    );
  if (error) {
    return {
      error: isMissingTable(error)
        ? "İnceleme kaydı henüz etkin değil (veritabanı güncellemesi bekleniyor)."
        : "İnceleme kaydedilemedi.",
    };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "oversight.alert_reviewed",
    entityType: "oversight_alert",
    newValue: { alert_key: key, note },
  });
  revalidatePath(`${PATH}/uyarilar`);
  revalidatePath(PATH);
  return { ok: true };
}

/** Esik + onay kurali ayarlari — yalniz ofis sahibi / genel mudur (settings:edit). */
export async function saveOversightSettings(_prev: OversightResult, fd: FormData): Promise<OversightResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.role !== "owner" && gate.role !== "gm") return { error: "Ayarları yalnızca ofis sahibi veya genel müdür değiştirebilir." };

  const rawThresholds: Record<string, unknown> = { enabled: {} as Record<string, boolean> };
  for (const f of Object.keys(THRESHOLD_LIMITS) as ThresholdNumField[]) {
    const v = fd.get(`t_${f}`);
    if (v !== null && String(v).trim() !== "") rawThresholds[f] = String(v);
  }
  for (const r of ALERT_RULE_IDS) (rawThresholds.enabled as Record<string, boolean>)[r] = fd.get(`en_${r}`) === "on";
  // Zeka katmani ayari (thresholds.insights) bu formda yok: mevcut deger KORUNUR (aksi halde kayitta silinirdi).
  {
    const { data: prev } = await (await createClient()).from("oversight_settings").select("thresholds").eq("tenant_id", gate.tenantId).maybeSingle();
    const prevInsights = (prev?.thresholds as { insights?: unknown } | null | undefined)?.insights;
    if (prevInsights !== undefined) rawThresholds.insights = prevInsights;
  }
  const thresholds = normalizeThresholds(rawThresholds);

  const rawRules: Record<string, unknown> = {};
  for (const t of APPROVAL_ACTION_TYPES) {
    rawRules[t] = { enabled: fd.get(`ar_${t}_enabled`) === "on", threshold: String(fd.get(`ar_${t}_threshold`) ?? "") };
  }
  const approvalRules = normalizeApprovalRules(rawRules);

  const supabase = await createClient();
  const { error } = await supabase.from("oversight_settings").upsert(
    {
      tenant_id: gate.tenantId,
      thresholds,
      approval_rules: approvalRules,
      updated_by: gate.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    return {
      error: isMissingTable(error)
        ? "Ayar kaydı henüz etkin değil (veritabanı güncellemesi bekleniyor). Varsayılan eşikler kullanılıyor."
        : "Ayarlar kaydedilemedi.",
    };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "oversight.settings_update",
    entityType: "oversight_settings",
    newValue: {
      approval_rules_enabled: APPROVAL_ACTION_TYPES.filter((t) => approvalRules[t].enabled),
      alert_rules_disabled: ALERT_RULE_IDS.filter((r) => !thresholds.enabled[r]),
    },
  });
  revalidatePath(PATH);
  revalidatePath(`${PATH}/kurallar`);
  revalidatePath(`${PATH}/uyarilar`);
  return { ok: true };
}
