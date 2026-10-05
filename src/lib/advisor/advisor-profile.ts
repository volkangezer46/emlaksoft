/**
 * Danışman iş profili, uzmanlık ve bölge için SAF mantık (ağ/DB yok; istemci + sunucu güvenli).
 * Sunucu action'ları (src/app/actions/advisor-profile.ts) ve birim testleri aynı kaynağı kullanır.
 * Şema: supabase/migrations/20260816001300 ve 20260816001400.
 */

import { defaultDefinitionValues } from "@/lib/definition-defaults";

export const EMPLOYMENT_TYPES = [
  { value: "kadrolu", label: "Kadrolu" },
  { value: "komisyon", label: "Komisyon bazlı" },
  { value: "stajyer", label: "Stajyer" },
  { value: "ortak", label: "Ortak" },
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];

export const WEEK_DAYS = [
  { n: 1, label: "Pzt" },
  { n: 2, label: "Sal" },
  { n: 3, label: "Çar" },
  { n: 4, label: "Per" },
  { n: 5, label: "Cum" },
  { n: 6, label: "Cmt" },
  { n: 7, label: "Paz" },
] as const;

export const SPECIALTY_LEVELS = [
  { value: 1, label: "1 · Yeni" },
  { value: 2, label: "2 · Deneyimli" },
  { value: 3, label: "3 · Uzman" },
] as const;

export type TxType = "Satılık" | "Kiralık";
/** İşlem türü sistem anahtarları: tek kaynak definition-defaults.ts (kodun dallandığı Satılık/Kiralık). */
export const TRANSACTION_TYPES = defaultDefinitionValues("transaction_type") as readonly TxType[];

export const REGION_WEIGHTS = [
  { value: 1, label: "1 · Düşük" },
  { value: 2, label: "2" },
  { value: 3, label: "3 · Orta" },
  { value: 4, label: "4" },
  { value: 5, label: "5 · Ana bölge" },
] as const;

export const MAX_SPECIALTY_ROWS = 60;
export const MAX_REGION_ROWS = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Tarih / belge bitişi
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` takvim günü geçerli mi (31 Şubat gibi taşmalar reddedilir). */
export function isValidDay(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function dayNumber(v: string): number {
  const [y, m, d] = v.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/** `to - from` takvim günü farkı. */
export function dayDiff(fromDay: string, toDay: string): number {
  return dayNumber(toDay) - dayNumber(fromDay);
}

export type DocState = "none" | "expired" | "week" | "month" | "ok";
export type DocStatus = { state: DocState; daysLeft: number | null };

export const DOC_WARN_DAYS = { week: 7, month: 30 } as const;

/**
 * Belge bitiş durumu. `todayKey`: bugünün TR takvim günü (`trDayKey(now())`); saf kalsın diye dışarıdan verilir.
 * Bitiş günü dahil geçerlidir (bugün biterse daysLeft = 0 -> "week"). Geçmişse "expired".
 */
export function docExpiryStatus(expiresOn: string | null | undefined, todayKey: string): DocStatus {
  if (!expiresOn || !isValidDay(expiresOn) || !isValidDay(todayKey)) return { state: "none", daysLeft: null };
  const daysLeft = dayDiff(todayKey, expiresOn);
  if (daysLeft < 0) return { state: "expired", daysLeft };
  if (daysLeft <= DOC_WARN_DAYS.week) return { state: "week", daysLeft };
  if (daysLeft <= DOC_WARN_DAYS.month) return { state: "month", daysLeft };
  return { state: "ok", daysLeft };
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
  none: "Tanımlı değil",
  expired: "Süresi doldu",
  week: "7 gün içinde bitiyor",
  month: "30 gün içinde bitiyor",
  ok: "Geçerli",
};

export type DocKind = "authority" | "spk";
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  authority: "Taşınmaz Ticareti Yetki Belgesi",
  spk: "SPK belgesi",
};

export type DocAlert = { profileId: string; kind: DocKind; expiresOn: string; state: "expired" | "week" | "month"; daysLeft: number };

/** Satır listesinden uyarı üretir (yalnız süresi dolmuş / 30 gün içinde bitenler); en acil önce. */
export function collectDocAlerts(
  rows: readonly { profile_id: string; authority_cert_expires_on: string | null; spk_cert_expires_on: string | null }[],
  todayKey: string,
): DocAlert[] {
  const out: DocAlert[] = [];
  for (const r of rows) {
    for (const [kind, on] of [
      ["authority", r.authority_cert_expires_on],
      ["spk", r.spk_cert_expires_on],
    ] as const) {
      const s = docExpiryStatus(on, todayKey);
      if (on && (s.state === "expired" || s.state === "week" || s.state === "month")) {
        out.push({ profileId: r.profile_id, kind, expiresOn: on, state: s.state, daysLeft: s.daysLeft ?? 0 });
      }
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.profileId.localeCompare(b.profileId));
}

// ---------------------------------------------------------------------------
// İş profili (advisor_profiles)
// ---------------------------------------------------------------------------

export type WorkProfileValue = {
  employment_type: EmploymentType | null;
  hired_at: string | null;
  left_at: string | null;
  authority_cert_no: string | null;
  authority_cert_expires_on: string | null;
  spk_cert_no: string | null;
  spk_cert_expires_on: string | null;
  max_active_listings: number | null;
  max_active_demands: number | null;
  work_days: number[];
  work_start: string | null;
  work_end: string | null;
  accepts_pool: boolean;
  /** Havuz duraklatma bitiş günü (YYYY-MM-DD); sunucu timestamptz'e çevirir. */
  pool_paused_until_day: string | null;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type Getter = { get(k: string): string | null; getAll(k: string): string[] };

/** Düz nesneden Getter (test ve FormData dışı kullanım). */
export function recordGetter(rec: Record<string, string | string[] | undefined>): Getter {
  return {
    get: (k) => {
      const v = rec[k];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
    getAll: (k) => {
      const v = rec[k];
      return Array.isArray(v) ? v : v === undefined ? [] : [v];
    },
  };
}

function text(g: Getter, key: string, max: number): string | null {
  const v = (g.get(key) ?? "").trim();
  return v === "" ? null : v.slice(0, max);
}

function dayField(g: Getter, key: string, label: string): Parsed<string | null> {
  const v = (g.get(key) ?? "").trim();
  if (v === "") return { ok: true, value: null };
  return isValidDay(v) ? { ok: true, value: v } : { ok: false, error: `${label} geçerli bir tarih olmalı.` };
}

function intField(g: Getter, key: string, label: string, max: number): Parsed<number | null> {
  const v = (g.get(key) ?? "").trim();
  if (v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) return { ok: false, error: `${label} 0 ile ${max} arasında tam sayı olmalı.` };
  return { ok: true, value: n };
}

function timeField(g: Getter, key: string, label: string): Parsed<string | null> {
  const v = (g.get(key) ?? "").trim();
  if (v === "") return { ok: true, value: null };
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? { ok: true, value: v } : { ok: false, error: `${label} SS:DD biçiminde olmalı.` };
}

export function parseWorkProfile(g: Getter): Parsed<WorkProfileValue> {
  const empRaw = (g.get("employment_type") ?? "").trim();
  if (empRaw && !EMPLOYMENT_TYPES.some((e) => e.value === empRaw)) return { ok: false, error: "İstihdam türü geçersiz." };

  const days: Record<string, Parsed<string | null>> = {
    hired_at: dayField(g, "hired_at", "İşe giriş tarihi"),
    left_at: dayField(g, "left_at", "Ayrılış tarihi"),
    authority_cert_expires_on: dayField(g, "authority_cert_expires_on", "Yetki belgesi bitiş tarihi"),
    spk_cert_expires_on: dayField(g, "spk_cert_expires_on", "SPK belgesi bitiş tarihi"),
    pool_paused_until: dayField(g, "pool_paused_until", "Havuz duraklatma bitişi"),
  };
  for (const r of Object.values(days)) if (!r.ok) return r;
  const d = (k: string) => (days[k] as { ok: true; value: string | null }).value;

  if (d("hired_at") && d("left_at") && d("left_at")! < d("hired_at")!) {
    return { ok: false, error: "Ayrılış tarihi işe giriş tarihinden önce olamaz." };
  }

  const listings = intField(g, "max_active_listings", "Aktif ilan üst sınırı", 10_000);
  if (!listings.ok) return listings;
  const demands = intField(g, "max_active_demands", "Aktif talep üst sınırı", 10_000);
  if (!demands.ok) return demands;

  const start = timeField(g, "work_start", "Mesai başlangıcı");
  if (!start.ok) return start;
  const end = timeField(g, "work_end", "Mesai bitişi");
  if (!end.ok) return end;
  if ((start.value && !end.value) || (!start.value && end.value)) {
    return { ok: false, error: "Mesai başlangıcı ve bitişi birlikte girilmeli." };
  }
  if (start.value && end.value && end.value <= start.value) {
    return { ok: false, error: "Mesai bitişi başlangıçtan sonra olmalı." };
  }

  const dayNums = [...new Set(g.getAll("work_days").map((x) => Number(x)))];
  if (dayNums.some((n) => !Number.isInteger(n) || n < 1 || n > 7)) return { ok: false, error: "Çalışma günü geçersiz." };

  const accepts = (g.get("accepts_pool") ?? "1").trim();
  if (accepts !== "1" && accepts !== "0") return { ok: false, error: "Havuz kabul değeri geçersiz." };

  return {
    ok: true,
    value: {
      employment_type: (empRaw || null) as EmploymentType | null,
      hired_at: d("hired_at"),
      left_at: d("left_at"),
      authority_cert_no: text(g, "authority_cert_no", 64),
      authority_cert_expires_on: d("authority_cert_expires_on"),
      spk_cert_no: text(g, "spk_cert_no", 64),
      spk_cert_expires_on: d("spk_cert_expires_on"),
      max_active_listings: listings.value,
      max_active_demands: demands.value,
      work_days: dayNums.sort((a, b) => a - b),
      work_start: start.value,
      work_end: end.value,
      accepts_pool: accepts === "1",
      pool_paused_until_day: d("pool_paused_until"),
    },
  };
}

/** Duraklatma bitiş günü -> timestamptz (günün sonu, TR saati). */
export function pausedUntilIso(day: string | null): string | null {
  return day ? `${day}T23:59:59+03:00` : null;
}

// ---------------------------------------------------------------------------
// Uzmanlık (advisor_specialties)
// ---------------------------------------------------------------------------

export type SpecialtyKind = "property_type" | "segment";

export type SpecialtyRow = {
  kind: SpecialtyKind;
  value: string;
  transaction_type: TxType | null;
  level: 1 | 2 | 3;
  price_min: number | null;
  price_max: number | null;
  experience_years: number | null;
};

export type AllowedSpecialtyValues = { property_type: ReadonlySet<string>; segment: ReadonlySet<string> };

export function specialtyKey(r: Pick<SpecialtyRow, "kind" | "value" | "transaction_type">): string {
  return `${r.kind}|${r.value}|${r.transaction_type ?? ""}`;
}

function numOrNull(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : "bad";
}

/** JSON dizisi (istemci gizli alanı) -> doğrulanmış satırlar. `allowed`: definitions'tan gelen izinli değerler. */
export function validateSpecialties(input: unknown, allowed: AllowedSpecialtyValues): Parsed<SpecialtyRow[]> {
  if (!Array.isArray(input)) return { ok: false, error: "Uzmanlık listesi geçersiz." };
  if (input.length > MAX_SPECIALTY_ROWS) return { ok: false, error: `En fazla ${MAX_SPECIALTY_ROWS} uzmanlık satırı eklenebilir.` };
  const out: SpecialtyRow[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== "property_type" && kind !== "segment") return { ok: false, error: "Uzmanlık türü geçersiz." };
    const value = typeof r.value === "string" ? r.value.trim() : "";
    if (!value || value.length > 64) return { ok: false, error: "Uzmanlık değeri boş olamaz." };
    if (!allowed[kind].has(value)) return { ok: false, error: `"${value}" ofisin tanımlarında yok (Ayarlar > Tanımlar).` };
    const txRaw = r.transaction_type;
    const tx = txRaw === null || txRaw === undefined || txRaw === "" ? null : txRaw;
    if (tx !== null && tx !== "Satılık" && tx !== "Kiralık") return { ok: false, error: "İşlem türü Satılık veya Kiralık olmalı." };
    const level = Number(r.level ?? 2);
    if (level !== 1 && level !== 2 && level !== 3) return { ok: false, error: "Seviye 1, 2 veya 3 olmalı." };
    const min = numOrNull(r.price_min);
    const max = numOrNull(r.price_max);
    if (min === "bad" || max === "bad") return { ok: false, error: "Fiyat bandı sayı olmalı." };
    if ((min !== null && min < 0) || (max !== null && max < 0)) return { ok: false, error: "Fiyat bandı negatif olamaz." };
    if (min !== null && max !== null && min > max) return { ok: false, error: "Fiyat bandında en az, en çoktan büyük olamaz." };
    const exp = numOrNull(r.experience_years);
    if (exp === "bad" || (exp !== null && (!Number.isInteger(exp) || exp < 0 || exp > 60))) {
      return { ok: false, error: "Deneyim 0 ile 60 yıl arasında tam sayı olmalı." };
    }
    const row: SpecialtyRow = { kind, value, transaction_type: tx as TxType | null, level, price_min: min, price_max: max, experience_years: exp };
    const key = specialtyKey(row);
    if (seen.has(key)) return { ok: false, error: `"${value}" aynı işlem türüyle iki kez eklenmiş.` };
    seen.add(key);
    out.push(row);
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Bölge (advisor_regions)
// ---------------------------------------------------------------------------

export type RegionRow = {
  province_id: string;
  district_id: string | null;
  neighborhood_id: string | null;
  weight: 1 | 2 | 3 | 4 | 5;
};

export function regionKey(r: Pick<RegionRow, "province_id" | "district_id" | "neighborhood_id">): string {
  return `${r.province_id}|${r.district_id ?? ""}|${r.neighborhood_id ?? ""}`;
}

/** Yapısal doğrulama (hiyerarşi, ağırlık, tekrar). İl>ilçe>mahalle ilişkisi DB'den ayrıca doğrulanır. */
export function validateRegions(input: unknown): Parsed<RegionRow[]> {
  if (!Array.isArray(input)) return { ok: false, error: "Bölge listesi geçersiz." };
  if (input.length > MAX_REGION_ROWS) return { ok: false, error: `En fazla ${MAX_REGION_ROWS} bölge eklenebilir.` };
  const out: RegionRow[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const province = r.province_id;
    const district = r.district_id === "" || r.district_id == null ? null : r.district_id;
    const hood = r.neighborhood_id === "" || r.neighborhood_id == null ? null : r.neighborhood_id;
    if (!isUuid(province)) return { ok: false, error: "Her bölge satırında il seçilmeli." };
    if (district !== null && !isUuid(district)) return { ok: false, error: "İlçe geçersiz." };
    if (hood !== null && !isUuid(hood)) return { ok: false, error: "Mahalle geçersiz." };
    if (hood !== null && district === null) return { ok: false, error: "Mahalle seçmek için önce ilçe seçilmeli." };
    const weight = Number(r.weight ?? 3);
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) return { ok: false, error: "Ağırlık 1 ile 5 arasında olmalı." };
    const row: RegionRow = { province_id: province, district_id: district, neighborhood_id: hood, weight: weight as RegionRow["weight"] };
    const key = regionKey(row);
    if (seen.has(key)) return { ok: false, error: "Aynı bölge iki kez eklenmiş." };
    seen.add(key);
    out.push(row);
  }
  return { ok: true, value: out };
}

/** Mevcut kümeye göre fark: eklenecek / güncellenecek / silinecek anahtarlar (kayıp riskini azaltmak için tam silme yok). */
export function diffByKey<T>(
  existing: readonly (T & { id: string })[],
  next: readonly T[],
  keyOf: (r: T) => string,
  changed: (a: T, b: T) => boolean,
): { insert: T[]; update: { id: string; row: T }[]; remove: string[] } {
  const byKey = new Map(existing.map((e) => [keyOf(e), e]));
  const nextKeys = new Set(next.map(keyOf));
  const insert: T[] = [];
  const update: { id: string; row: T }[] = [];
  for (const n of next) {
    const hit = byKey.get(keyOf(n));
    if (!hit) insert.push(n);
    else if (changed(hit, n)) update.push({ id: hit.id, row: n });
  }
  const remove = existing.filter((e) => !nextKeys.has(keyOf(e))).map((e) => e.id);
  return { insert, update, remove };
}

// ---------------------------------------------------------------------------
// Belge ve kapasite özet metinleri
// ---------------------------------------------------------------------------

export function formatDocCountdown(s: DocStatus): string {
  if (s.state === "none" || s.daysLeft === null) return DOC_STATE_LABEL.none;
  if (s.state === "expired") return `${Math.abs(s.daysLeft)} gün önce doldu`;
  if (s.daysLeft === 0) return "Bugün bitiyor";
  return `${s.daysLeft} gün kaldı`;
}

// ---------------------------------------------------------------------------
// Görünüm tipleri (sunucu okuyucuları ve istemci bileşenleri ortak kullanır)
// ---------------------------------------------------------------------------

export type WorkProfileRow = {
  profile_id: string;
  employment_type: string | null;
  hired_at: string | null;
  left_at: string | null;
  authority_cert_no: string | null;
  authority_cert_expires_on: string | null;
  spk_cert_no: string | null;
  spk_cert_expires_on: string | null;
  max_active_listings: number | null;
  max_active_demands: number | null;
  work_days: number[];
  work_start: string | null;
  work_end: string | null;
  accepts_pool: boolean;
  pool_paused_until: string | null;
};

/** Kimlik özeti: ŞİFRELİ metin ve açık değer ASLA seçilmez; yalnız son 4 hane ve düz iletişim alanları. */
export type PrivateSummary = {
  national_id_last4: string | null;
  iban_last4: string | null;
  birth_date: string | null;
  address_line: string | null;
  province_id: string | null;
  district_id: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relation: string | null;
  bank_name: string | null;
  iban_holder: string | null;
};

/** Uzmanlık seçenekleri: tür = ofisin property_type tanımları, segment = advisor_segment tanımları (kodda sabit liste yok). */
export type SpecialtyOptions = {
  propertyTypes: { value: string; label: string }[];
  segments: { value: string; label: string }[];
};


export type SpecialtyView = SpecialtyRow & { id: string };
export type RegionView = RegionRow & {
  id: string;
  province_name: string | null;
  district_name: string | null;
  neighborhood_name: string | null;
};

