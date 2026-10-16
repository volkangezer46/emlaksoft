/**
 * Otomasyon etiket sözlüğü — liste ve detay sayfası AYNI haritayı kullanır.
 *
 * NEDEN TEK DOSYA: liste ile detay ayrı ayrı TRIGGER_LABELS/ACTION_LABELS
 * tutuyordu ve iki harita birbirinden ayrışmıştı; aynı tetikleyici listede
 * Türkçe, detayda ham enum olarak görünebiliyordu. Buradaki birleşim iki
 * sayfanın tarihsel anahtarlarının tamamını kapsar.
 */
import { DEAL_STAGES } from "@/lib/workflow-state";
import { defaultStageLabels, stageLabelMap } from "@/lib/deal-stage-labels";

export const TRIGGER_LABELS: Record<string, string> = {
  new_customer:       "Yeni müşteri",
  new_demand:         "Yeni talep",
  new_property:       "Yeni portföy",
  property_matched:   "Portföy eşleşmesi",
  no_contact_days:    "İletişimsizlik süresi",
  offer_received:     "Teklif alındı",
  deal_won:           "Satış tamamlandı",
  deal_lost:          "Satış kaybedildi",
  auth_expiring:      "Yetki belgesi doluyor",
  appointment_missed: "Randevu kaçırıldı",
  demand_stale:       "Hareketsiz talep",
  new_fsbo_lead:      "Yeni sahibinden ilan",
  fsbo_no_contact_days: "Sahibinden ilan: iletişimsizlik",
  inbound_message:    "Gelen mesaj (WhatsApp / SMS)",
  lead_form_submitted: "Form başvurusu",
  authority_expiring: "Yetki belgesi bitiyor",
  portal_stale:       "Portal teyidi gecikti",
  demand_created:     "Yeni talep oluştu",
  property_created:   "Yeni portföy eklendi",
  birthday:           "Doğum günü / yıldönümü",
  no_activity:        "Uzun süre etkileşim yok",
  deal_stage:         "Anlaşma aşaması değişti",
};

export const ACTION_LABELS: Record<string, string> = {
  send_whatsapp:     "WhatsApp gönder",
  send_sms:          "SMS gönder",
  send_email:        "E-posta gönder",
  create_task:       "Görev oluştur",
  assign_to_staff:   "Danışmana ata",
  notify_manager:    "Müdüre bildir",
  notify_office:     "Ofise bildirim",
  notify_advisor:    "Danışmana bildirim",
  add_tag:           "Etiket ekle",
  change_status:     "Durum değiştir",
  send_notification: "Bildirim gönder",
};

/**
 * Eylem sonucu kodları (automation_logs.actions_taken[].detail) → Türkçe neden. Kod tanınmazsa ham değer gösterilir.
 * Kaynaklar: automation-engine.ts executeAction + İYS kapısı + sağlayıcı sonuç kodları.
 */
export const SKIP_REASON_LABELS: Record<string, string> = {
  whatsapp_template_contract_required: "onaylı WhatsApp şablonu seçilmemiş",
  iys_consent_not_granted: "İYS izni yok",
  no_customer_consent_context: "müşteri kaydı yok",
  customer_or_phone_unavailable: "müşteri telefonu yok",
  customer_or_email_unavailable: "müşteri e-postası yok",
  demo_blocked: "örnek kayıt, gönderilmedi",
  email_channel_disabled: "e-posta kanalı kapalı",
  suppressed: "adres bastırma listesinde",
  no_email_body: "e-posta metni boş",
  tenant_provider_unconfigured: "ofisin mesaj sağlayıcısı bağlı değil",
  provider_resolution_error: "sağlayıcı geçici olarak çözülemedi",
  provider_config_invalid: "sağlayıcı ayarı geçersiz",
  whatsapp_template_invalid: "şablon adı/dili geçersiz",
  unknown_provider_outcome: "gönderim sonucu belirsiz",
  invalid_phone: "telefon numarası geçersiz",
  open_task_exists: "aynı görev zaten açık",
  no_assignee: "danışman seçilmemiş",
  assignee_not_found: "danışman bulunamadı",
  no_tag: "etiket boş",
  tag_exists: "etiket zaten var",
  no_customer: "müşteri kaydı yok",
  customer_not_found: "müşteri bulunamadı",
  unsupported_action: "desteklenmeyen eylem",
  fsbo_action_closed: "sahibinden ilanda bu eylem kapalı",
  deal_stage_requires_human: "anlaşma aşamasını kişi değiştirir",
  customer_assigned: "müşteri atandı",
  property_assigned: "portföy atandı",
  fsbo_assigned: "sahibinden ilanı danışmana verildi",
};

/** Sonuç kodunu okunur nedene çevirir (http_400 gibi sağlayıcı kodları dahil). */
export function skipReasonLabel(detail: string | null | undefined): string {
  const d = String(detail ?? "").trim();
  if (!d) return "";
  if (SKIP_REASON_LABELS[d]) return SKIP_REASON_LABELS[d];
  if (/^http_\d{3}$/.test(d)) return `sağlayıcı ${d.slice(5)} hatası verdi (şablon parametresi uyuşmuyor olabilir)`;
  if (/sample|demo/i.test(d)) return "örnek kayıt, gönderilmedi";
  return d;
}

export const STATUS_LABELS: Record<string, string> = {
  active:   "Aktif",
  inactive: "Pasif",
  paused:   "Pasif",
  draft:    "Taslak",
};

/**
 * trigger_config JSON anahtarları → Türkçe etiket.
 * Anahtarlar `applyAutomationTemplate` şablonlarında üretilen değerler.
 */
export const TRIGGER_CONFIG_LABELS: Record<string, string> = {
  days:        "Gün eşiği",
  days_before: "Kaç gün kala",
  min_score:   "Asgari eşleşme puanı",
  due_minutes: "Görev süresi (dk)",
};

// ---------------------------------------------------------------------------
// Sihirbaz sözlükleri — "Yeni otomasyon" / "Düzenle" dialoglarının veri kaynağı.
// Değerler automation_trigger / automation_action enum'larıyla birebir
// (migration 20260723000036); yeni enum değeri EKLEME.
// ---------------------------------------------------------------------------

export type TriggerOption = {
  value: string;
  label: string;
  description: string;
  /** Zaman tabanlı tetikleyicilerde gün girişi (trigger_config anahtarı). */
  daysConfig?: { key: "days" | "days_before"; label: string; defaultValue: number };
};

export const TRIGGER_OPTIONS: TriggerOption[] = [
  { value: "new_customer",       label: "Yeni müşteri",           description: "Sisteme yeni bir müşteri kaydedildiğinde tetiklenir." },
  { value: "new_demand",         label: "Yeni talep",             description: "Bir müşteriye yeni talep girildiğinde tetiklenir." },
  { value: "new_property",       label: "Yeni portföy",           description: "Portföye yeni bir ilan eklendiğinde tetiklenir." },
  { value: "property_matched",   label: "Portföy eşleşmesi",      description: "Bir talep ile portföy eşleştiğinde tetiklenir." },
  { value: "offer_received",     label: "Teklif alındı",          description: "Bir portföye yeni teklif girildiğinde tetiklenir." },
  { value: "deal_won",           label: "Satış tamamlandı",       description: "Anlaşma kazanıldı aşamasına geçtiğinde tetiklenir." },
  { value: "deal_lost",          label: "Satış kaybedildi",       description: "Anlaşma kaybedildi aşamasına geçtiğinde tetiklenir." },
  { value: "no_contact_days",    label: "İletişimsizlik süresi",  description: "Belirlenen gün boyunca iletişim kurulmayan müşteriler için çalışır (günlük tarama).",
    daysConfig: { key: "days", label: "Kaç gün iletişimsizlik", defaultValue: 14 } },
  { value: "auth_expiring",      label: "Yetki belgesi doluyor",  description: "Yetki belgesi bitişine belirlenen gün kala portföyler için çalışır (günlük tarama).",
    daysConfig: { key: "days_before", label: "Bitişe kaç gün kala", defaultValue: 15 } },
  { value: "appointment_missed", label: "Randevu kaçırıldı",      description: "Saati 2 saatten fazla geçen, sonuçlanmamış randevular için çalışır (günlük tarama)." },
  { value: "demand_stale",       label: "Hareketsiz talep",       description: "Belirlenen gün boyunca güncellenmeyen açık talepler için çalışır (günlük tarama).",
    daysConfig: { key: "days", label: "Kaç gün hareketsizlik", defaultValue: 30 } },
  { value: "new_fsbo_lead",      label: "Yeni sahibinden ilan",   description: "Sahibinden ilanlar listesine yeni bir ilan eklendiğinde tetiklenir (yalnız görev, atama ve bildirim; mesaj gönderilmez)." },
  { value: "fsbo_no_contact_days", label: "Sahibinden ilan: iletişimsizlik", description: "Belirlenen gün boyunca aranmayan açık ilan sahipleri için çalışır (günlük tarama; yalnız görev, atama ve bildirim).",
    daysConfig: { key: "days", label: "Kaç gün aranmadı", defaultValue: 7 } },
  { value: "inbound_message",    label: "Gelen mesaj",            description: "Müşteri WhatsApp'tan ya da SMS ile yazdığında tetiklenir. Aynı kişi için kural saatte en çok bir kez çalışır." },
  { value: "lead_form_submitted", label: "Form başvurusu",        description: "Talep formu, vitrin ya da QR tabeladan başvuru geldiğinde tetiklenir (kayıtlı müşteri tekrar başvursa da). Kaynağa göre süzülebilir." },
];

/** Koşul operatörleri — engine'deki evaluateConditions ile birebir. */
export const CONDITION_OP_OPTIONS = [
  { value: "eq",       label: "eşittir" },
  { value: "neq",      label: "eşit değildir" },
  { value: "gt",       label: "büyüktür" },
  { value: "gte",      label: "büyük veya eşittir" },
  { value: "lt",       label: "küçüktür" },
  { value: "lte",      label: "küçük veya eşittir" },
  { value: "contains", label: "içerir" },
] as const;

export const CONDITION_OP_LABELS: Record<string, string> = Object.fromEntries(
  CONDITION_OP_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * Tetikleyici başına koşul alanı önerileri — engine'in her tetikleyicide
 * payload.fields ile geçirdiği HAM alanlar. Öneri dışı alan koşula girerse
 * evaluateConditions fail-open geçer; o yüzden yalnızca gerçekten var olan
 * alanlar listelenir.
 */
export const TRIGGER_CONDITION_FIELDS: Record<string, { value: string; label: string; hint?: string }[]> = {
  new_customer:       [
    { value: "source",  label: "Kaynak", hint: "panel / web_form / qr / whatsapp_inbound / sms_inbound" },
    { value: "channel", label: "Kanal",  hint: "panel / web_form / whatsapp / sms" },
  ],
  inbound_message:    [
    { value: "channel",        label: "Kanal",            hint: "whatsapp / sms" },
    { value: "body",           label: "Mesaj metni",      hint: "'içerir' ile ör. fiyat" },
    { value: "is_new_contact", label: "İlk temas mı",     hint: "evet / hayir" },
    { value: "after_hours",    label: "Mesai dışı mı",    hint: "evet / hayir (Pazar ve 09:00-19:00 dışı)" },
  ],
  lead_form_submitted: [
    { value: "source",         label: "Kaynak",           hint: "web_form / qr / vitrin / utm kaynağı" },
    { value: "is_new_contact", label: "Yeni müşteri mi",  hint: "evet / hayir" },
    { value: "has_property",   label: "İlan bağlamı var mı", hint: "evet / hayir" },
    { value: "after_hours",    label: "Mesai dışı mı",    hint: "evet / hayir (Pazar ve 09:00-19:00 dışı)" },
  ],
  new_demand:         [
    { value: "transaction_type", label: "İşlem türü", hint: "Satılık / Kiralık" },
    { value: "property_type",    label: "Mülk türü",  hint: "Daire, Villa, Arsa…" },
  ],
  new_property:       [
    { value: "transaction_type", label: "İşlem türü", hint: "Satılık / Kiralık" },
    { value: "property_type",    label: "Mülk türü" },
    { value: "list_price",       label: "Liste fiyatı", hint: "Sayısal karşılaştırma" },
  ],
  property_matched:   [],
  offer_received:     [{ value: "amount", label: "Teklif tutarı", hint: "Sayısal karşılaştırma" }],
  deal_won:           [
    { value: "deal_type",  label: "Anlaşma türü", hint: "sale / rent" },
    { value: "deal_value", label: "Anlaşma tutarı", hint: "Sayısal karşılaştırma" },
  ],
  deal_lost:          [
    { value: "deal_type",   label: "Anlaşma türü", hint: "sale / rent" },
    { value: "deal_value",  label: "Anlaşma tutarı" },
    { value: "loss_reason", label: "Kayıp nedeni" },
  ],
  no_contact_days:    [{ value: "full_name", label: "Müşteri adı", hint: "'içerir' ile filtrelenebilir" }],
  auth_expiring:      [{ value: "status", label: "Portföy durumu", hint: "ör. active" }],
  appointment_missed: [{ value: "status", label: "Randevu durumu", hint: "pending / confirmed" }],
  new_fsbo_lead:      [
    { value: "transaction_type", label: "İşlem türü", hint: "sale / rent" },
    { value: "price",            label: "Fiyat", hint: "Sayısal karşılaştırma" },
  ],
  fsbo_no_contact_days: [
    { value: "status",           label: "İlan durumu", hint: "yeni / arandi / randevu" },
    { value: "contact_attempts", label: "Arama denemesi", hint: "Sayısal karşılaştırma" },
  ],
  demand_stale:       [
    { value: "status",           label: "Talep durumu", hint: "new / active" },
    { value: "transaction_type", label: "İşlem türü" },
  ],
};

/** change_status aksiyonunun hedef entity'si — tetikleyiciye göre. */
export const STATUS_ENTITY_BY_TRIGGER: Record<string, "demand" | "deal"> = {
  new_demand:   "demand",
  demand_stale: "demand",
};

export const DEMAND_STATUS_OPTIONS = [
  { value: "new",     label: "Yeni" },
  { value: "active",  label: "Aktif" },
  { value: "matched", label: "Eşleşti" },
  { value: "closed",  label: "Kapalı" },
] as const;

/** Varsayılan aşama adları (tek kaynak); ofisin özel adları sihirbaza `stageNames` ile gelir. */
export const DEAL_STAGE_OPTIONS = DEAL_STAGES.map((value) => ({ value, label: stageLabelMap(defaultStageLabels())[value] }));

/** Bir kuralda en çok kaç eylem zincirlenebilir (sunucu eylemi de aynı sınırı uygular). */
export const MAX_AUTOMATION_ACTIONS = 3;

/** Müşteri bağlamı olmayan tetikleyiciler — SMS/WhatsApp/etiket burada anlamsız (FSBO tetikleyicilerinde mesaj KAPALI). */
const NO_CUSTOMER_TRIGGERS = new Set(["new_property", "auth_expiring", "new_fsbo_lead", "fsbo_no_contact_days"]);

export type ActionOption = { value: string; label: string; description: string };

/**
 * Tetikleyiciye göre seçilebilir aksiyonlar. Enum'daki tüm değerler kapsanır;
 * yalnızca ilgili tetikleyicide fiilen çalışamayacak kombinasyonlar gizlenir
 * (engine o kombinasyonlarda zaten 'skip' döner).
 */
export function availableActionsForTrigger(trigger: string): ActionOption[] {
  const options: ActionOption[] = [
    { value: "create_task",       label: "Görev oluştur",    description: "İlgili kayda bağlı takip görevi açar." },
    { value: "send_notification", label: "Bildirim gönder",  description: "Sorumlu kullanıcıya uygulama içi bildirim gönderir." },
    { value: "notify_manager",    label: "Müdüre bildir",    description: "Ofis genelinde yöneticilerin gördüğü uyarı bildirimi." },
    { value: "assign_to_staff",   label: "Danışmana ata",    description: "Kaydı (müşteri/portföy) seçilen danışmana atar." },
  ];
  if (!NO_CUSTOMER_TRIGGERS.has(trigger)) {
    options.push(
      { value: "send_sms",      label: "SMS gönder",      description: "Müşterinin telefonuna SMS gönderir (İYS izni olanlara)." },
      { value: "send_whatsapp", label: "WhatsApp şablonu gönder", description: "Meta onaylı WhatsApp şablonunu gönderir (İYS izni olanlara)." },
      { value: "send_email",    label: "E-posta gönder",  description: "Müşterinin e-posta adresine ileti gönderir (İYS izni olanlara)." },
      { value: "add_tag",       label: "Etiket ekle",     description: "Müşteri kartına otomatik etiket ekler." },
    );
  }
  if (STATUS_ENTITY_BY_TRIGGER[trigger]) {
    options.push({
      value: "change_status",
      label: "Durum değiştir",
      description: STATUS_ENTITY_BY_TRIGGER[trigger] === "demand"
        ? "Talebin durumunu otomatik değiştirir."
        : "Anlaşmanın aşamasını otomatik değiştirir.",
    });
  }
  return options;
}
