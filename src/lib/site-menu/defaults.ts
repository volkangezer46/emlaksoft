import type { FooterColumn, IconRef, MenuGroup, MenuItem, SiteMenuConfig } from "./schema";

/**
 * VARSAYILAN site menüsü: yönetici hiçbir şey yayınlamadıysa site bugünkü içerikle birebir aynı çalışır.
 * İçerik ana sayfa mega menüsünün (eski `marketing-nav.ts`) birebir karşılığıdır: sütun başlıkları = `section`,
 * öne çıkan kartlar = `featured`. `main-nav.snapshot.json` ile testte karşılaştırılır. Paket bağlantıları sabit değildir:
 * "Paketler" sütunu `autoPlans` ile etkin paket tanımlarından üretilir (fiyat okuyucu tek kaynak).
 */

const lucide = (name: string): IconRef => ({ kind: "lucide", name });

function item(id: string, section: string, label: string, text: string, href: string, icon: string): MenuItem {
  return { id, section, label, text, href, icon: lucide(icon), badge: null, hidden: false };
}

function link(id: string, label: string, href: string) {
  return { id, label, href, hidden: false };
}

const DEFAULT_GROUPS: MenuGroup[] = [
  {
    id: "urun",
    kind: "menu",
    label: "Ürün",
    href: "",
    hidden: false,
    items: [
      item("urun-tur", "Satış ve kazanç", "Ürün turu", "Bugün, müşteriler, portföy ve daha fazlası", "/#tur", "LayoutDashboard"),
      item("urun-komisyon", "Satış ve kazanç", "Komisyon ve anlaşma", "Tekliften hakedişe tek omurga", "/#komisyon", "Handshake"),
      item("urun-kayip-kacak", "Satış ve kazanç", "Kayıp-kaçak kalkanı", "Kaçan komisyonu rakama dökün", "/#kayip-kacak", "ShieldAlert"),
      item("urun-degerleme", "Satış ve kazanç", "Emsal bazlı değerleme", "Fiyat aralığı sinyali", "/#emsal-degerleme", "Calculator"),
      item("urun-ef-degerleme", "Satış ve kazanç", "EmlakFiyati ile değerleme", "Ada/parsel bazlı değerleme ve PDF rapor", "/#degerleme", "MapPinned"),
      item("urun-imza", "Satış ve kazanç", "Dijital imza", "SMS onaylı sözleşme akışı", "/#imza", "FileSignature"),
      item("urun-otomasyon", "Otomasyon ve ofis", "Otomasyonlar", "Arka planda çalışan otomatik görevler", "/#otomasyon", "Workflow"),
      item("urun-ai-asistan", "Otomasyon ve ofis", "AI asistan", "Kişisel veri maskeli yanıtlar", "/#ai-asistan", "Bot"),
      item("urun-vitrin", "Otomasyon ve ofis", "Vitrin ve portallar", "Ofis vitrini, token’lı portallar", "/#vitrin", "Globe"),
      item("urun-portal-kontrol", "Otomasyon ve ofis", "Portal kontrolü", "İlan takibi ve teyit", "/#portal-kontrol", "Link2"),
      item("urun-tv-modu", "Otomasyon ve ofis", "Ofis panosu (TV)", "Ofis ekranı için canlı pano", "/#tv-modu", "Tv"),
      item("urun-moduller", "Otomasyon ve ofis", "Modüller (aç/kapa)", "İhtiyacınız olmayanı kapatın", "/#moduller", "ToggleRight"),
    ],
    featured: { eyebrow: "En çok bakılan", icon: { kind: "lucide", name: "ShieldAlert" }, title: "Kaybettiğiniz komisyonu görün", text: "İlan yayından kalkınca sistem sebebini sorar; kaçan komisyon danışman bazında görünür olur.", ctaLabel: "Kalkanı inceleyin", href: "/#kayip-kacak", hidden: false, media: null },
  },
  {
    id: "cozum",
    kind: "menu",
    label: "Çözümler",
    href: "",
    hidden: false,
    items: [
      item("cozum-kayit-plan-advisor", "Ofis büyüklüğüne göre", "Bağımsız danışman", "Tek kişilik çalışma için", "/kayit?plan=advisor", "UserRound"),
      item("cozum-kayit-plan-office", "Ofis büyüklüğüne göre", "Emlak ofisi", "Küçük ve orta ölçekli ekip", "/kayit?plan=office", "Building2"),
      item("cozum-kayit-plan-professional", "Ofis büyüklüğüne göre", "Büyüyen ekip", "Çok danışmanlı, çok şubeli yapı", "/kayit?plan=professional", "Briefcase"),
      item("cozum-kayit-plan-enterprise", "Ofis büyüklüğüne göre", "Kurumsal yapı", "Franchise ve proje satış ekipleri", "/kayit?plan=enterprise", "Crown"),
      item("cozum-fiyatlar-karsilastirma", "Karar vermek için", "Paketleri karşılaştırın", "Fiyat, limit ve kapsam yan yana", "/fiyatlar#karsilastirma", "BadgeCheck"),
      item("cozum-neden", "Karar vermek için", "Neden EmlakSoft", "Excel ve defterle karşılaştırma", "/#neden", "Scale"),
    ],
    featured: { eyebrow: "Başlamak kolay", icon: { kind: "lucide", name: "CalendarCheck" }, title: "Ofisinizi ücretsiz deneyin", text: "Kayıt olun; kurulum sihirbazı ofisinizi ve ekibinizi adım adım hazırlasın.", ctaLabel: "Ücretsiz dene", href: "/kayit", hidden: false, media: null },
  },
  {
    id: "kaynak",
    kind: "menu",
    label: "Kaynaklar",
    href: "",
    hidden: false,
    items: [
      item("kaynak-nasil", "Öğrenin", "Nasıl çalışır", "Üç adımda başlangıç", "/#nasil", "Route"),
      item("kaynak-sss", "Öğrenin", "Sık sorulan sorular", "Net cevaplar", "/#sss", "CircleHelp"),
      item("kaynak-guvenlik", "Öğrenin", "Güvenlik ve KVKK", "Süreç ve altyapı", "/#guvenlik", "Lock"),
      item("kaynak-uyum", "Yasal ve destek", "Telefon ve KVKK uyumu", "Doğru numara, izinli iletişim", "/#uyum", "ShieldCheck"),
      item("kaynak-kvkk-aydinlatma", "Yasal ve destek", "KVKK aydınlatma metni", "Yasal metin", "/kvkk-aydinlatma", "Scale"),
      item("kaynak-destek-emlaksoft-com-tr", "Yasal ve destek", "Destek", "destek@emlaksoft.com.tr", "mailto:destek@emlaksoft.com.tr", "Mail"),
    ],
    featured: { eyebrow: "Veri güvenliği", icon: { kind: "lucide", name: "Lock" }, title: "Verinizi süreçle koruyun", text: "Satır düzeyinde güvenlik, rol ve izin matrisi, denetim kaydı ve dışa aktarma.", ctaLabel: "Güvenlik bölümüne git", href: "/#guvenlik", hidden: false, media: null },
  },
  {
    id: "fiyat",
    kind: "menu",
    label: "Fiyatlar",
    href: "",
    hidden: false,
    items: [
      item("fiyat-fiyatlar", "Fiyatlandırma", "Paketler ve fiyatlar", "Güncel fiyat ve limitler", "/fiyatlar", "BadgeCheck"),
      item("fiyat-fiyatlar-karsilastirma", "Fiyatlandırma", "Paket karşılaştırma", "Özellik özellik tablo", "/fiyatlar#karsilastirma", "Scale"),
      item("fiyat-fiyatlar-kacan-komisyon", "Fiyatlandırma", "Kaçan komisyon hesaplayıcı", "Kendi sayılarınızla hesaplayın", "/fiyatlar#kacan-komisyon", "HandCoins"),
      item("fiyat-fiyatlar-sss", "Fiyatlandırma", "Fiyat SSS", "Fatura, KDV ve limitler", "/fiyatlar#sss", "CircleHelp"),
    ],
    featured: { eyebrow: "Şeffaf fiyat", icon: { kind: "lucide", name: "Rocket" }, title: "Size uygun paketi seçin", text: "Fiyatlar KDV hariç, taahhütsüz. Deneme boyunca tüm özellikler açık.", ctaLabel: "Fiyatlara git", href: "/fiyatlar", hidden: false, media: null },
  },
];

function defaultFooter(): FooterColumn[] {
  return [
    {
      id: "urun",
      title: "Ürün",
      hidden: false,
      autoPlans: false,
      links: [
        link("urun-ozellikler", "Özellikler", "/#ozellikler"),
        link("urun-tur", "Ürün turu", "/#tur"),
        link("urun-kayip", "Kayıp-kaçak motoru", "/#kayip-kacak"),
        link("urun-degerleme", "Emsal bazlı değerleme", "/#degerleme"),
        link("urun-portal", "Portal kontrolü", "/#portal-kontrol"),
        link("urun-imza", "Dijital imza", "/#imza"),
        link("urun-guvenlik", "Güvenlik ve KVKK", "/#guvenlik"),
      ],
    },
    {
      id: "paketler",
      title: "Paketler",
      hidden: false,
      autoPlans: true,
      links: [link("paket-karsilastir", "Fiyatları karşılaştır", "/fiyatlar")],
    },
    {
      id: "kaynaklar",
      title: "Kaynaklar",
      hidden: false,
      autoPlans: false,
      links: [
        link("kaynak-neden", "Neden EmlakSoft", "/#neden"),
        link("kaynak-nasil", "Nasıl çalışır", "/#nasil"),
        link("kaynak-sss", "Sık sorulan sorular", "/#sss"),
        link("kaynak-araclar", "Araçlar", "/araclar"),
        link("kaynak-giris", "Giriş yap", "/giris"),
      ],
    },
    {
      id: "yasal",
      title: "Yasal",
      hidden: false,
      autoPlans: false,
      links: [
        link("yasal-kvkk", "KVKK Aydınlatma", "/kvkk-aydinlatma"),
        link("yasal-gizlilik", "Gizlilik Politikası", "/gizlilik"),
        link("yasal-cerez", "Çerez Politikası", "/cerez-politikasi"),
        link("yasal-kullanim", "Kullanım Şartları", "/kullanim-sartlari"),
        link("yasal-mesafeli", "Mesafeli Satış Sözleşmesi", "/mesafeli-satis"),
        link("yasal-on-bilgi", "Ön Bilgilendirme", "/on-bilgilendirme"),
        link("yasal-iptal", "İptal ve İade", "/iptal-iade"),
      ],
    },
    {
      id: "iletisim",
      title: "İletişim",
      hidden: false,
      autoPlans: false,
      links: [
        link("iletisim-demo", "Görüşme talep edin", "/demo"),
        link("iletisim-destek", "destek@emlaksoft.com.tr", "mailto:destek@emlaksoft.com.tr"),
      ],
    },
  ];
}

export function defaultSiteMenu(): SiteMenuConfig {
  return {
    v: 1,
    groups: structuredClone(DEFAULT_GROUPS),
    footer: defaultFooter(),
    announcement: { enabled: false, key: "0", text: "", href: "", linkLabel: "", endsOn: "", dismissible: true },
  };
}
