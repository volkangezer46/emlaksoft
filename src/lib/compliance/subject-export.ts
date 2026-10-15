import { createHash } from "node:crypto";

/**
 * KVKK veri sahibi dökümü (araştırma 7) — erişim (md. 11/1-b,c) ve taşınabilirlik talebine tek tıkla yanıt.
 *
 * Kapsam: kişi kartı, talepler (arama kriterleri), randevular, iletişim kayıtları (mesaj/not/e-posta), çağrılar,
 * teklifler, İYS izinleri + izin geçmişi, belge LİSTESİ (dosya içeriği değil), KVKK başvuruları ve işlem izi
 * (hangi işlem, ne zaman — eski/yeni değerler dökülmez). İç kimlikler (tenant/kullanıcı uuid'leri, depolama yolu,
 * imza belirteçleri) dökümde YOK; kişiye ait veri ve işleme bilgisi var.
 *
 * Bu modül iki parçadır: `loadSubjectData` (çağıranın verdiği istemcilerle okur; RLS'li istemci + yalnız servis rolüne
 * açık iki kanıt tablosu için kiracı süzgeçli admin istemcisi) ve SAF `buildSubjectExport` (testli). Her kaynak
 * bağımsız okunur: biri okunamazsa döküm durmaz, `warnings` içinde Türkçe not düşülür.
 */

export const SUBJECT_EXPORT_FORMAT = "emlaksoft.kvkk.subject-export";
export const SUBJECT_EXPORT_VERSION = 1;
export const SUBJECT_EXPORT_ROW_LIMIT = 1000;

type Row = Record<string, unknown>;

export type SubjectSectionKey =
  | "demands"
  | "appointments"
  | "communications"
  | "calls"
  | "offers"
  | "consents"
  | "consent_events"
  | "documents"
  | "kvkk_requests"
  | "audit_trail";

export const SUBJECT_SECTION_LABELS: Record<SubjectSectionKey, string> = {
  demands: "Talepler (arama kriterleri)",
  appointments: "Randevular",
  communications: "İletişim kayıtları ve mesajlar",
  calls: "Telefon görüşmeleri",
  offers: "Teklifler",
  consents: "İleti izinleri (İYS)",
  consent_events: "İzin geçmişi",
  documents: "Belgeler (liste)",
  kvkk_requests: "KVKK başvuruları",
  audit_trail: "İşlem kaydı",
};

export const SUBJECT_SECTION_ORDER: SubjectSectionKey[] = [
  "demands",
  "appointments",
  "communications",
  "calls",
  "offers",
  "consents",
  "consent_events",
  "documents",
  "kvkk_requests",
  "audit_trail",
];

export type RawSubjectData = {
  customer: Row | null;
  sections: Partial<Record<SubjectSectionKey, Row[]>>;
  warnings: string[];
};

export type SubjectExport = {
  format: typeof SUBJECT_EXPORT_FORMAT;
  version: number;
  generated_at: string;
  controller: { name: string | null };
  request: { id: string; type: string; created_at: string | null; due_at: string | null };
  subject: Row;
  sections: Record<SubjectSectionKey, Row[]>;
  counts: Record<SubjectSectionKey, number>;
  warnings: string[];
};

/** Her bölümde dökülen alanlar (beyaz liste: iç kimlik ve yol sızmaz). */
const SECTION_FIELDS: Record<SubjectSectionKey, string[]> = {
  demands: ["transaction_type", "property_type", "budget_min", "budget_max", "rooms", "min_sqm", "urgency", "status", "created_at"],
  appointments: ["appointment_type", "scheduled_at", "duration_min", "location", "status", "notes", "created_at"],
  communications: ["channel", "direction", "subject", "body", "outcome", "duration_sec", "scheduled_at", "created_at"],
  calls: ["direction", "phone", "duration_sec", "disposition", "notes", "started_at"],
  offers: ["amount", "status", "created_at"],
  consents: ["channel", "status", "source", "granted_at", "revoked_at", "created_at"],
  consent_events: ["channel", "from_status", "to_status", "source", "occurred_at"],
  documents: ["file_name", "file_type", "file_size", "label", "created_at"],
  kvkk_requests: ["request_type", "status", "created_at", "due_at", "resolved_at"],
  audit_trail: ["action", "created_at"],
};

const SUBJECT_FIELDS = [
  "full_name",
  "phone",
  "email",
  "customer_types",
  "tags",
  "source",
  "lead_source",
  "lead_source_detail",
  "notes",
  "blacklist",
  "birth_date",
  "anniversary_date",
  "is_foreign",
  "nationality",
  "province",
  "district",
  "created_at",
];

function pick(row: Row, fields: string[]): Row {
  const out: Row = {};
  for (const field of fields) {
    let value = row[field];
    // PostgREST gömmesi ({ name }) düz metne iner.
    if (value && typeof value === "object" && !Array.isArray(value) && "name" in (value as Row)) {
      value = (value as Row).name ?? null;
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] && "name" in value[0]) {
      value = (value[0] as Row).name ?? null;
    }
    if (value !== undefined) out[field] = value;
  }
  return out;
}

export function buildSubjectExport(
  raw: RawSubjectData,
  meta: { requestId: string; requestType: string; requestCreatedAt: string | null; dueAt: string | null; officeName: string | null; generatedAt: string },
): SubjectExport {
  const sections = {} as Record<SubjectSectionKey, Row[]>;
  const counts = {} as Record<SubjectSectionKey, number>;
  for (const key of SUBJECT_SECTION_ORDER) {
    const rows = (raw.sections[key] ?? []).slice(0, SUBJECT_EXPORT_ROW_LIMIT).map((r) => pick(r, SECTION_FIELDS[key]));
    sections[key] = rows;
    counts[key] = rows.length;
  }
  const warnings = [...raw.warnings];
  for (const key of SUBJECT_SECTION_ORDER) {
    if ((raw.sections[key]?.length ?? 0) > SUBJECT_EXPORT_ROW_LIMIT) {
      warnings.push(`${SUBJECT_SECTION_LABELS[key]}: ilk ${SUBJECT_EXPORT_ROW_LIMIT} kayıt alındı.`);
    }
  }
  return {
    format: SUBJECT_EXPORT_FORMAT,
    version: SUBJECT_EXPORT_VERSION,
    generated_at: meta.generatedAt,
    controller: { name: meta.officeName },
    request: { id: meta.requestId, type: meta.requestType, created_at: meta.requestCreatedAt, due_at: meta.dueAt },
    subject: raw.customer ? pick(raw.customer, SUBJECT_FIELDS) : {},
    sections,
    counts,
    warnings,
  };
}

/** Anahtarları özyinelemeli sıralı, boşluksuz JSON (jsonb anahtar sırasını değiştirdiği için özet buna göre alınır). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Row)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const SUBJECT_EXPORT_INTEGRITY_NOTE =
  "sha256 = SHA-256(UTF-8, anahtarları sıralı ve boşluksuz JSON; 'integrity' alanı hariç). Döküm oluşturulduğu andaki halinin kanıtıdır.";

/** Değişmezlik kanıtı: kanonik JSON'un SHA-256'sı (dökümle birlikte saklanır ve çıktıda gösterilir). */
export function subjectExportHash(doc: SubjectExport): string {
  return createHash("sha256").update(canonicalJson(doc), "utf8").digest("hex");
}

export function subjectExportFileName(doc: Pick<SubjectExport, "generated_at" | "request">): string {
  const day = doc.generated_at.slice(0, 10);
  return `kvkk-veri-dokumu-${doc.request.id.slice(0, 8)}-${day}.json`;
}

type QueryResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Selectable = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, opts: { ascending: boolean }) => { limit: (n: number) => QueryResult };
          maybeSingle: () => QueryResult;
        };
      };
    };
  };
};

const CUSTOMER_COLUMNS =
  "id, full_name, phone, email, customer_types, tags, source, lead_source, lead_source_detail, notes, blacklist, birth_date, anniversary_date, is_foreign, nationality, created_at, province:geo_provinces(name), district:geo_districts(name)";

const SOURCES: { key: SubjectSectionKey; table: string; columns: string; order: string; filter: "customer_id" | "entity_id"; admin?: boolean }[] = [
  { key: "demands", table: "customer_demands", columns: SECTION_FIELDS.demands.join(", "), order: "created_at", filter: "customer_id" },
  { key: "appointments", table: "appointments", columns: SECTION_FIELDS.appointments.join(", "), order: "scheduled_at", filter: "customer_id" },
  { key: "communications", table: "communications", columns: SECTION_FIELDS.communications.join(", "), order: "created_at", filter: "customer_id" },
  { key: "calls", table: "calls", columns: SECTION_FIELDS.calls.join(", "), order: "started_at", filter: "customer_id" },
  { key: "offers", table: "offers", columns: SECTION_FIELDS.offers.join(", "), order: "created_at", filter: "customer_id" },
  { key: "consents", table: "iys_consents", columns: SECTION_FIELDS.consents.join(", "), order: "created_at", filter: "customer_id" },
  { key: "consent_events", table: "iys_consent_events", columns: SECTION_FIELDS.consent_events.join(", "), order: "occurred_at", filter: "customer_id", admin: true },
  { key: "documents", table: "customer_files", columns: SECTION_FIELDS.documents.join(", "), order: "created_at", filter: "customer_id" },
  { key: "kvkk_requests", table: "kvkk_requests", columns: SECTION_FIELDS.kvkk_requests.join(", "), order: "created_at", filter: "customer_id" },
  { key: "audit_trail", table: "audit_logs", columns: SECTION_FIELDS.audit_trail.join(", "), order: "created_at", filter: "entity_id", admin: true },
];

/**
 * Kaynakları paralel okur. `db`: çağıranın RLS'li istemcisi; `evidence`: yalnız servis rolüne açık iki kanıt tablosu
 * (izin olayları, işlem kaydı) için admin istemcisi — HER sorgu `tenant_id` ile süzülür (çağıran yetkiyi doğrulamış olmalı).
 */
export async function loadSubjectData(db: unknown, evidence: unknown, tenantId: string, customerId: string): Promise<RawSubjectData> {
  const user = db as Selectable;
  const admin = evidence as Selectable;
  const warnings: string[] = [];
  const [customerRes, ...sectionRes] = await Promise.all([
    user.from("customers").select(CUSTOMER_COLUMNS).eq("id", customerId).eq("tenant_id", tenantId).maybeSingle(),
    ...SOURCES.map((s) =>
      (s.admin ? admin : user)
        .from(s.table)
        .select(s.columns)
        .eq("tenant_id", tenantId)
        .eq(s.filter, customerId)
        .order(s.order, { ascending: false })
        .limit(SUBJECT_EXPORT_ROW_LIMIT + 1),
    ),
  ]);
  const sections: Partial<Record<SubjectSectionKey, Row[]>> = {};
  SOURCES.forEach((s, i) => {
    const res = sectionRes[i]!;
    if (res.error) {
      warnings.push(`${SUBJECT_SECTION_LABELS[s.key]} okunamadı; bu bölüm boş bırakıldı.`);
      sections[s.key] = [];
    } else {
      sections[s.key] = (res.data as Row[] | null) ?? [];
    }
  });
  if (customerRes.error) warnings.push("Kişi kartı okunamadı.");
  return { customer: (customerRes.data as Row | null) ?? null, sections, warnings };
}

/** Görünen değer: tarih → tr-TR, boolean → Evet/Hayır, dizi → virgüllü. Yazdırılabilir dökümde kullanılır. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (Array.isArray(value)) return value.length ? value.map((v) => displayValue(v)).join(", ") : "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(d);
    }
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const SUBJECT_FIELD_LABELS: Record<string, string> = {
  full_name: "Ad soyad",
  phone: "Telefon",
  email: "E-posta",
  customer_types: "Müşteri türü",
  tags: "Etiketler",
  source: "Kaynak",
  lead_source: "Başvuru kaynağı",
  lead_source_detail: "Kaynak ayrıntısı",
  notes: "Notlar",
  blacklist: "Kara liste",
  birth_date: "Doğum tarihi",
  anniversary_date: "Özel gün",
  is_foreign: "Yabancı uyruklu",
  nationality: "Uyruk",
  province: "İl",
  district: "İlçe",
  created_at: "Kayıt tarihi",
  transaction_type: "İşlem",
  property_type: "Mülk tipi",
  budget_min: "Bütçe (en az)",
  budget_max: "Bütçe (en çok)",
  rooms: "Oda",
  min_sqm: "En az m²",
  urgency: "Aciliyet",
  status: "Durum",
  appointment_type: "Tür",
  scheduled_at: "Tarih",
  duration_min: "Süre (dk)",
  location: "Konum",
  channel: "Kanal",
  direction: "Yön",
  subject: "Konu",
  body: "İçerik",
  outcome: "Sonuç",
  duration_sec: "Süre (sn)",
  disposition: "Sonuç",
  started_at: "Tarih",
  amount: "Tutar",
  source_detail: "Kaynak",
  granted_at: "Verildiği tarih",
  revoked_at: "Geri alındığı tarih",
  from_status: "Önceki durum",
  to_status: "Yeni durum",
  occurred_at: "Tarih",
  file_name: "Dosya adı",
  file_type: "Tür",
  file_size: "Boyut (bayt)",
  label: "Etiket",
  request_type: "Başvuru türü",
  due_at: "Yanıt süresi",
  resolved_at: "Sonuçlandığı tarih",
  action: "İşlem",
};
