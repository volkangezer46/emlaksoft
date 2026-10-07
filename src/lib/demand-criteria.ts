import { parseMoneyInput } from "@/lib/money-input";

/**
 * Yapılandırılmış talep (müşteri formu + talep formu ortak sözleşmesi).
 *
 * Faz 1: `customer_demands` sütunları (işlem, tür, bütçe, oda, m², il/ilçe/mahalle,
 * aciliyet) aynen kullanılır; ek kriterler mevcut `criteria jsonb` sütununa yazılır
 * (migration YOK). Bu dosya: alan adları (tek kaynak), jsonb şeması (zod),
 * form değerlerinden doğrulama ve "olmazsa olmaz" anahtarları.
 * Saf modüldür (DOM/DB yok) — birim testli.
 */

/** Formda kullanılan alan adları, sekme/bölüm bazında (sekme tanımları ve sözleşme testi bunu kullanır). */
export const DEMAND_FIELD_GROUPS = {
  ne: ["transaction_type", "property_type", "urgency", "required_keys"],
  kriter: [
    "budget_min",
    "budget_max",
    "rooms",
    "min_sqm",
    "max_sqm",
    "floor_min",
    "floor_max",
    "heating",
    "facade",
    "feature_tags",
    "uses_loan",
    "swap_ok",
  ],
  bolge: ["demand_province_id", "demand_district_id", "demand_neighborhood_id", "extra_locations"],
} as const;

export const DEMAND_FIELD_NAMES: readonly string[] = [
  ...DEMAND_FIELD_GROUPS.ne,
  ...DEMAND_FIELD_GROUPS.kriter,
  ...DEMAND_FIELD_GROUPS.bolge,
];

// Kriter anahtarları + etiketleri bağımlılıksız modülde (istemci paketine zod taşımasın); burada aynen yeniden dışa aktarılır.
import { CRITERIA_REQUIRED_KEYS, CRITERIA_LABELS, type CriteriaKey } from "@/lib/demand-criteria-labels";
export { CRITERIA_REQUIRED_KEYS, CRITERIA_LABELS, type CriteriaKey };

/*
 * jsonb doğrulaması el yazımı (zod YOK): bu modül müşteri/talep/portföy formları ve içe aktarma sihirbazı üzerinden
 * istemci paketine girer; zod ~280 KB ham taşıyordu (HIZ_OLCUM_RAPORU_5 §3, P3). Kurallar eski zod şemasıyla birebir:
 * tanımsız → varsayılan, yanlış tür / sınır dışı → TÜM nesne geçersiz; bilinmeyen anahtarlar atılır.
 */
const ID_RE = /^[0-9a-fA-F-]{8,40}$/;
const INVALID = Symbol("invalid");
type Invalid = typeof INVALID;

export type DemandLocation = { province_id: string | null; district_id: string | null; neighborhood_id: string | null };

export const MAX_EXTRA_LOCATIONS = 4;
export const MAX_FEATURE_TAGS = 12;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function idOrNull(v: unknown): string | null | Invalid {
  if (v === undefined || v === null) return null;
  return typeof v === "string" && ID_RE.test(v) ? v : INVALID;
}

function parseLocation(v: unknown): DemandLocation | Invalid {
  if (!isObj(v)) return INVALID;
  const province_id = idOrNull(v.province_id);
  const district_id = idOrNull(v.district_id);
  const neighborhood_id = idOrNull(v.neighborhood_id);
  if (province_id === INVALID || district_id === INVALID || neighborhood_id === INVALID) return INVALID;
  return { province_id, district_id, neighborhood_id };
}

function parseLocations(v: unknown): DemandLocation[] | Invalid {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_EXTRA_LOCATIONS) return INVALID;
  const out: DemandLocation[] = [];
  for (const item of v) {
    const loc = parseLocation(item);
    if (loc === INVALID) return INVALID;
    out.push(loc);
  }
  return out;
}

function intOrNull(v: unknown): number | null | Invalid {
  if (v === undefined || v === null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= -5 && v <= 200 ? v : INVALID;
}

function shortText(v: unknown): string | null | Invalid {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return INVALID;
  const t = v.trim();
  return t.length > 60 ? INVALID : t || null;
}

function bool(v: unknown): boolean | Invalid {
  if (v === undefined) return false;
  return typeof v === "boolean" ? v : INVALID;
}

export type DemandCriteria = {
  required: CriteriaKey[];
  max_sqm: number | null;
  floor_min: number | null;
  floor_max: number | null;
  heating: string | null;
  facade: string | null;
  features: string[];
  uses_loan: boolean;
  swap_ok: boolean;
  extra_locations: DemandLocation[];
};

/** Eski `demandCriteriaSchema.safeParse` eşi: geçerliyse normalize nesne, değilse null. */
export function validateDemandCriteria(raw: unknown): DemandCriteria | null {
  if (!isObj(raw)) return null;
  let required: CriteriaKey[] = [];
  if (raw.required !== undefined) {
    if (!Array.isArray(raw.required) || raw.required.length > CRITERIA_REQUIRED_KEYS.length) return null;
    if (!raw.required.every((k) => typeof k === "string" && (CRITERIA_REQUIRED_KEYS as readonly string[]).includes(k))) return null;
    required = raw.required as CriteriaKey[];
  }
  let max_sqm: number | null = null;
  if (raw.max_sqm !== undefined && raw.max_sqm !== null) {
    if (typeof raw.max_sqm !== "number" || !Number.isFinite(raw.max_sqm) || raw.max_sqm <= 0 || raw.max_sqm > 1_000_000) return null;
    max_sqm = raw.max_sqm;
  }
  const floor_min = intOrNull(raw.floor_min);
  const floor_max = intOrNull(raw.floor_max);
  const heating = shortText(raw.heating);
  const facade = shortText(raw.facade);
  const uses_loan = bool(raw.uses_loan);
  const swap_ok = bool(raw.swap_ok);
  const extra_locations = parseLocations(raw.extra_locations);
  const features: string[] = [];
  if (raw.features !== undefined) {
    if (!Array.isArray(raw.features) || raw.features.length > MAX_FEATURE_TAGS) return null;
    for (const f of raw.features) {
      if (typeof f !== "string") return null;
      const t = f.trim();
      if (t.length < 1 || t.length > 40) return null;
      features.push(t);
    }
  }
  if (
    floor_min === INVALID || floor_max === INVALID || heating === INVALID || facade === INVALID ||
    uses_loan === INVALID || swap_ok === INVALID || extra_locations === INVALID
  ) {
    return null;
  }
  return { required, max_sqm, floor_min, floor_max, heating, facade, features, uses_loan, swap_ok, extra_locations };
}

export const EMPTY_CRITERIA: DemandCriteria = {
  required: [],
  max_sqm: null,
  floor_min: null,
  floor_max: null,
  heating: null,
  facade: null,
  features: [],
  uses_loan: false,
  swap_ok: false,
  extra_locations: [],
};

/**
 * DB'den gelen `criteria` jsonb'sini güvenle okur. Geçersiz/boş/eski ({}) → boş kriter
 * (eşleştirme eski davranışla birebir aynı kalır). Hata fırlatmaz.
 */
export function parseDemandCriteria(raw: unknown): DemandCriteria {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_CRITERIA };
  return validateDemandCriteria(raw) ?? { ...EMPTY_CRITERIA };
}

/** Kriter nesnesinde hiçbir ek kriter yok mu (jsonb'ye `{}` yazılsın diye). */
export function isEmptyCriteria(c: DemandCriteria): boolean {
  return (
    c.required.length === 0 &&
    c.max_sqm == null &&
    c.floor_min == null &&
    c.floor_max == null &&
    !c.heating &&
    !c.facade &&
    c.features.length === 0 &&
    !c.uses_loan &&
    !c.swap_ok &&
    c.extra_locations.length === 0
  );
}

export type DemandFormValues = Record<string, string>;

/** FormData'dan yalnız bilinen talep alanlarını (string) çeker; fazlalık yok sayılır. */
export function demandValuesFromFormData(fd: FormData): DemandFormValues {
  const out: DemandFormValues = {};
  for (const name of DEMAND_FIELD_NAMES) {
    const v = fd.get(name);
    if (typeof v === "string") out[name] = v.slice(0, 2000);
  }
  // NOT: `province_id`/`district_id` (müşterinin kendi bölgesi, müşteri formunda aynı formda
  // bulunur) bilinçli OKUNMAZ; talep bölgesi yalnız `demand_*` alanlarındandır.
  return out;
}

/** Talep sütunları — customer_demands insert/preview ortak biçimi. */
export type DemandColumns = {
  transaction_type: string;
  property_type: string | null;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
};

export type ParsedDemand =
  | { ok: true; columns: DemandColumns; criteria: DemandCriteria }
  | { ok: false; error: string };

const str = (v: string | undefined) => (v ?? "").trim();

function parsePositive(raw: string, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null };
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return { ok: false, error: `Geçerli bir ${label} girin.` };
  return { ok: true, value: n };
}

function parseFloor(raw: string, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < -5 || n > 200) return { ok: false, error: `${label} geçersiz.` };
  return { ok: true, value: n };
}

function parseExtraLocations(raw: string): DemandLocation[] | null {
  if (!raw) return [];
  try {
    const json: unknown = JSON.parse(raw);
    const r = parseLocations(json);
    if (r === INVALID) return null;
    // Boş satırı ele; il yoksa ilçe/mahalle anlamsız.
    return r.filter((l) => l.province_id || l.district_id || l.neighborhood_id);
  } catch {
    return null;
  }
}

/**
 * Form değerlerini doğrular ve sütun + criteria'ya çevirir (createDemand ve canlı önizleme
 * AYNI fonksiyonu kullanır — önizleme sayısı ile kayıt sonrası sonuç sapmasın).
 */
export function parseDemandValues(values: DemandFormValues): ParsedDemand {
  const transactionType = str(values.transaction_type);
  if (!transactionType) return { ok: false, error: "İşlem türü zorunlu." };

  const bMin = parseMoneyInput(values.budget_min, { allowZero: true, max: 100_000_000_000 });
  const bMax = parseMoneyInput(values.budget_max, { allowZero: true, max: 100_000_000_000 });
  if (!bMin.ok || !bMax.ok) return { ok: false, error: "Bütçe alanlarından biri geçersiz." };
  if (bMin.value != null && bMax.value != null && bMin.value > bMax.value) {
    return { ok: false, error: "Minimum bütçe, maksimumdan büyük olamaz." };
  }

  const minSqm = parsePositive(str(values.min_sqm), "minimum metrekare");
  if (!minSqm.ok) return minSqm;
  const maxSqm = parsePositive(str(values.max_sqm), "maksimum metrekare");
  if (!maxSqm.ok) return maxSqm;
  if (minSqm.value != null && maxSqm.value != null && minSqm.value > maxSqm.value) {
    return { ok: false, error: "Minimum m², maksimumdan büyük olamaz." };
  }

  const floorMin = parseFloor(str(values.floor_min), "Minimum kat");
  if (!floorMin.ok) return floorMin;
  const floorMax = parseFloor(str(values.floor_max), "Maksimum kat");
  if (!floorMax.ok) return floorMax;
  if (floorMin.value != null && floorMax.value != null && floorMin.value > floorMax.value) {
    return { ok: false, error: "Minimum kat, maksimumdan büyük olamaz." };
  }

  const extra = parseExtraLocations(str(values.extra_locations));
  if (extra === null) return { ok: false, error: "Ek bölge bilgisi geçersiz." };

  const tags = Array.from(
    new Set(
      str(values.feature_tags)
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
  if (tags.length > MAX_FEATURE_TAGS) return { ok: false, error: `En fazla ${MAX_FEATURE_TAGS} özellik etiketi girilebilir.` };
  if (tags.some((t) => t.length > 40)) return { ok: false, error: "Özellik etiketi en fazla 40 karakter olabilir." };

  const columns: DemandColumns = {
    transaction_type: transactionType,
    property_type: str(values.property_type) || null,
    province_id: str(values.demand_province_id) || null,
    district_id: str(values.demand_district_id) || null,
    neighborhood_id: str(values.demand_neighborhood_id) || null,
    budget_min: bMin.value,
    budget_max: bMax.value,
    rooms: str(values.rooms) || null,
    min_sqm: minSqm.value,
    urgency: str(values.urgency) || null,
  };

  const hasBudget = columns.budget_min != null || columns.budget_max != null;
  const hasLocation = Boolean(columns.province_id || columns.district_id || columns.neighborhood_id || extra.length);
  const present: Record<CriteriaKey, boolean> = {
    property_type: columns.property_type != null,
    budget: hasBudget,
    rooms: columns.rooms != null,
    sqm: columns.min_sqm != null || maxSqm.value != null,
    location: hasLocation,
    floor: floorMin.value != null || floorMax.value != null,
    heating: Boolean(str(values.heating)),
    facade: Boolean(str(values.facade)),
    features: tags.length > 0,
  };

  const requested = new Set(
    str(values.required_keys)
      .split(",")
      .map((k) => k.trim())
      .filter((k): k is CriteriaKey => (CRITERIA_REQUIRED_KEYS as readonly string[]).includes(k)),
  );
  // Bütçe girildiyse kendiliğinden olmazsa olmaz (tasarım belgesi 3a).
  if (hasBudget) requested.add("budget");
  // Değeri olmayan kriter "zorunlu" olamaz.
  const required = CRITERIA_REQUIRED_KEYS.filter((k) => requested.has(k) && present[k]);

  const truthy = (v: string | undefined) => v === "1" || v === "on" || v === "true";
  const criteria = validateDemandCriteria({
    required,
    max_sqm: maxSqm.value,
    floor_min: floorMin.value,
    floor_max: floorMax.value,
    heating: str(values.heating) || null,
    facade: str(values.facade) || null,
    features: tags,
    uses_loan: truthy(values.uses_loan),
    swap_ok: truthy(values.swap_ok),
    extra_locations: extra,
  });
  if (!criteria) return { ok: false, error: "Talep kriterleri geçersiz (ısınma/cephe en fazla 60 karakter)." };

  return { ok: true, columns, criteria };
}

/**
 * Müşteri formunda talep kaydı açılsın mı? İşlem/tür/aciliyet varsayılan seçili geldiği için
 * sayılmaz; en az bir gerçek kriter (bütçe, oda, m², bölge, kat, ısınma, cephe, etiket) gerekir.
 */
export function hasDemandContent(values: DemandFormValues): boolean {
  const keys = [
    "budget_min",
    "budget_max",
    "rooms",
    "min_sqm",
    "max_sqm",
    "floor_min",
    "floor_max",
    "heating",
    "facade",
    "feature_tags",
    "demand_province_id",
    "demand_district_id",
    "demand_neighborhood_id",
  ];
  if (keys.some((k) => str(values[k]) !== "")) return true;
  const extra = parseExtraLocations(str(values.extra_locations));
  return Boolean(extra && extra.length > 0);
}

/** Talep detayında gösterilecek ek kriter etiketleri (olmazsa olmaz olanlar "*" ile). */
export function extraCriteriaChips(c: DemandCriteria): string[] {
  const req = (k: CriteriaKey, text: string) => (c.required.includes(k) ? `${text} *` : text);
  const chips: string[] = [];
  if (c.max_sqm != null) chips.push(req("sqm", `≤ ${c.max_sqm} m²`));
  if (c.floor_min != null || c.floor_max != null) chips.push(req("floor", `Kat ${c.floor_min ?? "…"}–${c.floor_max ?? "…"}`));
  if (c.heating) chips.push(req("heating", c.heating));
  if (c.facade) chips.push(req("facade", `${c.facade} cephe`));
  for (const t of c.features) chips.push(req("features", t));
  if (c.uses_loan) chips.push("Kredi");
  if (c.swap_ok) chips.push("Takas");
  if (c.extra_locations.length > 0) chips.push(`+${c.extra_locations.length} ek bölge`);
  return chips;
}

/** Alıcı/kiracı taraf mı? Mülk sahibi ve satıcı talep değil portföy girer. */
export function isOwnerSideCustomerType(type: string | null | undefined): boolean {
  const t = (type ?? "").trim().toLocaleLowerCase("tr-TR");
  return t === "satıcı" || t === "mülk sahibi";
}

/** Eşleştirme sayfasındaki ?kriter= önizleme bağlantısı için kompakt, doğrulanmış değer paketi. */
export function encodeDemandPreviewParam(values: DemandFormValues): string {
  const compact: DemandFormValues = {};
  for (const k of DEMAND_FIELD_NAMES) {
    const v = str(values[k]);
    if (v) compact[k] = v;
  }
  return JSON.stringify(compact);
}

/** İstemciden gelen serbest nesneyi yalnız bilinen talep alanlarına (string) indirger. */
export function sanitizeDemandValues(json: unknown): DemandFormValues | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const out: DemandFormValues = {};
  for (const k of DEMAND_FIELD_NAMES) {
    const v = (json as Record<string, unknown>)[k];
    if (typeof v === "string") out[k] = v.slice(0, 2000);
  }
  return out;
}

export function decodeDemandPreviewParam(raw: string | undefined | null): DemandFormValues | null {
  if (!raw || raw.length > 4000) return null;
  try {
    return sanitizeDemandValues(JSON.parse(raw));
  } catch {
    return null;
  }
}
