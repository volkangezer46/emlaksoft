import type { SurveyAudience, SurveyEventType, SurveyQuestionDef } from "@/lib/surveys/types";

/**
 * Olay türüne göre hazır gelen Türkçe şablonlar (saf veri).
 * Ofis ilk açışta bunlar veritabanına kopyalanır; sonra ofis sahibi düzenler.
 * `tag: "primary"` puan sorusu görevin ana puanıdır; `tag: "reason"` neden/şikayet dağılımına girer.
 */
export type DefaultTemplate = {
  event: SurveyEventType;
  audience: SurveyAudience;
  name: string;
  questions: SurveyQuestionDef[];
};

const score = (label: string): SurveyQuestionDef => ({ kind: "score", label, options: [], required: true, tag: "primary" });
const yesno = (label: string): SurveyQuestionDef => ({ kind: "yesno", label, options: [], required: false, tag: null });
const text = (label = "Eklemek istedikleriniz var mı?"): SurveyQuestionDef => ({ kind: "text", label, options: [], required: false, tag: null });
const choice = (label: string, options: string[], tag: "reason" | null = null, required = false): SurveyQuestionDef => ({
  kind: "choice",
  label,
  options,
  required,
  tag,
});

function dealWon(audience: SurveyAudience, name: string, who: string, verb: string): DefaultTemplate {
  return {
    event: "deal_won",
    audience,
    name,
    questions: [
      score(`${verb} sürecindeki genel memnuniyetinizi 1-10 arası puanlar mısınız?`),
      yesno(`Danışmanımız süreç boyunca ulaşılabilir ve bilgilendirici miydi?`),
      yesno(`Bizi yakınlarınıza tavsiye eder misiniz?`),
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
    name: "Yayından kalkan ilan: malik anketi",
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
      yesno("Danışmanımızın hizmetinden memnun kaldınız mı?"),
      score("Hizmetimizi 1-10 arası puanlar mısınız?"),
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
      score("Şu ana kadarki hizmetimizi 1-10 arası puanlar mısınız?"),
      text(),
    ],
  },
  dealWon("buyer", "İşlem gören anlaşma: alıcı anketi", "Alıcı", "Satın alma"),
  dealWon("seller", "İşlem gören anlaşma: satıcı anketi", "Satıcı", "Satış"),
  dealWon("tenant", "İşlem gören anlaşma: kiracı anketi", "Kiracı", "Kiralama"),
  dealWon("landlord", "İşlem gören anlaşma: ev sahibi anketi", "Ev sahibi", "Kiraya verme"),
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
      score("Hizmetimizi 1-10 arası puanlar mısınız?"),
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
      score("Hizmetimizi 1-10 arası puanlar mısınız?"),
      text(),
    ],
  },
  {
    event: "appointment_done",
    audience: "visitor",
    name: "Ziyaret sonrası kısa geri bildirim",
    questions: [
      score("Ziyaret / görüşme deneyiminizi 1-10 arası puanlar mısınız?"),
      yesno("Mülk beklentinize uygun muydu?"),
      choice("Beğenmediğiniz bir yön var mı?", ["Hayır", "Fiyat", "Konum", "Mülkün durumu", "Danışmanın ilgisi", "Diğer"], "reason"),
      text(),
    ],
  },
];

export function defaultTemplateFor(event: SurveyEventType, audience: SurveyAudience): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.event === event && t.audience === audience);
}
