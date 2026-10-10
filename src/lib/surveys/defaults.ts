import type { SurveyAudience, SurveyEventType, SurveyQuestionDef } from "@/lib/surveys/types";

/**
 * Olay türüne göre hazır gelen Türkçe şablonlar (saf veri).
 * Ofis ilk açışta bunlar veritabanına kopyalanır; sonra ofis sahibi düzenler.
 * TEK ÖLÇEK 0-10: `tag: "primary"` puan sorusu görevin ana puanıdır (NPS/CSAT bu puandan hesaplanır),
 * `tag: "advisor"` danışman puanıdır (danışman kartı), `tag: "reason"` neden/şikayet dağılımına girer.
 */
export type DefaultTemplate = {
  event: SurveyEventType;
  audience: SurveyAudience;
  name: string;
  questions: SurveyQuestionDef[];
};

const score = (label: string): SurveyQuestionDef => ({ kind: "score", label, options: [], required: true, tag: "primary" });
const advisorScore = (label = "Danışmanınızı 0-10 arası puanlar mısınız?"): SurveyQuestionDef => ({
  kind: "score",
  label,
  options: [],
  required: false,
  tag: "advisor",
});
const plainScore = (label: string): SurveyQuestionDef => ({ kind: "score", label, options: [], required: false, tag: null });
const yesno = (label: string): SurveyQuestionDef => ({ kind: "yesno", label, options: [], required: false, tag: null });
const text = (label = "Eklemek istedikleriniz var mı?"): SurveyQuestionDef => ({ kind: "text", label, options: [], required: false, tag: null });
const choice = (label: string, options: string[], tag: "reason" | null = null, required = false): SurveyQuestionDef => ({
  kind: "choice",
  label,
  options,
  required,
  tag,
});

/** NPS sorusu (tavsiye olasılığı) — müşteri ve malik kitlelerinde ana puan. */
const NPS_QUESTION = "Ofisimizi bir yakınınıza tavsiye etme olasılığınızı 0-10 arası puanlar mısınız?";

function dealWon(audience: SurveyAudience, name: string, who: string): DefaultTemplate {
  return {
    event: "deal_won",
    audience,
    name,
    questions: [
      score(NPS_QUESTION),
      advisorScore(),
      choice(
        `Memnun kalmadığınız bir nokta oldu mu?`,
        ["Hayır, memnunum", "İletişim ve ulaşılabilirlik", "Komisyon / ücret", "Süreç hızı", "Bilgilendirme eksikliği", "Diğer"],
        "reason",
      ),
      text(`${who} olarak eklemek istedikleriniz var mı?`),
    ],
  };
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    event: "property_unpublished",
    audience: "owner",
    name: "Yayından kalkan ilan / yetki bitimi: malik anketi",
    questions: [
      choice(
        "İlan neden yayından kalktı?",
        [
          "Ofisiniz aracılığıyla satıldı / kiralandı",
          "Başka bir emlak ofisi aracılığıyla satıldı / kiralandı",
          "Sahibinden / kendi imkanlarımızla satıldı veya kiralandı",
          "Satmaktan / kiralamaktan vazgeçtim",
          "Fiyat beklentisi karşılanmadı",
          "Yetki süresi doldu",
          "Diğer",
        ],
        "reason",
        true,
      ),
      score(NPS_QUESTION),
      advisorScore(),
      choice("Rakip bir ofisle veya sahibinden ile çalıştınız mı?", ["Hayır", "Başka bir emlak ofisi", "Sahibinden / kendi imkanlarım"]),
      text(),
    ],
  },
  {
    event: "authority_extended",
    audience: "owner",
    name: "Yetki uzatma: neden devam ediyorsunuz?",
    questions: [
      choice(
        "Yetkiyi neden uzatmaya karar verdiniz?",
        [
          "Hizmetten memnunum",
          "Satış / kiralama için daha fazla süre gerekiyor",
          "Başka bir seçenek bulamadım",
          "Fiyat konusunda yeni bir plan yaptık",
          "Diğer",
        ],
        "reason",
        true,
      ),
      choice("Bu dönemde en çok neyi bekliyorsunuz?", [
        "Daha fazla ziyaretçi / gösterim",
        "Fiyat danışmanlığı",
        "Daha sık bilgilendirme",
        "Daha iyi fotoğraf ve tanıtım",
        "Beklentim yok, süreç iyi gidiyor",
      ]),
      score("Şu ana kadarki hizmetimizi 0-10 arası puanlar mısınız?"),
      text(),
    ],
  },
  dealWon("buyer", "Anlaşma kapanışı: alıcı anketi", "Alıcı"),
  dealWon("seller", "Anlaşma kapanışı: satıcı anketi", "Satıcı"),
  dealWon("tenant", "Anlaşma kapanışı: kiracı anketi", "Kiracı"),
  dealWon("landlord", "Anlaşma kapanışı: ev sahibi anketi", "Ev sahibi"),
  {
    event: "deal_lost",
    audience: "customer",
    name: "Kaybedilen anlaşma: neden olmadı?",
    questions: [
      choice(
        "Anlaşma neden gerçekleşmedi?",
        [
          "Fiyat uyuşmadı",
          "Başka bir mülk veya ofis tercih edildi",
          "Finansman / kredi sağlanamadı",
          "Vazgeçti veya erteledi",
          "Mülk beklentiyi karşılamadı",
          "Hizmetten memnun kalınmadı",
          "Diğer",
        ],
        "reason",
        true,
      ),
      yesno("İleride tekrar bizimle çalışır mısınız?"),
      score("Hizmetimizi 0-10 arası puanlar mısınız?"),
      text(),
    ],
  },
  {
    event: "demand_lost",
    audience: "customer",
    name: "Kapanan talep: arayış neden sona erdi?",
    questions: [
      choice(
        "Arayışınız neden sona erdi?",
        [
          "Aradığımı başka yerden buldum",
          "Bütçe / finansman yetmedi",
          "Aramaktan vazgeçtim veya erteledim",
          "Önerilen portföyler uygun değildi",
          "Ofisle iletişim yetersizdi",
          "Diğer",
        ],
        "reason",
        true,
      ),
      yesno("Size uygun portföyler önerildi mi?"),
      score("Hizmetimizi 0-10 arası puanlar mısınız?"),
      text(),
    ],
  },
  {
    event: "appointment_done",
    audience: "visitor",
    name: "Gösterim sonrası kısa memnuniyet",
    questions: [
      score("Gösterim deneyiminizi 0-10 arası puanlar mısınız?"),
      yesno("Mülk beklentinize uygun muydu?"),
      choice("Beğenmediğiniz bir yön var mı?", ["Hayır", "Fiyat", "Konum", "Mülkün durumu", "Danışmanın ilgisi", "Diğer"], "reason"),
      text(),
    ],
  },
  {
    event: "rent_renewal",
    audience: "tenant",
    name: "Kira bitişine 60 gün: yenileme niyeti",
    questions: [
      choice(
        "Sözleşme bitiminde kiracılığa devam etmeyi düşünüyor musunuz?",
        ["Evet, yenilemek istiyorum", "Kararsızım", "Hayır, taşınmayı düşünüyorum"],
        "reason",
        true,
      ),
      score("Kiracılık süresince ofisimizden memnuniyetinizi 0-10 arası puanlar mısınız?"),
      choice("Taşınmayı düşünüyorsanız başlıca neden nedir?", ["Kira artışı", "Daha büyük / küçük ev ihtiyacı", "Konum / iş değişikliği", "Ev sahibiyle sorunlar", "Mülkün durumu", "Diğer"]),
      text(),
    ],
  },
  {
    event: "tenant_annual",
    audience: "tenant",
    name: "Kiracı yıllık memnuniyet anketi",
    questions: [
      score("Bu yıl ofisimizden memnuniyetinizi 0-10 arası puanlar mısınız?"),
      choice(
        "Bu yıl en çok neye ihtiyaç duydunuz?",
        ["Bakım / arıza desteği", "Ev sahibiyle iletişim", "Kira ödeme kolaylığı", "Sözleşme bilgilendirmesi", "İhtiyacım olmadı"],
        "reason",
      ),
      yesno("Sözleşme bitiminde devam etmeyi düşünüyor musunuz?"),
      text(),
    ],
  },
  {
    event: "advisor_pulse",
    audience: "advisor",
    name: "Ekip nabzı: aylık ofis içi anket (anonim)",
    questions: [
      score("Ofisimizi çalışılacak yer olarak bir arkadaşınıza tavsiye etme olasılığınızı 0-10 arası puanlar mısınız?"),
      plainScore("Yönetimden aldığınız desteği 0-10 arası puanlar mısınız?"),
      choice(
        "Şu an en çok neye ihtiyaç duyuyorsunuz?",
        ["Eğitim ve gelişim desteği", "Daha fazla portföy / talep", "Pazarlama ve ilan desteği", "Teknoloji ve araçlar", "Yönetimle iletişim", "Komisyon / prim yapısı", "Diğer"],
        "reason",
        true,
      ),
      text("Önerinizi yazabilirsiniz (anonim)."),
    ],
  },
];

export function defaultTemplateFor(event: SurveyEventType, audience: SurveyAudience): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.event === event && t.audience === audience);
}
