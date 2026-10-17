"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { requireStepUp } from "@/lib/platform-security/step-up";
import {
  FOUR_EYES_KINDS,
  checkDecision,
  formFromPayload,
  isFourEyesKind,
  isGrantKind,
  runApprovedExecution,
  type FourEyesKind,
} from "@/lib/platform-security/four-eyes";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { recordInvoiceRefund } from "@/app/actions/platform-billing";
import { grantAccountCredit } from "@/app/actions/admin-account-credit";
import { setTenantLifecycleByAdmin } from "@/app/actions/platform-tenants";
import { updateStaffRole } from "@/app/actions/platform-staff";

/**
 * DG1 dört göz kuyruğu kararları (Kontrol paneli > Onaylar).
 *  - Onayla: talep eden DEĞİL + talebin modülünde "onayla" yetkisi + kendi doğrulayıcı kodu. Talep koşullu güncellemeyle
 *    sahiplenilir (çift tıklama/iki onaylayan aynı talebi iki kez yürütemez), ardından kayıtlı yükle ASIL eylem onaylayan
 *    adına yürür (asıl eylemin tüm kapıları yeniden çalışır). Sonuç talebe yazılır (executed / failed).
 *  - Reddet: aynı yetki kuralı + gerekçe. Geri çek: yalnız talebi açan.
 * Her karar platform denetim izine yazılır (platform.approval.*).
 *
 * Kapı istisnası (bilinçli): eylemler `requirePlatformStaff` ile açılır, modül kapısı talep satırı okunduktan SONRA
 * `checkDecision` içinde uygulanır (talebin modülünde "onayla"; geri çekmede yalnız talebi açan). Modül talebe göre
 * değiştiği için girişte tek bir `requirePlatformModule` çağrısı yazılamaz; asıl eylem ayrıca kendi kapılarından geçer.
 */

export type ApprovalActionResult = { ok?: boolean; error?: string; notice?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = "id, kind, module, entity_type, entity_id, amount_try, summary, payload, status, requested_by, expires_at";

type ExecResult = { ok?: boolean; error?: string; notice?: string; message?: string };

/**
 * Talep türü → asıl eylem (yükü FormData olarak alır). İzin türleri (hassas admin işlemleri: `mode: "grant"`) burada
 * YOKTUR: onay yalnız izni açar, işlem talep edenin yeniden başlatmasıyla tek seferlik tüketilerek yürür.
 */
const EXECUTORS: Partial<Record<FourEyesKind, (fd: FormData) => Promise<ExecResult>>> = {
  refund: recordInvoiceRefund,
  credit_grant: grantAccountCredit,
  office_close: setTenantLifecycleByAdmin,
  staff_role: updateStaffRole,
};

async function rateLimited(staffId: string): Promise<boolean> {
  const { allowed } = await checkRateLimit(`platform-approval:${staffId}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  return !allowed;
}

function refresh() {
  revalidatePath("/admin/onaylar");
}

export async function approvePlatformRequest(fd: FormData): Promise<ApprovalActionResult> {
  const staff = await requirePlatformStaff();
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz talep." };
  if (await rateLimited(staff.id)) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;

  const admin = createAdminClient();
  const { data: row } = await admin.from("platform_approval_requests").select(SELECT).eq("id", id).maybeSingle();
  if (!row) return { error: "Talep bulunamadı." };
  const check = checkDecision(row, staff.id, staff, "approve", now());
  if (!check.ok) return { error: check.error };
  if (!isFourEyesKind(row.kind)) return { error: "Bilinmeyen talep türü." };
  const kind: FourEyesKind = row.kind;

  // Onaylayan kendi doğrulayıcı koduyla onaylar (talep edenin kodu yük içinde SAKLANMAZ).
  const su = await requireStepUp(fd, FOUR_EYES_KINDS[kind].stepUp, staff.id);
  if (!su.ok) return { error: su.error };

  const stamp = new Date(now()).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("platform_approval_requests")
    .update({ status: "approved", decided_by: staff.id, decided_at: stamp, decision_note: note })
    .eq("id", id)
    .eq("status", "pending")
    .neq("requested_by", staff.id)
    .gt("expires_at", stamp)
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) return { error: "Talep bu arada sonuçlandırıldı ya da süresi doldu." };
  await logPlatformActivity({
    actorId: staff.id,
    action: "platform.approval.approved",
    entityType: "platform_approval_request",
    entityId: id,
    meta: { kind, requested_by: row.requested_by, entity_type: row.entity_type, entity_id: row.entity_id, amount_try: row.amount_try, note, mode: FOUR_EYES_KINDS[kind].mode },
  });

  // İzin türü: işlem burada yürümez; talep eden aynı işlemi yeniden başlatınca izin bir kez tüketilir.
  if (isGrantKind(kind)) {
    if (row.requested_by) {
      await notifyPlatformStaff({
        staffId: row.requested_by,
        title: `Onaylandı: ${FOUR_EYES_KINDS[kind].label}`,
        body: `${String(row.summary).slice(0, 160)} — işlemi aynı bilgilerle yeniden başlatın; onay bir kez kullanılır.`,
        href: "/admin/onaylar?durum=benim",
        kind: "info",
        meta: { kind, approval_id: id },
      }).catch(() => undefined);
    }
    refresh();
    return { ok: true, notice: `${FOUR_EYES_KINDS[kind].label} onaylandı. Talep eden işlemi yeniden başlattığında bir kez yürür.` };
  }

  const executor = EXECUTORS[kind];
  if (!executor) {
    await finish(admin, id, staff.id, kind, "Bu talep türünün yürütücüsü yok.");
    refresh();
    return { error: "Onaylandı ancak işlem yürütülemedi: bu talep türünün yürütücüsü yok." };
  }

  let result: ExecResult;
  try {
    result = await runApprovedExecution({ requestId: id, kind, requestedBy: row.requested_by, approverId: staff.id }, () =>
      executor(formFromPayload(kind, row.payload)),
    );
  } catch (err) {
    // Asıl eylem yönlendirdiyse (yetki kapısı) ya da patladıysa talep "başarısız" kalır; yönlendirme yine uygulanır.
    await finish(admin, id, staff.id, kind, "Asıl işlem yetki kapısında durdu ya da hata verdi.");
    unstable_rethrow(err);
    return { error: "Onaylandı ancak işlem yürütülemedi." };
  }
  if (result.error) {
    await finish(admin, id, staff.id, kind, result.error);
    refresh();
    return { error: `Onaylandı ancak işlem yürütülemedi: ${result.error}` };
  }
  await finish(admin, id, staff.id, kind, null);
  refresh();
  return { ok: true, notice: result.notice ?? result.message ?? `${FOUR_EYES_KINDS[kind].label} onaylandı ve yürütüldü.` };
}

async function finish(admin: ReturnType<typeof createAdminClient>, id: string, staffId: string, kind: FourEyesKind, error: string | null) {
  const stamp = new Date(now()).toISOString();
  await admin
    .from("platform_approval_requests")
    .update(error ? { status: "failed", result_error: error.slice(0, 500) } : { status: "executed", executed_at: stamp })
    .eq("id", id)
    .eq("status", "approved");
  await logPlatformActivity({
    actorId: staffId,
    action: error ? "platform.approval.failed" : "platform.approval.executed",
    entityType: "platform_approval_request",
    entityId: id,
    meta: { kind, ...(error ? { error: error.slice(0, 300) } : {}) },
  });
}

export async function rejectPlatformRequest(fd: FormData): Promise<ApprovalActionResult> {
  const staff = await requirePlatformStaff();
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz talep." };
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  if (note.length < 3) return { error: "Ret gerekçesi yazın (en az 3 karakter)." };
  if (await rateLimited(staff.id)) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: row } = await admin.from("platform_approval_requests").select(SELECT).eq("id", id).maybeSingle();
  if (!row) return { error: "Talep bulunamadı." };
  const check = checkDecision(row, staff.id, staff, "reject", now());
  if (!check.ok) return { error: check.error };

  const stamp = new Date(now()).toISOString();
  const { data: done } = await admin
    .from("platform_approval_requests")
    .update({ status: "rejected", decided_by: staff.id, decided_at: stamp, decision_note: note })
    .eq("id", id)
    .eq("status", "pending")
    .neq("requested_by", staff.id)
    .select("id")
    .maybeSingle();
  if (!done) return { error: "Talep bu arada sonuçlandırıldı." };
  await logPlatformActivity({
    actorId: staff.id,
    action: "platform.approval.rejected",
    entityType: "platform_approval_request",
    entityId: id,
    meta: { kind: row.kind, requested_by: row.requested_by, entity_id: row.entity_id, note },
  });
  refresh();
  return { ok: true, notice: "Talep reddedildi; işlem yapılmadı." };
}

export async function cancelPlatformRequest(fd: FormData): Promise<ApprovalActionResult> {
  const staff = await requirePlatformStaff();
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz talep." };
  if (await rateLimited(staff.id)) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: row } = await admin.from("platform_approval_requests").select(SELECT).eq("id", id).maybeSingle();
  if (!row) return { error: "Talep bulunamadı." };
  const check = checkDecision(row, staff.id, staff, "cancel", now());
  if (!check.ok) return { error: check.error };

  const { data: done } = await admin
    .from("platform_approval_requests")
    .update({ status: "cancelled", decided_at: new Date(now()).toISOString(), decision_note: "Talep eden geri çekti." })
    .eq("id", id)
    .eq("status", "pending")
    .eq("requested_by", staff.id)
    .select("id")
    .maybeSingle();
  if (!done) return { error: "Talep bu arada sonuçlandırıldı." };
  await logPlatformActivity({
    actorId: staff.id,
    action: "platform.approval.cancelled",
    entityType: "platform_approval_request",
    entityId: id,
    meta: { kind: row.kind, entity_id: row.entity_id },
  });
  refresh();
  return { ok: true, notice: "Talep geri çekildi." };
}
