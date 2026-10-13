/** Yetki defteri olay etiketleri (SAF; istemci/sunucu güvenli). Kaynak: eids_authority_events.kind / source. */
export const EIDS_EVENT_KIND_LABELS: Record<string, string> = {
  grant: "Yetki verildi",
  revoke: "Yetki iptal edildi",
  extend: "Yetki uzatıldı",
  expire: "Süresi doldu",
  manual_set: "Elle güncellendi",
  link: "Portföye bağlandı",
  undo: "Geri alındı",
  override: "Yayın engeli aşıldı (ofis sahibi)",
};

export const EIDS_EVENT_SOURCE_LABELS: Record<string, string> = {
  email_verified: "Bakanlık e-postası (doğrulanmış)",
  email_unverified: "Bakanlık e-postası (doğrulanamadı)",
  manual: "Elle",
  document: "Belge",
  portal_check: "Portal kontrolü",
  system: "Sistem",
};
