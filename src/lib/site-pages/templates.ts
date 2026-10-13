import type { PageKind, SitePageContent } from "./schema-core";

/**
 * "+ Yeni sayfa" şablon galerisi: her şablon örnek blok ve metinlerle DOLU gelir (boş sayfa korkusu yok).
 * Metinler doğrulanabilir iddialarla sınırlıdır (rakam/garanti/"en iyi" yok); bağlantılar yalnız var olan sayfalara gider.
 */
export const TEMPLATE_IDS = ["hakkimizda", "iletisim", "kampanya", "bolge", "bos"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type PageTemplate = { id: TemplateId; label: string; description: string; kind: PageKind; slug: string; content: SitePageContent };

const seo = (title: string, description: string) => ({ title, description, index: true, inSitemap: true });

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: "hakkimizda",
    label: "Hakkımızda",
    description: "Kim olduğunuz, neden bu işi yaptığınız ve nasıl çalıştığınız.",
    kind: "kurumsal",
    slug: "hakkimizda",
    content: {
      title: "Hakkımızda",
      blocks: [
        {
          type: "hero",
          eyebrow: "Hakkımızda",
          title: "Emlak ofisleri için kurulmuş bir yazılım ekibiyiz",
          lead: "EmlakSoft; müşteri, portföy, randevu, anlaşma ve komisyon işlerini tek yerde toplayan, Türkiye'deki emlak ofisleri için geliştirilmiş bir ofis yönetim platformudur.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
          secondary: { label: "Fiyatları görün", href: "/fiyatlar" },
        },
        {
          type: "text",
          heading: "Neden varız",
          paragraphs: [
            "Emlak ofislerinde iş; defterlere, mesajlaşma uygulamalarına ve tablolara dağılır. Kim hangi müşteriyle görüştü, hangi portföyün sözleşmesi bitiyor, hangi komisyon tahsil edilmedi sorularının cevabı çoğu zaman bir kişinin hafızasındadır.",
            "EmlakSoft bu bilgiyi ofisin ortak hafızasına dönüştürür: her kayıt kimin elinde olduğu, ne zaman güncellendiği ve sırada ne yapılacağı bilgisiyle birlikte tutulur.",
          ],
          bullets: [],
        },
        {
          type: "features",
          heading: "Nasıl çalışıyoruz",
          items: [
            { icon: "ShieldCheck", title: "Veriniz sizindir", text: "Her ofisin verisi ayrı tutulur; ofisler birbirinin kaydını göremez." },
            { icon: "Users", title: "Ofislerle birlikte", text: "Yeni özellikleri kullanan ofislerin geri bildirimiyle önceliklendiririz." },
            { icon: "Scale", title: "Mevzuata uygun", text: "KVKK aydınlatma metinleri ve onay kayıtları ürünün içinde gelir." },
          ],
        },
        {
          type: "cta",
          title: "Ofisinizle denemeye başlayın",
          text: "Kurulum birkaç dakika sürer; deneme boyunca tüm özellikler açıktır.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
          secondary: { label: "Paketleri karşılaştırın", href: "/fiyatlar#karsilastirma" },
        },
      ],
      seo: seo("Hakkımızda", "EmlakSoft'u kimin, neden geliştirdiğini ve emlak ofisleriyle nasıl çalıştığımızı öğrenin."),
    },
  },
  {
    id: "iletisim",
    label: "İletişim",
    description: "E-posta ve telefon SEO ayarlarındaki kurum bilgisinden gelir.",
    kind: "kurumsal",
    slug: "iletisim",
    content: {
      title: "İletişim",
      blocks: [
        {
          type: "hero",
          eyebrow: "İletişim",
          title: "Size nasıl yardımcı olabiliriz?",
          lead: "Paketler, kurulum ya da mevcut hesabınızla ilgili sorularınız için bize yazın; mesai saatleri içinde dönüş yaparız.",
          primary: { label: "Sık sorulanlara bakın", href: "/fiyatlar#sss" },
        },
        { type: "contact", heading: "İletişim bilgileri", showEmail: true, showPhone: true, showAddress: false },
        {
          type: "faq",
          items: [
            { q: "Hesabım varsa destek talebini nereden açarım?", a: "Ofis panelinde Yardım bölümünden destek talebi açabilirsiniz; talebiniz ve cevabımız hesabınızda kayıtlı kalır." },
            { q: "Kurulum için randevu almam gerekir mi?", a: "Hayır. Kurulum sihirbazı ofisinizi birkaç dakikada açar; takıldığınız yerde bize yazabilirsiniz." },
          ],
        },
      ],
      seo: seo("İletişim", "EmlakSoft ekibine ulaşın: paketler, kurulum ve hesabınızla ilgili sorularınız için iletişim bilgileri."),
    },
  },
  {
    id: "kampanya",
    label: "Kampanya landing",
    description: "Tek bir teklif veya dönem kampanyası için odaklı sayfa.",
    kind: "kampanya",
    slug: "kampanya",
    content: {
      title: "Kampanya",
      blocks: [
        {
          type: "hero",
          eyebrow: "Dönem kampanyası",
          title: "Ofisinizi bu ay dijitale taşıyın",
          lead: "Kampanyanın kapsamını ve süresini burada tek cümleyle anlatın. Koşulları aşağıdaki maddelerde açıkça yazın.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
          secondary: { label: "Fiyatları görün", href: "/fiyatlar" },
        },
        {
          type: "features",
          heading: "Kampanyada neler var",
          items: [
            { icon: "Users", title: "Müşteri ve talep takibi", text: "Her müşterinin görüşme geçmişi ve sıradaki adımı tek ekranda." },
            { icon: "Building2", title: "Portföy yönetimi", text: "Portföy, fotoğraf ve sözleşme bilgileri ofisin ortak kaydında." },
            { icon: "HandCoins", title: "Komisyon takibi", text: "Anlaşma kapanınca komisyon payları ve tahsilat durumu görünür." },
          ],
        },
        {
          type: "text",
          heading: "Kampanya koşulları",
          paragraphs: ["Kampanya koşullarını açık ve ölçülebilir yazın: başlangıç ve bitiş tarihi, hangi paketlerde geçerli olduğu ve varsa kısıtlar."],
          bullets: ["Geçerlilik tarihi: ", "Geçerli paketler: ", "Diğer koşullar: "],
        },
        {
          type: "cta",
          title: "Kampanyadan yararlanın",
          text: "Kayıt olurken kampanya kodunu kullanın.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
        },
      ],
      seo: seo("Kampanya", "Dönem kampanyasının kapsamı, geçerli paketler ve koşullar."),
    },
  },
  {
    id: "bolge",
    label: "Bölge landing",
    description: "Bir il veya ilçedeki emlak ofisleri için yerel sayfa.",
    kind: "bolge",
    slug: "emlak-ofisi-yazilimi/istanbul",
    content: {
      title: "İstanbul emlak ofisleri için",
      blocks: [
        {
          type: "hero",
          eyebrow: "İstanbul",
          title: "İstanbul'daki emlak ofisleri için ofis yönetim yazılımı",
          lead: "Müşteri, portföy, randevu ve komisyon takibini tek yerde toplayın. Bölgenize özgü notları bu açıklamaya ekleyin.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
          secondary: { label: "Fiyatları görün", href: "/fiyatlar" },
        },
        {
          type: "text",
          heading: "Bölgedeki ofisler neden kullanıyor",
          paragraphs: ["Bölgenin emlak piyasasına özgü ihtiyaçları burada anlatın: yoğun kiralık talebi, site yönetimi, yabancı müşteri gibi. Doğrulanabilir bilgi yazın."],
          bullets: [],
        },
        {
          type: "faq",
          items: [{ q: "Birden fazla şubemiz var, kullanabilir miyiz?", a: "Evet. Şube sayısı paketinize göre değişir; ayrıntılar fiyatlar sayfasındaki karşılaştırma tablosunda yazar." }],
        },
        {
          type: "cta",
          title: "Ofisinizi birkaç dakikada kurun",
          text: "Deneme boyunca tüm özellikler açıktır.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
        },
      ],
      seo: seo("İstanbul emlak ofisi yazılımı", "İstanbul'daki emlak ofisleri için müşteri, portföy, randevu ve komisyon takibini tek yerde toplayan yazılım."),
    },
  },
  {
    id: "bos",
    label: "Boş sayfa",
    description: "Tek giriş bloğuyla başlar; blokları siz eklersiniz.",
    kind: "bos",
    slug: "yeni-sayfa",
    content: {
      title: "Yeni sayfa",
      blocks: [
        {
          type: "hero",
          eyebrow: "",
          title: "Sayfa başlığı",
          lead: "Sayfanın ne anlattığını bir iki cümleyle yazın.",
          primary: { label: "Denemeyi başlatın", href: "/kayit" },
        },
      ],
      seo: { title: "", description: "", index: false, inSitemap: false },
    },
  },
];

export function getTemplate(id: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id);
}
