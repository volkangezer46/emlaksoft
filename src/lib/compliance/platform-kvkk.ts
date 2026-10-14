import { DAY_MS, trDayStartMs } from "@/lib/clock";
import { KVKK_DEADLINE_DAYS, KVKK_WARN_DAYS, kvkkTone, type KvkkTone } from "./kvkk-queue";

/**
 * PLATFORM KVKK BAŞVURULARI (DG6) — SAF parça (DB yok; sunucu, istemci formu, rapor kataloğu ve testler ortak).
 *
 * Akış: herkese açık form (/kvkk-basvuru) → e-posta doğrulama kodu (30 dk) → admin kuyruğu (/admin/tickets/kvkk?kaynak=basvuru,
 * 30 gün yasal süre sayacı) → kimlik doğrulama → veri paketi hazırlığı (dosya: Raporlar > "KVKK veri paketi") → silme
 * talebinde mevcut anonimleştirme akışı (anonymize_customer; yasal saklama kayıtları korunur) → yanıt (AD7 kvkk_reply)
 * ve sonuç kaydı. Ofislerin kendi kaydettiği talepler (kvkk_requests) ayrı akıştır; bu başvurular EmlakSoft'a doğrudan gelir.
 * Sunucu tarafı: `platform-kvkk-service.ts`; eylemler `app/actions/kvkk-public.ts` + `admin-kvkk-requests.ts`.
 */

export const PLATFORM_KVKK_TYPES = ["access", "rectification", "erasure", "portability", "objection"] as const;
export type PlatformKvkkType = (typeof PLATFORM_KVKK_TYPES)[number];

export const PLATFORM_KVKK_TYPE_LABELS: Record<PlatformKvkkType, string> = {
  access: "Bilgi talebi (erişim)",
  rectification: "Düzeltme",
  erasure: "Silme / anonimleştirme",
  portability: "Veri taşınabilirliği",
  objection: "İtiraz",
};

/** Formda tür seçeneğinin altındaki tek satırlık açıklama (KVKK m.11). */
export const PLATFORM_KVKK_TYPE_HINTS: Record<PlatformKvkkType, string> = {
  access: "Verilerimin işlenip işlenmediğini ve hangi verilerin tutulduğunu öğrenmek istiyorum.",
  rectification: "Eksik ya da yanlış işlenen verilerimin düzeltilmesini istiyorum.",
  erasure: "Verilerimin silinmesini ya da anonim hâle getirilmesini istiyorum.",
  portability: "Verilerimin bir kopyasını dosya olarak almak istiyorum.",
  objection: "Verilerimin işlenmesine ya da otomatik analiz sonucuna itiraz ediyorum.",
};

export const PLATFORM_KVKK_STATUSES = ["awaiting_email", "open", "in_progress", "completed", "rejected"] as const;
export type PlatformKvkkStatus = (typeof PLATFORM_KVKK_STATUSES)[number];

export const PLATFORM_KVKK_STATUS_LABELS: Record<PlatformKvkkStatus, string> = {
  awaiting_email: "E-posta doğrulaması bekliyor",
  open: "Yeni",
  in_progress: "İşlemde",
  completed: "Sonuçlandı",
  rejected: "Reddedildi",
};

/** Kuyrukta görünen (e-postası doğrulanmış) durumlar; açık = yanıt verilmemiş. */
export const PLATFORM_KVKK_QUEUE_STATUSES = ["open", "in_progress", "completed", "rejected"] as const;
export const PLATFORM_KVKK_OPEN_STATUSES = ["open", "in_progress"] as const;

export const IDENTITY_STATUS_LABELS = { pending: "Bekliyor", verified: "Doğrulandı", failed: "Doğrulanamadı" } as const;
export type IdentityStatus = keyof typeof IDENTITY_STATUS_LABELS;

export const IDENTITY_METHODS = ["email_document", "e_signature", "kep", "notary", "in_person", "other"] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];
export const IDENTITY_METHOD_LABELS: Record<IdentityMethod, string> = {
  email_document: "Doğrulanmış e-posta + kimlik belgesi teyidi",
  e_signature: "Güvenli elektronik imza",
  kep: "KEP (kayıtlı elektronik posta)",
  notary: "Noter",
  in_person: "Yüz yüze / ıslak imzalı dilekçe",
  other: "Diğer (notta açıklanır)",
};

export const PLATFORM_KVKK_OUTCOMES = ["completed", "rejected"] as const;
export type PlatformKvkkOutcome = (typeof PLATFORM_KVKK_OUTCOMES)[number];

/** Doğrulama kodu geçerliliği, deneme ve yeniden gönderim sınırları; doğrulanmayan başvurunun saklama süresi. */
export const VERIFY_CODE_TTL_MINUTES = 30;
export const VERIFY_MAX_ATTEMPTS = 5;
export const VERIFY_MAX_SENDS = 3;
export const UNVERIFIED_RETENTION_DAYS = 7;
/** Yasal yanıt süresi (KVKK m.13) ve kuyruk sarı eşiği (ofis kuyruğuyla aynı). */
export const PLATFORM_KVKK_DEADLINE_DAYS = KVKK_DEADLINE_DAYS;
export const PLATFORM_KVKK_WARN_DAYS = KVKK_WARN_DAYS;

export const DETAILS_MIN = 10;
export const DETAILS_MAX = 4000;
export const RESPONSE_MIN = 20;
export const RESPONSE_MAX = 4000;

export function isPlatformKvkkType(v: unknown): v is PlatformKvkkType {
  return typeof v === "string" && (PLATFORM_KVKK_TYPES as readonly string[]).includes(v);
}
export function isPlatformKvkkStatus(v: unknown): v is PlatformKvkkStatus {
  return typeof v === "string" && (PLATFORM_KVKK_STATUSES as readonly string[]).includes(v);
}
export function isIdentityMethod(v: unknown): v is IdentityMethod {
  return typeof v === "string" && (IDENTITY_METHODS as readonly string[]).includes(v);
}

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 0/O ve 1/I karışmaz
/** Başvuru no: `KVKK-<yıl>-<6 karakter>` (rastgele baytlar dışarıdan; saf ve test edilir). */
export function buildKvkkRef(year: number, bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[(bytes[i] ?? 0) % REF_ALPHABET.length];
  return `KVKK-${year}-${s}`;
}
export const KVKK_REF_RE = /^KVKK-\d{4}-[0-9A-Z]{6}$/;

/** Son tarih: doğrulanan başvurunun oluşturma anı + 30 gün. */
export function platformKvkkDueIso(createdIso: string): string {
  return new Date(Date.parse(createdIso) + PLATFORM_KVKK_DEADLINE_DAYS * DAY_MS).toISOString();
}

/** Kalan gün (TR takvim günü): son tarihin TR günü − bugünün TR günü. Kapanmış ya da doğrulanmamış başvuruda null. */
export function platformKvkkDaysLeft(dueIso: string | null, status: string, nowMs: number): number | null {
  if (!dueIso || !(PLATFORM_KVKK_OPEN_STATUSES as readonly string[]).includes(status)) return null;
  const t = Date.parse(dueIso);
  if (!Number.isFinite(t)) return null;
  return Math.round((trDayStartMs(t) - trDayStartMs(nowMs)) / DAY_MS);
}

export function platformKvkkTone(daysLeft: number | null): KvkkTone {
  return kvkkTone(daysLeft);
}

/** SLA uyarı sınıfı: gecikmiş / eşik içinde / sorun yok (uyarı motoru ve kuyruk ortak). */
export function slaBucket(daysLeft: number | null, warnDays: number): "late" | "warn" | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return "late";
  if (daysLeft <= warnDays) return "warn";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Adım kapıları (sunucu eylemi ve ekran aynı kuralı kullanır)
// ---------------------------------------------------------------------------------------------------------------------

export type PlatformKvkkGateRow = {
  status: string;
  request_type: string;
  identity_status: string;
  package_prepared_at: string | null;
  erasure_applied_at: string | null;
};

const isOpen = (r: PlatformKvkkGateRow) => (PLATFORM_KVKK_OPEN_STATUSES as readonly string[]).includes(r.status);

/** Kimlik adımı: yalnız açık başvuruda (sonuçlanmış başvurunun kimlik kaydı değişmez). */
export function identityBlocker(r: PlatformKvkkGateRow): string | null {
  if (!isOpen(r)) return "Başvuru sonuçlanmış; kimlik kaydı değiştirilemez.";
  return null;
}

/** Veri paketi: kimlik doğrulanmadan kişiye ait kayıt derlenmez (KVKK: yanlış kişiye veri vermemek). */
export function packageBlocker(r: PlatformKvkkGateRow): string | null {
  if (!isOpen(r)) return "Başvuru sonuçlanmış.";
  if (r.identity_status !== "verified") return "Önce başvuru sahibinin kimliğini doğrulayın.";
  // Silinen küme incelenen taramadır; silmeden sonra tarama kaydı (kimlikler) kanıt olarak değişmez.
  if (r.erasure_applied_at) return "Silme uygulandı; tarama kaydı artık değiştirilemez.";
  return null;
}

/** Silme: yalnız silme türünde, kimlik doğrulanmış ve kayıtlar taranmış (paket hazırlanmış) başvuruda, bir kez. */
export function erasureBlocker(r: PlatformKvkkGateRow): string | null {
  if (r.request_type !== "erasure") return "Silme yalnız silme / anonimleştirme başvurusunda uygulanır.";
  if (!isOpen(r)) return "Başvuru sonuçlanmış.";
  if (r.identity_status !== "verified") return "Önce başvuru sahibinin kimliğini doğrulayın.";
  if (!r.package_prepared_at) return "Önce kayıtları tarayın (veri paketini hazırlayın); silinecek kayıtlar böylece görülür.";
  if (r.erasure_applied_at) return "Silme bu başvuruda zaten uygulandı.";
  return null;
}

/**
 * Yanıt + sonuç: sonuçlandırma (completed) kimlik doğrulaması ve kayıt taraması ister; silme başvurusu ayrıca silmenin
 * uygulanmasını ister. Ret (rejected) her açık başvuruda verilebilir (ör. kimlik doğrulanamadı) ama gerekçe ister.
 */
export function respondBlocker(r: PlatformKvkkGateRow, outcome: PlatformKvkkOutcome): string | null {
  if (!isOpen(r)) return "Başvuru zaten sonuçlanmış.";
  if (outcome === "rejected") return null;
  if (r.identity_status !== "verified") return "Kimliği doğrulanmamış başvuru sonuçlandırılamaz; gerekirse gerekçeyle reddedin.";
  if (!r.package_prepared_at) return "Önce kayıtları tarayın (veri paketini hazırlayın).";
  if (r.request_type === "erasure" && !r.erasure_applied_at) return "Silme başvurusunda önce silmeyi uygulayın.";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Kayıt eşleşmesi özeti + yasal saklama
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Eşleşme gerekçesi: `email` = başvuranın KODLA DOĞRULANMIŞ e-postası (varsayılan kapsam); `phone` = başvuranın yazdığı
 * ama doğrulanmamış telefon. Telefonla (yalnız) eşleşen kayıt başka bir kişiye ait olabilir: veri paketine ve silmeye
 * ancak personel o kaydı tek tek onaylarsa girer (`approvedPhone`).
 */
export type MatchBasis = "email" | "phone";
export const MATCH_BASIS_LABELS: Record<MatchBasis, string> = {
  email: "Doğrulanmış e-posta",
  phone: "Telefon (doğrulanmamış)",
};

export type SubjectCustomer = {
  id: string;
  tenantId: string;
  tenantName: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string | null;
  deletedAt: string | null;
  source: string | null;
  notes: string | null;
  birthDate: string | null;
  customerTypes: string[];
  /** İlişkili kayıt sayıları (anlaşma, randevu, çağrı, iletişim, teklif, görev, İYS onayı). */
  related: Record<string, number>;
  matchedBy: MatchBasis;
};

export type SubjectSimple = { id: string; label: string; createdAt: string | null; fields: Record<string, string | null>; matchedBy: MatchBasis };

export type SubjectRecords = {
  customers: SubjectCustomer[];
  demoRequests: SubjectSimple[];
  visitors: SubjectSimple[];
  /** Silinmeyen (yasal saklama) kayıt türü sayıları: imzacı, muhasebe cari kaydı (yalnız doğrulanmış e-postayla). */
  signers: number;
  financeParties: number;
};

export const RELATED_LABELS: Record<string, string> = {
  deals: "Anlaşma",
  appointments: "Randevu",
  calls: "Çağrı",
  communications: "İletişim kaydı",
  offers: "Teklif",
  tasks: "Görev",
  iys_consents: "İYS izin kaydı",
};

/** Yasal saklama gerekçeleri (silme sonucu ve yanıt metninde aynı dil). */
export const LEGAL_HOLD_REASONS = {
  deals: "Anlaşma ve komisyon kayıtları (6102 TTK m.82 ve 213 VUK m.253 gereği 10 yıl): satır korunur, kişi alanları anonimleşir.",
  signers: "İmzalı sözleşme imzacı kayıtları (ispat yükümlülüğü, zamanaşımı süresince) korunur.",
  financeParties: "Muhasebe cari kayıtları (213 VUK m.253) korunur.",
} as const;

/** Taramada bulunan tek kayıt (kimliğiyle saklanır: silme YALNIZ incelenen bu kümeye uygulanır). */
export type ScannedKind = "customer" | "demo" | "visitor";
export const SCANNED_KIND_LABELS: Record<ScannedKind, string> = {
  customer: "Ofis müşteri kaydı",
  demo: "EmlakSoft demo talebi",
  visitor: "Açık ev ziyaretçi kaydı",
};
export type ScannedRecord = {
  key: string;
  kind: ScannedKind;
  id: string;
  tenantId: string | null;
  office: string;
  /** Maskeli ad (personel uyuşmazlığı görsün diye; tam ad yalnız veri paketinde). */
  name: string;
  matchedBy: MatchBasis;
  related: Record<string, number>;
};

export const customerKey = (tenantId: string, id: string) => `customer:${tenantId}:${id}`;
export const demoKey = (id: string) => `demo:${id}`;
export const visitorKey = (id: string) => `visitor:${id}`;

/** "Ayşe Yılmaz" → "A*** Y***" (boşsa "İsimsiz"). */
export function maskPersonName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "İsimsiz";
  return parts.map((p) => `${Array.from(p)[0] ?? ""}***`).join(" ");
}

export function scanRecords(r: SubjectRecords): ScannedRecord[] {
  return [
    ...r.customers.map((c) => ({
      key: customerKey(c.tenantId, c.id),
      kind: "customer" as const,
      id: c.id,
      tenantId: c.tenantId,
      office: c.tenantName,
      name: maskPersonName(c.fullName),
      matchedBy: c.matchedBy,
      related: c.related,
    })),
    ...r.demoRequests.map((d) => ({
      key: demoKey(d.id),
      kind: "demo" as const,
      id: d.id,
      tenantId: null,
      office: "EmlakSoft",
      name: maskPersonName(d.fields["Ad soyad"]),
      matchedBy: d.matchedBy,
      related: {},
    })),
    ...r.visitors.map((v) => ({
      key: visitorKey(v.id),
      kind: "visitor" as const,
      id: v.id,
      tenantId: null,
      office: v.label,
      name: maskPersonName(v.fields["Ad soyad"]),
      matchedBy: v.matchedBy,
      related: {},
    })),
  ];
}

/** Kapsam: doğrulanmış e-postayla eşleşen her kayıt + personelin tek tek onayladığı telefon eşleşmeleri. */
export function inScope(rec: { key: string; matchedBy: MatchBasis }, approvedPhone: ReadonlySet<string>): boolean {
  return rec.matchedBy === "email" || approvedPhone.has(rec.key);
}

export type PackageSummary = {
  /** KAPSAMDAKİ kayıt sayıları (veri paketi ve silme bunlara uygulanır). */
  customers: number;
  offices: number;
  demoRequests: number;
  visitors: number;
  related: Record<string, number>;
  legalHolds: string[];
  /** Onay bekleyen (kapsam dışı) telefon eşleşmesi sayısı. */
  phoneCandidates: number;
  /** Taramada bulunan TÜM kayıtlar (kimlik + ofis + maskeli ad + eşleşme gerekçesi). */
  records: ScannedRecord[];
  /** Personelin kapsama aldığı telefon eşleşmelerinin anahtarları. */
  approvedPhone: string[];
  signers: number;
  financeParties: number;
};

export function summarizeScan(records: ScannedRecord[], approvedPhone: string[], signers: number, financeParties: number): PackageSummary {
  const phoneKeys = new Set(records.filter((r) => r.matchedBy === "phone").map((r) => r.key));
  const approved = [...new Set(approvedPhone)].filter((k) => phoneKeys.has(k));
  const approvedSet = new Set(approved);
  const scoped = records.filter((r) => inScope(r, approvedSet));
  const related: Record<string, number> = {};
  for (const c of scoped) for (const [k, n] of Object.entries(c.related)) related[k] = (related[k] ?? 0) + n;
  const legalHolds: string[] = [];
  if ((related.deals ?? 0) > 0) legalHolds.push(LEGAL_HOLD_REASONS.deals);
  if (signers > 0) legalHolds.push(LEGAL_HOLD_REASONS.signers);
  if (financeParties > 0) legalHolds.push(LEGAL_HOLD_REASONS.financeParties);
  const customers = scoped.filter((r) => r.kind === "customer");
  return {
    customers: customers.length,
    offices: new Set(customers.map((c) => c.tenantId)).size,
    demoRequests: scoped.filter((r) => r.kind === "demo").length,
    visitors: scoped.filter((r) => r.kind === "visitor").length,
    related,
    legalHolds,
    phoneCandidates: phoneKeys.size - approved.length,
    records,
    approvedPhone: approved,
    signers,
    financeParties,
  };
}

export function summarizeRecords(r: SubjectRecords, approvedPhone: string[] = []): PackageSummary {
  return summarizeScan(scanRecords(r), approvedPhone, r.signers, r.financeParties);
}

/** Taramadan yalnız kapsamdaki kayıtlar (veri paketi bunu kullanır). */
export function scopeSubjectRecords(r: SubjectRecords, approvedPhone: string[]): SubjectRecords {
  const approved = new Set(approvedPhone);
  return {
    ...r,
    customers: r.customers.filter((c) => inScope({ key: customerKey(c.tenantId, c.id), matchedBy: c.matchedBy }, approved)),
    demoRequests: r.demoRequests.filter((d) => inScope({ key: demoKey(d.id), matchedBy: d.matchedBy }, approved)),
    visitors: r.visitors.filter((v) => inScope({ key: visitorKey(v.id), matchedBy: v.matchedBy }, approved)),
  };
}

/**
 * Silme anındaki yeni taramada, incelenen (kaydedilmiş) kapsamda OLMAYAN ama kapsama girecek kayıtlar. Boş değilse silme
 * yapılmaz, yeniden tarama istenir (incelenmeyen kayıt anonimleşmez).
 */
export function scopeDrift(stored: PackageSummary, current: ScannedRecord[]): string[] {
  const approved = new Set(stored.approvedPhone);
  const reviewed = new Set(stored.records.filter((r) => inScope(r, approved)).map((r) => r.key));
  return current.filter((r) => inScope(r, approved) && !reviewed.has(r.key)).map((r) => r.key);
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function parseScanned(v: unknown): ScannedRecord | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<ScannedRecord>;
  if (typeof o.key !== "string" || typeof o.id !== "string") return null;
  if (o.kind !== "customer" && o.kind !== "demo" && o.kind !== "visitor") return null;
  return {
    key: o.key,
    kind: o.kind,
    id: o.id,
    tenantId: typeof o.tenantId === "string" ? o.tenantId : null,
    office: String(o.office ?? ""),
    name: String(o.name ?? "İsimsiz"),
    matchedBy: o.matchedBy === "email" ? "email" : "phone",
    related: o.related && typeof o.related === "object" ? (o.related as Record<string, number>) : {},
  };
}

export function parsePackageSummary(v: unknown): PackageSummary | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<PackageSummary>;
  return {
    customers: num(o.customers),
    offices: num(o.offices),
    demoRequests: num(o.demoRequests),
    visitors: num(o.visitors),
    related: o.related && typeof o.related === "object" ? (o.related as Record<string, number>) : {},
    legalHolds: Array.isArray(o.legalHolds) ? o.legalHolds.map(String) : [],
    phoneCandidates: num(o.phoneCandidates),
    records: Array.isArray(o.records) ? o.records.map(parseScanned).filter((r): r is ScannedRecord => r !== null) : [],
    approvedPhone: Array.isArray(o.approvedPhone) ? o.approvedPhone.map(String) : [],
    signers: num(o.signers),
    financeParties: num(o.financeParties),
  };
}

/** Veri paketi satırı (rapor merkezi: XLSX'te `bolum` sütununa göre sayfalara bölünür). */
export type PackageRow = { bolum: string; ofis: string; kayit: string; alan: string; deger: string; tarih: string | null };

const CUSTOMER_FIELDS: [keyof SubjectCustomer, string][] = [
  ["fullName", "Ad soyad"],
  ["phone", "Telefon"],
  ["email", "E-posta"],
  ["birthDate", "Doğum tarihi"],
  ["source", "Kaynak"],
  ["notes", "Not"],
];

/** Eşleşen kayıtları alan/değer satırlarına çevirir (boş alan yazılmaz; ilişkili kayıtlar sayı olarak). */
export function buildPackageRows(r: SubjectRecords): PackageRow[] {
  const rows: PackageRow[] = [];
  r.customers.forEach((c, i) => {
    const kayit = `Müşteri kaydı ${i + 1}`;
    for (const [k, label] of CUSTOMER_FIELDS) {
      const v = c[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") rows.push({ bolum: "Ofis kayıtları", ofis: c.tenantName, kayit, alan: label, deger: String(v), tarih: c.createdAt });
    }
    if (c.customerTypes.length) rows.push({ bolum: "Ofis kayıtları", ofis: c.tenantName, kayit, alan: "Müşteri türü", deger: c.customerTypes.join(", "), tarih: c.createdAt });
    if (c.deletedAt) rows.push({ bolum: "Ofis kayıtları", ofis: c.tenantName, kayit, alan: "Silinme (ofis tarafından)", deger: c.deletedAt.slice(0, 10), tarih: c.createdAt });
    for (const [k, n] of Object.entries(c.related)) {
      if (n > 0) rows.push({ bolum: "İlişkili kayıtlar", ofis: c.tenantName, kayit, alan: RELATED_LABELS[k] ?? k, deger: `${n} kayıt`, tarih: c.createdAt });
    }
  });
  for (const d of r.demoRequests) {
    for (const [alan, v] of Object.entries(d.fields)) if (v) rows.push({ bolum: "EmlakSoft kayıtları", ofis: "EmlakSoft", kayit: d.label, alan, deger: v, tarih: d.createdAt });
  }
  for (const v of r.visitors) {
    for (const [alan, val] of Object.entries(v.fields)) if (val) rows.push({ bolum: "Ofis kayıtları", ofis: v.label, kayit: "Açık ev ziyaretçi kaydı", alan, deger: val, tarih: v.createdAt });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Yanıt şablonları (AD7 `kvkk_reply` şablonunun {yanit} değişkenine yerleşir; personel düzenleyebilir)
// ---------------------------------------------------------------------------------------------------------------------

export function defaultResponseText(type: PlatformKvkkType, outcome: PlatformKvkkOutcome, summary: PackageSummary | null): string {
  if (outcome === "rejected") {
    return "Başvurunuzu inceledik; ancak başvuru sahibinin kimliğini doğrulayamadığımız için talebinizi bu aşamada yerine getiremiyoruz. Kimliğinizi teyit eden belgeyle (ör. güvenli elektronik imzalı ya da KEP üzerinden) yeniden başvurabilirsiniz.";
  }
  const found = summary ? summary.customers + summary.demoRequests + summary.visitors : 0;
  const scope = summary
    ? found > 0
      ? `Sistemimizde adınıza ${found} kayıt bulundu${summary.offices > 0 ? ` (${summary.offices} emlak ofisinin kayıtlarında)` : ""}.`
      : "Sistemimizde e-posta adresiniz ve telefon numaranızla eşleşen kayıt bulunmadı."
    : "";
  const holds = summary?.legalHolds.length ? `\n\nYasal saklama yükümlülüğü nedeniyle korunan kayıtlar:\n- ${summary.legalHolds.join("\n- ")}` : "";
  switch (type) {
    case "access":
      return `${scope} İşlenen verilerinizin dökümü ekte/aşağıda bilginize sunulmuştur. Emlak ofislerinin girdiği müşteri kayıtlarında ilgili ofis veri sorumlusu, EmlakSoft veri işleyendir.`.trim();
    case "portability":
      return `${scope} Verilerinizin yapılandırılmış kopyası (Excel) güvenli yolla tarafınıza iletilmiştir.`.trim();
    case "erasure":
      return `${scope} Kişisel verileriniz silinmiş ya da geri döndürülemez biçimde anonim hâle getirilmiştir.${holds}`.trim();
    case "rectification":
      return `${scope} Düzeltme talebiniz ilgili kayıtlarda uygulanmıştır.`.trim();
    case "objection":
      return `${scope} İtirazınız değerlendirilmiş ve ilgili işleme faaliyeti durdurulmuştur.`.trim();
  }
}
