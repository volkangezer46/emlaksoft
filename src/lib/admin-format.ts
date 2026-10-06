/** Admin panel ortak biçimlendirme yardımcıları (saf, yan etkisiz). Para biçimi TEK kaynak `@/lib/format` (formatTry). */

/** audit_logs ve platform_audit_logs.action için insana okunur etiket. */
export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    // Tenant / ops
    "ops.impersonate.start":    "Ofise giriş yapıldı",
    "ops.impersonate.stop":     "Ofisten çıkıldı",
    "tenant.create":            "Ofis oluşturuldu",
    "tenant.update":            "Ofis güncellendi",
    "subscription.update":      "Abonelik güncellendi",
    "ticket.create":            "Destek talebi açıldı",
    "ticket.reply":             "Destek talebi yanıtlandı",
    "ticket.status":            "Destek talebi durumu değişti",
    "demo.request":             "Yeni demo talebi geldi",
    "sales.status":             "Aday durumu güncellendi",
    "sales.assign":             "Aday atandı",
    "sales.convert":            "Aday ofise dönüştürüldü",
    // Platform personel
    "platform_staff.add":         "Personel eklendi",
    "platform_staff.invite":      "Personel davet edildi",
    "platform_staff.role_change": "Personel rolü değiştirildi",
    "platform_staff.deactivate":  "Personel pasif yapıldı",
    "platform_staff.reactivate":  "Personel tekrar aktif edildi",
    "platform_staff.update":         "Personel bilgileri güncellendi",
    "platform_staff.reset_link":     "Personel için sıfırlama bağlantısı üretildi",
    "platform_staff.password_reset": "Personel parolası sıfırlandı",
    "platform_staff.password_change": "Personel kendi parolasını değiştirdi",
    "platform_staff.sessions_revoke": "Personelin oturumları kapatıldı",
    "platform_staff.self_update":    "Personel kendi adını güncelledi",
    // Platform: üye (ofis kullanıcısı) yönetimi
    "platform_member.update":           "Üye bilgileri güncellendi",
    "platform_member.role_change":      "Üye rolü değiştirildi",
    "platform_member.activate":         "Üye aktifleştirildi",
    "platform_member.deactivate":       "Üye pasifleştirildi",
    "platform_member.sessions_revoke":  "Üyenin oturumları kapatıldı",
    "platform_member.reset_link":       "Üye için sıfırlama bağlantısı üretildi",
    // Platform: sistem
    "platform_settings.general_update": "Platform genel ayarları güncellendi",
    "platform_cron.run":                "Zamanlanmış iş elle çalıştırıldı",
    "error_log.resolve":                "Hata kaydı çözüldü",
    "error_log.reopen":                 "Hata kaydı yeniden açıldı",
    "error_log.bulk_resolve":           "Hatalar toplu çözüldü",
    "activity.export":                  "Aktivite kaydı dışa aktarıldı",
    // Entegrasyon anahtarları
    "integration.netgsm.save":    "Netgsm bilgileri kaydedildi",
    "integration.netgsm.clear":   "Netgsm bilgileri silindi",
    "integration.whatsapp.save":  "WhatsApp bilgileri kaydedildi",
    "integration.whatsapp.clear": "WhatsApp bilgileri silindi",
    "integration.emlakfiyati.key_change": "EmlakFiyati anahtarı değişti",
    "integration.emlakfiyati.key_clear": "EmlakFiyati anahtarı silindi",
    "integration.emlakfiyati.previous_delete": "EmlakFiyati eski anahtarı silindi",
    "integration.emlakfiyati.test": "EmlakFiyati bağlantısı denendi",
    "integration.emlakfiyati.ortak_flag": "EmlakFiyati ortak uç bayrağı değişti",
  };
  if (map[action]) return map[action];
  // Fallback: "customer.create" → "customer · create"
  return action.replace(/\./g, " · ");
}

export function relativeTimeTR(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}
