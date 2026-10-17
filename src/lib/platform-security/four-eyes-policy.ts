/**
 * DG1 dört göz onayı (SAF parça; DB yok, istemci güvenli): kritik işlem türleri, ayar anahtarları, eşik kuralı,
 * talep yükü (form alanı beyaz listesi) ve onay/ret yetki kontrolü. Sunucu akışı `four-eyes.ts`, eylemler
 * `src/app/actions/platform-approvals.ts`, ekran `/admin/onaylar`.
 *
 * Akış: işlemi başlatan personel (kendi yetkisi + doğrulayıcı kodu ile) işlemi gönderir → ayar eşiği aşılırsa işlem
 * YÜRÜMEZ, `platform_approval_requests` satırı açılır → aynı modülde `approve` yetkisi olan BAŞKA bir personel kendi
 * koduyla onaylar → kayıtlı yük ile ASIL eylem onaylayan adına yürür. Talep eden onaylayamaz (burada + DB CHECK).
 */
import { baseRoleOf, platformCan, type PlatformAccessSubject, type PlatformModule } from "@/lib/platform-access";
import type { StepUpAction } from "./step-up-policy";

/**
 * `mode`:
 *  - "execute": onaylayan, kayıtlı yükle ASIL eylemi kendi adına yürütür (iade, kredi, ofis kapatma, rol).
 *  - "grant" (hassas admin işlemleri, 2026-10): onay bir İZİNdir. Talep eden işlemi yeniden başlattığında aynı yükle
 *    eşleşen onaylı talep DB'de tek seferlik tüketilir (`platform_consume_approval`: approved → executed) ve işlem
 *    talep edenin adıyla yürür. Ofise giriş gibi yalnız talep edenin oturumunda anlamlı işlemler bu yüzden desteklenir.
 * `superAdminApprover`: karar yalnız (talep edenden farklı) süper admindir; DB tüketimi de onaylayanın süper admin olduğunu
 * yeniden denetler.
 */
export const FOUR_EYES_KINDS = {
  refund: { label: "İade", module: "billing", stepUp: "refund", entityType: "invoice", mode: "execute", superAdminApprover: false },
  credit_grant: { label: "Hesap kredisi verme", module: "billing", stepUp: "credit_grant", entityType: "tenant", mode: "execute", superAdminApprover: false },
  office_close: { label: "Ofis kapatma / askıya alma", module: "tenants", stepUp: "office_close", entityType: "tenant", mode: "execute", superAdminApprover: false },
  staff_role: { label: "Personel rol değişikliği", module: "personel", stepUp: "staff_role", entityType: "platform_staff", mode: "execute", superAdminApprover: false },
  session_revoke: { label: "Oturum kapatma", module: "members", stepUp: "session_revoke", entityType: "profile", mode: "grant", superAdminApprover: true },
  flag_change: { label: "Ofis bazında bayrak değişikliği", module: "sistem", stepUp: "flag_change", entityType: "tenant_flag", mode: "grant", superAdminApprover: true },
  queue_requeue: { label: "Kuyruk işini yeniden deneme", module: "sistem", stepUp: "queue_requeue", entityType: "queue", mode: "grant", superAdminApprover: true },
  demo_data: { label: "Demo verisi (zorla temizleme / yeniden yükleme / sıfırlama)", module: "tenants", stepUp: "demo_data", entityType: "tenant", mode: "grant", superAdminApprover: true },
  impersonation: { label: "Ofise destek erişimi", module: "tenants", stepUp: "impersonation", entityType: "tenant", mode: "grant", superAdminApprover: true },
} as const satisfies Record<
  string,
  { label: string; module: PlatformModule; stepUp: StepUpAction; entityType: string; mode: "execute" | "grant"; superAdminApprover: boolean }
>;

export type FourEyesKind = keyof typeof FOUR_EYES_KINDS;
export const FOUR_EYES_KIND_LIST = Object.keys(FOUR_EYES_KINDS) as FourEyesKind[];

/** Hassas admin işlemleri (izin modeli). */
export type SensitiveFourEyesKind = "session_revoke" | "flag_change" | "queue_requeue" | "demo_data" | "impersonation";
export const SENSITIVE_FOUR_EYES_KINDS: readonly SensitiveFourEyesKind[] = ["session_revoke", "flag_change", "queue_requeue", "demo_data", "impersonation"];

export function isGrantKind(kind: FourEyesKind): kind is SensitiveFourEyesKind {
  return FOUR_EYES_KINDS[kind].mode === "grant";
}

export function isFourEyesKind(v: unknown): v is FourEyesKind {
  return typeof v === "string" && v in FOUR_EYES_KINDS;
}

/** Ayar anahtarları (platform_settings; registry: src/lib/settings/registry/four-eyes.ts). */
export const FOUR_EYES_KEYS = {
  refundThreshold: "platform.four_eyes_refund_threshold_try",
  creditThreshold: "platform.four_eyes_credit_threshold_try",
  officeClose: "platform.four_eyes_office_close",
  staffRole: "platform.four_eyes_staff_role",
  expiryHours: "platform.four_eyes_expiry_hours",
} as const;

/** "Hassas işlemlerde dört göz onayı" ayar anahtarları (işlem başına; hepsi varsayılan KAPALI). */
export const SENSITIVE_FOUR_EYES_KEYS: Record<SensitiveFourEyesKind, string> = {
  session_revoke: "platform.four_eyes_session_revoke",
  flag_change: "platform.four_eyes_flag_change",
  queue_requeue: "platform.four_eyes_queue_requeue",
  demo_data: "platform.four_eyes_demo_data",
  impersonation: "platform.four_eyes_impersonation",
};

export type FourEyesConfig = {
  /** TL; 0 = kapalı. Bu tutar ve üstü iade ikinci onaya düşer. */
  refundThresholdTry: number;
  /** TL; 0 = kapalı. Bu tutar ve üstü hesap kredisi ikinci onaya düşer. */
  creditThresholdTry: number;
  officeClose: boolean;
  staffRole: boolean;
  /** Bekleyen talebin geçerlilik süresi (saat). */
  expiryHours: number;
  /** Hassas admin işlemleri: açıksa işlem başka bir süper adminin onayıyla (tek seferlik izin) yürür. */
  sensitive: Record<SensitiveFourEyesKind, boolean>;
};

/** Varsayılan: HEPSİ KAPALI (mevcut personel davranışı değişmez; sahip Ayar merkezinden açar). */
export const FOUR_EYES_DEFAULTS: FourEyesConfig = {
  refundThresholdTry: 0,
  creditThresholdTry: 0,
  officeClose: false,
  staffRole: false,
  expiryHours: 72,
  sensitive: { session_revoke: false, flag_change: false, queue_requeue: false, demo_data: false, impersonation: false },
};

/** İşlem ikinci onaya düşer mi? Tutar eşiği "eşit ve üstü"; eşik 0 = kapalı. */
export function fourEyesRequired(kind: FourEyesKind, cfg: FourEyesConfig, amountTry?: number | null): boolean {
  switch (kind) {
    case "refund":
      return cfg.refundThresholdTry > 0 && Number(amountTry ?? 0) >= cfg.refundThresholdTry;
    case "credit_grant":
      return cfg.creditThresholdTry > 0 && Number(amountTry ?? 0) >= cfg.creditThresholdTry;
    case "office_close":
      return cfg.officeClose;
    case "staff_role":
      return cfg.staffRole;
    case "session_revoke":
    case "flag_change":
    case "queue_requeue":
    case "demo_data":
    case "impersonation":
      return cfg.sensitive[kind] === true;
    default:
      return false;
  }
}

/**
 * Talep yükü: yalnız bu alanlar saklanır ve onayda asıl eyleme geri verilir. Doğrulayıcı kodu (`step_up_code`)
 * ASLA saklanmaz (onaylayan kendi kodunu girer).
 */
export const FOUR_EYES_FIELDS: Record<FourEyesKind, readonly string[]> = {
  refund: ["invoice_id", "amount_try", "reason"],
  credit_grant: ["tenant_id", "amount", "reason", "request_id", "kind", "expires_on"],
  office_close: ["id", "mode", "reason", "confirm_name", "target_status"],
  staff_role: ["id", "role"],
  // İzin modeli: yük = işlemi BAĞLAYAN alanlar (onaylanan işlemden farklı bir işlem izni tüketemez). Gerekçe özettedir.
  session_revoke: ["id", "session_id"],
  flag_change: ["flag_key", "tenant_id", "include"],
  queue_requeue: ["queue", "id"],
  demo_data: ["op", "id", "pack"],
  impersonation: ["tenant_id", "ticket_id"],
};

type FormLike = { get(key: string): FormDataEntryValue | null };

export function payloadFromForm(kind: FourEyesKind, fd: FormLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FOUR_EYES_FIELDS[kind]) {
    const v = fd.get(key);
    if (typeof v === "string" && v !== "") out[key] = v.slice(0, 1000);
  }
  return out;
}

export function formFromPayload(kind: FourEyesKind, payload: unknown): FormData {
  const fd = new FormData();
  const src = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  for (const key of FOUR_EYES_FIELDS[kind]) {
    const v = src[key];
    if (typeof v === "string") fd.set(key, v);
  }
  return fd;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "executed" | "failed";

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus | "expired", string> = {
  pending: "Onay bekliyor",
  approved: "Onaylandı (yürütülüyor)",
  rejected: "Reddedildi",
  cancelled: "Geri çekildi",
  executed: "Onaylandı ve yürütüldü",
  failed: "Onaylandı, yürütme başarısız",
  expired: "Süresi doldu",
};

export type ApprovalRowLite = {
  kind: string;
  module: string;
  status: string;
  requested_by: string | null;
  expires_at: string;
};

export function approvalExpired(row: Pick<ApprovalRowLite, "status" | "expires_at">, nowMs: number): boolean {
  return row.status === "pending" && new Date(row.expires_at).getTime() <= nowMs;
}

/** Ekranda gösterilen durum (süresi dolmuş bekleyen = "expired"). */
export function approvalDisplayStatus(row: Pick<ApprovalRowLite, "status" | "expires_at">, nowMs: number): ApprovalStatus | "expired" {
  return approvalExpired(row, nowMs) ? "expired" : (row.status as ApprovalStatus);
}

export type DecisionCheck = { ok: true } | { ok: false; error: string };

/**
 * Onay/ret yetkisi: bekleyen + süresi geçmemiş talep, talep eden DEĞİL, talebin modülünde `approve`.
 * Geri çekme (cancel) yalnız talep edenin işidir.
 */
export function checkDecision(
  row: ApprovalRowLite,
  actorId: string,
  subject: PlatformAccessSubject,
  op: "approve" | "reject" | "cancel",
  nowMs: number,
): DecisionCheck {
  if (!isFourEyesKind(row.kind)) return { ok: false, error: "Bilinmeyen talep türü." };
  if (row.status !== "pending") return { ok: false, error: "Talep zaten sonuçlanmış." };
  if (approvalExpired(row, nowMs)) return { ok: false, error: "Talebin süresi doldu; işlemi yeniden başlatın." };
  if (op === "cancel") {
    return row.requested_by === actorId ? { ok: true } : { ok: false, error: "Talebi yalnız açan personel geri çekebilir." };
  }
  // Talep eden kaydı silinmişse (requested_by null) kimin açtığı doğrulanamaz: karar verilmez.
  if (!row.requested_by || row.requested_by === actorId) {
    return { ok: false, error: "Kendi talebinizi onaylayamaz ya da reddedemezsiniz; başka bir yetkili karar vermeli." };
  }
  if (!canDecideKind(subject, row.kind)) {
    return { ok: false, error: FOUR_EYES_KINDS[row.kind].superAdminApprover ? "Bu talebi yalnız başka bir süper admin onaylayabilir." : "Bu talebe karar verme yetkiniz yok." };
  }
  return { ok: true };
}

/** Tür bazında karar yetkisi: modülde "onayla"; hassas türlerde ayrıca süper admin (özel rol taşımayan). */
export function canDecideKind(subject: PlatformAccessSubject, kind: FourEyesKind): boolean {
  const spec = FOUR_EYES_KINDS[kind];
  if (spec.superAdminApprover) {
    if (baseRoleOf(subject) !== "super_admin") return false;
    if (typeof subject !== "string" && subject.customRole) return false;
  }
  return platformCan(subject, spec.module, "approve");
}

/** Personelin karar verebildiği talep türleri (kuyruk süzgeci ve rozet sayısı). */
export function decidableKinds(subject: PlatformAccessSubject): FourEyesKind[] {
  return FOUR_EYES_KIND_LIST.filter((k) => canDecideKind(subject, k));
}

/** Ekrandaki durum etiketi: izin türlerinde "onaylandı" = talep edenin kullanmasını bekler; "yürütüldü" = kullanıldı. */
export function approvalStatusLabel(row: Pick<ApprovalRowLite, "kind" | "status" | "expires_at">, nowMs: number): string {
  const status = approvalDisplayStatus(row, nowMs);
  if (isFourEyesKind(row.kind) && isGrantKind(row.kind)) {
    if (status === "approved") {
      return new Date(row.expires_at).getTime() <= nowMs ? "Onaylandı, kullanılmadan süresi doldu" : "Onaylandı (talep edenin kullanmasını bekliyor)";
    }
    if (status === "executed") return "Onaylandı ve kullanıldı";
  }
  return APPROVAL_STATUS_LABELS[status];
}
