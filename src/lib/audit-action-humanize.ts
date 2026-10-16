import { actionLabel } from "@/lib/audit-labels";

/**
 * Denetim/işlem akışı etiketi TEK yardımcı (SAF). Önce elle yazılmış sözlük (`audit-labels.ts`), yoksa koddan TÜRKÇE
 * türetme: "module.toggle" → "Modül açıldı/kapatıldı", "site_page.publish" → "Site sayfası yayımlandı".
 *
 * Neden: 500+ işlem kodunun ~400'ü sözlükte yoktu ve Ofis kontrol akışı / denetim kaydı / rapor ham kodu
 * ("module.bundle") gösteriyordu. Ham kod kullanıcıya ASLA çıkmaz: bilinmeyen özne "Sistem işlemi", bilinmeyen
 * fiil "<Özne> işlemi" olur.
 */

/** Sık görülen ofis işlemleri için elle yazılmış ek etiketler (genel sözlüğü tamamlar). */
const EXPLICIT: Record<string, string> = {
  "module.toggle": "Modül açıldı/kapatıldı",
  "module.bundle": "Modül paketi açıldı/kapatıldı",
  "module.preset": "Hazır modül seti uygulandı",
  "module.setup": "Modül kurulumu yapıldı",
  "module.platform_set": "Modül platformdan ayarlandı",
  "settings.write": "Ayar güncellendi",
  "settings.matching_weights": "Eşleştirme ağırlıkları güncellendi",
  "settings.vitrin_update": "Vitrin ayarları güncellendi",
  "settings.watermark_update": "Filigran ayarları güncellendi",
  "auth.demo_login": "Demo girişi yapıldı",
  "report.export": "Rapor indirildi",
  "sms.send": "SMS gönderildi",
  "permission.role_update": "Rol izinleri güncellendi",
  "permission.role_reset": "Rol izinleri varsayılana döndü",
  "team.owner_transfer": "Ofis sahipliği devredildi",
  "team.handoff.failed": "Danışman devri başarısız",
  "office_center.advisor_deactivate": "Danışman pasife alındı",
  "office_center.advisor_reactivate": "Danışman yeniden etkinleştirildi",
  "office_center.advisor_update": "Danışman bilgisi güncellendi",
  "advisor_pii.reveal": "Danışman kişisel verisi görüntülendi",
  "owner_iban.reveal": "Mülk sahibi IBAN'ı görüntülendi",
  "test.audit": "Test kaydı",
  "test.fk": "Test kaydı",
};

/** Öznenin Türkçe adı (kodun ilk parçası). */
const SUBJECT: Record<string, string> = {
  account: "Hesap", accounting: "Muhasebe", advisor_pii: "Danışman kişisel verisi", advisor_private: "Danışman özel bilgisi",
  advisor_profile: "Danışman profili", advisor_regions: "Danışman bölgeleri", advisor_specialties: "Danışman uzmanlıkları",
  agent_profile: "Danışman profili", ai: "Yapay zeka", ai_credits: "AI kredisi", alert_channel: "Uyarı kanalı",
  alert_rule: "Uyarı kuralı", api_key: "API anahtarı", appointment: "Randevu", assistant: "Asistan", auth: "Giriş",
  automation: "Otomasyon", billing: "Faturalama", booking: "Randevu sayfası", brand: "Marka", broadcast: "Toplu duyuru",
  building_announcement: "Bina duyurusu", campaign: "Kampanya", changelog: "Yenilik notu", coaching: "Birebir görüşme",
  commission: "Komisyon", commission_payout: "Komisyon ödemesi", compliance_ledger: "Yasal kayıt defteri",
  contract: "Sözleşme", contract_template: "Sözleşme şablonu", custom_field: "Özel alan", customer: "Müşteri",
  deal: "Anlaşma", deal_checklist: "Anlaşma kontrol listesi", definition: "Seçim listesi", demand: "Talep",
  document_request: "Evrak talebi", duty: "Nöbet", ef: "Piyasa analizi", ef_credits: "Analiz bakiyesi", eids: "EİDS",
  einvoice: "E-fatura", error_log: "Hata kaydı", expense: "Gider", expense_budget: "Gider bütçesi", export: "Dışa aktarma",
  feature_flag: "Özellik bayrağı", feature_request: "Öneri", finance: "Finans", fsbo: "Sahibinden ilan", geo: "Coğrafya",
  google: "Google bağlantısı", growth: "Ortaklık", help_article: "Yardım makalesi", import: "İçe aktarma",
  insight: "İçgörü", integration: "Entegrasyon", kvkk: "KVKK", lead: "Gelen aday", league: "Lig",
  legal_constant: "Yasal sabit", legal_doc: "Yasal metin", listing_pool: "İlan havuzu", marketing_spend: "Pazarlama gideri",
  match: "Eşleşme", measure: "Ölçüm", message_template: "Mesaj şablonu", module: "Modül", network: "Ofis ağı",
  office_center: "Ofis merkezi", optimizer: "İlan iyileştirici", owner_charge: "Mülk sahibi tahakkuku",
  owner_iban: "Mülk sahibi IBAN", payment_link: "Ödeme bağlantısı", permission: "Yetki", personel: "Personel",
  platform: "Platform", platform_cron: "Zamanlanmış iş", platform_member: "Platform üyesi", platform_role: "Platform rolü",
  platform_settings: "Platform ayarı", platform_staff: "Personel", playbook: "Satış senaryosu", portal: "Portal",
  presentation: "Sunum", pricing_page: "Fiyat sayfası", project: "Proje", project_media: "Proje medyası",
  project_unit: "Proje birimi", property: "Portföy", property_media: "Portföy medyası", publishing: "Yayın",
  recruit: "Danışman adayı", referral: "Tavsiye", referral_link: "Tavsiye bağlantısı", rental: "Kiralama",
  rental_application: "Kira başvurusu", rental_application_link: "Kira başvuru bağlantısı", rental_deposit: "Depozito",
  rental_inspection: "Teslim tutanağı", report: "Rapor", sample_data: "Örnek veri", security: "Güvenlik",
  settings: "Ayar", site_content: "Site içeriği", site_guide: "Rehber yazısı", site_media: "Site medyası",
  site_menu: "Site menüsü", site_page: "Site sayfası", sms: "SMS", staff_leave: "İzin", status_incident: "Durum olayı",
  subscription: "Abonelik", support: "Destek", survey: "Anket", task: "Görev", team: "Ekip", tenant: "Ofis",
  tenant_tag: "Ofis etiketi", test: "Test", ticket: "Destek talebi", unit_payment: "Birim ödeme planı",
  valuation: "Değerleme", voice_note: "Sesli not", webhook: "Webhook", whatsapp: "WhatsApp",
};

/** Fiil (kodun son parçası) → edilgen geçmiş zaman. */
const VERB: Record<string, string> = {
  create: "oluşturuldu", created: "oluşturuldu", add: "eklendi", update: "güncellendi", updated: "güncellendi",
  save: "kaydedildi", saved: "kaydedildi", delete: "silindi", remove: "kaldırıldı", removed: "kaldırıldı",
  bulk_delete: "toplu silindi", bulk_assign: "toplu atandı", bulk_status: "toplu durum değişti", bulk_stage: "toplu aşama değişti",
  bulk_create: "toplu oluşturuldu", assign: "atandı", assign_cancel: "ataması iptal edildi", toggle: "açıldı/kapatıldı",
  publish: "yayımlandı", unpublish: "yayından kaldırıldı", publish_now: "hemen yayımlandı", publish_all: "toplu yayımlandı",
  schedule: "zamanlandı", unschedule: "zamanlaması kaldırıldı", scheduled_publish: "zamanında yayımlandı",
  draft_save: "taslağı kaydedildi", draft_discard: "taslağı atıldı", draft_delete: "taslağı silindi", discard_draft: "taslağı atıldı",
  rollback: "önceki sürüme döndü", restore: "geri yüklendi", reset: "varsayılana döndü", archive: "arşivlendi",
  import: "içe aktarıldı", import_batch: "toplu içe aktarıldı", export: "dışa aktarıldı", download: "indirildi",
  zip_download: "toplu indirildi", upload: "yüklendi", media_upload: "medyası yüklendi", send: "gönderildi", sent: "gönderildi",
  bulk_sent: "toplu gönderildi", retry: "yeniden denendi", cancel: "iptal edildi", cancelled: "iptal edildi",
  approved: "onaylandı", rejected: "reddedildi", requested: "istendi", closed: "kapatıldı", completed: "tamamlandı",
  complete: "tamamlandı", complete_bulk: "toplu tamamlandı", resolve: "çözüldü", bulk_resolve: "toplu çözüldü", reopen: "yeniden açıldı",
  connect: "bağlandı", disconnect: "bağlantısı kesildi", connect_started: "bağlantısı başlatıldı", test: "test edildi",
  test_connection: "bağlantısı test edildi", self_test: "kendi kendine test edildi", revoke: "iptal edildi", revoked: "iptal edildi",
  regenerate: "yenilendi", share: "paylaşıldı", unshare: "paylaşımı kaldırıldı", duplicate: "kopyalandı", merge: "birleştirildi",
  move: "taşındı", extend: "uzatıldı", suspend: "askıya alındı", status: "durumu değişti", settings: "ayarları güncellendi",
  settings_update: "ayarları güncellendi", template: "şablonu uygulandı", reveal: "görüntülendi", note: "notu eklendi",
  note_append: "notu eklendi", tag_add: "etiketi eklendi", tag_remove: "etiketi kaldırıldı", contact_add: "kişisi eklendi",
  contact_remove: "kişisi kaldırıldı", relation_add: "ilişkisi eklendi", relation_remove: "ilişkisi kaldırıldı",
  link: "bağlandı", unlink: "bağlantısı kaldırıldı", clear: "temizlendi", set: "ayarlandı", apply: "uygulandı",
  handoff: "devredildi", handoff_failed: "devri başarısız", failed: "başarısız", ok: "doğrulandı", verified: "doğrulandı",
  submit: "gönderildi", submitted: "gönderildi", issue: "kesildi", void: "iptal edildi", pay: "ödendi", run: "çalıştırıldı",
  role_change: "rolü değişti", role_update: "rol izinleri güncellendi", role_reset: "rol izinleri sıfırlandı", scope: "kapsamı değişti",
  sessions_revoke: "oturumları kapatıldı", password_reset: "parolası sıfırlandı", password_change: "parolası değişti",
  two_factor_reset: "iki adımlı doğrulaması sıfırlandı", mfa_reset: "iki adımlı doğrulaması sıfırlandı",
  status_update: "durumu güncellendi", reschedule: "yeniden planlandı", trigger: "tetiklendi", convert: "dönüştürüldü",
  claim: "üstlenildi", return: "iade edildi", lost: "kayıp bildirildi", checkout: "teslim edildi", finalize: "kesinleştirildi",
  setup: "kurulumu yapıldı", preset: "hazır seti uygulandı", bundle: "paketi değiştirildi", seed: "yüklendi",
  seed_defaults: "varsayılanları yüklendi", reorder: "sırası değişti", meta: "bilgisi güncellendi", ocr: "metni okundu",
  triage: "önceliklendirildi", ignore: "yok sayıldı", audit: "denetlendi", autopilot: "otomatik iyileştirildi",
  write: "güncellendi", widen: "genişletildi", erasure: "silmesi uygulandı", package: "veri paketi hazırlandı",
  identity: "kimliği doğrulandı", released: "bırakıldı", result: "sonuçlandı", hide: "gizlendi", color: "rengi değişti",
};

function sentence(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : s;
}

/** Koddan Türkçe etiket türetir (sözlükte olmayan kodlar için). Ham kod döndürmez. */
export function humanizeAuditAction(action: string): string {
  if (EXPLICIT[action]) return EXPLICIT[action];
  const parts = action.split(".").filter(Boolean);
  const subject = parts.length ? SUBJECT[parts[0]!] : undefined;
  if (!subject) return "Sistem işlemi";
  if (parts.length < 2) return `${subject} işlemi`;
  const verb = VERB[parts[parts.length - 1]!];
  return sentence(verb ? `${subject} ${verb}` : `${subject} işlemi`);
}

/** Denetim etiketinin tek girişi: sözlük → ek etiketler → türetme. */
export function auditLabelOf(action: string, extra?: Readonly<Record<string, string>>): string {
  return actionLabel[action] ?? extra?.[action] ?? humanizeAuditAction(action);
}
