import type { PricingPageContent } from "./schema-core";

/**
 * /fiyatlar BUGÜNKÜ metinleri (yayın yokken sayfa bunlarla çizilir; HTML değişmez). Değişkenli kısımlar
 * (deneme günü, indirim, paket adları) eskiden sayfada hesaplanan değerlerle birebir aynı sonucu verir:
 * pricing-page.test.ts hem sabit metinleri hem de SSS'nin `buildFaq` çıktısıyla eşitliğini doğrular.
 */
export function defaultPricingPage(): PricingPageContent {
  return {
    hero: {
      eyebrow: "Fiyatlar",
      title: "Açık fiyat, paket paket net kapsam",
      lead: "Deneme boyunca tüm özellikler açık, kredi kartı gerekmez. Tutarlar KDV hariçtir{indirim_cumle}",
    },
    ctaPrimaryLabel: "{baslat}",
    compareLabel: "Paketleri karşılaştır",
    notes: [
      { title: "Deneme boyunca her şey açık", text: "{deneme_ifade}; tüm paketlerin özellikleri açıktır ve kredi kartı gerekmez." },
      { title: "SMS onaylı dijital imza", text: "Sözleşmeler SMS onayıyla imzalanır. Bu, nitelikli elektronik imza (e-imza) değildir." },
      { title: "Kayıp-kaçak komisyon motoru", text: "Yalnızca {kayip_paket} ve üzeri paketlerde açıktır." },
    ],
    sections: {
      compare: { title: "Paketleri yan yana karşılaştırın", lead: "Tablo, uygulamadaki gerçek paket kuralları ve sayfa kilitlerinden üretilir." },
      analiz: { title: "EmlakFiyati analiz bakiyesi" },
      roi: {
        title: "Kaçan komisyonunuzu kendi sayılarınızla hesaplayın",
        lead: "Aşağıdaki sayı alanlarına kendi rakamlarınızı yazın; sonuç anında hesaplanır. Sektör ortalaması kullanılmaz, alanlar bilerek boş bırakıldı.",
      },
      faq: { title: "Fiyatlarla ilgili sık sorulanlar" },
      final: { title: "Ofisinizle denemeye başlayın", text: "{deneme_ifade}, kredi kartı gerekmez.", primaryLabel: "Ücretsiz başla" },
    },
    efText: {
      leadLive:
        "Analiz bakiyesi yalnız ada/parsel değerleme için harcanır (PDF, rapor detayı ve ilan analizi bakiye harcamaz). Paketinizdeki aylık analiz bakiyesi her ay yüklenir ve ay sonunda yanar; yetmezse süreli ek paket alırsınız.",
      leadPlanned: "Değerleme henüz herkese açık değil; aşağıdaki analiz bakiyesi hakları planlanan değerlerdir ve değerleme açılınca geçerli olur.",
      creditsNote: "Aylık analiz bakiyesi o ayın sonunda yanar, devretmez. Sonuçlar ilan ve emsal verisine dayanır; kesin değer veya ekspertiz değildir.",
      packsNote: "Ek paketler 1, 3, 6 ve 12 aylık satılır; süre sonunda kullanılmayan bakiye sona erer. Tutarlar KDV hariçtir.",
    },
    // buildFaq (src/lib/pricing-page-model.ts) çıktısının değişkenli hâli; sıra ve metin birebir.
    faq: [
      {
        q: "Deneme ücretsiz mi, kredi kartı gerekir mi?",
        a: "Kayıt olunca {deneme_gun}ücretsiz deneme başlar ve kredi kartı istenmez. Deneme boyunca tüm paketlerin özellikleri açıktır; seçtiğiniz paketin kapsamı denemeden sonra geçerli olur.",
      },
      { q: "Fiyatlara KDV dahil mi?", a: "Hayır. Bu sayfadaki tüm aylık ve yıllık tutarlar KDV hariçtir." },
      {
        q: "Yıllık ödemede indirim var mı?",
        a: "Evet. Yıllık ödemede {indirim} indirim uygulanır; sayfadaki aylık/yıllık anahtarı bu hesabı fiyatlara yansıtır.",
      },
      {
        q: "Dijital imza e-imza mı?",
        a: "Hayır. Sözleşmeler SMS onaylı dijital imza ile imzalanır; bu, nitelikli elektronik imza (e-imza) değildir. Sözleşme özelliği {sozlesme_paket} ve üzeri paketlerde açıktır.",
      },
      {
        q: "Kayıp-kaçak komisyon motoru hangi pakette?",
        a: "Yalnızca {kayip_paket} ve üzeri paketlerde açıktır. Deneme süresince tüm paketlerde denemek mümkündür.",
      },
      {
        q: "Paket limitlerini aşarsam ne olur?",
        a: "Her paketin kullanıcı, şube, müşteri ve portföy limitleri yukarıdaki karşılaştırma tablosunda yazar. Ofisinizin ihtiyacı bir paketin kapsamını aşıyorsa bir üst paket daha uygun olur.",
      },
    ],
  };
}
