import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { daysAgoIso } from "@/lib/clock";
import { EMAIL_TEMPLATES } from "./templates";
import type { EmailLogStatus } from "./webhook";

/**
 * E-posta günlüğü ve bastırma listesi OKUMA (yalnız sunucu; çağıranlar `requirePlatformModule("sistem")` kapılı
 * `/admin/ayarlar/eposta` sayfası ve Ofis 360). Tablolar yokken (migration 20261013004600 öncesi) `installed:false`.
 * Kişisel veri: yalnız maskeli alıcı; düz adres tutulmaz.
 */

export const EMAIL_STATUS_LABEL: Record<EmailLogStatus, string> = {
  sent: "Gönderildi",
  delivered: "Teslim edildi",
  delayed: "Gecikti",
  opened: "Açıldı",
  clicked: "Tıklandı",
  bounced: "Geri döndü (bounce)",
  complained: "Şikâyet",
  failed: "Hata",
  suppressed: "Bastırıldı",
  disabled: "Kanal kapalı",
};

export const EMAIL_STATUS_TONE: Record<EmailLogStatus, "success" | "warn" | "danger" | "neutral" | "info"> = {
  sent: "info",
  delivered: "success",
  delayed: "warn",
  opened: "success",
  clicked: "success",
  bounced: "danger",
  complained: "danger",
  failed: "danger",
  suppressed: "warn",
  disabled: "neutral",
};

export const EMAIL_STATUSES = Object.keys(EMAIL_STATUS_LABEL) as EmailLogStatus[];

export function isEmailStatus(v: string | undefined): v is EmailLogStatus {
  return Boolean(v) && (EMAIL_STATUSES as string[]).includes(v!);
}

export function emailTemplateLabel(key: string): string {
  if (key === "test") return "Kanal testi";
  return EMAIL_TEMPLATES.find((t) => t.key === key)?.label ?? key;
}

export type EmailSendRow = {
  id: string;
  created_at: string;
  tenant_id: string | null;
  template: string;
  source: string;
  to_masked: string;
  subject: string;
  status: EmailLogStatus;
  error: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  last_event_at: string | null;
};

export type EmailSuppressionRow = {
  id: string;
  email_masked: string;
  reason: "bounce" | "complaint" | "manual";
  detail: string | null;
  created_at: string;
};

const MISSING = new Set(["42P01", "PGRST205"]);
const SEND_COLS = "id, created_at, tenant_id, template, source, to_masked, subject, status, error, delivered_at, opened_at, last_event_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmailLogFilters = { status?: EmailLogStatus; template?: string; tenantId?: string; page: number; pageSize: number };

export type EmailLogPage = {
  installed: boolean;
  rows: EmailSendRow[];
  total: number;
  tenantNames: Map<string, string>;
  /** Durum sayıları: şablon/ofis süzgeciyle, durum süzgeci olmadan (çip tıklanınca aynı sayıda satır listelenir). */
  statusCounts: Partial<Record<EmailLogStatus, number>>;
};

/** Günlük listesi (sunucu süzgeci + gerçek sayfalama) ve durum sayıları (tek turda, Promise.all). */
export async function loadEmailLog(f: EmailLogFilters): Promise<EmailLogPage> {
  const admin = createAdminClient();
  const tenantId = f.tenantId && UUID_RE.test(f.tenantId) ? f.tenantId : null;
  const template = f.template ? f.template.slice(0, 64) : null;
  let q = admin.from("email_sends").select(SEND_COLS, { count: "exact" }).order("created_at", { ascending: false });
  if (f.status) q = q.eq("status", f.status);
  if (template) q = q.eq("template", template);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const from = (f.page - 1) * f.pageSize;
  const countFor = (s: EmailLogStatus) => {
    let c = admin.from("email_sends").select("id", { count: "exact", head: true }).eq("status", s);
    if (template) c = c.eq("template", template);
    if (tenantId) c = c.eq("tenant_id", tenantId);
    return c;
  };
  const [list, ...counts] = await Promise.all([q.range(from, from + f.pageSize - 1), ...EMAIL_STATUSES.map(countFor)]);
  if (list.error) {
    if (MISSING.has(list.error.code ?? "")) return { installed: false, rows: [], total: 0, tenantNames: new Map(), statusCounts: {} };
    throw new Error(`email_sends read failed: ${list.error.code}`);
  }
  const rows = (list.data ?? []) as EmailSendRow[];
  const statusCounts: Partial<Record<EmailLogStatus, number>> = {};
  EMAIL_STATUSES.forEach((s, i) => {
    statusCounts[s] = counts[i]?.count ?? 0;
  });
  const ids = [...new Set([...rows.map((r) => r.tenant_id), tenantId].filter((x): x is string => Boolean(x)))];
  const tenantNames = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await admin.from("tenants").select("id, name").in("id", ids);
    for (const t of (data ?? []) as { id: string; name: string }[]) tenantNames.set(t.id, t.name);
  }
  return { installed: true, rows, total: list.count ?? rows.length, tenantNames, statusCounts };
}

export async function loadEmailSuppressions(page: number, pageSize: number): Promise<{ installed: boolean; rows: EmailSuppressionRow[]; total: number }> {
  const admin = createAdminClient();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await admin
    .from("email_suppressions")
    .select("id, email_masked, reason, detail, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) {
    if (MISSING.has(error.code ?? "")) return { installed: false, rows: [], total: 0 };
    throw new Error(`email_suppressions read failed: ${error.code}`);
  }
  return { installed: true, rows: (data ?? []) as EmailSuppressionRow[], total: count ?? 0 };
}

/** Ofis 360 "İletişim": ofisin son 30 günde aldığı e-postalar (admin istemcisi sayfadan gelir; tablo yoksa boş). */
export async function loadTenantEmailSends(admin: SupabaseClient, tenantId: string, days = 30): Promise<EmailSendRow[]> {
  try {
    const { data, error } = await admin
      .from("email_sends")
      .select(SEND_COLS)
      .eq("tenant_id", tenantId)
      .gte("created_at", daysAgoIso(days))
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return [];
    return (data ?? []) as EmailSendRow[];
  } catch {
    return [];
  }
}

/** Gece budaması (operational-retention ayrık adımı): olaylar 180, gönderimler 400 gün. RPC yoksa atlanır. */
export async function pruneEmailLog(admin: SupabaseClient): Promise<{ removed: number } | { skipped: true }> {
  const { data, error } = await admin.rpc("email_log_prune");
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") return { skipped: true };
    throw new Error(`email_log_prune failed: ${error.code}`);
  }
  return { removed: Number(data ?? 0) };
}
