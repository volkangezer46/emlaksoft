import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact-info";
import type { FooterBrand, FooterColumn, IconRef, MenuGroup, MenuItem, NotFoundContent, OgCard, SiteMenuConfig } from "./schema";
import { DEFAULT_CTAS } from "./schema-core";

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

/**
 * Üst menü SADE (sadeleştirme planı C31): üç başlık, toplam en çok 15 bağlantı (`marketing-nav.test.ts` kilitler).
 * Paket/ofis büyüklüğü bağlantıları alt bilgideki "Paketler" sütununda (autoPlans) ve Fiyatlar sayfasında durur.
 */
export const TOP_MENU_LINK_BUDGET = 15;

const DEFAULT_GROUPS: MenuGroup[] = [
  {
    id: "urun",
    kind: "menu",
    label: "Ürün",
    href: "",
    hidden: false,
    items: [
      item("urun-tur", "Günlük iş", "Ürün turu", "Bugün, müşteriler, portföy ve daha fazlası", "/#tur", "LayoutDashboard"),
      item("urun-komisyon", "Günlük iş", "Komisyon ve anlaşma", "Tekliften danışman ödemesine tek yerde", "/#komisyon", "Handshake"),
      item("urun-imza", "Günlük iş", "Dijital imza", "SMS onaylı sözleşme", "/#imza", "FileSignature"),
      item("urun-vitrin", "Günlük iş", "Vitrin ve portallar", "Ofis vitrini, müşteri ve malik sayfaları", "/#vitrin", "Globe"),
      item("urun-kayip-kacak", "Kazanç", "Kaçan komisyon", "Kaçan komisyonu rakama dökün", "/#kayip-kacak", "ShieldAlert"),
      item("urun-degerleme", "Kazanç", "Değerleme", "Emsale dayalı fiyat aralığı", "/#emsal-degerleme", "Calculator"),
      item("urun-otomasyon", "Kazanç", "Otomatik hatırlatmalar", "Arka planda çalışan görevler", "/#otomasyon", "Workflow"),
    ],
    featured: { eyebrow: "En çok bakılan", icon: { kind: "lucide", name: "ShieldAlert" }, title: "Kaybettiğiniz komisyonu görün", text: "İlan yayından kalkınca sistem sebebini sorar; kaçan komisyon danışman bazında görünür olur.", ctaLabel: "İnceleyin", href: "/#kayip-kacak", hidden: false, preview: "leak", media: null },
  },
  {
    id: "kaynak",
    kind: "menu",
    label: "Kaynaklar",
    href: "",
    hidden: false,
    items: [
      item("kaynak-nasil", "Öğrenin", "Nasıl çalışır", "Üç adımda başlangıç", "/#nasil", "Route"),
      item("cozum-neden", "Öğrenin", "Neden EmlakSoft", "Excel ve defterle karşılaştırma", "/#neden", "Scale"),
      item("kaynak-sss", "Öğrenin", "Sık sorulan sorular", "Net cevaplar", "/#sss", "CircleHelp"),
      item("kaynak-guvenlik", "Güven ve destek", "Güvenlik ve KVKK", "Süreç ve altyapı", "/#guvenlik", "Lock"),
      item("kaynak-destek-emlaksoft-com-tr", "Güven ve destek", "Destek", SUPPORT_EMAIL, SUPPORT_MAILTO, "Mail"),
    ],
    featured: { eyebrow: "Başlamak kolay", icon: { kind: "lucide", name: "CalendarCheck" }, title: "Ofisinizi dakikalar içinde kurun", text: "Dört alanla üye olun, dört kısa soruyla ofisinizi hazırlayın.", ctaLabel: "Ücretsiz dene", href: "/kayit", hidden: false, media: null },
  },
  {
    id: "fiyat",
    kind: "menu",
    label: "Fiyatlar",
    href: "",
    hidden: false,
    items: [
      item("fiyat-fiyatlar", "Fiyatlandırma", "Paketler ve fiyatlar", "Güncel fiyat, limit ve karşılaştırma", "/fiyatlar", "BadgeCheck"),
      item("fiyat-fiyatlar-kacan-komisyon", "Fiyatlandırma", "Kaçan komisyon hesaplayıcı", "Kendi sayılarınızla hesaplayın", "/fiyatlar#kacan-komisyon", "HandCoins"),
    ],
    featured: { eyebrow: "Şeffaf fiyat", icon: { kind: "lucide", name: "Rocket" }, title: "Size uygun paketi seçin", text: "Fiyatlar KDV hariç, taahhütsüz. Deneme boyunca tüm özellikler açık.", ctaLabel: "Fiyatlara git", href: "/fiyatlar", hidden: false, preview: "plans", media: null },
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
        link("yasal-davet", "Davet ve Ortaklık Koşulları", "/davet-kosullari"),
      ],
    },
    {
      id: "iletisim",
      title: "İletişim",
      hidden: false,
      autoPlans: false,
      links: [
        link("iletisim-destek", SUPPORT_EMAIL, SUPPORT_MAILTO),
      ],
    },
  ];
}

/** Alt bilgi marka bloğu: src/components/site-footer.tsx'teki bugünkü sabit metnin birebir aynısı. */
function defaultFooterBrand(): FooterBrand {
  return {
    description: "Emlak ofisleri için müşteri, portföy, anlaşma ve komisyon akışını tek panelde toplayan abonelikli yazılım.",
    badges: [
      { label: "Almanya veri merkezi", icon: "shield-check" },
      { label: "KVKK süreç araçları", icon: "scale" },
      { label: "SMS onaylı imza", icon: "file-signature" },
    ],
    cta: { label: "Ücretsiz dene", href: "/kayit" },
    copyright: "© {yil} EmlakSoft. Tüm hakları saklıdır.",
    disclaimer: "Ekran görüntüleri ve sayılar örnek veridir. Anılan portal adları yalnız takip içindir; resmi ortaklık iddiası yoktur.",
    showContact: false,
  };
}

/** Paylaşım kartı (1200x630): src/lib/brand/og-card.tsx'teki bugünkü metin. */
function defaultOgCard(): OgCard {
  return {
    title: "Türkiye’nin emlak işletim sistemi",
    subtitle: "Müşteriden tapuya, ilandan komisyona — ofisinizi tek premium platformda yönetin.",
    chips: ["İYS/EİDS hazırlık akışları", "Yapay zeka destekli", "Portal operasyonları"],
  };
}

/** 404 sayfası: src/app/not-found.tsx'teki bugünkü metin ve popüler bağlantılar. */
function defaultNotFound(): NotFoundContent {
  return {
    title: "Aradığınız sayfa taşınmış olabilir",
    text: "Bağlantı eski olabilir ya da adres yanlış yazılmış olabilir. Sorun değil, aşağıdan kaldığınız yerden devam edebilirsiniz.",
    links: [
      { label: "Fiyatlar", desc: "Paketler ve kapsam", href: "/fiyatlar" },
      { label: "Ücretsiz deneyin", desc: "Ofisinizi birkaç dakikada açın", href: "/kayit" },
      { label: "Araçlar", desc: "Ücretsiz hesaplayıcılar", href: "/araclar" },
    ],
  };
}

export function defaultSiteMenu(): SiteMenuConfig {
  return {
    v: 1,
    groups: structuredClone(DEFAULT_GROUPS),
    footer: defaultFooter(),
    footerBrand: defaultFooterBrand(),
    ctas: structuredClone(DEFAULT_CTAS) as SiteMenuConfig["ctas"],
    announcements: [],
    ogCard: defaultOgCard(),
    notFound: defaultNotFound(),
  };
}
