/**
 * WhatsApp şablon mesaj kütüphanesi — saf (pure) katman.
 *
 * Ofis kendi standart metinlerini bir kez tanımlar (`message_templates` tablosu),
 * danışman müşteri kartından tek tıkla değişkenleri dolu mesajla WhatsApp'ı açar
 * (`toWhatsAppLink(phone, text)` → wa.me deep-link). Otomatik gönderim YOK;
 * mesajı kullanıcı kendi WhatsApp'ından gönderir, bu yüzden İYS/EİDS kapsamı dışıdır.
 *
 * Yer tutucu sözdizimi tek süslü parantez: `{musteri}`. (Otomasyon motorundaki
 * `{{name}}` iki-parantez sözdiziminden bilinçli olarak ayrı: burada metni
 * danışman elle yazıyor, tek parantez yazması ve okuması daha kolay.)
 */

export const TEMPLATE_BODY_MAX = 1000;
export const TEMPLATE_TITLE_MAX = 120;

export const TEMPLATE_CATEGORIES = [
  "genel",
  "portfoy",
  "randevu",
  "teklif",
  "takip",
  "kutlama",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  genel: "Genel",
  portfoy: "Portföy",
  randevu: "Randevu",
  teklif: "Teklif",
  takip: "Takip",
  kutlama: "Kutlama",
};

/** Kategori rozet sınıfları — mor yok, marka paleti (Ink/Brand/Mint/Amber/Cyan). */
export const CATEGORY_BADGE: Record<TemplateCategory, string> = {
  genel: "bg-ink-950/8 text-text-muted",
  portfoy: "bg-brand-600/10 text-brand-600",
  randevu: "bg-cyan-400/12 text-cyan-500",
  teklif: "bg-amber-400/15 text-amber-600",
  takip: "bg-mint-500/12 text-mint-600",
  kutlama: "bg-danger-500/10 text-danger-500",
};

export function isTemplateCategory(value: unknown): value is TemplateCategory {
  return typeof value === "string" && (TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

/** Şablonda kullanılabilen değişken anahtarları. */
export const TEMPLATE_VARIABLES = [
  "musteri",
  "danisman",
  "ofis",
  "portfoy",
  "portfoy_kodu",
  "fiyat",
  "adres",
  "randevu_tarih",
  "randevu_saat",
  "link",
  "telefon",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Değişken değerleri — verilmeyen/boş olan alan render'da silinir. */
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;

/** UI'da gösterilen değişken yardım listesi (çip + açıklama). */
export const VARIABLE_HELP: { key: TemplateVariable; token: string; label: string; desc: string }[] = [
  { key: "musteri", token: "{musteri}", label: "Müşteri adı", desc: "Mesajın gideceği kişinin adı soyadı." },
  { key: "danisman", token: "{danisman}", label: "Danışman", desc: "Mesajı gönderen danışmanın adı." },
  { key: "ofis", token: "{ofis}", label: "Ofis adı", desc: "Emlak ofisinizin ticari adı." },
  { key: "portfoy", token: "{portfoy}", label: "Portföy başlığı", desc: "İlgili ilanın başlığı (örn. 3+1 Bahçeli Daire)." },
  { key: "portfoy_kodu", token: "{portfoy_kodu}", label: "Portföy kodu", desc: "İlanın ofis içi referans kodu." },
  { key: "fiyat", token: "{fiyat}", label: "Fiyat", desc: "Portföyün güncel fiyatı (biçimlenmiş)." },
  { key: "adres", token: "{adres}", label: "Adres", desc: "İlanın konumu — ilçe / mahalle." },
  { key: "randevu_tarih", token: "{randevu_tarih}", label: "Randevu tarihi", desc: "Planlanan görüşme tarihi." },
  { key: "randevu_saat", token: "{randevu_saat}", label: "Randevu saati", desc: "Planlanan görüşme saati." },
  { key: "link", token: "{link}", label: "Bağlantı", desc: "İlan vitrin bağlantısı veya paylaşım linki." },
  { key: "telefon", token: "{telefon}", label: "Telefon", desc: "Ofis/danışman iletişim numarası." },
];

/** Önizlemede kullanılan örnek değerler — ofis şablonu yazarken sonucu görsün. */
export const SAMPLE_VARS: Required<Record<TemplateVariable, string>> = {
  musteri: "Ayşe Yılmaz",
  danisman: "Mehmet Demir",
  ofis: "Vadi Emlak",
  portfoy: "3+1 Bahçe Katı Daire",
  portfoy_kodu: "VD-1042",
  fiyat: "4.750.000 ₺",
  adres: "Çankaya / Birlik Mahallesi",
  randevu_tarih: "12 Ağustos Salı",
  randevu_saat: "14:30",
  link: "https://emlaksoft.vercel.app/vitrin/vadi-emlak/1042",
  telefon: "0532 123 45 67",
};

const KNOWN = new Set<string>(TEMPLATE_VARIABLES);

// {anahtar} — yalnız küçük harf + alt çizgi; bilinmeyen anahtar aynen korunur.
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/**
 * Boşluk temizliği: değişkeni boş kalan yerler "Merhaba  ," gibi çift boşluk /
 * öksüz noktalama bırakmasın. Satır yapısı (\n) korunur — WhatsApp mesajlarında
 * paragraflar anlamlıdır; yalnız yatay boşluklar sadeleştirilir.
 */
function tidy(text: string): string {
  return text
    // Windows satır sonlarını normalize et
    .replace(/\r\n?/g, "\n")
    // yatay boşluk yığınları → tek boşluk
    .replace(/[^\S\n]{2,}/g, " ")
    // noktalama öncesi öksüz boşluk (" ," / " ." / " !" ...)
    .replace(/[^\S\n]+([,.;:!?])/g, "$1")
    // açılan parantez sonrası / kapanan parantez öncesi boşluk
    .replace(/\([^\S\n]+/g, "(")
    .replace(/[^\S\n]+\)/g, ")")
    // içi boşalmış parantez ve tire kalıntıları
    .replace(/\(\s*\)/g, "")
    // satır başı/sonu boşlukları
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+$/g, "").replace(/^[^\S\n]+/g, ""))
    .join("\n")
    // 3+ boş satır → en fazla bir boş satır
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Şablon gövdesindeki `{degisken}` yer tutucularını doldurur.
 *
 * - Bilinen ama değeri verilmemiş/boş değişken → boş string (kalan boşluk temizlenir).
 * - Bilinmeyen yer tutucu (`{birsey}`) aynen korunur — ofis kendi notunu yazmış olabilir,
 *   sessizce silmek veri kaybı gibi hissettirir.
 * - Değişken değerleri tekrar taranmaz (kullanıcı verisi içindeki `{...}` işlenmez).
 */
export function renderTemplate(body: string, vars: TemplateVars = {}): string {
  if (!body) return "";
  const replaced = body.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!KNOWN.has(key)) return match;
    const value = vars[key as TemplateVariable];
    return typeof value === "string" ? value.trim() : "";
  });
  return tidy(replaced);
}

/** Gövdede geçen bilinen değişkenlerin listesi (UI'da "kullanılan alanlar" rozeti). */
export function usedVariables(body: string): TemplateVariable[] {
  const found = new Set<TemplateVariable>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    if (KNOWN.has(m[1])) found.add(m[1] as TemplateVariable);
  }
  return TEMPLATE_VARIABLES.filter((v) => found.has(v));
}

export type DefaultTemplate = {
  title: string;
  category: TemplateCategory;
  body: string;
  sort_order: number;
};

/**
 * Varsayılan şablon seti — ofis "Varsayılan şablonları ekle" dediğinde toplu insert edilir.
 * Metinler Türk emlak pratiğine göre yazıldı: kısa, nazik, tek konu, net eylem çağrısı.
 */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    title: "İlan bilgisi paylaşımı",
    category: "portfoy",
    body:
      "Merhaba {musteri}, ben {ofis}'ten {danisman}.\n" +
      "Aradığınız kriterlere uygun bir portföyümüz var:\n\n" +
      "🏠 {portfoy} ({portfoy_kodu})\n" +
      "📍 {adres}\n" +
      "💰 {fiyat}\n\n" +
      "Detaylar ve fotoğraflar: {link}\n\n" +
      "Beğenirseniz uygun bir gün yerinde gezdirelim.",
    sort_order: 10,
  },
  {
    title: "Randevu teyidi",
    category: "randevu",
    body:
      "Merhaba {musteri}, {danisman} ben.\n" +
      "{randevu_tarih} günü saat {randevu_saat} için randevumuzu kaydettim.\n" +
      "Adres: {adres}\n\n" +
      "Sizin için uygun mu, teyit edebilir misiniz? Bir değişiklik olursa bu numaradan yazmanız yeterli.",
    sort_order: 20,
  },
  {
    title: "Randevu hatırlatma",
    category: "randevu",
    body:
      "Merhaba {musteri}, yarınki görüşmemizi hatırlatmak istedim.\n" +
      "🗓 {randevu_tarih} · ⏰ {randevu_saat}\n" +
      "📍 {adres}\n\n" +
      "Görüşmek üzere, iyi günler dilerim.\n{danisman} — {ofis}",
    sort_order: 30,
  },
  {
    title: "Fiyat güncellemesi bildirimi",
    category: "portfoy",
    body:
      "Merhaba {musteri}, ilgilendiğiniz {portfoy} ({portfoy_kodu}) portföyünde fiyat güncellendi.\n" +
      "Yeni fiyat: {fiyat}\n\n" +
      "İlgilenmeye devam ediyorsanız bu hafta içinde gezdirmek isterim; bu bantta talep yoğun oluyor.\n" +
      "{danisman} — {ofis}",
    sort_order: 40,
  },
  {
    title: "Görüşme sonrası teşekkür",
    category: "takip",
    body:
      "Merhaba {musteri}, bugün ayırdığınız vakit için teşekkür ederim.\n" +
      "Konuştuklarımızı not aldım; kriterlerinize uyan yeni portföy çıktığında ilk size haber vereceğim.\n\n" +
      "Aklınıza takılan olursa bu numaradan bana ulaşabilirsiniz.\n{danisman} — {ofis}",
    sort_order: 50,
  },
  {
    title: "Evrak isteme",
    category: "teklif",
    body:
      "Merhaba {musteri}, süreci başlatabilmemiz için aşağıdaki belgelere ihtiyacımız var:\n\n" +
      "• Kimlik fotokopisi\n" +
      "• Tapu fotokopisi\n" +
      "• DASK poliçesi\n" +
      "• Güncel abonelik/aidat belgesi\n\n" +
      "Fotoğrafını bu numaraya iletmeniz yeterli. Teşekkürler.\n{danisman} — {ofis}",
    sort_order: 60,
  },
  {
    title: "Açık ev daveti",
    category: "portfoy",
    body:
      "Merhaba {musteri}, {portfoy} için açık ev günü düzenliyoruz.\n" +
      "🗓 {randevu_tarih} · ⏰ {randevu_saat}\n" +
      "📍 {adres}\n\n" +
      "Randevusuz gelip gezebilirsiniz. Detay: {link}\n" +
      "Bilgi için: {telefon}",
    sort_order: 70,
  },
  {
    title: "Doğum günü kutlaması",
    category: "kutlama",
    body:
      "Merhaba {musteri}, doğum gününüzü en içten dileklerimizle kutlarız! 🎉\n" +
      "Sağlık ve huzur dolu bir yıl dileriz.\n\n" +
      "{ofis} ailesi adına, {danisman}",
    sort_order: 80,
  },
  {
    title: "Teklif iletimi",
    category: "teklif",
    body:
      "Merhaba {musteri}, {portfoy} ({portfoy_kodu}) için görüştüğümüz teklifi malik tarafına ilettim.\n" +
      "Teklif tutarı: {fiyat}\n\n" +
      "Dönüş aldığımda hemen bilgilendireceğim.\n{danisman} — {ofis}",
    sort_order: 90,
  },
  {
    title: "Uzun süredir görüşülmeyen müşteri",
    category: "takip",
    body:
      "Merhaba {musteri}, uzun zamandır görüşemedik. Arayışınız hâlâ devam ediyor mu?\n" +
      "Kriterlerinizde bir değişiklik olduysa güncelleyip size uygun portföyleri yeniden derleyeyim.\n\n" +
      "İyi günler dilerim.\n{danisman} — {ofis}",
    sort_order: 100,
  },
];
