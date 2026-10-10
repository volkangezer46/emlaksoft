import { PIONEER_CLAIM } from "./claims";
import type { SiteContent } from "./schema";
// Otomatik görev sayısı cron envanterinden türetilir (sabit sayı yazılmaz; check:cron ile doğrulanır).
import { CRON_JOBS } from "@/lib/cron-jobs";

/**
 * Hiç yayın yokken siteyi BUGÜNKÜ metinle gösteren varsayılan içerik. Ana sayfa bileşenleri bu metinleri artık
 * burada okur; `landing-golden.test.ts` çıktıyı eski sabit metinlerden alınmış altın dosyayla birebir karşılaştırır.
 * Değişkenler ({deneme}, {yillik} ...) tokens.ts'te çözülür. Bölüm kimlikleri (id) ikon/yapı eşlemesi içindir; değiştirilmez.
 */
const p = (id: string, text: string, gate = "") => ({ id, text, gate, hidden: false });
const c = (id: string, text: string) => ({ id, text, hidden: false });

export function defaultSiteContent(): SiteContent {
  return {
    v: 1,
    hero: {
      badge: "Emlak ofisleri için işletim sistemi",
      title: "Emlak işlerinizi",
      em: "tek platformda",
      tail: "yönetin",
      lead: `Müşteri, talep, portföy, anlaşma ve komisyon akışı tek panelde. Kaçan komisyonu görünür kılan kayıp-kaçak motoru, emsal bazlı değerleme ve ${CRON_JOBS.length} otomatik görev ofisinizle birlikte çalışır.`,
      // Boş = uzun açıklamanın ilk cümlesi ("Müşteri, talep, portföy, anlaşma ve komisyon akışı tek panelde.").
      mobileLead: "",
      primary: { label: "{deneme_dene}", href: "/kayit" },
      secondary: { label: "Paketleri ve fiyatları gör", href: "/fiyatlar" },
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
      { id: "gorev", title: "Arka planda çalışan görevler", text: `Hatırlatma, teyit ve özet işleri ${CRON_JOBS.length} otomatik görevle yürür.`, href: "/#ozellikler", hidden: false },
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
      { id: "f10", q: "Kontör nedir, nasıl işliyor?", a: "Kontör yalnız EmlakFiyati ada/parsel değerlemesi için ofisinizin bakiyesidir; PDF indirme, rapor detayı ve ilan analizi gibi diğer özellikler kontör düşürmez. Her değerleme çalışmadan önce kaç kontör düşeceği görünür. Paketinizdeki aylık kontör kapsamı fiyat bölümünde ve Fiyatlar sayfasındadır; yetmezse 1, 3, 6 veya 12 aylık ek kontör paketi alırsınız.", hidden: false },
      { id: "f11", q: "Değerleme sonucu resmi ekspertiz midir?", a: "Hayır. Sonuç ilan ve emsal verisine dayanır, bilgilendirme amaçlıdır; kesin değer değildir ve resmi ekspertiz veya banka değerlemesi yerine geçmez.", hidden: false },
      { id: "f12", q: "Kontör devreder mi, iade var mı?", a: "Hayır, kontör süreli geçerlidir ve devretmez: satın alınan ek paketin kontörü paket süresi (1, 3, 6 veya 12 ay) sonunda, paketle gelen aylık kontör ay sonunda, hoş geldin kontörü 30 gün sonunda yanar. Harcama önce en yakın tarihte sona erecek kontörden düşer. Sonuç üretilemezse kontör düşmez veya iade edilir.", hidden: false },
      { id: "f13", q: "Rapor ne kadar süre geçerli, PDF'i tekrar indirebilir miyim?", a: "Rapor üretildikten sonra 30 gün erişilebilir; PDF'i bu süre içinde indirip saklayın. PDF indirmek (ilk indirme dahil) kontör düşürmez; kontör yalnız değerleme raporu için harcanır.", hidden: false },
    ],
    finalCta: {
      title: "Ofisinizde kaybolan fırsatları",
      em: "bugün görün.",
      tail: "",
      text: "{deneme}, kredi kartı gerekmez. Verileriniz size ait; istediğiniz an dışa aktarın.",
      primary: { label: "{deneme_dene}", href: "/kayit" },
      secondary: { label: "Paketleri ve fiyatları gör", href: "/fiyatlar" },
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
    // Ürün turu: kimlik = ekran çizimi. `gate` dolu maddeye paket rozeti sayfa kilidinden eklenir (metin elle yazılmaz).
    tour: [
      { id: "bugun", label: "Bugün", text: "Günün işi açılışta tek bakışta: görevler, randevular ve yeni talepler.", points: [p("p1", "Günlük brifing ve AI asistan aynı başlıkta"), p("p2", "Görev ve randevular tek akışta"), p("p3", "Yeni talepler eşleşmeleriyle gelir")], hidden: false },
      { id: "musteriler", label: "Müşteriler", text: "Müşteri kartı, talep ve eşleşmeler yan yana; hiçbir talep kaybolmaz.", points: [p("p1", "Müşteri, talep ve eşleştirme bir arada"), p("p2", "Akıllı listeler ve tavsiyeler"), p("p3", "Gelen kutusu ve görüşme notları")], hidden: false },
      { id: "portfoy", label: "Portföy", text: "Portföyleriniz durumlarıyla kart görünümünde; yayın teyidi bekleyenler ayrışır.", points: [p("p1", "Kiralama, proje ve açık ev yönetimi"), p("p2", "Portal kontrolü ve anahtar takibi"), p("p3", "Sunumlar ve ofisler arası ağ")], hidden: false },
      { id: "anlasmalar", label: "Anlaşmalar", text: "Tekliften tamamlanmaya anlaşmalar aşamalarına göre sütunlarda ilerler.", points: [p("p1", "Teklif ve sözleşme aynı kayıtta"), p("p2", "SMS onaylı dijital imza", "/app/sozlesmeler"), p("p3", "Aşama bazlı takip")], hidden: false },
      { id: "komisyon", label: "Komisyon", text: "Komisyon kayıtları, bölüşüm ve hakediş durumu aylık dağılımla birlikte.", points: [p("p1", "Bölüşüm ve hakediş kayıt altında"), p("p2", "Onay akışı"), p("p3", "Cüzdan, gider ve aidat takibi")], hidden: false },
      { id: "raporlar", label: "Raporlar", text: "Satış hunisi, danışman karnesi ve kaçan komisyon özeti.", points: [p("p1", "Satış hunisi ve trendler"), p("p2", "Danışman KPI ve ekip ligi"), p("p3", "Kayıp-kaçak karnesi", "/app/kayip-kacak")], hidden: false },
      { id: "otomasyon", label: "Otomasyon", text: "Hatırlatma, teyit ve özet işleri arka planda zamanlanmış görevlerle çalışır.", points: [p("p1", "{gorev} otomatik görev"), p("p2", "İş akışı ve onay akışları", "/app/onaylar"), p("p3", "Çalışmalar kayıt altına alınır")], hidden: false },
    ],
    // Özellik ızgarası: kimlik = illüstrasyon + ızgara yerleşimi + paket rozeti yolu (bento-grid.tsx TILE_META).
    bento: {
      tiles: [
        { id: "kayip-kacak", eyebrow: "Kayıp-kaçak kalkanı", title: "Kaybettiğiniz komisyonu rakama dökün", text: "İlan yayından kalktığında sistem sebebini sorar: satıldı mı, rakip mi kapattı, yoksa ihmal mi edildi? Kaçan komisyon görünür olur.", points: [c("b1", "Zorunlu kapanış formu, boş geçilemez"), c("b2", "Rakip kapanışı ile kendi satışınız ayrı sayılır"), c("b3", "Danışman bazında kaçak karnesi")], hidden: false },
        { id: "emsal-degerleme", eyebrow: "Değerleme", title: "Emsal bazlı fiyat sinyali", text: "Emsal motoru benzer portföylerden bir fiyat aralığı çıkarır; pazarlığa veriyle girersiniz.", points: [], hidden: false },
        { id: "otomasyon", eyebrow: "Otomasyonlar", title: "{gorev} otomatik görev, arka planda", text: "Hatırlatma, teyit ve özet işleri siz uğraşmadan zamanında çalışır.", points: [], hidden: false },
        { id: "ai-asistan", eyebrow: "AI asistan", title: "Sorun, listelesin", text: "Doğal dille sorun; asistan ofis kayıtlarınız üzerinden yanıtlar.", points: [], hidden: false },
        { id: "portal-kontrol", eyebrow: "Portal kontrolü", title: "İlanlarınızı teyitle, kaçağı ölçün", text: "İlan numarası veya bağlantısını ekleyin; periyodik teyit ve kapanış formu. Otomatik yayınlama yoktur.", points: [], hidden: false },
        { id: "imza", eyebrow: "Sözleşme", title: "SMS onaylı dijital imza", text: "Teklif ve sözleşme aynı kayıtta; imza SMS doğrulamasıyla alınır.", points: [], hidden: false },
        { id: "vitrin", eyebrow: "Vitrin", title: "Kendi adresinizde ofis vitrini", text: "Portföyleriniz, favoriler ve değerleme formuyla herkese açık sayfa.", points: [], hidden: false },
        { id: "performans", eyebrow: "Ekip ve performans", title: "Karne, lig ve hedefler", text: "Danışman KPI, ekip ligi ve hedefler tek yerde; ekibi sayılarla yönetin.", points: [], hidden: false },
      ],
      note: "Özelliklerin kapsamı pakete göre değişir; deneme boyunca hepsi açıktır.",
    },
    why: {
      oldLabel: "Excel + WhatsApp + defter",
      newLabel: "EmlakSoft",
      rows: [
        { id: "musteri", topic: "Müşteri ve talep", old: "Dosyalara ve sohbetlere dağılmış kayıtlar; talep unutulabilir.", now: "Tek müşteri kartı; talep ve portföy eşleşmesi aynı akışta.", gate: "", hidden: false },
        { id: "takip", topic: "Takip ve hatırlatma", old: "Hatırlatma sizin hafızanızda ve not defterinizde.", now: "Görev ve randevu hatırlatmaları otomatik görevlerle gelir.", gate: "", hidden: false },
        { id: "kacak", topic: "Kaçan fırsat", old: "Bir ilanın neden kaybedildiği çoğu zaman bilinmez.", now: "Zorunlu kapanış formu ve kaçak karnesi.", gate: "/app/kayip-kacak", hidden: false },
        { id: "komisyon", topic: "Komisyon", old: "Elle hesap; bölüşümde ve hakedişte tartışma çıkar.", now: "Bölüşüm, hakediş ve onay durumu kayıt altında.", gate: "", hidden: false },
        { id: "erisim", topic: "Ekip erişimi", old: "Dosyaya ulaşan herkes her şeyi görür.", now: "Rol ve izin matrisi; ofis verisi ayrı tutulur.", gate: "", hidden: false },
        { id: "imza", topic: "Sözleşme ve imza", old: "Kâğıt, fotoğraf ve mesajlaşma ile onay.", now: "SMS onaylı dijital imza akışı.", gate: "/app/sozlesmeler", hidden: false },
      ],
      note: "Karşılaştırma genel çalışma alışkanlıklarını anlatır; belirli bir ürün veya firma ile kıyas değildir.",
    },
    efSection: {
      eyebrow: "EmlakFiyati",
      title: "Nasıl çalışır,",
      em: "kaç kontör",
      tail: "düşer?",
      liveText: "Kontör yalnız ada/parsel değerleme için harcanır; paketinizdeki aylık kontör her ay otomatik yüklenir (ay sonunda yanar).",
      soonText: "Değerleme henüz herkese açık değil. Aşağıdaki kontör hakları planlanan değerlerdir ve değerleme açılınca paketinizle yüklenecektir.",
      // "onay" adımına tarifedeki değerleme bedeli koddan eklenir (sayı burada yazılmaz).
      steps: [
        { id: "sec", title: "Mahalle ve ada/parsel seçin", text: "Müşteri kaydının yanından mahalleyi seçin, ada ve parseli girin.", hidden: false },
        { id: "onay", title: "Onaylayın, kontör görünsün", text: "Sorgu çalışmadan önce kaç kontör düşeceği ekranda görünür; onaylarsanız çalışır.", hidden: false },
        { id: "rapor", title: "Rapor ve PDF", text: "Değer aralığı, emsal sayısı ve güven düzeyiyle rapor gelir; PDF olarak indirirsiniz.", hidden: false },
      ],
      plansTitle: "Pakete dahil aylık kontör",
      plansNote: "Yaklaşık değerleme sayısı, aylık kontörün değerleme bedeline bölünmesiyle bulunur. Aylık kontör o ayın sonunda yanar, devretmez.",
      packsTitle: "Ek kontör paketleri",
      packsText: "Ek kontör paketleri 1, 3, 6 ve 12 aylık satılır; süre sonunda kullanılmayan kontör yanar. Uzun süreli pakette kontör başı fiyat düşer.",
      packsEmpty: "Ek paket fiyatları ofis panelinde, giriş yaptıktan sonra görünür.",
      detailLink: { label: "Kontör ayrıntıları ve fiyatlar", href: "/fiyatlar#kontor" },
      note: "Tutarlar KDV hariçtir. Sonuçlar ilan ve emsal verisine dayanır; kesin değer veya ekspertiz değildir.",
    },
    // Bölüm sırası = bugünkü ana sayfa sırası; hepsi görünür.
    layout: ["deger", "guven", "tur", "ozellikler", "degerleme", "emlakfiyati", "diger", "neden", "nasil", "guvenlik", "fiyat", "sss", "son"].map((id) => ({ id: id as SiteContent["layout"][number]["id"], hidden: false })),
    // Geriye dönük anahtar: /demo sayfası kaldırıldı (kalıcı /kayit yönlendirmesi); şema uyumu için korunur, hiçbir sayfa okumaz.
    demo: { title: "Ofisini ücretsiz kur", text: "Kredi kartı gerekmez — kurulum sihirbazı ofisini dakikalar içinde hazırlar." },
    register: {
      title: "Ücretsiz başlayın",
      text: "Birkaç kısa adımda ofisiniz demo verisiyle hazır.",
      panelText: "{deneme_uzun}, kredi kartsız ve taahhütsüz. Kurulum sihirbazı ofisinizi adım adım hazırlar; verileriniz rol, yetki ve denetim kontrolleriyle korunur.",
    },
  };
}
