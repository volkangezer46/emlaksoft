/** `pt_complete_session` sonuçlarının kullanıcıya gösterilen Türkçe karşılıkları (SAF, testli). */
const MESSAGES: Record<string, string> = {
  forbidden: "Bu işlem için yetkiniz yok.",
  invalid: "Aktarım oturumu bulunamadı.",
  closed: "Bu aktarım oturumu kapatılmış; yeni bir aktarım başlatın.",
  expired: "Aktarım oturumunun süresi doldu (24 saat); ilanı portföyde “Portal kaydı ekle” ile elle bağlayın.",
  property_not_found: "Portföy bulunamadı ya da size açık değil.",
  bound_to_other_property: "Bu ilan numarası bu portalda başka bir portföye bağlı.",
  invalid_input: "İlan numarası ya da bağlantı geçersiz.",
  invalid_portal: "Portal adı geçersiz.",
};

export function completeOutcomeMessage(outcome: string): string {
  return MESSAGES[outcome] ?? "İlan bağlanamadı.";
}
