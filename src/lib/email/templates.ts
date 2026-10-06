/**
 * İşlemsel e-posta şablonları (SAF). Metinler ayar defterinde (`email.template.<anahtar>.subject|body`, yönetim
 * `/admin/ayarlar/eposta`); varsayılanlar burada. Değişkenler `{ad}` biçiminde; bilinmeyen değişken olduğu gibi kalır,
 * değerler düz metin olarak yerleştirilir (HTML üretilmez → enjeksiyon yüzeyi yok).
 */

export type EmailTemplateKey = "trial_ending" | "owner_weekly_report" | "daily_digest";

export type EmailTemplateDef = {
  key: EmailTemplateKey;
  label: string;
  /** Kullanılabilir değişkenler (ekranda listelenir). */
  variables: readonly string[];
  defaultSubject: string;
  defaultBody: string;
  /** Şu an hangi akış gönderiyor (dürüst durum). */
  usedBy: string;
};

export const EMAIL_TEMPLATES: readonly EmailTemplateDef[] = [
  {
    key: "trial_ending",
    label: "Deneme süresi bitiyor",
    variables: ["ofis", "gun", "baglanti"],
    defaultSubject: "{ofis}: deneme süreniz {gun} gün içinde bitiyor",
    defaultBody:
      "Merhaba,\n\n{ofis} için EmlakSoft deneme süreniz {gun} gün içinde sona eriyor. Kesintisiz devam etmek için paketinizi seçip ödemenizi tamamlayabilirsiniz:\n{baglanti}\n\nVerileriniz silinmez.\nEmlakSoft",
    usedBy: "abonelik-kontrol (3 gün ve 1 gün kala, ofis sahibi)",
  },
  {
    key: "owner_weekly_report",
    label: "Malik haftalık raporu",
    variables: ["ofis", "portfoy", "baglanti"],
    defaultSubject: "{portfoy} için haftalık ilan raporunuz",
    defaultBody: "Merhaba,\n\n{ofis} olarak {portfoy} için haftalık pazarlama raporunuz hazır:\n{baglanti}\n\nİyi günler.",
    usedBy: "Henüz gönderilmiyor: malik paneli bağlantısında e-posta adresi tutulmuyor (SMS / bağlantı kopyala kullanılır).",
  },
  {
    key: "daily_digest",
    label: "Günlük özet",
    variables: ["ofis", "ozet", "baglanti"],
    defaultSubject: "{ofis}: günün özeti",
    defaultBody: "Merhaba,\n\n{ozet}\n\nAyrıntılar: {baglanti}",
    usedBy: "Henüz gönderilmiyor: günlük özet uygulama içi bildirim olarak kalır (e-posta tercihi ayrı karar).",
  },
];

export function templateDef(key: EmailTemplateKey): EmailTemplateDef {
  return EMAIL_TEMPLATES.find((t) => t.key === key)!;
}

export const templateSettingKey = (key: EmailTemplateKey, part: "subject" | "body") => `email.template.${key}.${part}`;

/** `{degisken}` yerleştirme (düz metin). Satır sonları korunur; değerlerdeki CR/LF konu satırında boşluğa çevrilir. */
export function renderTemplate(text: string, vars: Record<string, string | number>, opts?: { singleLine?: boolean }): string {
  const out = text.replace(/\{([a-z_]+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  return opts?.singleLine ? out.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : out;
}
