/**
 * Otomasyon etiket sözlüğü — liste ve detay sayfası AYNI haritayı kullanır.
 *
 * NEDEN TEK DOSYA: liste ile detay ayrı ayrı TRIGGER_LABELS/ACTION_LABELS
 * tutuyordu ve iki harita birbirinden ayrışmıştı; aynı tetikleyici listede
 * Türkçe, detayda ham enum olarak görünebiliyordu. Buradaki birleşim iki
 * sayfanın tarihsel anahtarlarının tamamını kapsar.
 */
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
  new_customer:       [],
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
  demand_stale:       [
    { value: "status",           label: "Talep durumu", hint: "new / active" },
    { value: "transaction_type", label: "İşlem türü" },
  ],
};

/** change_status aksiyonunun hedef entity'si — tetikleyiciye göre. */
export const STATUS_ENTITY_BY_TRIGGER: Record<string, "demand" | "deal"> = {
  new_demand:   "demand",
  demand_stale: "demand",
  deal_won:     "deal",
  deal_lost:    "deal",
};

export const DEMAND_STATUS_OPTIONS = [
  { value: "new",     label: "Yeni" },
  { value: "active",  label: "Aktif" },
  { value: "matched", label: "Eşleşti" },
  { value: "closed",  label: "Kapalı" },
] as const;

export const DEAL_STAGE_OPTIONS = [
  { value: "new",         label: "Yeni" },
  { value: "qualified",   label: "Nitelikli" },
  { value: "negotiation", label: "Pazarlık" },
  { value: "won",         label: "Kazanıldı" },
  { value: "lost",        label: "Kaybedildi" },
] as const;

/** Müşteri bağlamı olmayan tetikleyiciler — SMS/WhatsApp/etiket burada anlamsız. */
const NO_CUSTOMER_TRIGGERS = new Set(["new_property", "auth_expiring"]);

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
      { value: "send_sms",      label: "SMS gönder",      description: "Müşterinin telefonuna SMS gönderir." },
      { value: "send_whatsapp", label: "WhatsApp gönder", description: "Müşteriye WhatsApp mesajı gönderir." },
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
