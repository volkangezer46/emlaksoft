import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { requireActiveTenant } from "@/lib/tenant-guard";
import {
  CURRENT_PORTALS,
  PORTAL_CATALOG,
  isCurrentPortal,
  portalIdFromName,
  type CurrentPortal,
  type MembershipSource,
  type MembershipStatus,
} from "./catalog";

/**
 * PORTAL ÜYELİĞİ OKUYUCUSU — ofisin hangi portallara üye olduğunun TEK kaynağı (`tenant_portal_accounts`). Eklenti,
 * gece işleri (portal-teyit, kontrol kuyruğu), Portala aktar paneli, eksik portal, yayın paneli, bağlama formları ve ROI
 * raporu YALNIZ buradan okur.
 *
 * Karar kuralı (`resolveMemberships`, SAF, testli):
 *  - Sahibin beyanı (`status` active/none) her zaman geçerlidir.
 *  - Beyan yoksa ya da "bilmiyorum" ise `inferPortalMembership` önerisine bakılır: ofiste o portalda canlı ilan, son bir yılda
 *    portal gideri ya da portal kaynaklı talep varsa portal GEÇİCİ olarak aktif sayılır (mevcut ofislerin işleyişi kesilmez);
 *    kanıt yoksa "bilinmiyor" kalır ve aktif SAYILMAZ (eklenti o portala istek atmaz, ekranlarda soluk durur).
 *  - Öneri hiçbir zaman yazılmaz; kayıt yalnız sahip/genel müdür onayıyla (`savePortalMemberships`) olur.
 * Tablo yoksa (migration bekliyor) yalnız öneriler kullanılır. Sonuç istek başına önbelleklidir (React `cache`).
 */

type Db = SupabaseClient;

export type PortalAccountRow = {
  portal: CurrentPortal;
  status: MembershipStatus;
  check_enabled: boolean;
  source: MembershipSource;
  account_label: string | null;
  store_url: string | null;
  plan_ends_at: string | null;
  last_login_ok_at: string | null;
  last_login_fail_at: string | null;
  login_fail_streak: number;
  updated_at: string | null;
};

export type PortalEvidence = { liveListings: number; expenses: number; leads: number };

export type PortalSuggestion = {
  portal: CurrentPortal;
  /** Öneri: kanıt varsa "active", yoksa "unknown" (öneri asla "none" demez). */
  suggested: "active" | "unknown";
  source: MembershipSource | null;
  evidence: PortalEvidence;
};

export type PortalMembership = {
  portal: CurrentPortal;
  label: string;
  /** Sahibin kaydettiği durum (kayıt yoksa "unknown"). */
  declared: MembershipStatus;
  /** Sahip açıkça "var" ya da "yok" dedi mi. */
  isDeclared: boolean;
  /** Ekranların ve eklentinin kullandığı etkin durum. */
  effective: MembershipStatus;
  /** Etkin durum öneriden mi geldi (geçici). */
  inferred: boolean;
  /** Otomatik kontrol (eklenti/kuyruk) bu portal için açık mı: etkin aktif VE kontrol kapatılmamış. */
  checkEnabled: boolean;
  row: PortalAccountRow | null;
  suggestion: PortalSuggestion | null;
};

const EMPTY_EVIDENCE: PortalEvidence = { liveListings: 0, expenses: 0, leads: 0 };
const ROW_COLUMNS =
  "portal, status, check_enabled, source, account_label, store_url, plan_ends_at, last_login_ok_at, last_login_fail_at, login_fail_streak, updated_at";

// ---------------------------------------------------------------- SAF karar fonksiyonları

/** Ham kayıtlardan portal başına kanıt sayımı (portal adı serbest metin olabilir; katalogla eşlenir). */
export function tallyEvidence(input: {
  liveListingPortals: readonly (string | null)[];
  expensePortalKeys: readonly (string | null)[];
  leadSources: readonly (string | null)[];
}): Record<CurrentPortal, PortalEvidence> {
  const out = Object.fromEntries(CURRENT_PORTALS.map((p) => [p, { ...EMPTY_EVIDENCE }])) as Record<CurrentPortal, PortalEvidence>;
  for (const name of input.liveListingPortals) {
    const id = portalIdFromName(name);
    if (isCurrentPortal(id)) out[id].liveListings += 1;
  }
  for (const key of input.expensePortalKeys) {
    const id = (key ?? "").trim().toLowerCase();
    if (isCurrentPortal(id)) out[id].expenses += 1;
  }
  for (const src of input.leadSources) {
    const s = (src ?? "").trim().toLowerCase();
    if (!s.startsWith("portal_")) continue;
    const id = s.slice("portal_".length);
    if (isCurrentPortal(id)) out[id].leads += 1;
  }
  return out;
}

/** Kanıttan öneri: canlı ilan > gider > talep önceliğiyle kaynak etiketi. */
export function suggestFromEvidence(evidence: Record<CurrentPortal, PortalEvidence>): PortalSuggestion[] {
  return CURRENT_PORTALS.map((portal) => {
    const e = evidence[portal] ?? EMPTY_EVIDENCE;
    const source: MembershipSource | null =
      e.liveListings > 0 || e.leads > 0 ? "inferred_listing" : e.expenses > 0 ? "inferred_expense" : null;
    return { portal, suggested: source ? "active" : "unknown", source, evidence: e };
  });
}

/** Kayıt + öneri → etkin üyelik listesi (her güncel portal için tek satır, katalog sırasıyla). */
export function resolveMemberships(rows: readonly PortalAccountRow[], suggestions: readonly PortalSuggestion[] | null): PortalMembership[] {
  return CURRENT_PORTALS.map((portal) => {
    const row = rows.find((r) => r.portal === portal) ?? null;
    const suggestion = suggestions?.find((s) => s.portal === portal) ?? null;
    const declared: MembershipStatus = row?.status ?? "unknown";
    const isDeclared = declared !== "unknown";
    const effective: MembershipStatus = isDeclared ? declared : suggestion?.suggested === "active" ? "active" : "unknown";
    const checkEnabled = effective === "active" && (row?.check_enabled ?? true);
    return {
      portal,
      label: PORTAL_CATALOG[portal].label,
      declared,
      isDeclared,
      effective,
      inferred: !isDeclared && effective === "active",
      checkEnabled,
      row,
      suggestion,
    };
  });
}

/** Önerinin gerekip gerekmediği: herhangi bir portal için beyan yoksa. */
export function needsInference(rows: readonly PortalAccountRow[]): boolean {
  return CURRENT_PORTALS.some((p) => {
    const r = rows.find((x) => x.portal === p);
    return !r || r.status === "unknown";
  });
}

export function activePortalIds(list: readonly PortalMembership[]): CurrentPortal[] {
  return list.filter((m) => m.effective === "active").map((m) => m.portal);
}

export function checkPortalIds(list: readonly PortalMembership[]): CurrentPortal[] {
  return list.filter((m) => m.checkEnabled).map((m) => m.portal);
}

/** Sahibin ilk kez onay vermesi gereken durum: hiçbir portal için beyan yok. */
export function awaitingOwnerConfirmation(list: readonly PortalMembership[]): boolean {
  return list.every((m) => !m.isDeclared);
}

// ---------------------------------------------------------------- okuma (istemci enjekte edilir; service_role ÇAĞRILMAZ)

function isMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return code === "42P01" || code === "PGRST205" || code === "42703" || /does not exist|schema cache/i.test(String(error.message ?? ""));
}

function normalizeRow(r: Record<string, unknown>): PortalAccountRow | null {
  const portal = String(r.portal ?? "");
  if (!isCurrentPortal(portal)) return null;
  const status = String(r.status ?? "unknown");
  return {
    portal,
    status: status === "active" || status === "none" ? status : "unknown",
    check_enabled: r.check_enabled !== false,
    source: (String(r.source ?? "owner_declared") as MembershipSource) ?? "owner_declared",
    account_label: typeof r.account_label === "string" ? r.account_label : null,
    store_url: typeof r.store_url === "string" ? r.store_url : null,
    plan_ends_at: typeof r.plan_ends_at === "string" ? r.plan_ends_at : null,
    last_login_ok_at: typeof r.last_login_ok_at === "string" ? r.last_login_ok_at : null,
    last_login_fail_at: typeof r.last_login_fail_at === "string" ? r.last_login_fail_at : null,
    login_fail_streak: Number(r.login_fail_streak ?? 0) || 0,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/** Ofisin kayıtlı üyelik satırları. `available: false` = tablo yok (migration bekliyor). */
export async function loadPortalAccountRows(db: Db, tenantId: string): Promise<{ available: boolean; rows: PortalAccountRow[] }> {
  const { data, error } = await db.from("tenant_portal_accounts").select(ROW_COLUMNS).eq("tenant_id", tenantId);
  if (error) {
    if (!isMissing(error)) console.error("tenant_portal_accounts read", { code: error.code });
    return { available: false, rows: [] };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeRow).filter((r): r is PortalAccountRow => r !== null);
  return { available: true, rows };
}

/** Birden çok ofisin kayıtlı satırları (gece işleri; istemci çağırandan). Tablo yoksa boş harita. */
export async function loadPortalAccountsForTenants(db: Db, tenantIds: readonly string[]): Promise<Map<string, PortalAccountRow[]>> {
  const out = new Map<string, PortalAccountRow[]>();
  const ids = [...new Set(tenantIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("tenant_portal_accounts")
      .select(`tenant_id, ${ROW_COLUMNS}`)
      .in("tenant_id", ids.slice(i, i + 200));
    if (error) {
      if (!isMissing(error)) console.error("tenant_portal_accounts batch read", { code: error.code });
      return out;
    }
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const row = normalizeRow(r);
      if (!row) continue;
      const tid = String(r.tenant_id);
      out.set(tid, [...(out.get(tid) ?? []), row]);
    }
  }
  return out;
}

/** Öneri için kanıt: canlı portal ilanları, son 365 gün portal giderleri ve portal kaynaklı talepler (yalnız okuma). */
export async function loadPortalEvidence(db: Db, tenantId: string): Promise<Record<CurrentPortal, PortalEvidence>> {
  const since = daysAgoIso(365);
  const [listings, expenses, leads] = await Promise.all([
    db.from("portal_listings").select("portal_name").eq("tenant_id", tenantId).eq("status", "live").limit(5000),
    db.from("expenses").select("portal_key").eq("tenant_id", tenantId).not("portal_key", "is", null).gte("created_at", since).limit(2000),
    db.from("customers").select("lead_source").eq("tenant_id", tenantId).like("lead_source", "portal_%").gte("created_at", since).limit(2000),
  ]);
  return tallyEvidence({
    liveListingPortals: listings.error ? [] : ((listings.data ?? []) as { portal_name: string | null }[]).map((r) => r.portal_name),
    expensePortalKeys: expenses.error ? [] : ((expenses.data ?? []) as { portal_key: string | null }[]).map((r) => r.portal_key),
    leadSources: leads.error ? [] : ((leads.data ?? []) as { lead_source: string | null }[]).map((r) => r.lead_source),
  });
}

/**
 * Öneri üretir (canlı portal_listings, expenses.portal_key ve lead_source=portal_* kayıtlarından). YAZMAZ: sonuç yalnız
 * üyelik kartında işaretli gelir, kayıt sahibin onayıyla yapılır.
 */
export const inferPortalMembership = cache(async (tenantId: string, db?: Db): Promise<PortalSuggestion[]> => {
  const client = db ?? (await createClient());
  return suggestFromEvidence(await loadPortalEvidence(client, tenantId));
});

/** Kayıtlı satırlar + tablo var mı (istek başına önbellekli; kart ve okuyucu aynı sorguyu paylaşır). */
export const getPortalAccountState = cache(async (tenantId: string, db?: Db): Promise<{ available: boolean; rows: PortalAccountRow[] }> => {
  return loadPortalAccountRows(db ?? (await createClient()), tenantId);
});

/** Ofisin etkin portal üyelikleri (istek başına önbellekli). `db` verilmezse oturum istemcisi (RLS) kullanılır. */
export const getPortalMemberships = cache(async (tenantId: string, db?: Db): Promise<PortalMembership[]> => {
  const { rows } = await getPortalAccountState(tenantId, db);
  const suggestions = needsInference(rows) ? await inferPortalMembership(tenantId, db) : null;
  return resolveMemberships(rows, suggestions);
});

/** Etkin olarak üye olunan güncel portallar. */
export async function getActivePortals(tenantId: string, db?: Db): Promise<CurrentPortal[]> {
  return activePortalIds(await getPortalMemberships(tenantId, db));
}

export async function isPortalActive(tenantId: string, portal: string, db?: Db): Promise<boolean> {
  return (await getActivePortals(tenantId, db)).includes(portal as CurrentPortal);
}

/** Otomatik kontrol (eklenti, kontrol kuyruğu) bu portal için açık mı. */
export async function isPortalCheckEnabled(tenantId: string, portal: string, db?: Db): Promise<boolean> {
  return checkPortalIds(await getPortalMemberships(tenantId, db)).includes(portal as CurrentPortal);
}

// ---------------------------------------------------------------- eklenti köprüsü (oturumlu uçlar)

/**
 * Eklentiye bildirilecek portal listesi: ofisin üye olduğu VE otomatik kontrolü açık portallar (eşleşme/`register` ve kural
 * yenileme yanıtlarında döner). Oturum/ofis yoksa null (eklenti listeyi değiştirmez). Eklentinin yerel ayarı bu listeyi yalnız
 * daraltır; liste boşsa eklenti hiçbir portala istek atmaz.
 */
export async function getExtensionPortalsForRequest(): Promise<CurrentPortal[] | null> {
  try {
    const gate = await requireActiveTenant();
    if (!gate.ok) return null;
    return checkPortalIds(await getPortalMemberships(gate.tenantId));
  } catch {
    return null;
  }
}

/**
 * Eklentinin mağaza taraması sonucu: giriş başarılı (liste okundu) ya da "giriş istedi". `last_login_*` ve seri
 * `portal_account_report_login` RPC'sinde (JWT; yalnız kendi ofisi) yazılır; seri 3'te ofis sahibine tek seferlik
 * "üyelik bitti mi?" bildirimi gider. En iyi çaba: tablo/RPC yoksa sessizce atlanır.
 */
export async function reportPortalLogin(portal: string, ok: boolean): Promise<void> {
  if (!isCurrentPortal(portal)) return;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("portal_account_report_login", { p_portal: portal, p_ok: ok });
    if (error && !isMissing(error) && !/could not find the function/i.test(String(error.message ?? ""))) {
      console.error("portal_account_report_login", { code: error.code });
    }
  } catch {
    /* en iyi çaba */
  }
}
