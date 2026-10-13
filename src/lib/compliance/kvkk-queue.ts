import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayStartMs } from "@/lib/clock";

/**
 * PLATFORM KVKK TALEP KUYRUĞU (/admin/tickets/kvkk): tüm ofislerin `kvkk_requests` kayıtları, YALNIZ META veri.
 * Okunan sütunlar: id, tenant_id, request_type, status, created_at, resolved_at (+ ofis adı). Kişi adı
 * (requester_name), müşteri bağı (customer_id), not ve çözüm notu OKUNMAZ — personel ilgili ofisin kapanış/dışa
 * aktarma akışına gider. Okuma service_role (kiracılar arası): istemciyi çağıran sayfa verir (`createAdminClient`,
 * kabul listesinde gerekçeli); kapı çağıranda `requirePlatformModule("tickets")`. Bu dosya sunucu istemcisi içe
 * aktarmaz: saf yardımcılar rapor kataloğunda da kullanılır.
 * Yasal süre: başvurudan itibaren 30 gün (KVKK m.13); son tarih = oluşturma + 30 gün, kalan gün TR takvim günüyle.
 */

export const KVKK_TYPE_LABELS: Record<string, string> = {
  access: "Bilgi talebi",
  portability: "Veri taşınabilirliği",
  rectification: "Düzeltme",
  objection: "İtiraz",
  erasure: "Silme",
  account_closure: "Hesap kapatma",
  data_export: "Veri dışa aktarma",
};

export const KVKK_STATUS_LABELS: Record<string, string> = {
  open: "Açık",
  in_progress: "İşlemde",
  completed: "Tamamlandı",
  rejected: "Reddedildi",
};

/** Kapanmış durumlar: sayaç durur. */
const CLOSED = new Set(["completed", "rejected"]);
export const KVKK_DEADLINE_DAYS = 30;
/** Kalan gün bu değere eşit ya da altındaysa sarı uyarı. */
export const KVKK_WARN_DAYS = 7;

export type KvkkTone = "ok" | "warn" | "late" | "closed";

/** Son tarih: oluşturma + 30 gün (ISO). */
export function kvkkDeadlineIso(createdIso: string): string | null {
  const t = Date.parse(createdIso);
  return Number.isFinite(t) ? new Date(t + KVKK_DEADLINE_DAYS * DAY_MS).toISOString() : null;
}

/**
 * Kalan gün (TR takvim günü farkı): son tarihin TR günü − bugünün TR günü. 0 = son gün bugün, negatif = gecikmiş.
 * Kapanmış talepte null (sayaç yok).
 */
export function kvkkDaysLeft(createdIso: string, status: string, nowMs: number): number | null {
  if (CLOSED.has(status)) return null;
  const deadline = kvkkDeadlineIso(createdIso);
  if (!deadline) return null;
  return Math.round((trDayStartMs(deadline) - trDayStartMs(nowMs)) / DAY_MS);
}

/** Ton: gecikmiş kırmızı, ≤7 gün sarı, kapalı nötr. */
export function kvkkTone(daysLeft: number | null): KvkkTone {
  if (daysLeft === null) return "closed";
  if (daysLeft < 0) return "late";
  if (daysLeft <= KVKK_WARN_DAYS) return "warn";
  return "ok";
}

export function kvkkDaysLeftLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "Kapandı";
  if (daysLeft < 0) return `${Math.abs(daysLeft)} gün gecikti`;
  if (daysLeft === 0) return "Son gün bugün";
  return `${daysLeft} gün kaldı`;
}

/**
 * Satırın gideceği akış: hesap kapatma / dışa aktarma talepleri Ofis 360 > Yönetim'de (kapanış talepleri bölümü)
 * işlenir; diğer KVKK başvuruları Ofis 360 > Yasal ve onaylar sekmesinde.
 */
export function kvkkFlowHref(tenantId: string, type: string): string {
  const tab = type === "account_closure" || type === "data_export" ? "yonetim" : "yasal";
  return `/admin/tenants/${tenantId}?sekme=${tab}`;
}

/** `sure`: açık taleplerde süre süzgeci (gecikmiş / ≤7 gün kalan). */
export type KvkkQueueFilters = { tur?: string; durum?: string; sure?: "gecikmis" | "yaklasan"; sayfa: number };

export type KvkkQueueRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  type: string;
  status: string;
  createdAt: string;
  deadlineAt: string | null;
  daysLeft: number | null;
  tone: KvkkTone;
};

export type KvkkQueue = {
  rows: KvkkQueueRow[];
  total: number;
  /** Açık (kapanmamış) taleplerden gecikmiş / ≤7 gün kalan sayıları (tüm ofisler, süzgeçten bağımsız). */
  late: number;
  warn: number;
  open: number;
  error: string | null;
};

/** Durum süzgecinin sanal değerleri: açık (open+in_progress). */
export const KVKK_OPEN_STATUSES = ["open", "in_progress"] as const;

/** URL → güvenli süzgeç (bilinmeyen değer yok sayılır). */
export function parseKvkkFilters(sp: Record<string, string | string[] | undefined>): KvkkQueueFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tur = one(sp.tur);
  const durum = one(sp.durum);
  const sure = one(sp.sure);
  const n = Number(one(sp.sayfa));
  return {
    tur: KVKK_TYPE_LABELS[tur] ? tur : undefined,
    durum: durum === "acik" || KVKK_STATUS_LABELS[durum] ? durum : undefined,
    sure: sure === "gecikmis" || sure === "yaklasan" ? sure : undefined,
    sayfa: Number.isInteger(n) && n > 1 ? n : 1,
  };
}

export function kvkkQueueHref(f: Partial<KvkkQueueFilters>): string {
  const sp = new URLSearchParams();
  if (f.tur) sp.set("tur", f.tur);
  if (f.durum) sp.set("durum", f.durum);
  if (f.sure) sp.set("sure", f.sure);
  if (f.sayfa && f.sayfa > 1) sp.set("sayfa", String(f.sayfa));
  const s = sp.toString();
  return s ? `/admin/tickets/kvkk?${s}` : "/admin/tickets/kvkk";
}

type Raw = { id: string; tenant_id: string; request_type: string; status: string; created_at: string; tenant: { name?: string } | { name?: string }[] | null };

const PAGE = 50;

/** Kuyruk okuması (YALNIZ meta). Çağıran `requirePlatformModule("tickets")` ile kapılıdır. */
export async function loadKvkkQueue(admin: SupabaseClient, f: KvkkQueueFilters, nowMs: number): Promise<KvkkQueue> {
  // Eşikler: gecikmiş ⇔ oluşturma < bugün(TR) − 30 gün; ≤7 gün ⇔ oluşturma < bugün(TR) + 8 − 30 gün (kvkkDaysLeft ile aynı).
  const lateBefore = new Date(trDayStartMs(nowMs) - KVKK_DEADLINE_DAYS * DAY_MS).toISOString();
  const warnBefore = new Date(trDayStartMs(nowMs) + (KVKK_WARN_DAYS + 1) * DAY_MS - KVKK_DEADLINE_DAYS * DAY_MS).toISOString();
  let q = admin
    .from("kvkk_requests")
    .select("id, tenant_id, request_type, status, created_at, tenant:tenants(name)", { count: "exact" })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range((f.sayfa - 1) * PAGE, f.sayfa * PAGE - 1);
  if (f.tur) q = q.eq("request_type", f.tur);
  if (f.durum === "acik") q = q.in("status", [...KVKK_OPEN_STATUSES]);
  else if (f.durum) q = q.eq("status", f.durum);
  if (f.sure) {
    q = q.in("status", [...KVKK_OPEN_STATUSES]);
    q = f.sure === "gecikmis" ? q.lt("created_at", lateBefore) : q.gte("created_at", lateBefore).lt("created_at", warnBefore);
  }

  // Uyarı sayımları (tüm ofisler, süzgeçten bağımsız): açık taleplerin yalnız oluşturma tarihi karşılaştırılır.
  const openCount = () => admin.from("kvkk_requests").select("id", { count: "exact", head: true }).in("status", [...KVKK_OPEN_STATUSES]);
  const [list, late, warnOrLate, open] = await Promise.all([q, openCount().lt("created_at", lateBefore), openCount().lt("created_at", warnBefore), openCount()]);
  if (list.error) return { rows: [], total: 0, late: 0, warn: 0, open: 0, error: list.error.message };

  const rows = ((list.data ?? []) as unknown as Raw[]).map((r) => {
    const t = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
    const daysLeft = kvkkDaysLeft(r.created_at, r.status, nowMs);
    return {
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: t?.name ?? "—",
      type: r.request_type,
      status: r.status,
      createdAt: r.created_at,
      deadlineAt: kvkkDeadlineIso(r.created_at),
      daysLeft,
      tone: kvkkTone(daysLeft),
    };
  });
  const lateN = late.count ?? 0;
  return {
    rows,
    total: list.count ?? rows.length,
    late: lateN,
    warn: Math.max(0, (warnOrLate.count ?? 0) - lateN),
    open: open.count ?? 0,
    error: null,
  };
}
