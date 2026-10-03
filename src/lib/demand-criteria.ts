import { z } from "zod";
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

/** "Olmazsa olmaz" işaretlenebilen kriter anahtarları. */
export const CRITERIA_REQUIRED_KEYS = [
  "property_type",
  "budget",
  "rooms",
  "sqm",
  "location",
  "floor",
  "heating",
  "facade",
  "features",
] as const;
export type CriteriaKey = (typeof CRITERIA_REQUIRED_KEYS)[number];

export const CRITERIA_LABELS: Record<CriteriaKey, string> = {
  property_type: "Portföy türü",
  budget: "Bütçe",
  rooms: "Oda",
  sqm: "m²",
  location: "Konum",
  floor: "Kat",
  heating: "Isınma",
  facade: "Cephe",
  features: "Özellikler",
};

const ID_RE = /^[0-9a-fA-F-]{8,40}$/;
const idOrNull = z
  .string()
  .regex(ID_RE)
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const extraLocationSchema = z.object({
  province_id: idOrNull,
  district_id: idOrNull,
  neighborhood_id: idOrNull,
});
export type DemandLocation = z.infer<typeof extraLocationSchema>;

export const MAX_EXTRA_LOCATIONS = 4;
export const MAX_FEATURE_TAGS = 12;

const intOrNull = z.number().int().min(-5).max(200).nullable().optional().transform((v) => v ?? null);

export const demandCriteriaSchema = z.object({
  required: z.array(z.enum(CRITERIA_REQUIRED_KEYS)).max(CRITERIA_REQUIRED_KEYS.length).default([]),
  max_sqm: z.number().positive().max(1_000_000).nullable().optional().transform((v) => v ?? null),
  floor_min: intOrNull,
  floor_max: intOrNull,
  heating: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  facade: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  features: z.array(z.string().trim().min(1).max(40)).max(MAX_FEATURE_TAGS).default([]),
  uses_loan: z.boolean().default(false),
  swap_ok: z.boolean().default(false),
  extra_locations: z.array(extraLocationSchema).max(MAX_EXTRA_LOCATIONS).default([]),
});

export type DemandCriteria = z.infer<typeof demandCriteriaSchema>;

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
  const r = demandCriteriaSchema.safeParse(raw);
  return r.success ? r.data : { ...EMPTY_CRITERIA };
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
    const r = z.array(extraLocationSchema).max(MAX_EXTRA_LOCATIONS).safeParse(json);
    if (!r.success) return null;
    // Boş satırı ele; il yoksa ilçe/mahalle anlamsız.
    return r.data.filter((l) => l.province_id || l.district_id || l.neighborhood_id);
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
  const criteria = demandCriteriaSchema.parse({
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
