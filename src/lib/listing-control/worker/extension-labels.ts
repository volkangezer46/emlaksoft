import type { ProbeClassification } from "./core";
import type { HealthLevel } from "./extension-health";

/** Eklenti popup'ı ve uygulama içi sayfa için TEK Türkçe etiket kaynağı (kopya yok). */

export const CLASSIFICATION_LABEL: Record<ProbeClassification, string> = {
  live: "Yayında",
  removed: "Yayından kaldırıldı",
  not_found: "Bulunamadı",
  blocked: "Portal engeli (kontrol edilemedi)",
  unknown: "Kontrol edilemedi",
};

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  green: "Sağlıklı",
  yellow: "Dikkat",
  red: "Sorunlu",
  idle: "Henüz veri yok",
};

export const PORTAL_LABEL: Record<string, string> = { sahibinden: "Sahibinden", hepsiemlak: "Hepsiemlak", emlakjet: "Emlakjet" };

const REASONS: Record<string, string> = {
  captcha: "Portal doğrulama (CAPTCHA) istedi",
  login_required: "Portal giriş istedi",
  http_401: "Portal oturum istedi (401)",
  http_403: "Portal erişimi reddetti (403)",
  http_429: "Portal hız sınırı gösterdi (429)",
  unexpected_structure: "Sayfa yapısı tanınmadı (portal tasarımı değişmiş olabilir)",
  id_mismatch: "Sayfadaki ilan no beklenenle uyuşmadı",
  conflicting_signals: "Sayfadaki işaretler birbiriyle çelişti",
  redirected: "Portal dışına yönlendirildi",
  timeout: "Portal zamanında yanıt vermedi",
  network_error: "Ağ bağlantısı kurulamadı",
  url_not_allowed: "İlan adresi izinli portal alanında değil",
  no_items: "Liste sayfasında ilan bulunamadı",
};

/** Hata kodu → Türkçe neden. Bilinmeyen kod ham gösterilmez (sızıntı/karışıklık yok). */
export function reasonLabel(code: string): string {
  if (REASONS[code]) return REASONS[code];
  if (/^http_5\d\d$/.test(code)) return "Portal geçici hata verdi (5xx)";
  if (/^http_\d{3}$/.test(code)) return "Portal beklenmeyen durum kodu döndürdü";
  return "Okunamadı";
}

export const RUN_STATE_LABEL = {
  disconnected: "Bağlı değil",
  paused: "Duraklatıldı",
  login_required: "EmlakSoft oturumu gerekli",
  cooldown: "Portal engeli: bekleniyor",
  outside_hours: "Çalışma saati dışında",
  waiting_app: "EmlakSoft sekmesi bekleniyor",
  day_cap: "Günlük sınıra ulaşıldı",
  hour_cap: "Saatlik sınıra ulaşıldı",
  running: "Çalışıyor",
} as const;
