/**
 * Ayarlar dizini (OA13; SAF, birim testli): ofisin TÜM ayar ekranları kategorili tek listede. `/app/ayarlar` açılış
 * sekmesi bu listeyi arama kutusuyla gösterir; menü şeridinde "Diğer" altına düşen seyrek ayarlar da burada bulunur.
 *
 * Kural: Ayarlar şeridindeki (nav-roles AYARLAR) her sayfa burada bir karttır (`settings-directory.test.ts` kilitler).
 * Yeni ayar sayfası = buraya bir satır. Her kart kendi sayfa kapısını korur; dizin yalnız görünürlük süzgeci uygular.
 */
import type { AppModule, AppRole } from "@/lib/permissions";

export type SettingsDirCategoryId = "ofis" | "ekip" | "satis" | "iletisim" | "otomasyon" | "veri";

export type SettingsDirItem = {
  href: string;
  label: string;
  description: string;
  keywords: readonly string[];
  /** Kartı görmek için gereken modül görüntüleme izni (yoksa ayarlar). */
  module?: AppModule;
  /** Yalnız bu rollerde görünür. */
  roles?: readonly AppRole[];
  /** Gerçek durum rozeti anahtarı (sayfa sunucu bileşeninde doldurur). */
  statusKey?: "rules" | "sample";
};

export type SettingsDirCategory = { id: SettingsDirCategoryId; label: string; description: string; items: readonly SettingsDirItem[] };

export const SETTINGS_DIRECTORY: readonly SettingsDirCategory[] = [
  {
    id: "ofis",
    label: "Ofis ve marka",
    description: "Ofis kimliği, vitrin ve görünen modüller.",
    items: [
      { href: "/app/ayarlar?sekme=kimlik", label: "Marka ve kimlik", description: "Ofis adı, logo, iletişim, yetki belgesi ve Google yorum bağlantısı", keywords: ["logo", "marka", "ofis adı", "adres", "yetki belgesi", "vergi", "google yorum"] },
      { href: "/app/ayarlar/vitrin", label: "Vitrin", description: "Ofis vitrininde görünecek bölümler ve tanıtım metni", keywords: ["vitrin", "web sitesi", "tanıtım", "seo"] },
      { href: "/app/ayarlar/filigran", label: "Filigran", description: "Portföy fotoğraflarına eklenen ofis filigranı", keywords: ["filigran", "fotoğraf", "logo", "watermark"] },
      { href: "/app/ayarlar/moduller", label: "Modüller", description: "Kullanılmayan alanları kapatın, menü sadeleşsin", keywords: ["modül", "aç kapa", "sadeleştir", "menü"]},
      { href: "/app/abonelik", label: "Abonelik", description: "Paket, fatura, analiz bakiyesi ve hesap kredisi", keywords: ["fatura", "ödeme", "plan", "paket", "kredi", "koltuk"], module: "billing" },
    ],
  },
  {
    id: "ekip",
    label: "Ekip ve erişim",
    description: "Kim neyi görür ve değiştirir, oturum güvenliği.",
    items: [
      { href: "/app/ayarlar/yetkilendirme", label: "Yetkiler", description: "Rol izin matrisi, kapsamlar, kişi istisnaları ve denetim günlüğü", keywords: ["rol", "izin", "yetki", "matris", "kapsam", "istisna", "erişim"] },
      { href: "/app/ayarlar/guvenlik", label: "Güvenlik", description: "İki adımlı doğrulama zorunluluğu, IP, oturum süresi ve açık oturumlar", keywords: ["güvenlik", "2fa", "iki adımlı", "ip", "oturum", "parola"] },
      { href: "/app/ayarlar/sahiplik-devri", label: "Sahiplik devri", description: "Ofis sahipliğini ekipten birine iki adımda devredin", keywords: ["sahip", "devir", "devret", "ofis sahibi"], roles: ["owner"] },
    ],
  },
  {
    id: "satis",
    label: "Satış kuralları",
    description: "Süreler, eşikler, talep dağıtımı, onay ve eşleştirme kuralları.",
    items: [
      { href: "/app/ayarlar/merkez", label: "Kurallar ve varsayılanlar", description: "Yanıt süreleri, uyarı eşikleri, talep dağıtımı, komisyon ve bildirim varsayılanları", keywords: ["kural", "eşik", "sla", "yanıt süresi", "talep dağıtımı", "akıllı atama", "varsayılan", "nöbet"], statusKey: "rules" },
      { href: "/app/ayarlar/merkez?grup=onay", label: "Onay politikası", description: "Onay karar süreleri ve küçük taleplerin otomatik onay sınırı", keywords: ["onay", "otomatik onay", "sla", "karar süresi", "vekil", "indirim"] },
      { href: "/app/ayarlar/lead", label: "Aday yakalama", description: "Web formu ve bağlantıdan gelen adaylar, sırayla atama ve hızlı yanıt", keywords: ["aday", "form", "web formu", "başvuru", "hızlı yanıt"] },
      { href: "/app/ayarlar/tanimlar", label: "Seçim listeleri", description: "Formlardaki açılır liste seçenekleri ve anlaşma aşama adları", keywords: ["tanım", "seçim listesi", "kaynak", "kayıp nedeni", "aşama"] },
      { href: "/app/ayarlar/ozel-alanlar", label: "Özel alanlar", description: "Müşteri, portföy, talep ve anlaşmaya ofise özel alanlar ekleyin", keywords: ["özel alan", "alan ekle", "custom field"] },
      { href: "/app/ayarlar?sekme=eslestirme", label: "Eşleştirme ağırlıkları", description: "Talep ile portföy eşleştirmesinde ölçütlerin önemi", keywords: ["eşleştirme", "ağırlık", "skor", "uyum"] },
    ],
  },
  {
    id: "iletisim",
    label: "İletişim",
    description: "Mesaj ve sözleşme şablonları, SMS, WhatsApp ve e-Fatura bağlantıları.",
    items: [
      { href: "/app/ayarlar/mesaj-sablonlari", label: "Mesaj şablonları", description: "WhatsApp, SMS ve e-posta için hazır metinler", keywords: ["şablon", "mesaj", "whatsapp", "sms", "e-posta"] },
      { href: "/app/ayarlar/sozlesme-sablonlari", label: "Sözleşme şablonları", description: "Yer gösterme, yetki ve kira sözleşmesi şablonları", keywords: ["sözleşme", "şablon", "yer gösterme", "yetki belgesi", "kira"] },
      { href: "/app/ayarlar/entegrasyonlar", label: "Entegrasyonlar", description: "SMS, WhatsApp, portal üyelikleri, Bakanlık e-postaları ve e-Fatura", keywords: ["entegrasyon", "netgsm", "sms", "whatsapp", "portal", "eids", "e-fatura"] },
    ],
  },
  {
    id: "otomasyon",
    label: "Otomasyon",
    description: "Tetikleyicili kurallar, takip dizileri, iş akışları ve API.",
    items: [
      { href: "/app/otomasyonlar", label: "Otomasyonlar", description: "Bir olay olunca görev, mesaj veya bildirim üreten kurallar", keywords: ["otomasyon", "kural", "tetikleyici", "otomatik"] },
      { href: "/app/otomasyonlar/diziler", label: "Takip dizileri", description: "Gecikmeli adımlı takip; müşteri yanıt verince durur", keywords: ["dizi", "takip", "drip", "sıralı mesaj"] },
      { href: "/app/ayarlar/is-akislari", label: "İş akışları", description: "Adım adım iş akışı senaryoları", keywords: ["iş akışı", "workflow", "senaryo"] },
      { href: "/app/ayarlar/api-webhook", label: "API ve webhook", description: "API anahtarı ve imzalı webhook olayları", keywords: ["api", "webhook", "anahtar", "entegrasyon"] },
    ],
  },
  {
    id: "veri",
    label: "Veri",
    description: "Etiketler, geri alma, örnek veri ve kullanım.",
    items: [
      { href: "/app/ayarlar/etiketler", label: "Etiketler", description: "Müşteri etiketlerini yeniden adlandırın ve birleştirin", keywords: ["etiket", "tag", "birleştir"], module: "customers" },
      { href: "/app/ayarlar/cop-kutusu", label: "Çöp kutusu", description: "Silinen müşteri ve portföyleri 90 gün içinde geri alın", keywords: ["çöp", "geri al", "silinen", "kurtar"] },
      { href: "/app/ayarlar/gercek-kullanim", label: "Gerçek kullanım", description: "Örnek verileri tek tuşla temizleyip gerçek kullanıma geçin", keywords: ["örnek veri", "demo sil", "gerçek kullanım", "temizle"], statusKey: "sample" },
      { href: "/app/ayarlar/ai-kullanim", label: "AI kullanımı", description: "Yapay zekâ özelliklerinin kullanımı ve kotası", keywords: ["ai", "yapay zeka", "kota", "kullanım"] },
      { href: "/app/ayarlar/cografya-bildir", label: "Bölge bildirimi", description: "Eksik ya da yanlış mahalleyi platform ekibine bildirin", keywords: ["mahalle", "il", "ilçe", "bölge", "eksik"] },
    ],
  },
];

/** Türkçe büyük/küçük harf ve şapka duyarsız karşılaştırma anahtarı. */
export function foldTr(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[âà]/g, "a")
    .replace(/[îì]/g, "i")
    .replace(/[ûù]/g, "u")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

/** Kart aramayla eşleşir mi: ad, açıklama ve anahtar sözcüklerin her birinde sözcük sözcük arar (tüm sözcükler bulunmalı). */
export function matchesSettingsQuery(item: Pick<SettingsDirItem, "label" | "description" | "keywords">, query: string): boolean {
  const words = foldTr(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldTr([item.label, item.description, ...item.keywords].join(" "));
  return words.every((w) => hay.includes(w));
}

/** Rol ve modül izni süzgeci (sayfa kapısı ayrıca korur; dizin ulaşılamayacak kart göstermez). */
export function visibleSettingsDirectory(
  role: string,
  canView: (mod: AppModule) => boolean,
): SettingsDirCategory[] {
  return SETTINGS_DIRECTORY.map((c) => ({
    ...c,
    items: c.items.filter((i) => (!i.roles || i.roles.includes(role as AppRole)) && canView(i.module ?? "settings")),
  })).filter((c) => c.items.length > 0);
}
