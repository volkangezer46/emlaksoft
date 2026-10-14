/**
 * Veri gezgini (SN4) İZİNLİ TABLO KAYDI — TEK KAYNAK, saf.
 *
 * Güvenlik modeli (kabul listesi; liste dışı hiçbir şey okunmaz):
 *  - Yalnız burada tanımlı tablolar ve yalnız burada tanımlı sütunlar SELECT edilir (`select` dizgesi bu listeden kurulur;
 *    URL'den sütun/tablo adı sorguya ham gitmez). Ham SQL yok; sorgu `plan.ts` güvenli oluşturucusundan geçer.
 *  - `secretColumns`: sır/jeton/ödeme referansı/gizli fiyat gibi sütunlar. Kayıtta YAZILI olmaları belgelemek içindir;
 *    `columns` içinde ASLA yer almazlar (sözleşme testi kilitler), dolayısıyla seçilmez ve gösterilmez.
 *  - `mask`: kişisel veri sütunları maskeli döner; maskeli sütunda süzgeç YOKTUR (arama ile kimlik tahmini yapılamasın).
 *  - Ofis süzgeci `tenantColumn` üzerinden (ofisler tablosunda kendi `id`'si).
 */
import type { MaskKind } from "./mask";

export type ExplorerColumnKind = "text" | "uuid" | "number" | "money" | "bool" | "date" | "datetime" | "array";

/** Süzgeç türü: `eq` tam eşleşme (seçenekli ya da serbest), `search` içerir (ilike, güvenli desen), `bool` evet/hayır. */
export type ExplorerFilterKind = "eq" | "search" | "bool";

export type ExplorerColumn = {
  key: string;
  label: string;
  kind: ExplorerColumnKind;
  mask?: MaskKind;
  filter?: ExplorerFilterKind;
  /** `eq` süzgecinin seçenekleri (şemadaki CHECK değerleri). Verilmezse serbest metin (uuid sütunlarında kimlik). */
  options?: readonly string[];
  /** Listede sütun olarak görünsün mü (hepsi ayrıntıda görünür). */
  list?: boolean;
};

export type ExplorerRecordLink = { href: string; label: string };

export type ExplorerTable = {
  /** URL anahtarı (`?tablo=`). */
  key: string;
  /** Postgres tablo adı (public şema). */
  table: string;
  label: string;
  description: string;
  /** Ofis süzgecinin sütunu; null = ofis bağı yok. */
  tenantColumn: string | null;
  /** Varsayılan sıralama (azalan) ve tarih aralığı süzgecinin sütunu. */
  orderBy: string;
  columns: readonly ExplorerColumn[];
  /** Asla seçilmeyen sır sütunları (belge + sözleşme testi). */
  secretColumns: readonly string[];
  /** Kaydın ilgili admin ekranı (tek kayda giden bağlantı kaydın kendisini ya da sahibini açar). */
  recordLink: (row: Record<string, unknown>) => ExplorerRecordLink | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const officeLink = (row: Record<string, unknown>): ExplorerRecordLink | null => {
  const t = str(row.tenant_id);
  return t ? { href: `/admin/tenants/${t}`, label: "Ofis 360'ta aç" } : null;
};

const ID: ExplorerColumn = { key: "id", label: "Kimlik", kind: "uuid", filter: "eq" };
const TENANT: ExplorerColumn = { key: "tenant_id", label: "Ofis", kind: "uuid", list: true };
const CREATED: ExplorerColumn = { key: "created_at", label: "Oluşturma", kind: "datetime", list: true };
const SAMPLE: ExplorerColumn = { key: "is_sample", label: "Örnek veri", kind: "bool", filter: "bool" };

export const EXPLORER_TABLES: readonly ExplorerTable[] = [
  {
    key: "ofisler",
    table: "tenants",
    label: "Ofisler",
    description: "Ofis kayıtları: plan, durum, deneme ve iletişim (iletişim maskeli)",
    tenantColumn: "id",
    orderBy: "created_at",
    columns: [
      ID,
      { key: "name", label: "Ofis adı", kind: "text", filter: "search", list: true },
      { key: "slug", label: "Kısa ad", kind: "text", filter: "search", list: true },
      { key: "plan", label: "Plan", kind: "text", filter: "eq", options: ["advisor", "office", "professional"], list: true },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["trial", "active", "past_due", "suspended", "cancelled"], list: true },
      { key: "trial_ends_at", label: "Deneme bitişi", kind: "datetime" },
      { key: "office_type", label: "Ofis türü", kind: "text", filter: "eq" },
      { key: "team_size", label: "Ekip büyüklüğü", kind: "text" },
      { key: "city", label: "Şehir", kind: "text", filter: "search" },
      { key: "license_no", label: "Yetki belgesi no", kind: "text" },
      { key: "phone", label: "Telefon", kind: "text", mask: "phone" },
      { key: "tax_number", label: "Vergi no", kind: "text", mask: "idNo" },
      { key: "iban", label: "IBAN", kind: "text", mask: "iban" },
      { key: "address_line", label: "Adres", kind: "text", mask: "address" },
      { key: "vitrin_enabled", label: "Vitrin açık", kind: "bool", filter: "bool" },
      CREATED,
    ],
    secretColumns: ["lead_capture_token"],
    recordLink: (row) => (str(row.id) ? { href: `/admin/tenants/${row.id}`, label: "Ofis 360'ta aç" } : null),
  },
  {
    key: "kullanicilar",
    table: "profiles",
    label: "Ofis kullanıcıları",
    description: "Ofis üyeleri: rol, durum ve ekip (ad ve telefon maskeli)",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "full_name", label: "Ad soyad", kind: "text", mask: "name", list: true },
      { key: "phone", label: "Telefon", kind: "text", mask: "phone" },
      {
        key: "role",
        label: "Rol",
        kind: "text",
        filter: "eq",
        options: ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"],
        list: true,
      },
      { key: "is_active", label: "Etkin", kind: "bool", filter: "bool", list: true },
      { key: "title", label: "Unvan", kind: "text" },
      { key: "team_id", label: "Ekip", kind: "uuid", filter: "eq" },
      { key: "two_factor_sms", label: "SMS doğrulama", kind: "bool", filter: "bool" },
      SAMPLE,
      CREATED,
    ],
    secretColumns: [],
    recordLink: (row) => (str(row.id) ? { href: `/admin/members/${row.id}`, label: "Üye ayrıntısında aç" } : null),
  },
  {
    key: "musteriler",
    table: "customers",
    label: "Müşteriler",
    description: "Ofislerin müşteri kartları: kaynak, kanal ve atama (kimlik ve iletişim maskeli)",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "full_name", label: "Ad soyad", kind: "text", mask: "name", list: true },
      { key: "phone", label: "Telefon", kind: "text", mask: "phone", list: true },
      { key: "email", label: "E-posta", kind: "text", mask: "email" },
      { key: "source", label: "Kaynak", kind: "text", filter: "eq", list: true },
      { key: "lead_channel", label: "Kanal", kind: "text", filter: "eq" },
      { key: "customer_types", label: "Müşteri türü", kind: "array" },
      { key: "assigned_to", label: "Atanan", kind: "uuid", filter: "eq" },
      { key: "blacklist", label: "Kara liste", kind: "bool", filter: "bool" },
      { key: "is_foreign", label: "Yabancı", kind: "bool", filter: "bool" },
      { key: "nationality", label: "Uyruk", kind: "text", filter: "eq" },
      { key: "passport_no", label: "Pasaport no", kind: "text", mask: "idNo" },
      { key: "birth_date", label: "Doğum tarihi", kind: "date", mask: "birthDate" },
      { key: "notes", label: "Notlar", kind: "text", mask: "freeText" },
      { key: "deleted_at", label: "Silinme", kind: "datetime" },
      SAMPLE,
      CREATED,
    ],
    secretColumns: [],
    recordLink: officeLink,
  },
  {
    key: "portfoyler",
    table: "properties",
    label: "Portföyler",
    description: "İlanlar: tür, durum, fiyat ve yetki belgesi (adres maskeli; gizli taban fiyatlar seçilmez)",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "property_code", label: "Portföy kodu", kind: "text", filter: "search", list: true },
      { key: "title", label: "Başlık", kind: "text", filter: "search", list: true },
      { key: "transaction_type", label: "İşlem", kind: "text", filter: "eq" },
      { key: "property_type", label: "Tür", kind: "text", filter: "eq" },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["draft", "live", "reserved", "sold", "rented"], list: true },
      { key: "list_price", label: "Liste fiyatı", kind: "money", list: true },
      { key: "commission_rate", label: "Komisyon oranı", kind: "number" },
      { key: "assigned_to", label: "Atanan", kind: "uuid", filter: "eq" },
      { key: "owner_customer_id", label: "Mal sahibi (müşteri)", kind: "uuid", filter: "eq" },
      { key: "address_line", label: "Adres", kind: "text", mask: "address" },
      { key: "authorization_end", label: "Yetki bitişi", kind: "date" },
      { key: "authority_doc_no", label: "Yetki belgesi no", kind: "text" },
      { key: "authority_eids_status", label: "EİDS durumu", kind: "text", filter: "eq" },
      { key: "published_at", label: "Yayın", kind: "datetime" },
      { key: "deleted_at", label: "Silinme", kind: "datetime" },
      SAMPLE,
      CREATED,
    ],
    secretColumns: ["hidden_price", "min_price"],
    recordLink: officeLink,
  },
  {
    key: "anlasmalar",
    table: "deals",
    label: "Anlaşmalar",
    description: "Satış/kiralama süreçleri: aşama, değer ve olasılık",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "deal_type", label: "Tür", kind: "text", filter: "eq", list: true },
      { key: "stage", label: "Aşama", kind: "text", filter: "eq", options: ["new", "qualified", "negotiation", "won", "lost"], list: true },
      { key: "deal_value", label: "Değer", kind: "money", list: true },
      { key: "probability", label: "Olasılık", kind: "number" },
      { key: "property_id", label: "Portföy", kind: "uuid", filter: "eq" },
      { key: "customer_id", label: "Müşteri", kind: "uuid", filter: "eq" },
      { key: "assigned_to", label: "Atanan", kind: "uuid", filter: "eq" },
      { key: "loss_reason", label: "Kayıp nedeni", kind: "text", mask: "freeText" },
      { key: "gos_reference_no", label: "GÖS referansı", kind: "text" },
      SAMPLE,
      CREATED,
    ],
    secretColumns: [],
    recordLink: officeLink,
  },
  {
    key: "randevular",
    table: "appointments",
    label: "Randevular",
    description: "Gösterim ve görüşmeler: zaman, durum ve sonuç (konum ve not maskeli)",
    tenantColumn: "tenant_id",
    orderBy: "scheduled_at",
    columns: [
      ID,
      TENANT,
      { key: "appointment_type", label: "Tür", kind: "text", filter: "eq", list: true },
      { key: "scheduled_at", label: "Zaman", kind: "datetime", list: true },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["pending", "confirmed", "signature", "completed", "cancelled"], list: true },
      { key: "outcome", label: "Sonuç", kind: "text", filter: "eq" },
      { key: "customer_id", label: "Müşteri", kind: "uuid", filter: "eq" },
      { key: "property_id", label: "Portföy", kind: "uuid", filter: "eq" },
      { key: "assigned_to", label: "Atanan", kind: "uuid", filter: "eq" },
      { key: "location", label: "Konum", kind: "text", mask: "address" },
      { key: "notes", label: "Notlar", kind: "text", mask: "freeText" },
      SAMPLE,
      CREATED,
    ],
    secretColumns: ["confirm_token", "public_booking_request_key"],
    recordLink: officeLink,
  },
  {
    key: "komisyonlar",
    table: "commissions",
    label: "Komisyonlar",
    description: "Anlaşma komisyonları: brüt, KDV ve durum",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "deal_id", label: "Anlaşma", kind: "uuid", filter: "eq", list: true },
      { key: "gross_amount", label: "Brüt", kind: "money", list: true },
      { key: "vat_amount", label: "KDV", kind: "money" },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["calculated", "paid"], list: true },
      SAMPLE,
      CREATED,
    ],
    secretColumns: [],
    recordLink: officeLink,
  },
  {
    key: "abonelikler",
    table: "subscriptions",
    label: "Abonelikler",
    description: "Ofis abonelikleri: plan, durum, dönem ve iptal",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "plan", label: "Plan", kind: "text", filter: "eq", options: ["advisor", "office", "professional"], list: true },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["trialing", "active", "past_due", "cancelled", "paused"], list: true },
      { key: "billing_cycle", label: "Dönem türü", kind: "text", filter: "eq" },
      { key: "amount_try", label: "Tutar", kind: "money", list: true },
      { key: "current_period_end", label: "Dönem sonu", kind: "datetime" },
      { key: "trial_ends_at", label: "Deneme bitişi", kind: "datetime" },
      { key: "extra_seats", label: "Ek koltuk", kind: "number" },
      { key: "cancel_at_period_end", label: "Dönem sonunda iptal", kind: "bool", filter: "bool" },
      { key: "cancel_reason_code", label: "İptal nedeni", kind: "text", filter: "eq" },
      { key: "cancelled_at", label: "İptal", kind: "datetime" },
      CREATED,
    ],
    secretColumns: ["iyzico_subscription_ref"],
    recordLink: officeLink,
  },
  {
    key: "faturalar",
    table: "invoices",
    label: "Faturalar",
    description: "Platform faturaları: tutar, KDV, vade ve ödeme (ödeme sağlayıcı referansı seçilmez)",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "invoice_no", label: "Fatura no", kind: "text", filter: "search", list: true },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["draft", "open", "paid", "void", "uncollectible"], list: true },
      { key: "amount_try", label: "Tutar", kind: "money" },
      { key: "tax_try", label: "KDV", kind: "money" },
      { key: "total_try", label: "Toplam", kind: "money", list: true },
      { key: "due_at", label: "Vade", kind: "datetime" },
      { key: "paid_at", label: "Ödeme", kind: "datetime" },
      { key: "checkout_status", label: "Ödeme sayfası", kind: "text", filter: "eq" },
      { key: "reminder_count", label: "Hatırlatma", kind: "number" },
      CREATED,
    ],
    secretColumns: ["iyzico_payment_id", "meta", "checkout_error"],
    recordLink: (row) => (str(row.id) ? { href: `/admin/billing/faturalar/${row.id}`, label: "Faturayı aç" } : null),
  },
  {
    key: "talepler",
    table: "support_tickets",
    label: "Destek talepleri",
    description: "Destek kuyruğu kayıtları: durum, öncelik ve süreler (konu maskeli, gövde seçilmez)",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "ticket_no", label: "Talep no", kind: "text", filter: "search", list: true },
      { key: "subject", label: "Konu", kind: "text", mask: "freeText", list: true },
      { key: "category", label: "Kategori", kind: "text", filter: "eq" },
      { key: "priority", label: "Öncelik", kind: "text", filter: "eq" },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["open", "in_progress", "waiting", "resolved", "closed"], list: true },
      { key: "source", label: "Kaynak", kind: "text", filter: "eq" },
      { key: "assigned_staff_id", label: "Atanan personel", kind: "uuid", filter: "eq" },
      { key: "first_response_at", label: "İlk yanıt", kind: "datetime" },
      { key: "resolved_at", label: "Çözüm", kind: "datetime" },
      CREATED,
    ],
    secretColumns: [],
    recordLink: (row) => (str(row.id) ? { href: `/admin/tickets/${row.id}`, label: "Talebi aç" } : null),
  },
  {
    key: "hatalar",
    table: "error_logs",
    label: "Hata kayıtları",
    description: "Uygulama hataları: kaynak, durum, tekrar ve sürüm (mesaj maskeli, yığın izi seçilmez)",
    tenantColumn: "tenant_id",
    orderBy: "last_seen",
    columns: [
      ID,
      TENANT,
      { key: "source", label: "Kaynak", kind: "text", filter: "eq", options: ["server", "client"], list: true },
      { key: "status", label: "Durum", kind: "text", filter: "eq", options: ["open", "ignored", "snoozed", "resolved"], list: true },
      { key: "message", label: "Mesaj", kind: "text", mask: "freeText", list: true },
      { key: "path", label: "Yol", kind: "text", filter: "search" },
      { key: "occurrences", label: "Tekrar", kind: "number" },
      { key: "release", label: "Sürüm", kind: "text", filter: "eq" },
      { key: "first_seen", label: "İlk görülme", kind: "datetime" },
      { key: "last_seen", label: "Son görülme", kind: "datetime", list: true },
      { key: "resolved_at", label: "Çözüm", kind: "datetime" },
    ],
    secretColumns: ["stack", "user_agent", "digest"],
    recordLink: (row) => {
      const t = str(row.tenant_id);
      return { href: t ? `/admin/sistem?sekme=hatalar&ofis=${t}` : "/admin/sistem?sekme=hatalar", label: "Hata kayıtlarında aç" };
    },
  },
  {
    key: "ofis-denetim",
    table: "audit_logs",
    label: "Ofis denetim izi",
    description: "Ofis içi işlem kayıtları: işlem, varlık ve zaman (değer içerikleri seçilmez, IP maskeli)",
    tenantColumn: "tenant_id",
    orderBy: "created_at",
    columns: [
      ID,
      TENANT,
      { key: "action", label: "İşlem", kind: "text", filter: "search", list: true },
      { key: "entity_type", label: "Varlık türü", kind: "text", filter: "eq", list: true },
      { key: "entity_id", label: "Varlık", kind: "uuid", filter: "eq" },
      { key: "actor_id", label: "İşlemi yapan", kind: "uuid", filter: "eq" },
      { key: "ip", label: "IP", kind: "text", mask: "ip" },
      CREATED,
    ],
    secretColumns: ["old_value", "new_value", "public_mutation_key"],
    recordLink: officeLink,
  },
];

export function explorerTable(key: string | null | undefined): ExplorerTable | null {
  return EXPLORER_TABLES.find((t) => t.key === key) ?? null;
}

/** Listede görünen sütunlar (ayrıntıda tüm sütunlar). */
export const listColumns = (t: ExplorerTable): ExplorerColumn[] => t.columns.filter((c) => c.list);

/** Süzgeç uygulanabilen sütunlar: maskeli sütun asla süzülmez. */
export const filterColumns = (t: ExplorerTable): ExplorerColumn[] => t.columns.filter((c) => c.filter && !c.mask);

/** PostgREST `select` dizgesi: YALNIZ kayıtlı sütunlar (sır sütunları burada olamaz). */
export const selectList = (t: ExplorerTable): string => t.columns.map((c) => c.key).join(", ");
