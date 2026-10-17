"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { logActivity } from "@/lib/activity";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { queueDef, requeuePatch } from "@/lib/admin/ops/queue-health";
import { getFeatureFlagDef } from "@/lib/feature-flags/registry";
import { resetFlagRulesCache } from "@/lib/feature-flags/rules";
import { validateFlagRuleInput } from "@/lib/feature-flags/targeting";
import { toggleTenantInList } from "@/lib/admin/ops/office-flags";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";

/**
 * /admin OPERASYON EYLEMLERİ (genişleme 2026-10): kuyruk yeniden deneme ve Ofis 360'tan ofis bazında bayrak.
 * Her eylem: modül + rol kapısı + personel başına hız sınırı (`guardPlatformAction`), platform denetim kaydı
 * (önce/sonra), bayrakta ayrıca kritik işlem doğrulaması (TOTP, `requireStepUp`) ve gerekçe.
 */

export type OpsActionResult = { ok?: boolean; error?: string; count?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEUE_BATCH = 100;

/**
 * Kalıcı hatalı kuyruk işini (ya da kuyruğun tüm kalıcı hatalılarını, en çok 100) yeniden kuyruğa alır. Yalnız işçisi
 * idempotent kuyruklar (`retryable`: public işlem bildirimi, dosya silme). Süper admin ve operasyon.
 */
export async function requeueQueueItems(fd: FormData): Promise<OpsActionResult> {
  const gate = await guardPlatformAction({ module: "sistem", roles: ["super_admin", "ops"], rate: { key: "admin-queue-requeue", limit: 20, windowSec: 600 } });
  if ("error" in gate) return { error: gate.error };
  const def = queueDef(String(fd.get("queue") ?? ""));
  if (!def?.retryable) return { error: "Bu kuyruk elle yeniden denenemez." };
  const target = String(fd.get("id") ?? "").trim();
  const all = target === "all";
  if (!all && !UUID_RE.test(target)) return { error: "İş kimliği geçersiz." };
  const nowIso = new Date(now()).toISOString();
  const patch = requeuePatch(def.key, nowIso);
  if (!patch) return { error: "Bu kuyruk elle yeniden denenemez." };

  const admin = createAdminClient();
  let query = admin.from(def.table).select("id, tenant_id").in("status", [...def.failed]).order("created_at", { ascending: true }).limit(all ? REQUEUE_BATCH : 1);
  if (!all) query = query.eq("id", target);
  const { data: rows, error: readError } = await query;
  if (readError) return { error: actionErrorMessage(readError, "Kuyruk okunamadı.") };
  const items = (rows ?? []) as { id: string; tenant_id: string }[];
  if (items.length === 0) return { error: all ? "Yeniden denenecek kalıcı hatalı iş yok." : "İş bulunamadı ya da artık hatalı değil." };

  let done = 0;
  for (const tenantId of [...new Set(items.map((r) => r.tenant_id))]) {
    const ids = items.filter((r) => r.tenant_id === tenantId).map((r) => r.id);
    const { data, error } = await admin.from(def.table).update(patch).in("id", ids).eq("tenant_id", tenantId).in("status", [...def.failed]).select("id");
    if (error) return { error: actionErrorMessage(error, "Yeniden kuyruğa alınamadı.") };
    done += (data ?? []).length;
  }

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_queue.requeue",
    entityType: def.table,
    entityId: all ? null : target,
    before: { status: def.failed },
    after: { status: patch.status, attempt_count: 0 },
    meta: { queue: def.key, count: done, ids: items.slice(0, 20).map((r) => r.id), scope: all ? "all" : "single" },
  });
  revalidatePath("/admin/kuyruklar");
  return { ok: true, count: done };
}

const FLAG_REASON_MIN = 10;

/**
 * Ofis 360 > Yönetim: ofisi bir bayrağın hedefleme kuralındaki SEÇİLİ OFİS listesine ekler / çıkarır. Yalnız süper
 * admin (bayrak ekranıyla aynı yetki) + doğrulayıcı kodu + gerekçe. Kural yoksa eklenmez (bayrak zaten herkese açıktır;
 * yalnız bu ofise kural yazmak diğer ofislerde kapatırdı). Son ofis çıkarılıp kural boşalacaksa reddedilir.
 */
export async function setOfficeFlagMembership(fd: FormData): Promise<OpsActionResult> {
  const gate = await guardPlatformAction({ module: "sistem", roles: ["super_admin"], rate: { key: "admin-office-flag", limit: 20, windowSec: 600 } });
  if ("error" in gate) return { error: gate.error };
  const def = getFeatureFlagDef(String(fd.get("flag_key") ?? ""));
  if (!def?.targetable) return { error: "Bu bayrak ofis bazında hedeflenemez." };
  const tenantId = String(fd.get("tenant_id") ?? "").trim();
  if (!UUID_RE.test(tenantId)) return { error: "Ofis kimliği geçersiz." };
  const include = String(fd.get("include") ?? "") === "1";
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < FLAG_REASON_MIN || reason.length > 300) return { error: `Gerekçe ${FLAG_REASON_MIN}–300 karakter olmalı.` };
  const step = await requireStepUp(fd, "flag_change", gate.staff.id);
  if (!step.ok) return { error: step.error };

  const admin = createAdminClient();
  const [{ data: tenant }, { data: rule, error: ruleError }] = await Promise.all([
    admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
    admin.from("feature_flag_rules").select("tenant_ids, plans, percentage, starts_at, ends_at, note").eq("flag_key", def.key).maybeSingle(),
  ]);
  if (!tenant) return { error: "Ofis bulunamadı." };
  if (ruleError) return { error: isSchemaMissing(ruleError) ? "Hedefleme tablosu henüz kurulmadı." : actionErrorMessage(ruleError, "Kural okunamadı.") };
  if (!rule) return { error: "Bu bayrağın hedefleme kuralı yok: bayrak açıksa zaten tüm ofislerde açıktır. Ofis listesi için önce Ayarlar > Özellik bayrakları ekranında kural kurun." };

  const before = rule as { tenant_ids: string[]; plans: string[]; percentage: number; starts_at: string | null; ends_at: string | null; note: string | null };
  const nextIds = toggleTenantInList(before.tenant_ids ?? [], tenantId, include);
  const v = validateFlagRuleInput({ tenantIds: nextIds, plans: before.plans ?? [], percentage: Number(before.percentage) || 0, startsAt: before.starts_at, endsAt: before.ends_at, note: before.note });
  if (!v.ok) return { error: v.error.startsWith("Hedef boş") ? "Kuraldaki son ofis buradan çıkarılamaz; kuralı Ayarlar > Özellik bayrakları ekranından kaldırın." : v.error };

  const { error } = await admin
    .from("feature_flag_rules")
    .update({ tenant_ids: v.value.tenantIds, updated_by: gate.staff.id, updated_at: new Date(now()).toISOString() })
    .eq("flag_key", def.key);
  if (error) return { error: actionErrorMessage(error, "Bayrak güncellenemedi.") };

  await Promise.all([
    logPlatformActivity({
      actorId: gate.staff.id,
      action: "feature_flag.rule_update",
      entityType: "feature_flag_rules",
      entityId: def.key,
      before: { tenant_ids: before.tenant_ids },
      after: { tenant_ids: v.value.tenantIds },
      meta: { flag: def.key, tenant_id: tenantId, include, via: "ofis_360", reason },
    }),
    logActivity({
      tenantId,
      actorId: null,
      action: "feature_flag.office_toggle",
      entityType: "tenant",
      entityId: tenantId,
      oldValue: { flag: def.key, in_list: !include },
      newValue: { flag: def.key, in_list: include, by: "platform", platform_staff_id: gate.staff.id, reason },
    }),
  ]);
  resetFlagRulesCache();
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/ayarlar/bayraklar");
  revalidatePath("/app", "layout");
  return { ok: true };
}
