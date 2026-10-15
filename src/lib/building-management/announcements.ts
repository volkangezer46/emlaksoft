import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";

/**
 * Bina DUYURULARI: sabitler, SAF alıcı planı ve SMS metni + okuyucular. Duyuru her zaman ofis ekranında ve (açıksa) malik/kiracı
 * portalında görünür; SMS/WhatsApp gönderimi isteğe bağlıdır ve sunucu action'ında merkezi İYS kapısından geçer
 * (`src/app/actions/building-announcements.ts`). Bu dosya ileti GÖNDERMEZ.
 */

export const ANNOUNCEMENT_CATEGORIES = ["genel", "bakim", "toplanti", "kesinti", "finans"] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  genel: "Genel",
  bakim: "Bakım / onarım",
  toplanti: "Toplantı / genel kurul",
  kesinti: "Kesinti (su, elektrik, asansör)",
  finans: "Aidat / ödeme",
};
export const isAnnouncementCategory = (v: unknown): v is AnnouncementCategory =>
  typeof v === "string" && (ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(v);

export const ANNOUNCEMENT_AUDIENCES = ["all", "owners", "tenants"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "Tüm sakinler (malik + kiracı)",
  owners: "Yalnız malikler",
  tenants: "Yalnız kiracılar",
};
export const isAnnouncementAudience = (v: unknown): v is AnnouncementAudience =>
  typeof v === "string" && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(v);

export type AnnouncementChannel = "sms" | "whatsapp";
/** Tek gönderimde en çok alıcı (sağlayıcı kredisi ve kötüye kullanım koruması). */
export const ANNOUNCEMENT_SEND_CAP = 300;
/** SMS gövdesi üst sınırı: 3 parça (Türkçe karakterli ~201, GSM ~459). */
export const ANNOUNCEMENT_SMS_MAX = 450;

export type DeliverySummary = { at: string; sent: number; failed: number; skipped: number; audience: AnnouncementAudience };
export type AnnouncementDelivery = Partial<Record<AnnouncementChannel, DeliverySummary>>;

export type AnnouncementRow = {
  id: string;
  buildingId: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  visibleInPortal: boolean;
  delivery: AnnouncementDelivery;
  createdAt: string;
  archivedAt: string | null;
};

type RawAnnouncement = {
  id: string; building_id: string; title: string; body: string; category: string; pinned: boolean; visible_in_portal: boolean;
  delivery: unknown; created_at: string; archived_at: string | null;
};

const ANN_COLS = "id, building_id, title, body, category, pinned, visible_in_portal, delivery, created_at, archived_at";

export function parseDelivery(v: unknown): AnnouncementDelivery {
  const out: AnnouncementDelivery = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const ch of ["sms", "whatsapp"] as const) {
    const r = (v as Record<string, unknown>)[ch];
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    out[ch] = {
      at: String(x.at ?? ""),
      sent: Number(x.sent) || 0,
      failed: Number(x.failed) || 0,
      skipped: Number(x.skipped) || 0,
      audience: isAnnouncementAudience(x.audience) ? x.audience : "all",
    };
  }
  return out;
}

function mapAnnouncement(a: RawAnnouncement): AnnouncementRow {
  return {
    id: a.id, buildingId: a.building_id, title: a.title, body: a.body, category: isAnnouncementCategory(a.category) ? a.category : "genel",
    pinned: Boolean(a.pinned), visibleInPortal: Boolean(a.visible_in_portal), delivery: parseDelivery(a.delivery), createdAt: a.created_at, archivedAt: a.archived_at,
  };
}

/** Sabitlenenler önce, sonra en yeni. */
export function sortAnnouncements<T extends { pinned: boolean; createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.pinned === b.pinned ? b.createdAt.localeCompare(a.createdAt) : a.pinned ? -1 : 1));
}

export async function loadBuildingAnnouncements(
  db: SupabaseClient,
  input: { tenantId: string; buildingId: string; includeArchived?: boolean },
): Promise<{ available: boolean; rows: AnnouncementRow[] }> {
  let q = db.from("building_announcements").select(ANN_COLS).eq("tenant_id", input.tenantId).eq("building_id", input.buildingId);
  if (!input.includeArchived) q = q.is("archived_at", null);
  const res = await q.order("created_at", { ascending: false }).limit(50);
  if (res.error) return { available: false, rows: [] };
  return { available: true, rows: sortAnnouncements(((res.data ?? []) as unknown as RawAnnouncement[]).map(mapAnnouncement)) };
}

/**
 * Portal okuyucusu (salt-okunur): izleyenin dairesinin bulunduğu binalara ait, portalda görünür ve arşivlenmemiş son duyurular.
 * İstemci token'ı doğrulayan sayfadan gelir; sorgu AÇIK tenant + bina kapsamlıdır.
 */
export async function loadPortalAnnouncements(
  db: SupabaseClient,
  input: { tenantId: string; buildingIds: readonly string[]; sinceIso: string },
): Promise<{ id: string; buildingId: string; title: string; body: string; category: AnnouncementCategory; pinned: boolean; createdAt: string }[]> {
  const ids = [...new Set(input.buildingIds)].slice(0, 20);
  if (ids.length === 0) return [];
  const res = await db
    .from("building_announcements")
    .select("id, building_id, title, body, category, pinned, created_at")
    .eq("tenant_id", input.tenantId)
    .in("building_id", ids)
    .eq("visible_in_portal", true)
    .is("archived_at", null)
    .gte("created_at", input.sinceIso)
    .order("created_at", { ascending: false })
    .limit(10);
  if (res.error) return [];
  return sortAnnouncements(
    ((res.data ?? []) as { id: string; building_id: string; title: string; body: string; category: string; pinned: boolean; created_at: string }[]).map((r) => ({
      id: r.id, buildingId: r.building_id, title: r.title, body: r.body, category: isAnnouncementCategory(r.category) ? r.category : "genel",
      pinned: Boolean(r.pinned), createdAt: r.created_at,
    })),
  );
}

// ---------------------------------------------------------------------------
// Alıcı planı (SAF)
// ---------------------------------------------------------------------------

export type ResidentUnit = { ownerCustomerId: string | null; tenantCustomerId: string | null };
export type ResidentCustomer = { id: string; fullName: string | null; phone: string | null; blacklist: boolean; isSample: boolean; deleted: boolean };

/** Kitleye göre benzersiz müşteri kimlikleri (etkin daireler). */
export function audienceCustomerIds(units: readonly ResidentUnit[], audience: AnnouncementAudience): string[] {
  const ids = new Set<string>();
  for (const u of units) {
    if (audience !== "tenants" && u.ownerCustomerId) ids.add(u.ownerCustomerId);
    if (audience !== "owners" && u.tenantCustomerId) ids.add(u.tenantCustomerId);
  }
  return [...ids];
}

export type AnnouncementPlan = {
  send: { customerId: string; phone: string; fullName: string | null }[];
  counts: { total: number; noPhone: number; blocked: number; noConsent: number; overCap: number };
};

/**
 * Gönderim planı: telefonsuz/geçersiz, kara listede, örnek ya da silinmiş müşteri ve İYS izni olmayan (allowed dışı) atlanır;
 * aynı numara tek kez gönderilir; üst sınır aşılırsa kalanlar `overCap`.
 */
export function planAnnouncementSend(input: {
  customerIds: readonly string[];
  customers: readonly ResidentCustomer[];
  allowed: ReadonlySet<string>;
  cap?: number;
}): AnnouncementPlan {
  const cap = input.cap ?? ANNOUNCEMENT_SEND_CAP;
  const byId = new Map(input.customers.map((c) => [c.id, c]));
  const counts = { total: input.customerIds.length, noPhone: 0, blocked: 0, noConsent: 0, overCap: 0 };
  const send: AnnouncementPlan["send"] = [];
  const phones = new Set<string>();
  for (const id of input.customerIds) {
    const c = byId.get(id);
    if (!c || c.deleted || c.isSample || c.blacklist) {
      counts.blocked += 1;
      continue;
    }
    const phone = normalizeTurkishPhone(c.phone ?? "");
    if (!c.phone || !isValidTurkishMobile(phone)) {
      counts.noPhone += 1;
      continue;
    }
    if (!input.allowed.has(id)) {
      counts.noConsent += 1;
      continue;
    }
    if (phones.has(phone)) continue;
    if (send.length >= cap) {
      counts.overCap += 1;
      continue;
    }
    phones.add(phone);
    send.push({ customerId: id, phone, fullName: c.fullName });
  }
  return { send, counts };
}

/** SMS metni: "<Ofis> · <Bina> duyurusu: <Başlık> — <metin>" (üst sınırda kısaltılır). */
export function buildAnnouncementSms(input: { officeName: string | null; buildingName: string; title: string; body: string }): string {
  const head = `${input.officeName ? `${input.officeName} · ` : ""}${input.buildingName} duyurusu: ${input.title.trim()}`;
  const body = input.body.replace(/\s+/g, " ").trim();
  const full = body ? `${head} — ${body}` : head;
  return full.length <= ANNOUNCEMENT_SMS_MAX ? full : `${full.slice(0, ANNOUNCEMENT_SMS_MAX - 1).trimEnd()}…`;
}
