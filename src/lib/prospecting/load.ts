import { DAY_MS, trDayStartMs, trMonthStartIso } from "@/lib/clock";
import { orIlike } from "@/lib/pgrst";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import type { ScopeFilter } from "@/lib/access-control/query-scope";
import type { Db } from "./store";
import { CLAIM_WARN_DAYS } from "./thresholds";
import { FSBO_STATUSES, OPEN_STATUSES, type FsboStatus } from "./types";

/** Sayfa başına kayıt (gerçek sayfalama). */
export const FSBO_PAGE_SIZE = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL'den gelen ham parametreler (iki yönlü filtre kontratı: URL ↔ sunucu sorgusu). */
export type FsboRawParams = Partial<Record<
  "q" | "durum" | "danisman" | "islem" | "ilce" | "min" | "max" | "yas" | "fiyat_dustu" | "tekrar" | "aranmasin" | "gorunum" | "aranmadi" | "hareketsiz" | "donem" | "sayfa",
  string
>>;

export const AGE_BUCKETS = [
  { key: "0-3", label: "0-3 gün", min: 0, max: 3 },
  { key: "4-14", label: "4-14 gün", min: 4, max: 14 },
  { key: "15-45", label: "15-45 gün", min: 15, max: 45 },
  { key: "45", label: "45+ gün", min: 45, max: null },
] as const;

export type FsboFilters = {
  q: string;
  durum: FsboStatus | "tumu" | "";
  danisman: string;
  islem: "sale" | "rent" | "";
  ilce: string;
  min: number | null;
  max: number | null;
  yas: string;
  fiyatDustu: boolean;
  tekrar: boolean;
  aranmasin: boolean;
  bugun: boolean;
  aranmadi: boolean;
  hareketsiz: boolean;
  buAy: boolean;
};

const num = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Ham parametreleri doğrular (geçersiz değer sessizce varsayılana düşer). */
export function parseFsboFilters(p: FsboRawParams, opts: { isManager: boolean }): FsboFilters {
  const durum = p.durum === "tumu" ? "tumu" : (FSBO_STATUSES as readonly string[]).includes(p.durum ?? "") ? (p.durum as FsboStatus) : "";
  return {
    q: (p.q ?? "").trim().slice(0, 80),
    durum,
    danisman: opts.isManager && (p.danisman === "sahipsiz" || UUID_RE.test(p.danisman ?? "")) ? (p.danisman as string) : "",
    islem: p.islem === "sale" || p.islem === "rent" ? p.islem : "",
    ilce: UUID_RE.test(p.ilce ?? "") ? (p.ilce as string) : "",
    min: num(p.min),
    max: num(p.max),
    yas: AGE_BUCKETS.some((b) => b.key === p.yas) ? (p.yas as string) : "",
    fiyatDustu: p.fiyat_dustu === "1",
    tekrar: p.tekrar === "1",
    aranmasin: p.aranmasin === "1",
    bugun: p.gorunum === "bugun",
    aranmadi: p.aranmadi === "1",
    hareketsiz: p.hareketsiz === "1",
    buAy: p.donem === "bu-ay",
  };
}

/** Filtreleri URL parametrelerine geri yazar (varsayılanlar parametre taşımaz). */
export function filtersToParams(f: FsboFilters, danismanRaw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.q = f.q;
  if (f.durum) out.durum = f.durum;
  if (f.danisman) out.danisman = danismanRaw ?? f.danisman;
  if (f.islem) out.islem = f.islem;
  if (f.ilce) out.ilce = f.ilce;
  if (f.min != null) out.min = String(f.min);
  if (f.max != null) out.max = String(f.max);
  if (f.yas) out.yas = f.yas;
  if (f.fiyatDustu) out.fiyat_dustu = "1";
  if (f.tekrar) out.tekrar = "1";
  if (f.aranmasin) out.aranmasin = "1";
  if (f.bugun) out.gorunum = "bugun";
  if (f.aranmadi) out.aranmadi = "1";
  if (f.hareketsiz) out.hareketsiz = "1";
  if (f.buAy) out.donem = "bu-ay";
  return out;
}

export type FsboRow = {
  id: string;
  title: string | null;
  url: string | null;
  portal: string;
  external_id: string | null;
  transaction_type: string;
  price: number | null;
  rooms: string | null;
  gross_m2: number | null;
  location_text: string | null;
  districtName: string | null;
  first_seen_at: string;
  listed_at: string | null;
  status: FsboStatus;
  lost_reason: string | null;
  contact_attempts: number;
  last_contact_at: string | null;
  next_action_at: string | null;
  price_drop_count: number;
  last_price_drop_pct: number | null;
  relist_of: string | null;
  owner_name: string | null;
  phone: string | null;
  phone_hash: string | null;
  assigned_to: string | null;
  assigneeName: string | null;
  customer_id: string | null;
  property_id: string | null;
  claim_expires_at: string | null;
  is_sample: boolean;
  pii_purged_at: string | null;
  /** Telefon özeti aranmasın listesinde (eylemler kilitli). */
  doNotCall: boolean;
};

export const FSBO_ROW_SELECT =
  "id, district_id, title, url, portal, external_id, transaction_type, price, rooms, gross_m2, location_text, first_seen_at, listed_at, status, lost_reason, contact_attempts, last_contact_at, next_action_at, price_drop_count, last_price_drop_pct, relist_of, owner_name, phone, phone_hash, assigned_to, customer_id, property_id, claim_expires_at, is_sample, pii_purged_at, district:geo_districts!fsbo_leads_district_id_fkey(name), assignee:profiles!fsbo_leads_assigned_to_fkey(full_name)";

type Chain = {
  eq: (c: string, v: unknown) => Chain;
  neq: (c: string, v: unknown) => Chain;
  in: (c: string, v: unknown[]) => Chain;
  is: (c: string, v: unknown) => Chain;
  gt: (c: string, v: unknown) => Chain;
  gte: (c: string, v: unknown) => Chain;
  lte: (c: string, v: unknown) => Chain;
  lt: (c: string, v: unknown) => Chain;
  not: (c: string, op: string, v: unknown) => Chain;
  or: (f: string) => Chain;
};

/** Kapsam: danışman/çağrı merkezi kendi + sahipsiz kayıtlarını, takım/şube kapsamı üyeleri + sahipsizleri görür. */
export function scopeClause(filter: ScopeFilter): string | null {
  if (filter.kind === "none") return null;
  if (filter.kind === "self") return `assigned_to.eq.${filter.userId},assigned_to.is.null`;
  return `assigned_to.in.(${filter.ids.join(",")}),assigned_to.is.null`;
}

/** Süzgeçleri sorguya uygular (kiracı + kapsam + URL filtreleri). `nowMs` dışarıdan gelir (saf). */
export function applyFsboFilters<Q>(query: Q, f: FsboFilters, scope: ScopeFilter, tenantId: string, nowMs: number): Q {
  let q = (query as unknown as Chain).eq("tenant_id", tenantId).is("deleted_at", null);
  const clause = scopeClause(scope);
  if (clause) q = q.or(clause);

  if (f.durum === "tumu") {
    /* tüm durumlar */
  } else if (f.durum) {
    q = q.eq("status", f.durum);
  } else if (f.aranmasin) {
    q = q.eq("status", "kayip").in("lost_reason", ["emlakci_istemiyor", "aslinda_emlakci"]);
  } else {
    q = q.in("status", [...OPEN_STATUSES]);
  }
  if (f.bugun) {
    const endOfDay = trDayStartMs(nowMs) + DAY_MS - 1;
    q = q.in("status", [...OPEN_STATUSES]).not("next_action_at", "is", null).lte("next_action_at", new Date(endOfDay).toISOString());
  }
  if (f.aranmadi) q = q.eq("contact_attempts", 0);
  if (f.hareketsiz) q = q.in("status", ["yeni", "arandi"]).not("claim_expires_at", "is", null).lte("claim_expires_at", new Date(nowMs + CLAIM_WARN_DAYS * DAY_MS).toISOString());
  if (f.buAy) q = q.eq("status", "portfoye_donustu").gte("converted_at", trMonthStartIso(nowMs));
  if (f.danisman === "sahipsiz") q = q.is("assigned_to", null);
  else if (f.danisman) q = q.eq("assigned_to", f.danisman);
  if (f.islem) q = q.eq("transaction_type", f.islem);
  if (f.ilce) q = q.eq("district_id", f.ilce);
  if (f.min != null) q = q.gte("price", f.min);
  if (f.max != null) q = q.lte("price", f.max);
  if (f.fiyatDustu) q = q.gt("price_drop_count", 0);
  if (f.tekrar) q = q.not("relist_of", "is", null);
  const bucket = AGE_BUCKETS.find((b) => b.key === f.yas);
  if (bucket) {
    // İlan yaşı: ofiste ilk görülmeden itibaren (en az N gün).
    const newest = new Date(nowMs - bucket.min * DAY_MS).toISOString();
    q = q.lte("first_seen_at", newest);
    if (bucket.max != null) q = q.gte("first_seen_at", new Date(nowMs - (bucket.max + 1) * DAY_MS).toISOString());
  }
  if (f.q) q = q.or(orIlike(["title", "external_id"], f.q));
  return q as unknown as Q;
}

export type FsboCounts = { bugun: number; yeni: number; randevu: number; yetki: number; donusen: number; toplam: number };

export type FsboListData = {
  rows: FsboRow[];
  total: number;
  counts: FsboCounts;
  /** Tablo yok (migration uygulanmadı): sayfa bilgi ve boş durum gösterir. */
  unavailable: boolean;
};

type RawRow = Omit<FsboRow, "districtName" | "assigneeName" | "doNotCall" | "price" | "gross_m2" | "last_price_drop_pct"> & {
  price: number | string | null;
  gross_m2: number | string | null;
  last_price_drop_pct: number | string | null;
  district: { name: string | null } | { name: string | null }[] | null;
  assignee: { full_name: string | null } | { full_name: string | null }[] | null;
};

const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const numOrNull = (v: number | string | null): number | null => (v == null ? null : Number(v));

/**
 * Liste + sayaçlar TEK turda (Promise.all). Sayaçlar kapsamla aynı süzgeci kullanır; hiçbir sayı kapsam dışı veri taşımaz.
 */
export async function loadFsboList(
  db: Db,
  input: { tenantId: string; scope: ScopeFilter; filters: FsboFilters; page: number; nowMs: number },
): Promise<FsboListData> {
  const { tenantId, scope, filters, page, nowMs } = input;
  const head = () => db.from("fsbo_leads").select("id", { count: "exact", head: true });
  const base = <Q,>(q: Q): Q => {
    let c = (q as unknown as Chain).eq("tenant_id", tenantId).is("deleted_at", null);
    const clause = scopeClause(scope);
    if (clause) c = c.or(clause);
    return c as unknown as Q;
  };
  const endOfDay = new Date(trDayStartMs(nowMs) + DAY_MS - 1).toISOString();
  const offset = (Math.max(1, page) - 1) * FSBO_PAGE_SIZE;

  const listQuery = applyFsboFilters(db.from("fsbo_leads").select(FSBO_ROW_SELECT, { count: "exact" }), filters, scope, tenantId, nowMs)
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .range(offset, offset + FSBO_PAGE_SIZE - 1);

  const [list, bugun, yeni, randevu, yetki, donusen, toplam] = await Promise.all([
    listQuery,
    base(head()).in("status", [...OPEN_STATUSES]).not("next_action_at", "is", null).lte("next_action_at", endOfDay),
    base(head()).eq("status", "yeni"),
    base(head()).eq("status", "randevu"),
    base(head()).eq("status", "yetki_alindi"),
    base(head()).eq("status", "portfoye_donustu").gte("converted_at", trMonthStartIso(nowMs)),
    base(head()),
  ]);

  const err = list.error;
  if (err) {
    if (isMissingSchemaError(err)) return { rows: [], total: 0, counts: { bugun: 0, yeni: 0, randevu: 0, yetki: 0, donusen: 0, toplam: 0 }, unavailable: true };
    throw new Error(`fsbo_leads: ${err.code ?? "hata"}`);
  }
  const raw = (list.data ?? []) as unknown as RawRow[];
  const hashes = [...new Set(raw.map((r) => r.phone_hash).filter((h): h is string => !!h))];
  let dnc = new Set<string>();
  if (hashes.length > 0) {
    const { data } = await db.from("fsbo_do_not_call").select("phone_hash").eq("tenant_id", tenantId).in("phone_hash", hashes);
    dnc = new Set(((data ?? []) as { phone_hash: string }[]).map((d) => d.phone_hash));
  }
  const rows = raw.map<FsboRow>((r) => ({
    ...r,
    price: numOrNull(r.price),
    gross_m2: numOrNull(r.gross_m2),
    last_price_drop_pct: numOrNull(r.last_price_drop_pct),
    districtName: first(r.district)?.name ?? null,
    assigneeName: first(r.assignee)?.full_name ?? null,
    doNotCall: !!r.phone_hash && dnc.has(r.phone_hash),
  }));
  return {
    rows,
    total: list.count ?? rows.length,
    counts: {
      bugun: bugun.count ?? 0,
      yeni: yeni.count ?? 0,
      randevu: randevu.count ?? 0,
      yetki: yetki.count ?? 0,
      donusen: donusen.count ?? 0,
      toplam: toplam.count ?? 0,
    },
    unavailable: false,
  };
}

/**
 * Sahipsiz açık Sahibinden ilan sayısı. Hedef liste (/app/portfoy-avi?danisman=sahipsiz) ile
 * AYNI süzgeci kullanır (açık durumlar + silinmemiş + atanmamış). Tablo yoksa ya da hata varsa 0 döner.
 */
export async function countUnassignedOpenFsbo(db: Db, tenantId: string, nowMs: number): Promise<number> {
  const filters: FsboFilters = { ...parseFsboFilters({}, { isManager: true }), danisman: "sahipsiz" };
  const { count, error } = await applyFsboFilters(
    db.from("fsbo_leads").select("id", { count: "exact", head: true }),
    filters,
    { kind: "none" },
    tenantId,
    nowMs,
  );
  if (error) return isMissingSchemaError(error) ? 0 : 0;
  return count ?? 0;
}
