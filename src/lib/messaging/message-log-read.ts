import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { daysAgoIso } from "@/lib/clock";
import type { MessageAccount, MessageAudience, MessageChannel, MessageLogStatus } from "./message-log";

/**
 * SMS/WhatsApp gönderim günlüğü OKUMA (yalnız sunucu; çağıranlar `requirePlatformModule("sistem")` kapılı Entegrasyon
 * merkezi ve Ofis 360). Tablo yokken (migration 20261014023000 öncesi) `installed:false`. Kişisel veri: yalnız maskeli alıcı.
 */

export const MESSAGE_STATUS_LABEL: Record<MessageLogStatus, string> = {
  queued: "Kuyrukta",
  sent: "Gönderildi",
  delivered: "Teslim edildi",
  read: "Okundu",
  failed: "Başarısız",
  unknown: "Sonuç belirsiz",
};

export const MESSAGE_STATUS_TONE: Record<MessageLogStatus, "success" | "warn" | "danger" | "neutral" | "info"> = {
  queued: "info",
  sent: "info",
  delivered: "success",
  read: "success",
  failed: "danger",
  unknown: "warn",
};

export const MESSAGE_STATUSES = Object.keys(MESSAGE_STATUS_LABEL) as MessageLogStatus[];
export const MESSAGE_CHANNEL_LABEL: Record<MessageChannel, string> = { sms: "SMS", whatsapp: "WhatsApp" };
export const MESSAGE_ACCOUNT_LABEL: Record<MessageAccount, string> = { platform: "EmlakSoft hesabı", tenant: "Ofisin hesabı" };
export const MESSAGE_AUDIENCE_LABEL: Record<MessageAudience, string> = { office: "Ofise", contact: "Ofisin kişisine" };

const SOURCE_LABEL: Record<string, string> = {
  system: "Sistem",
  tenant: "Ofis gönderimi",
  login_otp: "Giriş doğrulama kodu",
  two_factor_setup: "İki adımlı doğrulama kurulumu",
  dunning: "Tahsilat hatırlatması",
  integration_test: "Kanal testi",
  contract_sign: "Sözleşme imza bağlantısı",
  contract_reminder: "Sözleşme imza hatırlatması",
  authority_request: "Yetki belgesi talebi",
  manual_sms: "Müşteriye SMS",
  inbox_reply: "Gelen kutusu yanıtı",
  campaign: "Kampanya",
  automation: "Otomasyon",
  survey: "Memnuniyet anketi",
  rent_reminder: "Kira hatırlatması",
  owner_report: "Malik raporu",
};

export function messageSourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

export function isMessageStatus(v: string | undefined): v is MessageLogStatus {
  return Boolean(v) && (MESSAGE_STATUSES as string[]).includes(v!);
}

export function isMessageChannel(v: string | undefined): v is MessageChannel {
  return v === "sms" || v === "whatsapp";
}

export type MessageSendRow = {
  id: string;
  created_at: string;
  tenant_id: string | null;
  channel: MessageChannel;
  account: MessageAccount;
  audience: MessageAudience;
  source: string;
  to_masked: string;
  status: MessageLogStatus;
  error_code: string | null;
  error: string | null;
  segments: number | null;
  pricing_category: string | null;
  delivered_at: string | null;
  read_at: string | null;
};

const MISSING = new Set(["42P01", "PGRST205"]);
const SEND_COLS =
  "id, created_at, tenant_id, channel, account, audience, source, to_masked, status, error_code, error, segments, pricing_category, delivered_at, read_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageLogFilters = { channel?: MessageChannel; status?: MessageLogStatus; tenantId?: string; page: number; pageSize: number };

export type MessageLogPage = {
  installed: boolean;
  rows: MessageSendRow[];
  total: number;
  tenantNames: Map<string, string>;
  /** Durum sayıları: kanal/ofis süzgeciyle, durum süzgeci olmadan (çip tıklanınca aynı sayıda satır listelenir). */
  statusCounts: Partial<Record<MessageLogStatus, number>>;
};

/** Günlük listesi (sunucu süzgeci + gerçek sayfalama) ve durum sayıları (tek turda, Promise.all). */
export async function loadMessageLog(f: MessageLogFilters): Promise<MessageLogPage> {
  const admin = createAdminClient();
  const tenantId = f.tenantId && UUID_RE.test(f.tenantId) ? f.tenantId : null;
  let q = admin.from("message_sends").select(SEND_COLS, { count: "exact" }).order("created_at", { ascending: false });
  if (f.status) q = q.eq("status", f.status);
  if (f.channel) q = q.eq("channel", f.channel);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const from = (f.page - 1) * f.pageSize;
  const countFor = (s: MessageLogStatus) => {
    let c = admin.from("message_sends").select("id", { count: "exact", head: true }).eq("status", s);
    if (f.channel) c = c.eq("channel", f.channel);
    if (tenantId) c = c.eq("tenant_id", tenantId);
    return c;
  };
  const [list, ...counts] = await Promise.all([q.range(from, from + f.pageSize - 1), ...MESSAGE_STATUSES.map(countFor)]);
  if (list.error) {
    if (MISSING.has(list.error.code ?? "")) return { installed: false, rows: [], total: 0, tenantNames: new Map(), statusCounts: {} };
    throw new Error(`message_sends read failed: ${list.error.code}`);
  }
  const rows = (list.data ?? []) as MessageSendRow[];
  const statusCounts: Partial<Record<MessageLogStatus, number>> = {};
  MESSAGE_STATUSES.forEach((s, i) => {
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

/**
 * Ofis 360 "İletişim": ofise giden (kitle `office`: giriş kodu, tahsilat, kanal testi) son N günün SMS/WhatsApp'ı.
 * Ofisin müşterilerine giden toplu gönderimler zaman akışını boğmasın diye burada yok; Entegrasyon merkezi günlüğünde
 * ofis süzgeciyle görünür. Admin istemcisi sayfadan gelir; tablo yoksa boş.
 */
export async function loadTenantMessageSends(admin: SupabaseClient, tenantId: string, days = 30): Promise<MessageSendRow[]> {
  try {
    const { data, error } = await admin
      .from("message_sends")
      .select(SEND_COLS)
      .eq("tenant_id", tenantId)
      .eq("audience", "office")
      .gte("created_at", daysAgoIso(days))
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return [];
    return (data ?? []) as MessageSendRow[];
  } catch {
    return [];
  }
}

/** Gece budaması (operational-retention ayrık adımı): gönderimler 400 gün. RPC yoksa atlanır. */
export async function pruneMessageLog(admin: SupabaseClient): Promise<{ removed: number } | { skipped: true }> {
  const { data, error } = await admin.rpc("message_log_prune");
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") return { skipped: true };
    throw new Error(`message_log_prune failed: ${error.code}`);
  }
  return { removed: Number(data ?? 0) };
}
