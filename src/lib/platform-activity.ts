import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/error-log";

export type PlatformAuditInput = {
  /** Personel kimliği; personel olmayan olaylarda (ör. ofis demo girişi) null. */
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  /** Değişiklik öncesi/sonrası (gizli değer YAZILMAZ; çağıran maskeler). Verilmezse meta.before/meta.after kullanılır. */
  before?: unknown;
  after?: unknown;
};

export type PlatformAuditResult = { ok: boolean };

const RETRY_DELAYS_MS = [0, 150, 500] as const;
const MAX_UA = 400;

/** İsteğin istemci IP'si: Traefik `X-Real-Ip`/`X-Forwarded-For`'u kendisi yazar (istemcinin gönderdiğine güvenmez). */
export function clientIpFrom(h: Pick<Headers, "get">): string | null {
  const raw = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  return raw ? raw.slice(0, 64) : null;
}

async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return { ip: clientIpFrom(h), userAgent: h.get("user-agent")?.slice(0, MAX_UA) || null };
  } catch {
    return { ip: null, userAgent: null }; // istek dışı bağlam (cron/betik)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kolon henüz yok (AD11 migration'ı uygulanmadan önceki yayın): eski kolonlarla yazılır. */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST204" || error.code === "42703"));
}

/**
 * Platform personel işlemlerini platform_audit_logs'a kaydeder (service role; tablo YALNIZ EKLENİR).
 * IP + user agent istekten, önce/sonra değerleri girdiden yazılır. Yazım SESSİZCE KAYBOLMAZ: geçici hatada 3 kez
 * denenir; yine yazılamazsa error_logs'a kaydedilir (`logPlatformActivityChecked` `{ ok: false }` döner). Asıl işlemi durdurmaz (çağıran
 * fail-closed istiyorsa sonucu denetler).
 */
export async function logPlatformActivity(input: PlatformAuditInput): Promise<void> {
  await logPlatformActivityChecked(input);
}

/** `logPlatformActivity` ile aynı; sonucu döner (fail-closed akışlar için). */
export async function logPlatformActivityChecked(input: PlatformAuditInput): Promise<PlatformAuditResult> {
  const ctx = await requestContext();
  const meta = input.meta ?? null;
  const before = input.before !== undefined ? input.before : (meta && "before" in meta ? meta.before : undefined);
  const after = input.after !== undefined ? input.after : (meta && "after" in meta ? meta.after : undefined);
  const base = {
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    meta,
  };
  let row: Record<string, unknown> = {
    ...base,
    ip: ctx.ip,
    user_agent: ctx.userAgent,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
  };

  let lastError = "bilinmeyen hata";
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      const admin = createAdminClient();
      const { error } = await admin.from("platform_audit_logs").insert(row);
      if (!error) return { ok: true };
      lastError = `${error.code ?? ""} ${error.message ?? ""}`.trim();
      if (isMissingColumn(error)) {
        row = base; // eski şema: yeni kolonsuz hemen yeniden dene
        continue;
      }
      // Kalıcı hatalar (yetki, kısıt) tekrar denenmez.
      if (error.code === "42501" || error.code?.startsWith("23")) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  console.error("logPlatformActivity", { action: input.action, error: lastError });
  await logError({
    source: "server",
    message: `Denetim izi yazılamadı (${input.action}): ${lastError}`.slice(0, 500),
    path: "platform_audit_logs",
    userId: input.actorId,
    userAgent: ctx.userAgent,
  });
  return { ok: false };
}
