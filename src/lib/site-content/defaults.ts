import { PIONEER_CLAIM } from "./claims";
import type { SiteContent } from "./schema";

/**
 * Hiç yayın yokken siteyi BUGÜNKÜ metinle gösteren varsayılan içerik. Ana sayfa bileşenleri bu metinleri artık
 * burada okur; `landing-golden.test.ts` çıktıyı eski sabit metinlerden alınmış altın dosyayla birebir karşılaştırır.
 * Değişkenler ({deneme}, {yillik} ...) tokens.ts'te çözülür. Bölüm kimlikleri (id) ikon/yapı eşlemesi içindir; değiştirilmez.
 */
export function defaultSiteContent(): SiteContent {
  return {
    v: 1,
    hero: {
      badge: "Emlak ofisleri için işletim sistemi",
      title: "Emlak işlerinizi",
      em: "tek platformda",
      tail: "yönetin",
      lead: "Müşteri, talep, portföy, anlaşma ve komisyon akışı tek panelde. Kaçan komisyonu görünür kılan kayıp-kaçak motoru, emsal bazlı değerleme ve 27 otomatik görev ofisinizle birlikte çalışır.",
      primary: { label: "{deneme_dene}", href: "/kayit" },
      secondary: { label: "Görüşme talep edin", href: "/demo" },
      checks: [
        { id: "kart", text: "Kredi kartı gerekmez", hidden: false },
        { id: "ozellik", text: "Deneme boyunca tüm özellikler açık", hidden: false },
        { id: "taahhut", text: "Taahhüt yok", hidden: false },
      ],
      integrationBadge: "EmlakFiyati entegrasyonu",
      integrationLine: "Ada/parsel bazlı değerleme ve PDF rapor, müşteri kaydınızın yanından.",
    },
    sections: {
      tur: { eyebrow: "Ürün turu", title: "Panelin içine", em: "bir bakın.", tail: "", text: "Yedi ana ekranın örnek görünümü. Menüdeki dokuz iş başlığının hepsi aynı müşteri ve portföy kaydını kullanır." },
      ozellikler: { eyebrow: "Ürün", title: "Bir ofisin ihtiyacı olan her şey,", em: "birbirine bağlı.", tail: "", text: "Menü dokuz iş başlığına ayrılır; hepsi aynı müşteri ve portföy kaydını kullanır, veriyi tekrar girmezsiniz." },
      diger: { eyebrow: "Ayrıntılar", title: "Günlük işi kolaylaştıran", em: "küçük büyük şeyler.", tail: "", text: "Vitrin, portal ve otomasyonun yanında ofisin her günü kullandığı yardımcı özellikler." },
      neden: { eyebrow: "Neden EmlakSoft", title: "Excel, WhatsApp ve defterle", em: "karşılaştırın.", tail: "", text: "Bugün işi nasıl yürütüyorsanız, aynı işin ürün içindeki karşılığı." },
      nasil: { eyebrow: "Nasıl çalışır", title: "Üç adımda", em: "başlayın.", tail: "", text: "" },
      fiyat: { eyebrow: "Fiyat", title: "Gizli maliyet yok,", em: "sürpriz yok.", tail: "", text: "KDV hariç fiyatlar. Taahhüt yok, dilediğiniz an iptal edin. {yillik_cumle}" },
      sss: { eyebrow: "Sık sorulan sorular", title: "Aklınızdaki sorular,", em: "net cevaplar.", tail: "", text: "" },
      guvenlik: { eyebrow: "Güvenlik ve KVKK", title: "Verinizi korumak,", em: "süreçle", tail: "desteklenir.", text: "" },
    },
    valueCards: [
      { id: "adim", title: "Adım adım kurulum", text: "Kurulum sihirbazı ofisinizi, ekibinizi ve ilk verilerinizi sırayla hazırlar.", href: "/#nasil", hidden: false },
      { id: "rol", title: "Rol ve izin kontrolü", text: "Danışman, muhasebe ve yönetici erişimi ayrı ayrı tanımlanır.", href: "/#guvenlik", hidden: false },
      { id: "kacak", title: "Kaçan komisyonu ölçün", text: "Zorunlu kapanış formu ve danışman bazında kaçak karnesi.", href: "/#kayip-kacak", hidden: false },
      { id: "veri", title: "Ofis verisi ayrı tutulur", text: "Satır düzeyinde güvenlik; ana veritabanı Frankfurt bölgesinde.", href: "/#guvenlik", hidden: false },
      { id: "gorev", title: "Arka planda çalışan görevler", text: "Hatırlatma, teyit ve özet işleri 27 otomatik görevle yürür.", href: "/#ozellikler", hidden: false },
    ],
    trust: [
      { id: "deneme", label: "ücretsiz deneme, kartsız", href: "/#fiyat", hidden: false },
      { id: "gorev", label: "otomatik görev", href: "/#nasil", hidden: false },
      { id: "menu", label: "iş başlığı, tek menü", href: "/#tur", hidden: false },
      { id: "imza", label: "onaylı dijital imza", href: "/#ozellikler", hidden: false },
      { id: "kvkk", label: "süreç araçları", href: "/#guvenlik", hidden: false },
    ],
    highlights: [
      { id: "komisyon", title: "Komisyon ve anlaşma omurgası", text: "Talep, teklif, sözleşme ve anlaşma aynı kayıtta ilerler; komisyon bölüşümü, hakediş ve onay durumu kayıt altındadır.", hidden: false },
      { id: "portallar", title: "Müşteri ve malik portalı", text: "Müşteriye ve mülk sahibine özel bağlantıyla açılan sayfalar; ilan, teklif ve randevu durumu tek yerde, hesap açmadan.", hidden: false },
      { id: "tv-modu", title: "Ofis panosu (TV modu)", text: "Ofis ekranına yansıtılan pano: günün özeti ve ekip skoru uzaktan okunur boyutta, kendiliğinden tazelenir.", hidden: false },
      { id: "moduller", title: "Modüller: aç, kapa", text: "Kullanmadığınız alanı ofis ayarlarından kapatın; menü ve ilgili otomasyonlar sadeleşir. Çekirdek alanlar kapatılamaz.", hidden: false },
      { id: "uyum", title: "Telefon ve KVKK uyumu", text: "Telefonlar ülkesine göre biçimlenir ve sunucuda doğrulanır; yanlış numara kayda girmez. İYS onayı, KVKK silme talepleri ve denetim dosyası bir arada.", hidden: false },
    ],
    steps: [
      { id: "hesap", title: "Hesabınızı açın", text: "{deneme}, kredi kartı istenmez. Deneme boyunca tüm özellikler açıktır.", hidden: false },
      { id: "ofis", title: "Ofisinizi ve ekibinizi tanımlayın", text: "Kurulum sihirbazı ofis bilgilerinizi ve ekibinizi adım adım hazırlar; rolleri siz belirlersiniz. Mevcut müşteri ve portföyleri Excel/CSV ile aktarabilirsiniz.", hidden: false },
      { id: "izle", title: "Eşleşmeleri ve uyarıları izleyin", text: "Talep-portföy eşleşmeleri, randevular ve otomatik görev hatırlatmaları panonuza düşer.", hidden: false },
    ],
    security: {
      chips: [
        { id: "frankfurt", text: "Frankfurt (eu-central-1)", hidden: false },
        { id: "rls", text: "Satır düzeyinde güvenlik", hidden: false },
        { id: "rol", text: "Rol-izin matrisi", hidden: false },
        { id: "kvkk", text: "KVKK süreç araçları", hidden: false },
        { id: "iys", text: "İYS/EİDS hazırlık", hidden: false },
      ],
      items: [
        { id: "veri", title: "Ofisinizin verisi ayrı tutulur", text: "Her kayıt ofisinize bağlıdır; veritabanı satır düzeyinde güvenlik (RLS) ile ofisler arası erişimi sınırlar. Ana veritabanı Frankfurt (eu-central-1) bölgesindedir.", hidden: false },
        { id: "yetki", title: "Her işlem yetki kapısından geçer", text: "Sayfalar ve işlemler izin kontrolünden geçer; yetkisiz kullanıcı ilgili ekranı ve işlemi göremez.", hidden: false },
        { id: "rol", title: "Rol ve izin matrisi", text: "Danışman, muhasebe ve yönetici erişimi ayrı ayrı tanımlanır; kullanıcı bazlı istisnalar eklenebilir.", hidden: false },
        { id: "kvkk", title: "KVKK süreç desteği", text: "Aydınlatma, rıza, dışa aktarım ve silme akışları ile İYS/EİDS hazırlık adımları ürünün içindedir.", hidden: false },
      ],
      note: "EmlakSoft KVKK süreçlerinizi destekleyen araçlar sunar; hukuki uyumluluk sorumluluğu ofisinizdedir.",
    },
    faq: [
      { id: "f1", q: "Deneme için kredi kartı gerekir mi?", a: "Hayır. Kayıt {deneme_gun}ücretsiz denemeyle başlar ve kart bilgisi istemez. Deneme boyunca tüm özellikler açıktır; süre sonunda size uygun paketi seçersiniz.", hidden: false },
      { id: "f2", q: "Kurulum ne kadar sürer?", a: "Kayıttan sonra kurulum sihirbazı ofis bilgilerinizi, ekibinizi ve ilk verilerinizi adım adım hazırlar. Süre; kullanıcı sayınıza ve içeri aktaracağınız veriye göre değişir.", hidden: false },
      { id: "f3", q: "Verilerim nerede saklanıyor?", a: "Ana uygulama veritabanı seçili Supabase projesinin Avrupa (Frankfurt / eu-central-1) bölgesinde tutulur. Dosya depolama ve etkinleştirdiğiniz dış hizmetler kendi veri işleme koşullarına tabidir. Yetkilendirme, denetim ve veri yaşam döngüsü araçları sunulur; dilediğiniz an dışa aktarabilirsiniz.", hidden: false },
      { id: "f4", q: "Portal ilanlarımı otomatik çekiyor veya yayınlıyor musunuz?", a: "Hayır. Portallardan izinsiz veri kazımıyoruz ve ilanlarınızı portallara otomatik yayınlamıyoruz. İlan numarası/URL ekliyorsunuz; sistem periyodik teyit ister ve ilan düştüğünde kapanış formuyla kaçağı ölçer.", hidden: false },
      { id: "f5", q: "Dijital imza e-imza mıdır?", a: "Hayır. Sözleşmeler SMS ile doğrulanan dijital imza akışıyla onaylanır; bu bir nitelikli elektronik imza (e-imza) değildir.", hidden: false },
      { id: "f6", q: "Sözleşme veya taahhüt var mı?", a: "Taahhüt yok. Aylık kullanın, istediğiniz an iptal edin. {yillik_metin}", hidden: false },
      { id: "f7", q: "Hangi paketi seçmeliyim, modülleri kapatabilir miyim?", a: "Paketler kullanıcı sayısı ve kapsama göre ayrılır; güncel fiyat ve limitler fiyat bölümünde ve Fiyatlar sayfasındadır. Ofis yöneticisi kullanmadığı modülleri ayarlardan kapatıp yeniden açabilir; çekirdek alanlar kapatılamaz.", hidden: false },
      { id: "f8", q: "Mevcut CRM’den geçiş yapabilir miyim?", a: "Evet. Müşteri ve portföylerinizi Excel/CSV ile içeri aktarabilirsiniz. Özel entegrasyon ihtiyaçları teknik değerlendirme sonrasında planlanır.", hidden: false },
      { id: "f9", q: "Değerleme nasıl yapılıyor?", a: "Mahalleyi seçip ada ve parseli girersiniz; sistem EmlakFiyati verisinden bir değer aralığı, güven düzeyi ve açıklama üretir. Sonucu PDF rapora çevirebilirsiniz.", hidden: false },
      { id: "f10", q: "Kontör ve aylık sorgu hakkı nasıl işliyor?", a: "Her sorgu ofisinizin kontör bakiyesinden düşer. Paketinizde aylık sorgu hakkı varsa bu hak kapsamında kullanılır; yetmezse ek kontör paketiyle devam edersiniz. Güncel kapsam fiyat bölümünde ve Fiyatlar sayfasındadır.", hidden: false },
      { id: "f11", q: "Değerleme sonucu resmi ekspertiz midir?", a: "Hayır. Sonuç bilgilendirme amaçlıdır, ilan fiyatlarına dayanır ve resmi ekspertiz veya banka değerlemesi yerine geçmez.", hidden: false },
    ],
    finalCta: {
      title: "Ofisinizde kaybolan fırsatları",
      em: "bugün görün.",
      tail: "",
      text: "{deneme}, kredi kartı gerekmez. Verileriniz size ait; istediğiniz an dışa aktarın.",
      primary: { label: "{deneme_dene}", href: "/kayit" },
      secondary: { label: "Görüşme talep edin", href: "/demo" },
      checks: [
        { id: "kvkk", text: "KVKK süreç desteği", hidden: false },
        { id: "yillik", text: "Yıllık ödemede {yillik}", hidden: false },
        { id: "taahhut", text: "Taahhütsüz", hidden: false },
      ],
    },
    valuation: {
      hidden: false,
      eyebrow: "Değerleme",
      title: "Değerleme",
      em: "ofisinizin içinde",
      tail: "",
      text: "Mahalleyi seçin, ada ve parseli girin; EmlakFiyati verisinden değerleme, güven düzeyi ve açıklamasıyla gelsin. Ayrı sitelere gitmeden, müşteri kaydının yanında.",
      claimConcrete: PIONEER_CLAIM.concrete,
      claim: { text: PIONEER_CLAIM.text, hidden: false },
      points: [
        { id: "adaparsel", title: "Ada/parsel ile değerleme", text: "Mahalle seçimi, ada ve parsel bilgisiyle EmlakFiyati verisinden değer aralığı hesaplanır.", hidden: false },
        { id: "guven", title: "Güven düzeyi ve açıklama", text: "Her sonuç, hangi verinin kullanıldığını ve sonucun ne kadar güvenilir olduğunu açıklayan bir notla gelir.", hidden: false },
        { id: "pdf", title: "PDF rapor", text: "Sonucu müşteriyle paylaşabileceğiniz PDF rapora dönüştürün.", hidden: false },
        { id: "kontor", title: "Ofisten kontörlü sorgu", text: "Sorgular ofisinizin kontör bakiyesinden düşer; harcama kayıt altındadır.", hidden: false },
        { id: "hak", title: "Pakete dahil aylık sorgu hakkı", text: "Aylık sorgu hakkı (paket başına): {ef_hak}.", hidden: false },
        { id: "paket", title: "Ek kontör paketi", text: "Hakkınız yetmezse ek kontör paketi alıp sorgulamaya devam edebilirsiniz.", hidden: false },
      ],
      compare: {
        beforeTitle: "Bugün",
        before: [
          { id: "b1", text: "Değerleme için ayrı sitelere girersiniz", hidden: false },
          { id: "b2", text: "Sonucu elle kopyalayıp müşteri kaydına yapıştırırsınız", hidden: false },
          { id: "b3", text: "Rapor için ayrı bir belge hazırlarsınız", hidden: false },
        ],
        afterTitle: "EmlakSoft ile",
        after: [
          { id: "a1", text: "Müşteri kaydının yanında, tek ekranda", hidden: false },
          { id: "a2", text: "Ada ve parseli girin; sonuç ve güven düzeyi gelsin", hidden: false },
          { id: "a3", text: "Tek tıkla PDF rapor", hidden: false },
        ],
      },
      liveBadge: "Canlı",
      soonBadge: "Yakında",
      liveCta: { label: "Hemen deneyin", href: "/kayit" },
      soonCta: { label: "{deneme_dene}", href: "/kayit" },
      note: "Sonuçlar bilgilendirme amaçlıdır, ilan fiyatlarına dayanır; resmi ekspertiz veya banka değerlemesi yerine geçmez.",
    },
    demo: { title: "Görüşme talebi", text: "15 dakikalık tur — CRM, portföy, kayıp-kaçak ve eşleştirme." },
    register: {
      title: "Ücretsiz başlayın",
      text: "3 kısa adımda çalışma alanınız hazır.",
      panelText: "{deneme_uzun}, kredi kartsız ve taahhütsüz. Kurulum sihirbazı ofisinizi adım adım hazırlar; verileriniz rol, yetki ve denetim kontrolleriyle korunur.",
    },
  };
}
