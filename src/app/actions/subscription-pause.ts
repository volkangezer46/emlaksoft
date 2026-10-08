"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { getPauseMaxDays, isPauseEnabled, loadPlanChangeState } from "@/lib/billing/plan-change";
import { evaluatePause, pauseRefusalMessage, type PauseRefusalCode } from "@/lib/billing/pause-core";
import { now } from "@/lib/clock";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * ABONELİK DURAKLATMA (varsayılan KAPALI: `billing.pause_enabled`; azami süre `billing.pause_max_days`, yılda 1 kez).
 * Duraklatma YALNIZ ofis sahibi tarafından başlatılır; devam ettirmeyi sahip veya genel müdür yapar. Duraklatmada veri
 * salt-okunur olur (requirePermission yazma eylemlerini reddeder; abonelik/ödeme modülü hariç) ve dönem bitişi gerçek
 * duraklatma süresi kadar uzar. Yazma, JWT kimlikli SECURITY DEFINER RPC'lerle tek işlemde denetim kaydıyla yapılır;
 * bayrak ve sınırlar SQL'de de kontrol edilir (dogrudan RPC çağrısı bypass olmasın).
 */

export type PauseResult = { ok?: boolean; error?: string; message?: string };

const NOT_READY = "Abonelik duraklatma henüz etkin değil: yönetici hazırlığı tamamlanıyor.";

const REFUSAL_CODES: ReadonlySet<string> = new Set<PauseRefusalCode>([
  "disabled",
  "not_owner",
  "invalid_days",
  "too_long",
  "no_subscription",
  "already_paused",
  "not_active",
  "period_over",
  "cancel_pending",
  "yearly_limit",
  "not_paused",
]);

function refusalFrom(res: { code?: string; maxDays?: number; nextAllowedAt?: string }, fallback: string): string {
  const code = String(res.code ?? "");
  if (!REFUSAL_CODES.has(code)) return fallback;
  const next = res.nextAllowedAt ? Date.parse(res.nextAllowedAt) : NaN;
  return pauseRefusalMessage(code as PauseRefusalCode, {
    maxDays: res.maxDays,
    nextAllowedAtMs: Number.isFinite(next) ? next : undefined,
  });
}

export async function pauseSubscription(formData: FormData): Promise<PauseResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda abonelik duraklatılamaz." };
  if (gate.role !== "owner") return { error: pauseRefusalMessage("not_owner") };

  const days = Number(String(formData.get("days") ?? "").trim());

  const { allowed } = await checkRateLimit(`pause:${gate.userId}`, { limit: 6, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin." };

  const [enabled, maxDays, support] = await Promise.all([isPauseEnabled(), getPauseMaxDays(), getPlanSupport()]);
  if (!enabled) return { error: pauseRefusalMessage("disabled") };
  if (!support.pauseReady) return { error: NOT_READY };

  const supabase = await createClient();
  const state = await loadPlanChangeState(supabase, gate.tenantId);
  if (!state) return { error: actionErrorMessage(null, "Abonelik bilgisi okunamadı.") };

  // Ön denetim (kullanıcıya hızlı ve açık gerekçe); son hakem SQL RPC'sidir.
  const decision = evaluatePause({
    enabled,
    role: gate.role,
    status: state.status,
    periodEndMs: state.periodEndMs,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    pausedAtMs: state.pause.startedAtMs,
    lastStartedMs: state.lastPauseStartedMs,
    maxDays,
    days,
    nowMs: now(),
  });
  if (!decision.ok) return { error: decision.message };

  const { data, error } = await supabase.rpc("subscription_pause", { p_days: days });
  if (error) {
    console.error("pauseSubscription", { code: error.code, message: error.message });
    return { error: actionErrorMessage(error, "Abonelik duraklatılamadı.") };
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string; maxDays?: number; nextAllowedAt?: string; endsAt?: string };
  if (res.ok !== true) return { error: refusalFrom(res, "Abonelik duraklatılamadı.") };

  revalidatePath("/app/abonelik");
  revalidatePath("/app");
  const endsLabel = res.endsAt
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(res.endsAt))
    : null;
  return {
    ok: true,
    message: `Aboneliğiniz duraklatıldı${endsLabel ? ` (${endsLabel} tarihine kadar)` : ""}. Bu sürede verileriniz salt-okunurdur; dönem bitişiniz duraklatma süresi kadar uzar.`,
  };
}

export async function resumeSubscription(): Promise<PauseResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda abonelik devam ettirilemez." };
  if (gate.role !== "owner" && gate.role !== "gm") {
    return { error: "Aboneliği yalnızca ofis sahibi veya genel müdür devam ettirebilir." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subscription_resume");
  if (error) {
    console.error("resumeSubscription", { code: error.code, message: error.message });
    return { error: actionErrorMessage(error, "Abonelik devam ettirilemedi.") };
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string; periodEnd?: string };
  if (res.ok !== true) return { error: refusalFrom(res, "Abonelik devam ettirilemedi.") };

  revalidatePath("/app/abonelik");
  revalidatePath("/app");
  const endLabel = res.periodEnd
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(res.periodEnd))
    : null;
  return { ok: true, message: `Aboneliğiniz devam ediyor${endLabel ? `; yeni dönem bitişiniz ${endLabel}` : ""}.` };
}
