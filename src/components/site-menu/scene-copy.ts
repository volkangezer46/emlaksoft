import type { SceneKind } from "@/lib/site-menu/previews";

/**
 * Mega menü: bir alt menü öğesinin üzerine gelince öne çıkan kartın başlık / açıklama / bağlantı yazısı o öğeye göre
 * değişir. Metinler yalnız tembel sahne parçasında yaşar (ilk HTML/JS'e girmez); bağlantı hedefi öğenin kendisidir.
 */
export type SceneCopy = { eyebrow: string; title: string; text: string; cta: string };

export const SCENE_COPY: Record<SceneKind, SceneCopy> = {
  dashboard: { eyebrow: "Ürün turu", title: "Bugün ne yapacağınızı panel söyler", text: "Randevular, geciken takipler, yeni talepler ve portföy tek ekranda; önce en önemlisi.", cta: "Turu başlatın" },
  commission: { eyebrow: "Komisyon ve anlaşma", title: "Tekliften hakedişe tek omurga", text: "Teklif, anlaşma, komisyon paylaşımı ve danışman hakedişi aynı kayıtta ilerler.", cta: "Akışı inceleyin" },
  leak: { eyebrow: "Kayıp-kaçak kalkanı", title: "Kaybettiğiniz komisyonu görün", text: "İlan yayından kalkınca sistem sebebini sorar; kaçan komisyon danışman bazında görünür olur.", cta: "Kalkanı inceleyin" },
  valuation: { eyebrow: "Emsal bazlı değerleme", title: "Fiyat aralığını emsallerle görün", text: "Kadıköy’den Ataşehir’e benzer ilanlar eğri üzerinde; değer aralığı eğriyle birlikte gelir.", cta: "Değerlemeyi inceleyin" },
  parcel: { eyebrow: "EmlakFiyati ile değerleme", title: "Ada ve parselden PDF rapora", text: "Ada/parsel bazlı değerleme yapın, müşterinize paylaşılabilir PDF rapor sunun.", cta: "Raporu inceleyin" },
  signature: { eyebrow: "Dijital imza", title: "Sözleşme SMS onayıyla imzalansın", text: "Belge gönderilir, müşteri telefonundan onaylar; imza kaydı sözleşmeyle birlikte saklanır.", cta: "İmza akışını görün" },
  automation: { eyebrow: "Otomasyonlar", title: "Takipler arka planda kendiliğinden", text: "Tetikleyici, koşul ve eylemi seçin; hatırlatma ve görevler siz uğraşmadan oluşsun.", cta: "Otomasyonları görün" },
  assistant: { eyebrow: "AI asistan", title: "Soru sorun, maskeli yanıt alın", text: "Telefon ve kimlik gibi kişisel veriler yapay zekâya gitmeden maskelenir.", cta: "Asistanı tanıyın" },
  showcase: { eyebrow: "Vitrin ve portallar", title: "Ofisinizin vitrini hazır", text: "İlanlarınız ofis vitrininde; müşteri ve ev sahibi için bağlantılı portallar açılır.", cta: "Vitrini inceleyin" },
  listing: { eyebrow: "Portal kontrolü", title: "İlanlarınız yayında mı, bilin", text: "İlan takibi ve teyit: kalkan, değişen ya da hatalı ilan satır satır işaretlenir.", cta: "Kontrolü inceleyin" },
  tv: { eyebrow: "Ofis panosu (TV)", title: "Ofis ekranında canlı pano", text: "Günün randevuları ve ofis hedefleri duvardaki ekranda; herkes aynı tabloya bakar.", cta: "Panoyu görün" },
  modules: { eyebrow: "Modüller", title: "İhtiyacınız olmayanı kapatın", text: "Modülleri tek dokunuşla açıp kapatın; menü yalnız kullandığınız işi gösterir.", cta: "Modülleri görün" },
  setup: { eyebrow: "Başlamak kolay", title: "Ofisinizi dakikalar içinde kurun", text: "Kullanıcı sayınızı seçin, fiyatı anında görün, ücretsiz denemeyi kendiniz başlatın.", cta: "Ücretsiz dene" },
  "plan-advisor": { eyebrow: "Bağımsız danışman", title: "Tek başınıza çalışırken de düzenli", text: "Portföy, müşteri ve randevularınız tek kişilik pakette; kurulum birkaç dakika.", cta: "Danışman paketiyle başlayın" },
  "plan-office": { eyebrow: "Emlak ofisi", title: "Küçük ve orta ekip için ortak düzen", text: "Danışmanlar, ortak portföy ve ofis raporları aynı çatı altında toplanır.", cta: "Ofis paketiyle başlayın" },
  "plan-team": { eyebrow: "Büyüyen ekip", title: "Çok danışmanlı, çok şubeli yapı", text: "Kadıköy, Ataşehir, Beşiktaş gibi şubeleri tek yerden yönetin; yetkiler role göre ayrılır.", cta: "Ekip paketiyle başlayın" },
  "plan-enterprise": { eyebrow: "Kurumsal yapı", title: "Franchise ve proje satış ekipleri", text: "Merkez ve şubeler tek ağda; gelişmiş yetki, denetim ve raporlama.", cta: "Kurumsal paketi görün" },
  compare: { eyebrow: "Paket karşılaştırma", title: "Fiyat, limit ve kapsam yan yana", text: "Hangi pakette neyin olduğunu tek tabloda görün; seçiminizi bilerek yapın.", cta: "Tabloyu açın" },
  why: { eyebrow: "Neden EmlakSoft", title: "Excel ve defterden net bir geçiş", text: "Dağınık dosyalar yerine tek kayıt: kimin, neyi, ne zaman yaptığı hep görünür.", cta: "Farkı görün" },
  plans: { eyebrow: "Paketler ve fiyatlar", title: "Size uygun paketi seçin", text: "Fiyatlar KDV hariç, taahhütsüz. Deneme boyunca tüm özellikler açık.", cta: "Fiyatlara git" },
  calc: { eyebrow: "Kaçan komisyon hesaplayıcı", title: "Kendi sayılarınızla hesaplayın", text: "İlan ve kapanış sayılarınızı girin, yılda kaç komisyonun kaçabileceğini görün.", cta: "Hesaplayın" },
  billing: { eyebrow: "Fiyat SSS", title: "Fatura, KDV ve limitler net", text: "Faturanın nasıl kesildiğini, KDV’nin nasıl yansıdığını ve limitleri öğrenin.", cta: "Cevapları okuyun" },
  steps: { eyebrow: "Nasıl çalışır", title: "Üç adımda başlangıç", text: "Hesabı açın, ofisinizi tanımlayın, ekibinizi davet edin.", cta: "Adımları görün" },
  faq: { eyebrow: "Sık sorulan sorular", title: "Net sorular, net cevaplar", text: "Kurulum, veri taşıma, yetkiler ve fiyatlandırma hakkında en çok sorulanlar.", cta: "Soruları açın" },
  security: { eyebrow: "Güvenlik ve KVKK", title: "Verinizi süreçle koruyun", text: "Satır düzeyinde güvenlik, rol ve izin matrisi, denetim kaydı ve dışa aktarma.", cta: "Güvenlik bölümüne git" },
  consent: { eyebrow: "Telefon ve KVKK uyumu", title: "Doğru numara, izinli iletişim", text: "Ülkeye göre biçimlenen telefon girişi ve iletişim izni takibi tek yerde.", cta: "Uyumu inceleyin" },
  legal: { eyebrow: "KVKK aydınlatma", title: "Yasal metin açık ve erişilebilir", text: "Verilerin nasıl işlendiğini anlatan aydınlatma metnine buradan ulaşın.", cta: "Metni okuyun" },
  support: { eyebrow: "Destek", title: "Sorunuz mu var, yazın", text: "Destek ekibimiz sorularınıza e-postayla dönüş yapar; bize yazmanız yeterli.", cta: "E-posta gönderin" },
};
