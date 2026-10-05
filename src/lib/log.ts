import { sanitizeLogText, shortTenantId } from "@/lib/pii-mask";

/**
 * İnce yapılandırılmış (tek satır JSON) log sarmalayıcı. Büyük refactor
 * değildir: yalnızca YENİ kodda kullanılır; mevcut console.* çağrıları yerinde kalır.
 *
 * Metin alanları PII maskelenir ve kırpılır; tenant yalnız kısa kimlik olarak
 * yazılır. Asla hata fırlatmaz.
 */
export type LogLevel = "info" | "warn" | "error";

export type LogFields = {
  route?: string | null;
  digest?: string | null;
  tenantId?: string | null;
  [key: string]: unknown;
};

export function buildLogLine(level: LogLevel, event: string, fields: LogFields = {}): string {
  const { route, digest, tenantId, ...rest } = fields;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    extra[k] =
      typeof v === "number" || typeof v === "boolean" ? v : v == null ? null : sanitizeLogText(v, 300);
  }
  return JSON.stringify({
    level,
    event: sanitizeLogText(event, 120),
    route: route ? sanitizeLogText(route, 200) : undefined,
    digest: digest ? sanitizeLogText(digest, 160) : undefined,
    tenant: shortTenantId(tenantId) ?? undefined,
    ...extra,
  });
}

function emit(level: LogLevel, event: string, fields?: LogFields) {
  try {
    const line = buildLogLine(level, event, fields);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    /* log yolu asıl akışı bozmaz */
  }
}

export const log = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
