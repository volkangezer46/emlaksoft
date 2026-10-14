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
    // Giriş
    "auth.demo_login":          "Demo girişi yapıldı",
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
    "personel.mfa_reset":            "Personelin iki adımlı doğrulayıcısı sıfırlandı",
    // Güvenlik politikası
    "security.feature_flag":         "Özellik bayrağı değiştirildi",
    "security.maintenance_scope":    "Bakım kapsamı değiştirildi",
    "security.mfa_enforcement":      "Personel MFA zorunluluğu değiştirildi",
    "security.mfa_grace":            "MFA geçiş süresi değiştirildi",
    "security.demo_login_mode":      "Demo girişi ayarı değiştirildi",
    "security.policy.update":        "Ofis güvenlik politikası güncellendi",
    "security.session.revoke":       "Oturumlar kapatıldı",
    "security.two_factor_reset":     "İki adımlı doğrulama sıfırlandı",
    "settings.write":                "Ayar değiştirildi",
    // DG1: özel roller ve dört göz onayı
    "platform_role.create":          "Özel rol oluşturuldu",
    "platform_role.update":          "Özel rol güncellendi",
    "platform_role.delete":          "Özel rol silindi",
    "platform.approval.requested":   "Dört göz onayı istendi",
    "platform.approval.approved":    "Dört göz onayı verildi",
    "platform.approval.executed":    "Onaylanan işlem uygulandı",
    "platform.approval.failed":      "Onaylanan işlem uygulanamadı",
    "platform.approval.rejected":    "Dört göz onayı reddedildi",
    "platform.approval.cancelled":   "Dört göz onay talebi geri çekildi",
    // DG7: özellik bayrağı hedefleme
    "feature_flag.rule_create":      "Bayrak hedefleme kuralı eklendi",
    "feature_flag.rule_update":      "Bayrak hedefleme kuralı güncellendi",
    "feature_flag.rule_delete":      "Bayrak hedefleme kuralı silindi",
    // DG8: NPS anketi ve öneri panosu
    "nps.create":                    "NPS anketi oluşturuldu",
    "nps.update":                    "NPS anketi güncellendi",
    "nps.activate":                  "NPS anketi başlatıldı",
    "nps.deactivate":                "NPS anketi durduruldu",
    "feature_request.status":        "Öneri durumu değişti",
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
    // KVKK veri sahibi başvuruları (DG6)
    "kvkk.public.submitted":        "KVKK başvurusu alındı (e-posta doğrulaması bekliyor)",
    "kvkk.public.code_resent":      "KVKK başvurusu için yeni doğrulama kodu gönderildi",
    "kvkk.public.verified":         "KVKK başvurusunun e-postası doğrulandı",
    "kvkk.request.identity":        "KVKK başvurusunda kimlik kontrolü kaydedildi",
    "kvkk.request.package":         "KVKK veri paketi hazırlandı",
    "kvkk.request.scope":           "KVKK başvurusunda telefon eşleşmesi kapsamı güncellendi",
    "kvkk.request.erasure_started": "KVKK silmesi başlatıldı",
    "kvkk.request.erasure":         "KVKK silmesi uygulandı",
    "kvkk.request.closed":          "KVKK başvurusu sonuçlandırıldı",
    "kvkk.request.assigned":        "KVKK başvurusu üstlenildi",
    "kvkk.request.released":        "KVKK başvurusu bırakıldı",
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
