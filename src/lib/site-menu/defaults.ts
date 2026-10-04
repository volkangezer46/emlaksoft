import { PLANS } from "@/lib/billing/plans";
import type { FooterColumn, IconRef, MenuGroup, MenuItem, SiteMenuConfig } from "./schema";

/**
 * VARSAYILAN site menüsü: yönetici hiçbir şey yayınlamadıysa site bugünkü içerikle birebir aynı çalışır.
 * (Eski sabit `site-header.tsx` / `site-footer.tsx` içeriği buraya taşındı; kimlikler kararlıdır.)
 */

const lucide = (name: string): IconRef => ({ kind: "lucide", name });

function item(id: string, label: string, text: string, href: string, icon: string): MenuItem {
  return { id, label, text, href, icon: lucide(icon), badge: null, hidden: false };
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
    columns: 2,
    featured: null,
    items: [
      item("urun-tur", "Ürün turu", "Bugün, müşteriler, portföy ve daha fazlası", "/#tur", "LayoutDashboard"),
      item("urun-kayip", "Kayıp-kaçak kalkanı", "Kaçan komisyonu rakama dökün", "/#kayip-kacak", "ShieldAlert"),
      item("urun-degerleme", "Emsal bazlı değerleme", "Fiyat aralığı sinyali", "/#degerleme", "Calculator"),
      item("urun-otomasyon", "Otomasyonlar", "27 otomatik görev", "/#otomasyon", "Workflow"),
      item("urun-portal", "Portal kontrolü", "İlan takibi ve teyit", "/#portal-kontrol", "Link2"),
      item("urun-imza", "Dijital imza", "SMS onaylı sözleşme akışı", "/#imza", "FileSignature"),
      item("urun-ai", "AI asistan", "Kişisel veri maskeli", "/#ai-asistan", "Bot"),
      item("urun-vitrin", "Vitrin ve portallar", "Ofis vitrini, token’lı portallar", "/#vitrin", "Globe"),
    ],
  },
  {
    id: "cozum",
    kind: "menu",
    label: "Çözümler",
    href: "",
    hidden: false,
    columns: 1,
    featured: null,
    items: [
      item("cozum-danisman", "Bağımsız danışman", "Danışman paketi", "/kayit?plan=advisor", "UserRound"),
      item("cozum-ofis", "Emlak ofisi", "Ofis paketi", "/kayit?plan=office", "Building2"),
      item("cozum-ekip", "Büyüyen ekip", "Profesyonel paketi", "/kayit?plan=professional", "Briefcase"),
      item("cozum-kurumsal", "Çok şubeli yapı", "Kurumsal paketi", "/kayit?plan=enterprise", "Crown"),
      item("cozum-karsilastir", "Paketleri karşılaştır", "Fiyat ve limitler", "/fiyatlar", "BadgeCheck"),
    ],
  },
  { id: "fiyatlandirma", kind: "link", label: "Fiyatlandırma", href: "/fiyatlar", hidden: false, columns: 1, featured: null, items: [] },
  {
    id: "kaynak",
    kind: "menu",
    label: "Kaynaklar",
    href: "",
    hidden: false,
    columns: 1,
    featured: null,
    items: [
      item("kaynak-nasil", "Nasıl çalışır", "Üç adımda başlangıç", "/#nasil", "Route"),
      item("kaynak-sss", "Sık sorulan sorular", "Net cevaplar", "/#sss", "CircleHelp"),
      item("kaynak-guvenlik", "Güvenlik ve KVKK", "Süreç ve altyapı", "/#guvenlik", "Lock"),
      item("kaynak-kvkk", "KVKK aydınlatma metni", "Yasal metin", "/kvkk-aydinlatma", "Scale"),
      item("kaynak-demo", "Demo görüşmesi planla", "Ürünü birlikte gezelim", "/demo", "CalendarCheck"),
      item("kaynak-destek", "Destek", "destek@emlaksoft.com.tr", "mailto:destek@emlaksoft.com.tr", "Mail"),
    ],
  },
];

function defaultFooter(): FooterColumn[] {
  return [
    {
      id: "urun",
      title: "Ürün",
      hidden: false,
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
      links: [
        ...PLANS.map((p) => link(`paket-${p.id}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"), p.name, `/kayit?plan=${p.id}`)),
        link("paket-karsilastir", "Fiyatları karşılaştır", "/fiyatlar"),
      ],
    },
    {
      id: "kaynaklar",
      title: "Kaynaklar",
      hidden: false,
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
      links: [
        link("iletisim-demo", "Demo görüşmesi planla", "/demo"),
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
