/**
 * `access_audit_log` yazıcısı — yalnız DEĞİŞİKLİKLER kaydedilir (aktif kapsam izi/okuma yazılmaz: gürültü yok).
 *
 * İstemci çağırandan gelir (kullanıcı istemcisi: RLS INSERT politikası 20261006000104; cron/rol eşitleme için
 * admin istemci). Satır: kim (created_by), kime (user_id), ne (change_type), önce/sonra (details.before/after),
 * neden (reason). Hata fırlatmaz; sonucu döner — çağıran kritik akışta telafi eder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessAuditChange =
  | "scope_created"
  | "scope_updated"
  | "scope_deleted"
  | "override_created"
  | "override_updated"
  | "override_deleted"
  | "permission_granted"
  | "permission_revoked";

/** Denetim sayfası "İşlem türü" süzgecinde tüm yetki değişikliklerini seçen değer. */
export const ACCESS_TUR = "yetki";
const ACCESS_PREFIX = "yetki.";

/** Yetki değişikliği denetim kodu: `yetki.<change_type>` (HIGH_RISK_ACTIONS ve actionLabel ile aynı kod). */
export function accessActionCode(change: AccessAuditChange): string {
  return `${ACCESS_PREFIX}${change}`;
}

export function isAccessCode(code: string): boolean {
  return code.startsWith(ACCESS_PREFIX);
}

/** `access_audit_log` satırının denetim sayfasına gelen ham hali. */
export type AccessRow = {
  id: string;
  user_id: string;
  change_type: AccessAuditChange;
  details: { before?: unknown; after?: unknown } | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

/** `audit_logs` akışıyla birleşen ortak satır biçimi. */
export type AuditRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  new_value: unknown;
  old_value: unknown;
  created_at: string;
};

/** Yetki satırını genel denetim satırına çevirir (kayıt = yetkisi değişen ekip üyesi; neden varsa "sonra" tarafına eklenir). */
export function accessToAuditRow(r: AccessRow): AuditRow {
  const before = r.details?.before ?? null;
  const after = r.details?.after ?? null;
  const reason = r.reason?.trim();
  const afterWithReason =
    reason && after && typeof after === "object"
      ? { ...(after as Record<string, unknown>), neden: reason }
      : reason
        ? { neden: reason }
        : after;
  return {
    id: `yetki-${r.id}`,
    action: accessActionCode(r.change_type),
    entity_type: "team_member",
    entity_id: r.user_id,
    actor_id: r.created_by,
    old_value: before,
    new_value: afterWithReason,
    created_at: r.created_at,
  };
}

// Özyinelemeli yapısal tip Supabase sorgu oluşturucusunda "excessively deep" hatası verir; bu yüzden düz bir arayüz.
type AccessFilterable = {
  gte(col: string, v: string): unknown;
  lte(col: string, v: string): unknown;
  eq(col: string, v: string): unknown;
  in(col: string, v: string[]): unknown;
};

/**
 * `access_audit_log` sorgusuna denetim süzgeçlerini uygular (tarih, aktör, işlem türü). Risk "yüksek" ve "tür boş"
 * tümünü kapsar (her yetki değişikliği yüksek risk). Metin araması kodla eşleşen yetki türlerine daralır.
 */
export function applyAccessFilters<Q extends object>(
  query: Q,
  f: { from: string; to: string; aktor: string; tur: string },
  changeTypes: string[] | null,
): Q {
  let q = query as unknown as AccessFilterable;
  if (f.from) q = q.gte("created_at", f.from) as AccessFilterable;
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999`) as AccessFilterable;
  if (f.aktor) q = q.eq("created_by", f.aktor) as AccessFilterable;
  if (isAccessCode(f.tur)) q = q.eq("change_type", f.tur.slice(ACCESS_PREFIX.length)) as AccessFilterable;
  else if (changeTypes) q = q.in("change_type", changeTypes) as AccessFilterable;
  return q as unknown as Q;
}

export type AccessAuditInput = {
  tenantId: string;
  /** Yetkisi değişen kullanıcı. */
  subjectUserId: string;
  /** Değişikliği yapan. */
  actorId: string;
  changeType: AccessAuditChange;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason?: string | null;
  /** Ek bağlam (resource_type/resource_id, module vb.). */
  meta?: Record<string, unknown>;
};

export type AccessAuditResult = { ok: true } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export async function recordAccessAudit(db: AnyClient, input: AccessAuditInput): Promise<AccessAuditResult> {
  try {
    const { error } = await db.from("access_audit_log").insert({
      tenant_id: input.tenantId,
      user_id: input.subjectUserId,
      change_type: input.changeType,
      details: { ...(input.meta ?? {}), before: input.before, after: input.after },
      reason: input.reason?.trim() || null,
      created_by: input.actorId,
    });
    if (error) {
      console.error("recordAccessAudit", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("recordAccessAudit", e);
    return { ok: false, error: e instanceof Error ? e.message : "Denetim kaydı yazılamadı." };
  }
}
