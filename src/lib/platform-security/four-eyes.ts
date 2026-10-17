import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/read";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { staffFromRow, type StaffRowWithRole } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { now } from "@/lib/clock";
import { requireStepUp, type StepUpAction, type StepUpResult } from "./step-up";
import {
  canDecideKind,
  FOUR_EYES_DEFAULTS,
  FOUR_EYES_KEYS,
  FOUR_EYES_KINDS,
  SENSITIVE_FOUR_EYES_KEYS,
  SENSITIVE_FOUR_EYES_KINDS,
  fourEyesRequired,
  payloadFromForm,
  type FourEyesConfig,
  type FourEyesKind,
  type SensitiveFourEyesKind,
} from "./four-eyes-policy";

export * from "./four-eyes-policy";

/**
 * DG1 dört göz onayı — sunucu akışı. Asıl kritik eylem (iade, kredi, ofis kapatma, rol değişikliği) iki noktada bu
 * modüle sorar:
 *   1) `requireStepUpOrApproved`: onaylı yürütmede onaylayan kodunu onay ekranında girdi; eylem kodu ikinci kez istemez.
 *   2) `fourEyesGate`: eşik/ayar ikinci onay istiyorsa işlem YÜRÜMEZ, talep açılır ve `{ queued }` döner.
 * Onaylı yürütme bağlamı sunucu içi `AsyncLocalStorage`'dır: istemci bu bağlamı form alanıyla taklit EDEMEZ.
 */

type ApprovalExecution = { requestId: string; kind: FourEyesKind; requestedBy: string | null; approverId: string };
const executionStore = new AsyncLocalStorage<ApprovalExecution>();

export function currentApprovalExecution(): ApprovalExecution | null {
  return executionStore.getStore() ?? null;
}

/** Onaylanmış talebin asıl eylemini onaylayan adına yürütür (yalnız `platform-approvals.ts` çağırır). */
export function runApprovedExecution<T>(ctx: ApprovalExecution, fn: () => Promise<T>): Promise<T> {
  return executionStore.run(ctx, fn);
}

const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

/** Ayarlar (Ayar merkezi > Güvenlik). Okunamazsa varsayılan: KAPALI (eski davranış). */
export async function readFourEyesConfig(): Promise<FourEyesConfig> {
  try {
    const raw = await getSettings([...Object.values(FOUR_EYES_KEYS), ...Object.values(SENSITIVE_FOUR_EYES_KEYS)]);
    const sensitive = { ...FOUR_EYES_DEFAULTS.sensitive };
    for (const k of SENSITIVE_FOUR_EYES_KINDS) sensitive[k] = bool(raw[SENSITIVE_FOUR_EYES_KEYS[k]], FOUR_EYES_DEFAULTS.sensitive[k]);
    return {
      sensitive,
      refundThresholdTry: num(raw[FOUR_EYES_KEYS.refundThreshold], FOUR_EYES_DEFAULTS.refundThresholdTry),
      creditThresholdTry: num(raw[FOUR_EYES_KEYS.creditThreshold], FOUR_EYES_DEFAULTS.creditThresholdTry),
      officeClose: bool(raw[FOUR_EYES_KEYS.officeClose], FOUR_EYES_DEFAULTS.officeClose),
      staffRole: bool(raw[FOUR_EYES_KEYS.staffRole], FOUR_EYES_DEFAULTS.staffRole),
      expiryHours: num(raw[FOUR_EYES_KEYS.expiryHours], FOUR_EYES_DEFAULTS.expiryHours),
    };
  } catch (e) {
    console.error("readFourEyesConfig", e instanceof Error ? e.message : e);
    return FOUR_EYES_DEFAULTS;
  }
}

export const OFFICE_CLOSE_QUEUE_ONLY =
  "Dört göz onayı açık: ofisi askıya alma ya da arşivleme Ofis 360 > Yönetim'den ikinci onaya gönderilir.";

/**
 * Dört göz ofis kapatma açıkken KUYRUĞU OLMAYAN yan yollar (tekil/toplu durum değişikliği, abonelik konsolu, hemen
 * iptal) ofisi tek imzayla kapatamaz; aksi halde kontrol bu yollardan atlanırdı. Onaylı yürütmenin içinde serbest.
 */
export async function officeCloseBlockedOutsideQueue(): Promise<boolean> {
  if (currentApprovalExecution()?.kind === "office_close") return false;
  return (await readFourEyesConfig()).officeClose;
}

/** Kritik işlem kodu: onaylı yürütmede (aynı tür, aynı onaylayan) atlanır; diğer her durumda AD11 `requireStepUp`. */
export async function requireStepUpOrApproved(
  input: FormData | { code?: unknown },
  action: StepUpAction,
  staffId: string,
): Promise<StepUpResult> {
  const ctx = currentApprovalExecution();
  if (ctx && ctx.approverId === staffId && FOUR_EYES_KINDS[ctx.kind].stepUp === action) return { ok: true };
  return requireStepUp(input, action, staffId);
}

export type FourEyesGateResult = { proceed: true } | { proceed: false; queued: true; notice: string } | { proceed: false; error: string };

const SCHEMA_PENDING = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

/**
 * Asıl eylemin doğrulamaları (yetki, kod, tutar) geçtikten SONRA, ilk yazımdan ÖNCE çağrılır.
 * Onaylı yürütmenin içindeyse (aynı tür + aynı onaylayan) işlem yürür. Aksi halde ayar ikinci onay istiyorsa talep
 * açılır, onay yetkilileri bildirilir ve işlem yürümez. Kuyruk yazılamazsa işlem de YÜRÜMEZ (sessizce tek imza yok).
 */
export async function fourEyesGate(opts: {
  kind: FourEyesKind;
  staffId: string;
  form: { get(key: string): FormDataEntryValue | null };
  entityId: string;
  amountTry?: number | null;
  summary: string;
}): Promise<FourEyesGateResult> {
  const ctx = currentApprovalExecution();
  if (ctx && ctx.kind === opts.kind && ctx.approverId === opts.staffId) return { proceed: true };

  const cfg = await readFourEyesConfig();
  if (!fourEyesRequired(opts.kind, cfg, opts.amountTry)) return { proceed: true };

  const spec = FOUR_EYES_KINDS[opts.kind];
  const admin = createAdminClient();
  const nowMs = now();
  const stamp = new Date(nowMs).toISOString();
  // Süresi dolmuş bekleyen talep aynı kayıt için yenisini engellemesin: geri çekildi sayılır (karar yok).
  await admin
    .from("platform_approval_requests")
    .update({ status: "cancelled", decided_at: stamp, decision_note: "Süresi doldu." })
    .eq("kind", opts.kind)
    .eq("entity_type", spec.entityType)
    .eq("entity_id", opts.entityId)
    .eq("status", "pending")
    .lte("expires_at", stamp);

  const { data, error } = await admin
    .from("platform_approval_requests")
    .insert({
      kind: opts.kind,
      module: spec.module,
      entity_type: spec.entityType,
      entity_id: opts.entityId,
      amount_try: opts.amountTry ?? null,
      summary: opts.summary.slice(0, 300),
      payload: payloadFromForm(opts.kind, opts.form),
      requested_by: opts.staffId,
      expires_at: new Date(nowMs + cfg.expiryHours * 3_600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return { proceed: false, queued: true, notice: "Bu kayıt için zaten onay bekleyen bir talep var (Kontrol paneli > Onaylar)." };
    }
    if (SCHEMA_PENDING.has(error?.code ?? "")) {
      return { proceed: false, error: "Dört göz onayı açık ama onay kuyruğu henüz kurulmadı (veritabanı güncellemesi bekliyor); işlem yapılmadı." };
    }
    console.error("fourEyesGate insert", error?.code);
    return { proceed: false, error: "Onay talebi oluşturulamadı; işlem yapılmadı. Tekrar deneyin." };
  }

  await logPlatformActivity({
    actorId: opts.staffId,
    action: "platform.approval.requested",
    entityType: "platform_approval_request",
    entityId: data.id as string,
    meta: { kind: opts.kind, entity_type: spec.entityType, entity_id: opts.entityId, amount_try: opts.amountTry ?? null },
  });
  await notifyApprovers(opts.kind, opts.staffId, opts.summary).catch(() => undefined);
  return {
    proceed: false,
    queued: true,
    notice: `${spec.label} ikinci onaya gönderildi. Başka bir yetkili Kontrol paneli > Onaylar ekranından onaylayınca yürür.`,
  };
}

/** Talebe karar verebilecek (modülde approve, talep eden hariç) aktif personele bildirim. */
async function notifyApprovers(kind: FourEyesKind, requesterId: string, summary: string): Promise<void> {
  const admin = createAdminClient();
  const spec = FOUR_EYES_KINDS[kind];
  const withRole = await admin
    .from("platform_staff")
    .select("id, email, full_name, role, is_active, custom_role_id, custom_role:platform_custom_roles!platform_staff_custom_role_id_fkey(id, label, base_role, permissions)")
    .eq("is_active", true);
  const rows = (withRole.data ?? []) as unknown as StaffRowWithRole[];
  const targets = rows
    .map(staffFromRow)
    .filter((s) => s.id !== requesterId && (spec.superAdminApprover ? canDecideKind(s, kind) : platformCan(s, spec.module, "approve")))
    .map((s) => s.id);
  for (const staffId of targets) {
    await notifyPlatformStaff({
      staffId,
      title: `Onay bekleyen işlem: ${spec.label}`,
      body: summary.slice(0, 200),
      href: "/admin/onaylar",
      kind: "warning",
      meta: { kind },
    });
  }
}

// ---------------------------------------------------------------------------
// Hassas admin işlemleri: izin modeli (tek seferlik tüketim)
// ---------------------------------------------------------------------------

export type SensitiveGateResult =
  | { proceed: true; approvalId: string | null }
  | { proceed: false; queued: true; notice: string }
  | { proceed: false; error: string };

/** Dört göz izni bekleyen işlemin kullanıcıya dönen ortak metni (talep açıldı / zaten bekliyor). */
export const SENSITIVE_QUEUED_HINT = "Başka bir süper admin Kontrol paneli > Onaylar ekranından onaylayınca işlemi aynı bilgilerle yeniden başlatın; onay bir kez kullanılır.";

/**
 * Hassas admin işlemi (oturum kapatma, ofis bayrağı, kuyruk yeniden deneme, demo verisi, ofise giriş) kapısı. Asıl eylemin
 * yetki + gerekçe + doğrulayıcı kodu kontrollerinden SONRA, ilk yazımdan ÖNCE çağrılır.
 *  - Ayar kapalıysa: işlem yürür (`approvalId: null`).
 *  - Ayar açık ve aynı personelin aynı yükle (`binding`) ONAYLANMIŞ talebi varsa: DB'de tek seferlik tüketilir
 *    (`platform_consume_approval`, approved → executed) ve işlem yürür. İkinci deneme yeniden talep açar.
 *  - Aksi halde bekleyen talep açılır, süper adminler bildirilir, işlem YÜRÜMEZ.
 * Her adım platform denetim izine yazılır (requested / consumed; onay/ret/geri çekme Onaylar eylemlerindedir).
 * Kuyruk yazılamaz ya da tüketim fonksiyonu yoksa işlem YÜRÜMEZ (sessizce tek imza yok).
 */
export async function sensitiveFourEyesGate(opts: {
  kind: SensitiveFourEyesKind;
  staffId: string;
  entityType?: string;
  entityId: string;
  binding: Record<string, string>;
  summary: string;
}): Promise<SensitiveGateResult> {
  const cfg = await readFourEyesConfig();
  if (!fourEyesRequired(opts.kind, cfg)) return { proceed: true, approvalId: null };

  const spec = FOUR_EYES_KINDS[opts.kind];
  const entityType = opts.entityType ?? spec.entityType;
  const entityId = opts.entityId.slice(0, 80);
  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.binding)) if (typeof v === "string" && v !== "") payload[k] = v.slice(0, 300);

  const admin = createAdminClient();
  const consumed = await admin.rpc("platform_consume_approval", {
    p_kind: opts.kind,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_staff_id: opts.staffId,
    p_payload: payload,
  });
  if (consumed.error) {
    if (SCHEMA_PENDING.has(consumed.error.code ?? "") || consumed.error.code === "PGRST202" || consumed.error.code === "42883") {
      return { proceed: false, error: "Dört göz onayı açık ama onay izni fonksiyonu henüz kurulmadı (veritabanı güncellemesi bekliyor); işlem yapılmadı." };
    }
    console.error("sensitiveFourEyesGate consume", consumed.error.code);
    return { proceed: false, error: "Onay izni denetlenemedi; işlem yapılmadı. Tekrar deneyin." };
  }
  const approvalId = typeof consumed.data === "string" && consumed.data ? consumed.data : null;
  if (approvalId) {
    await logPlatformActivity({
      actorId: opts.staffId,
      action: "platform.approval.consumed",
      entityType: "platform_approval_request",
      entityId: approvalId,
      meta: { kind: opts.kind, entity_type: entityType, entity_id: entityId },
    });
    return { proceed: true, approvalId };
  }

  const nowMs = now();
  const stamp = new Date(nowMs).toISOString();
  await admin
    .from("platform_approval_requests")
    .update({ status: "cancelled", decided_at: stamp, decision_note: "Süresi doldu." })
    .eq("kind", opts.kind)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("status", "pending")
    .lte("expires_at", stamp);

  const { data, error } = await admin
    .from("platform_approval_requests")
    .insert({
      kind: opts.kind,
      module: spec.module,
      entity_type: entityType,
      entity_id: entityId,
      amount_try: null,
      summary: opts.summary.slice(0, 300),
      payload,
      requested_by: opts.staffId,
      expires_at: new Date(nowMs + cfg.expiryHours * 3_600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return { proceed: false, queued: true, notice: `Bu kayıt için zaten onay bekleyen bir talep var (Kontrol paneli > Onaylar). ${SENSITIVE_QUEUED_HINT}` };
    }
    if (SCHEMA_PENDING.has(error?.code ?? "") || error?.code === "23514") {
      return { proceed: false, error: "Dört göz onayı açık ama onay kuyruğu bu işlem türü için henüz kurulmadı (veritabanı güncellemesi bekliyor); işlem yapılmadı." };
    }
    console.error("sensitiveFourEyesGate insert", error?.code);
    return { proceed: false, error: "Onay talebi oluşturulamadı; işlem yapılmadı. Tekrar deneyin." };
  }

  await logPlatformActivity({
    actorId: opts.staffId,
    action: "platform.approval.requested",
    entityType: "platform_approval_request",
    entityId: data.id as string,
    meta: { kind: opts.kind, entity_type: entityType, entity_id: entityId, binding: payload },
  });
  await notifyApprovers(opts.kind, opts.staffId, opts.summary).catch(() => undefined);
  return { proceed: false, queued: true, notice: `${spec.label} ikinci onaya gönderildi. ${SENSITIVE_QUEUED_HINT}` };
}

/** Dört göz açıkken kuyruğu olmayan toplu yol (ör. toplu oturum kapatma) tek imzayla yürümez. */
export async function sensitiveBulkBlocked(kind: SensitiveFourEyesKind): Promise<boolean> {
  return fourEyesRequired(kind, await readFourEyesConfig());
}
