"use server";

import { revalidatePath } from "next/cache";
import { now } from "@/lib/clock";
import {
  TRIAL_CHANGE_WARN_AFTER,
  canChangeTrial,
  cleanReason,
  resolveTrialEnd,
  type TrialChangeInput,
} from "@/lib/billing/admin-billing-fixes";
import { requirePlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DENEMEYİ UZAT / KISALT (Ofis 360 > Yönetim). Kapı: "sales" ya da "tenants" modülü + yazma yetkisi (`canChangeTrial`).
 * Yalnız deneme durumundaki ofise uygulanır; yeni bitiş yarın..bugün+90 gün. Deneme bitişi iki yerde tutulur ve
 * BİRLİKTE güncellenir: `tenants.trial_ends_at` ve deneme aboneliği satırı (`subscriptions` status='trialing':
 * trial_ends_at + current_period_end). Her değişiklik `tenant.trial_change` {old, new, reason} olarak denetim izine yazılır;
 * 2. değişiklikten sonrakiler sonuçta uyarı taşır (sayım denetim izinden).
 */

export type TrialChangeActionResult = { ok?: boolean; error?: string; message?: string; warning?: string; endIso?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseInput(raw: unknown): TrialChangeInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.date === "string" && r.date.trim()) return { date: r.date.trim() };
  if (r.days !== undefined && r.days !== null && r.days !== "") return { days: Number(r.days) };
  return null;
}

export async function extendTrial(tenantId: string, change: TrialChangeInput, reason: string): Promise<TrialChangeActionResult> {
  const staff = await requirePlatformStaff();
  if (!canChangeTrial(staff)) return { error: "Bu işlem için yetkiniz yok." };
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return { error: "Ofis bulunamadı." };
  const input = parseInput(change);
  if (!input) return { error: "Gün sayısı ya da tarih seçin." };
  const why = cleanReason(reason);
  if (!why) return { error: "Gerekçe yazın (en az 10 karakter)." };

  const admin = createAdminClient();
  const [tenantRes, subRes, priorRes] = await Promise.all([
    admin.from("tenants").select("id, status, trial_ends_at").eq("id", tenantId).maybeSingle(),
    admin.from("subscriptions").select("id, status, trial_ends_at").eq("tenant_id", tenantId).eq("status", "trialing").limit(1).maybeSingle(),
    admin.from("platform_audit_logs").select("id", { count: "exact", head: true }).eq("action", "tenant.trial_change").eq("entity_id", tenantId),
  ]);
  const tenant = tenantRes.data as { id: string; status: string; trial_ends_at: string | null } | null;
  if (tenantRes.error || !tenant) return { error: "Ofis bulunamadı." };
  if (tenant.status !== "trial") return { error: "Yalnız deneme durumundaki ofisin deneme süresi değiştirilebilir." };

  const nowMs = now();
  const oldEnd = tenant.trial_ends_at ?? (subRes.data as { trial_ends_at: string | null } | null)?.trial_ends_at ?? null;
  const next = resolveTrialEnd(input, oldEnd, nowMs);
  if (!next.ok) return { error: next.error };
  const nowIso = new Date(nowMs).toISOString();

  // Ofis satırı: durum koşulu TEKRARLANIR (bu arada ödeme alıp aktif olan ofisin deneme alanı ezilmez).
  const upd = await admin
    .from("tenants")
    .update({ trial_ends_at: next.endIso, updated_at: nowIso })
    .eq("id", tenantId)
    .eq("status", "trial")
    .select("id");
  if (upd.error) return { error: "Deneme bitişi kaydedilemedi; değişiklik yapılmadı, tekrar deneyin." };
  if ((upd.data ?? []).length === 0) return { error: "Ofis artık deneme durumunda değil; sayfayı yenileyin." };

  // Deneme aboneliği satırı (varsa): abonelik-kontrol cron'u bu alana bakar, birlikte güncellenmezse deneme erken biter.
  const sub = subRes.data as { id: string } | null;
  if (sub) {
    const subUpd = await admin
      .from("subscriptions")
      .update({ trial_ends_at: next.endIso, current_period_end: next.endIso, updated_at: nowIso })
      .eq("id", sub.id)
      .eq("status", "trialing");
    if (subUpd.error) {
      // Ofis güncellendi ama abonelik güncellenemedi: eski değere döndür (yarım kayıt bırakma).
      await admin.from("tenants").update({ trial_ends_at: tenant.trial_ends_at, updated_at: nowIso }).eq("id", tenantId).eq("status", "trial");
      return { error: "Deneme aboneliği güncellenemedi; değişiklik geri alındı." };
    }
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.trial_change",
    entityType: "tenant",
    entityId: tenantId,
    meta: { old: oldEnd, new: next.endIso, reason: why, ...("days" in input ? { days: input.days } : { date: input.date }) },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");
  const priorCount = priorRes.error ? 0 : (priorRes.count ?? 0);
  const label = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(next.endIso));
  return {
    ok: true,
    endIso: next.endIso,
    message: `Deneme bitişi ${label} olarak güncellendi.`,
    ...(priorCount >= TRIAL_CHANGE_WARN_AFTER
      ? { warning: `Bu ofisin deneme süresi daha önce ${priorCount} kez değiştirildi. Tekrarlayan uzatmalar yerine ücretli pakete geçişi görüşün.` }
      : {}),
  };
}
