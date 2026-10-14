"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { validateRequestInput } from "@/lib/product-feedback/model";
import {
  answerNps,
  boardEnabledFor,
  createFeatureRequest,
  dismissNps,
  markNpsShown,
  setFeatureRequestVote,
  tenantPlanOf,
} from "@/lib/product-feedback/store";

/**
 * OFİS tarafı ürün geri bildirimi (DG8): Yardım > Öneri panosu (öneri + oy) ve kabuktaki NPS anketi.
 * Öneri/oy ofis adına bir karardır: `support:create` (sahip/yönetici). NPS kişiseldir: aktif ofis kullanıcısı
 * (destek oturumu/impersonation yanıt veremez). Pano ve NPS ayrıca hedeflenebilir özellik bayraklarıdır
 * (`feature_board`, `nps_survey`); kapalı/hedef dışı ofisin isteği reddedilir.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_PATH = "/app/yardim";

export type FeedbackResult = { ok?: boolean; error?: string; votes?: number };

export async function submitFeatureRequest(fd: FormData): Promise<FeedbackResult> {
  const gate = await requirePermission("support", "create");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda öneri yazılamaz." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  const bad = validateRequestInput(title, body);
  if (bad) return { error: bad };
  const rl = await checkRateLimit(`feature-request:${gate.tenantId}`, { limit: 10, windowSec: 86_400, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Bugün için öneri sınırına ulaştınız; yarın tekrar deneyin." };
  try {
    if (!(await boardEnabledFor(gate.tenantId))) return { error: "Öneri panosu şu an kapalı." };
    await createFeatureRequest({ tenantId: gate.tenantId, userId: gate.userId, title, body: body || null });
  } catch (e) {
    return { error: actionErrorMessage(e, "Öneri kaydedilemedi") };
  }
  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/** Oy ver / geri al (ofis başına tek oy; ikinci oy yok sayılır). */
export async function voteFeatureRequest(requestId: string, on: boolean): Promise<FeedbackResult> {
  const gate = await requirePermission("support", "create");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda oy verilemez." };
  if (!UUID_RE.test(requestId)) return { error: "Geçersiz öneri." };
  const rl = await checkRateLimit(`feature-vote:${gate.tenantId}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık oy işlemi; biraz sonra tekrar deneyin." };
  try {
    if (!(await boardEnabledFor(gate.tenantId))) return { error: "Öneri panosu şu an kapalı." };
    const votes = await setFeatureRequestVote({ tenantId: gate.tenantId, userId: gate.userId, requestId, on: Boolean(on) });
    revalidatePath(BOARD_PATH);
    return { ok: true, votes };
  } catch (e) {
    return { error: actionErrorMessage(e, "Oy kaydedilemedi") };
  }
}

/** İstemci anketi ekrana getirdi: gösterim yazılır (sıklık sınırı DB'de de uygulanır). Null = gösterme. */
export async function recordNpsShown(surveyId: string): Promise<{ responseId: string | null }> {
  const gate = await requireActiveTenant();
  if (!gate.ok || gate.impersonating || !UUID_RE.test(surveyId)) return { responseId: null };
  const rl = await checkRateLimit(`nps-shown:${gate.userId}`, { limit: 20, windowSec: 3600, failurePolicy: "deny" });
  if (!rl.allowed) return { responseId: null };
  try {
    const plan = await tenantPlanOf(gate.tenantId);
    return { responseId: await markNpsShown({ surveyId, tenantId: gate.tenantId, userId: gate.userId, role: gate.role, plan }) };
  } catch {
    return { responseId: null };
  }
}

export async function submitNpsAnswer(input: { responseId: string; score: number; comment?: string }): Promise<FeedbackResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda yanıt verilemez." };
  if (!UUID_RE.test(input.responseId)) return { error: "Geçersiz anket." };
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) return { error: "Puan 0 ile 10 arasında olmalı." };
  const comment = (input.comment ?? "").trim();
  if (comment.length > 1000) return { error: "Yorum en fazla 1000 karakter olabilir." };
  try {
    const ok = await answerNps({ responseId: input.responseId, userId: gate.userId, score, comment: comment || null });
    return ok ? { ok: true } : { error: "Bu anket zaten yanıtlanmış." };
  } catch (e) {
    return { error: actionErrorMessage(e, "Yanıt kaydedilemedi") };
  }
}

export async function dismissNpsPrompt(responseId: string): Promise<FeedbackResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok || gate.impersonating || !UUID_RE.test(responseId)) return { ok: true };
  await dismissNps({ responseId, userId: gate.userId }).catch(() => undefined);
  return { ok: true };
}
