/**
 * İşlemsel e-posta şablonları (SAF). Metinler ayar defterinde (`email.template.<anahtar>.subject|body`, kayıt
 * `src/lib/settings/registry/email.ts`, yönetim `/admin/ayarlar/eposta?sekme=sablonlar`); varsayılanlar burada.
 * Değişkenler `{ad}` biçiminde ve YALNIZ değişken kataloğundan (`EMAIL_VARIABLES`) seçilir: şablonun listesinde olmayan
 * değişken içeren metin KAYDEDİLEMEZ (`templateTextRule`, ayar defterinin çapraz kuralı). Değerler düz metin olarak
 * yerleştirilir; HTML gövde ortak marka yerleşimiyle (`renderBrandedHtml`) üretilir ve her değer kaçışlanır.
 *
 * Auth şablonları (davet, sıfırlama, doğrulama, sihirli bağlantı, e-posta değişikliği) GoTrue tarafından gönderilir:
 * `/api/auth-templates/[type]` admin metnini Go şablon yer tutucularıyla (`{{ .ConfirmationURL }}` ...) HTML olarak sunar.
 * Konu satırı GoTrue ortam değişkeninden (GOTRUE_MAILER_SUBJECTS_*) gelir; panelde yalnız gövde düzenlenir.
 */

// ---------------------------------------------------------------------------
// Değişken kataloğu
// ---------------------------------------------------------------------------

export type EmailVariableDef = {
  label: string;
  /** Önizleme ve örnek gönderim değeri (gerçek kişi/ofis verisi YOK). */
  sample: string | number;
  /** Bağlantı değişkeni: tek başına satırdaysa HTML'de düğme olur. */
  url?: boolean;
  /** Auth şablonunda karşılığı olan GoTrue yer tutucusu. */
  goTemplate?: string;
};

export const EMAIL_VARIABLES = {
  ofis: { label: "Ofis adı", sample: "Örnek Emlak Ofisi" },
  ad: { label: "Alıcının adı", sample: "Ayşe Yılmaz" },
  gun: { label: "Gün sayısı", sample: 3 },
  baglanti: { label: "Bağlantı (adres)", sample: "https://emlaksoft.com.tr/app", url: true, goTemplate: "{{ .ConfirmationURL }}" },
  portfoy: { label: "Portföy başlığı", sample: "Örnek Mah. 3+1 Daire" },
  ozet: { label: "Özet metni", sample: "Bugün 3 yeni talep, 2 randevu ve 1 imza bekleyen anlaşma var." },
  davet_eden: { label: "Daveti gönderen", sample: "Mehmet Demir" },
  fatura_no: { label: "Fatura / makbuz no", sample: "ES-2026-000123" },
  tutar: { label: "Tutar (₺ biçimli)", sample: "1.490 ₺" },
  tarih: { label: "Tarih", sample: "13 Ekim 2026" },
  son_tarih: { label: "Son ödeme tarihi", sample: "20 Ekim 2026" },
  neden: { label: "Hata nedeni", sample: "Kart bakiyesi yetersiz" },
  eski_plan: { label: "Önceki paket", sample: "Ofis" },
  yeni_plan: { label: "Yeni paket", sample: "Ofis Pro" },
  talep_no: { label: "Destek talebi no", sample: "#1042" },
  konu: { label: "Konu", sample: "Portföy aktarımı" },
  yanit: { label: "Yanıt metni", sample: "Talebiniz incelendi; aktarım tamamlandı." },
  basvuru_no: { label: "KVKK başvuru no", sample: "KVKK-2026-0007" },
  kod: { label: "Tek kullanımlık kod", sample: "123456", goTemplate: "{{ .Token }}" },
  eposta: { label: "Alıcının e-postası", sample: "ornek@ornek.com", goTemplate: "{{ .Email }}" },
  yeni_eposta: { label: "Yeni e-posta adresi", sample: "yeni@ornek.com", goTemplate: "{{ .NewEmail }}" },
  site: { label: "Site adresi", sample: "https://emlaksoft.com.tr", url: true, goTemplate: "{{ .SiteURL }}" },
} as const satisfies Record<string, EmailVariableDef>;

export type EmailVariableName = keyof typeof EMAIL_VARIABLES;

// ---------------------------------------------------------------------------
// Şablon kataloğu
// ---------------------------------------------------------------------------

export type EmailTemplateKey =
  | "trial_ending"
  | "trial_ended"
  | "owner_weekly_report"
  | "daily_digest"
  | "welcome"
  | "team_invite"
  | "receipt"
  | "payment_failed"
  | "dunning_1"
  | "dunning_2"
  | "dunning_3"
  | "plan_changed"
  | "ticket_reply"
  | "kvkk_reply"
  | "auth_invite"
  | "auth_confirmation"
  | "auth_recovery"
  | "auth_magic_link"
  | "auth_email_change";

export type EmailTemplateGroup = "hesap" | "abonelik" | "destek" | "ofis" | "auth";

export const EMAIL_TEMPLATE_GROUPS: { id: EmailTemplateGroup; label: string }[] = [
  { id: "hesap", label: "Hesap ve karşılama" },
  { id: "abonelik", label: "Abonelik ve ödeme" },
  { id: "destek", label: "Destek ve KVKK" },
  { id: "ofis", label: "Ofis bildirimleri" },
  { id: "auth", label: "Giriş e-postaları (Supabase Auth)" },
];

export type EmailTemplateDef = {
  key: EmailTemplateKey;
  label: string;
  group: EmailTemplateGroup;
  /** Kullanılabilir değişkenler (katalogdan; ekranda listelenir, dışındakiler kaydedilemez). */
  variables: readonly EmailVariableName[];
  defaultSubject: string;
  defaultBody: string;
  /** Şu an hangi akış gönderiyor (dürüst durum). */
  usedBy: string;
  /** Auth şablonu: GoTrue tipi (`/api/auth-templates/<tip>`); konu panelden değişmez. */
  authType?: AuthTemplateType;
};

export const AUTH_TEMPLATE_TYPES = ["invite", "confirmation", "recovery", "magic_link", "email_change"] as const;
export type AuthTemplateType = (typeof AUTH_TEMPLATE_TYPES)[number];

const NOT_WIRED = (flow: string) => `Henüz bağlı akış yok: ${flow} bu şablonu sendTemplateEmail ile kullanacak.`;
const AUTH_USED_BY = (type: AuthTemplateType) =>
  `Supabase Auth (GoTrue): GOTRUE_MAILER_TEMPLATES_${type.toUpperCase()} → /api/auth-templates/${type} yönlendirildiğinde (en geç ~1 dk içinde yeni metin).`;

export const EMAIL_TEMPLATES: readonly EmailTemplateDef[] = [
  {
    key: "trial_ending",
    label: "Deneme süresi bitiyor",
    group: "abonelik",
    variables: ["ofis", "gun", "baglanti"],
    defaultSubject: "{ofis}: deneme süreniz {gun} gün içinde bitiyor",
    defaultBody:
      "Merhaba,\n\n{ofis} için EmlakSoft deneme süreniz {gun} gün içinde sona eriyor. Kesintisiz devam etmek için paketinizi seçip ödemenizi tamamlayabilirsiniz:\n{baglanti}\n\nVerileriniz silinmez.\nEmlakSoft",
    usedBy: "abonelik-kontrol (3 gün ve 1 gün kala, ofis sahibi)",
  },
  {
    key: "owner_weekly_report",
    label: "Malik haftalık raporu",
    group: "ofis",
    variables: ["ofis", "portfoy", "baglanti"],
    defaultSubject: "{portfoy} için haftalık ilan raporunuz",
    defaultBody: "Merhaba,\n\n{ofis} olarak {portfoy} için haftalık pazarlama raporunuz hazır:\n{baglanti}\n\nİyi günler.",
    usedBy: "Henüz gönderilmiyor: malik paneli bağlantısında e-posta adresi tutulmuyor (SMS / bağlantı kopyala kullanılır).",
  },
  {
    key: "daily_digest",
    label: "Günlük özet",
    group: "ofis",
    variables: ["ofis", "ozet", "baglanti"],
    defaultSubject: "{ofis}: günün özeti",
    defaultBody: "Merhaba,\n\n{ozet}\n\nAyrıntılar: {baglanti}",
    usedBy: "Henüz gönderilmiyor: günlük özet uygulama içi bildirim olarak kalır (e-posta tercihi ayrı karar).",
  },
  {
    key: "welcome",
    label: "Hoş geldin",
    group: "hesap",
    variables: ["ofis", "ad", "baglanti"],
    defaultSubject: "EmlakSoft'a hoş geldiniz, {ofis}",
    defaultBody:
      "Merhaba {ad},\n\n{ofis} hesabınız hazır. İlk adımlar için panelinize göz atın:\n{baglanti}\n\nSorunuz olursa bu e-postayı yanıtlamanız yeterli.\nEmlakSoft",
    usedBy: NOT_WIRED("kayıt / ofis oluşturma"),
  },
  {
    key: "team_invite",
    label: "Ekip daveti",
    group: "hesap",
    variables: ["ofis", "ad", "davet_eden", "baglanti"],
    defaultSubject: "{davet_eden} sizi {ofis} ekibine davet etti",
    defaultBody:
      "Merhaba {ad},\n\n{davet_eden}, sizi EmlakSoft'ta {ofis} ekibine davet etti. Hesabınızı etkinleştirmek için:\n{baglanti}\n\nEmlakSoft",
    usedBy: NOT_WIRED("ekip daveti (şu an Supabase Auth davet/sıfırlama e-postası kullanılır)"),
  },
  {
    key: "receipt",
    label: "Ödeme makbuzu / fatura",
    group: "abonelik",
    variables: ["ofis", "fatura_no", "tutar", "tarih", "baglanti"],
    defaultSubject: "{ofis}: {fatura_no} numaralı ödemeniz alındı",
    defaultBody:
      "Merhaba,\n\n{tarih} tarihinde {tutar} tutarındaki ödemeniz alındı (belge no: {fatura_no}). Belgeyi panelden görüntüleyebilirsiniz:\n{baglanti}\n\nTeşekkür ederiz.\nEmlakSoft",
    usedBy: NOT_WIRED("ödeme tamamlama / e-Arşiv"),
  },
  {
    key: "payment_failed",
    label: "Ödeme alınamadı",
    group: "abonelik",
    variables: ["ofis", "tutar", "neden", "baglanti"],
    defaultSubject: "{ofis}: ödemeniz alınamadı",
    defaultBody:
      "Merhaba,\n\n{tutar} tutarındaki ödemeniz alınamadı ({neden}). Kesinti yaşamamak için ödeme yönteminizi güncelleyin:\n{baglanti}\n\nEmlakSoft",
    usedBy: NOT_WIRED("ödeme hatası"),
  },
  {
    key: "dunning_1",
    label: "Tahsilat hatırlatması · 1. kademe",
    group: "abonelik",
    variables: ["ofis", "tutar", "gun", "son_tarih", "baglanti"],
    defaultSubject: "{ofis}: ödemeniz {gun} gündür bekliyor",
    defaultBody:
      "Merhaba,\n\n{tutar} tutarındaki abonelik ödemeniz {gun} gündür bekliyor. Son ödeme tarihi {son_tarih}. Ödemek için:\n{baglanti}\n\nÖdemeyi yaptıysanız bu e-postayı dikkate almayın.\nEmlakSoft",
    usedBy: NOT_WIRED("tahsilat (dunning) kademesi 1 (varsayılan 1. gün)"),
  },
  {
    key: "dunning_2",
    label: "Tahsilat hatırlatması · 2. kademe",
    group: "abonelik",
    variables: ["ofis", "tutar", "gun", "son_tarih", "baglanti"],
    defaultSubject: "{ofis}: ödeme hatırlatması ({gun}. gün)",
    defaultBody:
      "Merhaba,\n\n{tutar} tutarındaki ödemeniz hâlâ bekliyor ({gun} gün). {son_tarih} tarihine kadar ödenmezse hesabınızda kısıtlama uygulanabilir:\n{baglanti}\n\nEmlakSoft",
    usedBy: NOT_WIRED("tahsilat (dunning) kademesi 2 (varsayılan 4. gün)"),
  },
  {
    key: "dunning_3",
    label: "Tahsilat hatırlatması · son kademe",
    group: "abonelik",
    variables: ["ofis", "tutar", "gun", "son_tarih", "baglanti"],
    defaultSubject: "{ofis}: son ödeme hatırlatması",
    defaultBody:
      "Merhaba,\n\n{tutar} tutarındaki ödemeniz {gun} gündür bekliyor. Bu son hatırlatmadır; {son_tarih} sonrasında hesabınız gecikmiş durumda kalır:\n{baglanti}\n\nYardım için bu e-postayı yanıtlayabilirsiniz.\nEmlakSoft",
    usedBy: NOT_WIRED("tahsilat (dunning) kademesi 3 (varsayılan 8. gün)"),
  },
  {
    key: "plan_changed",
    label: "Paket değişikliği",
    group: "abonelik",
    variables: ["ofis", "eski_plan", "yeni_plan", "tarih", "baglanti"],
    defaultSubject: "{ofis}: paketiniz {yeni_plan} olarak değişti",
    defaultBody:
      "Merhaba,\n\n{ofis} paketiniz {tarih} itibarıyla {eski_plan} → {yeni_plan} olarak güncellendi. Ayrıntılar:\n{baglanti}\n\nEmlakSoft",
    usedBy: NOT_WIRED("paket değişikliği"),
  },
  {
    key: "trial_ended",
    label: "Deneme süresi bitti",
    group: "abonelik",
    variables: ["ofis", "baglanti"],
    defaultSubject: "{ofis}: deneme süreniz sona erdi",
    defaultBody:
      "Merhaba,\n\n{ofis} için EmlakSoft deneme süreniz sona erdi. Verileriniz korunuyor; devam etmek için paketinizi seçin:\n{baglanti}\n\nEmlakSoft",
    usedBy: NOT_WIRED("deneme bitişi"),
  },
  {
    key: "ticket_reply",
    label: "Destek talebi yanıtı",
    group: "destek",
    variables: ["ofis", "ad", "talep_no", "konu", "yanit", "baglanti"],
    defaultSubject: "{talep_no} · {konu}: yanıtınız var",
    defaultBody: "Merhaba {ad},\n\n{talep_no} numaralı \"{konu}\" talebinize yanıt verildi:\n\n{yanit}\n\nTalebi görüntülemek için:\n{baglanti}\n\nEmlakSoft Destek",
    usedBy: NOT_WIRED("destek talebi yanıtı"),
  },
  {
    key: "kvkk_reply",
    label: "KVKK başvurusu yanıtı",
    group: "destek",
    variables: ["ad", "basvuru_no", "yanit", "tarih"],
    defaultSubject: "KVKK başvurunuz ({basvuru_no}) hakkında",
    defaultBody:
      "Sayın {ad},\n\n{tarih} tarihli {basvuru_no} numaralı 6698 sayılı KVKK kapsamındaki başvurunuz sonuçlandırılmıştır:\n\n{yanit}\n\nSaygılarımızla,\nEmlakSoft",
    usedBy: NOT_WIRED("KVKK başvuru yanıtı"),
  },
  {
    key: "auth_invite",
    label: "Davet (giriş)",
    group: "auth",
    variables: ["baglanti", "eposta", "site"],
    defaultSubject: "EmlakSoft davetiniz",
    defaultBody:
      "Merhaba,\n\nEmlakSoft hesabınız oluşturuldu ({eposta}). Daveti kabul edip şifrenizi belirlemek için:\n{baglanti}\n\nBu daveti siz beklemiyorsanız e-postayı yok sayabilirsiniz.\nEmlakSoft",
    usedBy: AUTH_USED_BY("invite"),
    authType: "invite",
  },
  {
    key: "auth_confirmation",
    label: "E-posta doğrulama (giriş)",
    group: "auth",
    variables: ["baglanti", "kod", "eposta", "site"],
    defaultSubject: "E-posta adresinizi doğrulayın",
    defaultBody: "Merhaba,\n\nEmlakSoft hesabınızı etkinleştirmek için e-posta adresinizi doğrulayın:\n{baglanti}\n\nEmlakSoft",
    usedBy: AUTH_USED_BY("confirmation"),
    authType: "confirmation",
  },
  {
    key: "auth_recovery",
    label: "Şifre belirleme / sıfırlama (giriş)",
    group: "auth",
    variables: ["baglanti", "kod", "eposta", "site"],
    defaultSubject: "EmlakSoft şifrenizi belirleyin",
    // Nötr metin: aynı şablon hem "şifremi unuttum" hem ekip daveti / yeniden davet (resetPasswordForEmail) ile gider.
    defaultBody:
      "Merhaba,\n\n{eposta} EmlakSoft hesabınızın şifresini belirlemek ya da yenilemek için:\n{baglanti}\n\nBeklemediğiniz bir e-postaysa yok sayabilirsiniz; şifreniz değişmez.\nEmlakSoft",
    usedBy: `${AUTH_USED_BY("recovery")} Uygulamada: şifremi unuttum, ekip daveti ve yeniden davet, personel, satış ve platform ofis oluşturma akışlarındaki şifre belirleme bağlantısı (resetPasswordForEmail). Metin davet ve sıfırlama için nötr kalmalı.`,
    authType: "recovery",
  },
  {
    key: "auth_magic_link",
    label: "Tek tıkla giriş bağlantısı",
    group: "auth",
    variables: ["baglanti", "kod", "eposta", "site"],
    defaultSubject: "EmlakSoft giriş bağlantınız",
    // Nötr metin: signInWithOtp hem giriş bağlantısı hem uygulama içi e-posta doğrulaması için kullanılır.
    defaultBody: "Merhaba,\n\nE-posta adresinizi doğrulamak ve EmlakSoft'a giriş yapmak için:\n{baglanti}\n\nBu isteği siz yapmadıysanız e-postayı yok sayın.\nEmlakSoft",
    usedBy: `${AUTH_USED_BY("magic_link")} Uygulamada: tek tıkla giriş ve hesap ayarlarındaki e-posta doğrulaması (signInWithOtp). Metin her iki amaca uymalı.`,
    authType: "magic_link",
  },
  {
    key: "auth_email_change",
    label: "E-posta değişikliği onayı",
    group: "auth",
    variables: ["baglanti", "eposta", "yeni_eposta", "site"],
    defaultSubject: "E-posta değişikliğini onaylayın",
    defaultBody:
      "Merhaba,\n\nEmlakSoft hesabınızın e-postası {eposta} adresinden {yeni_eposta} adresine değiştirilmek isteniyor. Onaylamak için:\n{baglanti}\n\nBu isteği siz yapmadıysanız bize hemen yazın.\nEmlakSoft",
    usedBy: AUTH_USED_BY("email_change"),
    authType: "email_change",
  },
];

const BY_KEY = new Map<string, EmailTemplateDef>(EMAIL_TEMPLATES.map((t) => [t.key, t]));

export function templateDef(key: EmailTemplateKey): EmailTemplateDef {
  return BY_KEY.get(key)!;
}

export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return BY_KEY.has(key);
}

export function authTemplateDef(type: string): EmailTemplateDef | null {
  return EMAIL_TEMPLATES.find((t) => t.authType === type) ?? null;
}

/** Auth şablonlarının konusu GoTrue ortamından gelir: panelde yalnız gövde ayarı vardır. */
export function hasEditableSubject(t: EmailTemplateDef): boolean {
  return !t.authType;
}

export const templateSettingKey = (key: EmailTemplateKey, part: "subject" | "body") => `email.template.${key}.${part}`;

/** Şablonun örnek değişken değerleri (önizleme/örnek gönderim; gerçek veri yok). */
export function sampleVars(key: EmailTemplateKey): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const v of templateDef(key).variables) out[v] = EMAIL_VARIABLES[v].sample;
  return out;
}

// ---------------------------------------------------------------------------
// Doğrulama ve düz metin yerleştirme
// ---------------------------------------------------------------------------

const VAR_RE = /\{([a-z_]+)\}/g;

/** Metindeki `{ad}` değişkenlerinden izin listesinde OLMAYANLAR (sırayla, tekrarsız). */
export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) {
    if (!allowed.includes(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Ayar defteri çapraz kuralı: tanımsız değişken içeren şablon metni kaydedilemez. */
export function templateTextRule(t: Pick<EmailTemplateDef, "label" | "variables">): (value: string) => string | null {
  return (value) => {
    const bad = unknownVariables(String(value ?? ""), t.variables);
    if (bad.length === 0) return null;
    return `${t.label}: tanımsız değişken ${bad.map((b) => `{${b}}`).join(", ")}. Kullanılabilir: ${t.variables.map((v) => `{${v}}`).join(", ")}.`;
  };
}

/** `{degisken}` yerleştirme (düz metin). Satır sonları korunur; değerlerdeki CR/LF konu satırında boşluğa çevrilir. */
export function renderTemplate(text: string, vars: Record<string, string | number>, opts?: { singleLine?: boolean }): string {
  const out = text.replace(VAR_RE, (m, name: string) => (name in vars ? String(vars[name]) : m));
  return opts?.singleLine ? out.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : out;
}

// ---------------------------------------------------------------------------
// Ortak marka yerleşimi (HTML)
// ---------------------------------------------------------------------------

export const EMAIL_BRAND_NAME = "EmlakSoft";
export const DEFAULT_EMAIL_FOOTER = "Bu e-posta EmlakSoft (emlaksoft.com.tr) tarafından hizmetle ilgili bilgilendirme amacıyla gönderildi.";

/**
 * HTML kaçışı. `goSafe` (auth şablonu) açıkken `{` ve `}` da varlığa çevrilir: admin metni GoTrue'nun Go şablon
 * motorunda ASLA eylem (`{{ ... }}`) olarak yorumlanamaz; yalnız bizim yerleştirdiğimiz yer tutucular çalışır.
 */
export function escapeHtml(s: string, goSafe = false): string {
  const out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return goSafe ? out.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;") : out;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'\u0001]+/g;

function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (u) => `<a href="${u}" style="color:#2563eb;text-decoration:underline">${u}</a>`);
}

type Slot = { html: string };

/**
 * Gövde metnini HTML'e çevirir. `vars`: düz metin değerler (kaçışlanır). `raw`: kaçışlanmadan yerleşen yer tutucular
 * (yalnız auth şablonunda Go ifadeleri; kaynak koddaki sabit `goTemplate`, admin metni DEĞİL).
 */
function bodyToHtml(body: string, vars: Record<string, string | number>, raw: Record<string, string> | null): string {
  const goSafe = raw !== null;
  const valueHtml = (name: string, asLink: boolean): string | null => {
    if (raw && name in raw) return asLink ? `<a href="${raw[name]}" style="color:#2563eb">${raw[name]}</a>` : raw[name];
    if (!(name in vars)) return null;
    const esc = escapeHtml(String(vars[name]), goSafe);
    return asLink && /^https?:\/\//.test(String(vars[name])) ? `<a href="${esc}" style="color:#2563eb">${esc}</a>` : esc;
  };
  const name2href = (v: string | number | undefined): string | null =>
    v != null && /^https?:\/\//.test(String(v)) ? escapeHtml(String(v), goSafe) : null;
  const urlVar = (name: string) => (EMAIL_VARIABLES as Record<string, EmailVariableDef>)[name]?.url === true;

  const paragraphs = body.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return paragraphs
    .map((para) => {
      const lines = para.split("\n").map((line) => {
        const only = /^\s*\{([a-z_]+)\}\s*$/.exec(line);
        if (only && urlVar(only[1])) {
          const href = raw && only[1] in raw ? raw[only[1]] : name2href(vars[only[1]]);
          if (href) {
            return `<a href="${href}" style="display:inline-block;margin:6px 0;padding:10px 18px;border-radius:8px;background:#1d4ed8;color:#ffffff;font-weight:600;text-decoration:none">Bağlantıyı aç</a>`;
          }
        }
        // Değişkenleri yuvaya al → kaçışla → bağlantıla → yuvaları doldur (değerler kendi kaçışıyla).
        const slots: Slot[] = [];
        const marked = line.replace(VAR_RE, (m, name: string) => {
          const html = valueHtml(name, urlVar(name));
          if (html == null) return m;
          slots.push({ html });
          return `\u0001${slots.length - 1}\u0002`;
        });
        const esc = linkify(escapeHtml(marked, goSafe));
        return esc.replace(/\u0001(\d+)\u0002/g, (_m, i: string) => slots[Number(i)]?.html ?? "");
      });
      return `<p style="margin:0 0 14px">${lines.join("<br>")}</p>`;
    })
    .join("");

}

/** Ortak marka yerleşimi: başlık şeridi, gövde, alt bilgi. Tablo tabanlı (e-posta istemcileri), satır içi stil. */
export function renderBrandedHtml(input: {
  title: string;
  body: string;
  vars: Record<string, string | number>;
  footer?: string;
  /** Auth şablonu: değişken → Go yer tutucusu (kaçışlanmaz) ve metin Go-güvenli kaçışlanır. */
  goPlaceholders?: Record<string, string>;
}): string {
  const raw = input.goPlaceholders ?? null;
  const goSafe = raw !== null;
  const title = escapeHtml(input.title, goSafe);
  const footer = escapeHtml((input.footer ?? DEFAULT_EMAIL_FOOTER).trim() || DEFAULT_EMAIL_FOOTER, goSafe);
  const content = bodyToHtml(input.body, input.vars, raw);
  return [
    '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title></head>`,
    '<body style="margin:0;padding:0;background:#f3f5f8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;color:#1f2937">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">',
    `<tr><td style="padding:18px 28px;border-bottom:1px solid #eef0f3;font-size:18px;font-weight:700;color:#0f172a">${EMAIL_BRAND_NAME}</td></tr>`,
    `<tr><td style="padding:24px 28px 10px;font-size:15px;line-height:1.6">${content}</td></tr>`,
    `<tr><td style="padding:14px 28px 18px;border-top:1px solid #eef0f3;font-size:12px;line-height:1.5;color:#6b7280">${footer}</td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("");
}

/** Auth şablonunun GoTrue'ya sunulan HTML'i: değişkenler Go yer tutucularına bağlanır. */
export function renderAuthTemplateHtml(t: EmailTemplateDef, body: string, footer?: string): string {
  const placeholders: Record<string, string> = {};
  for (const v of t.variables) {
    const go = (EMAIL_VARIABLES as Record<string, EmailVariableDef>)[v]?.goTemplate;
    if (go) placeholders[v] = go;
  }
  return renderBrandedHtml({ title: t.label, body, vars: {}, footer, goPlaceholders: placeholders });
}
