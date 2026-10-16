/**
 * Terim sözlüğü (B193) — ürünün tek dili. Ekranda aynı kavram için tek kelime kullanılır:
 *  - Ofisin kendi kaydı = "Portföy" (kodu "portföy kodu"). Portaldaki karşılığı = "İlan" / "ilan no" (dış numara;
 *    yalnız portal bağlamında: ilan kontrolü, eşleşme). Kendi kaydı için "ilan" denmez.
 *  - Satış süreci kaydı = "Anlaşma". "Fırsat" kullanılmaz.
 *  - Kişi = "Müşteri"; aradığı ev = "Talep". "Lead" kullanılmaz.
 * Saf modül; yeni metin yazarken buradaki adlar kullanılır.
 */
export const TERMS = {
  property: "Portföy",
  properties: "Portföyler",
  propertyCode: "portföy kodu",
  listing: "İlan",
  listingNo: "ilan no",
  deal: "Anlaşma",
  deals: "Anlaşmalar",
  openDeals: "Açık anlaşma",
  customer: "Müşteri",
  customers: "Müşteriler",
  demand: "Talep",
  demands: "Talepler",
} as const;

/**
 * Sade Türkçe sözlük (basitlik planı §2.6, C30). En basit kullanıcı ve ofis sahibi teknik/muhasebe jargonu görmez;
 * özellik kaldırılmaz, yalnız adı sadeleşir. Yol adları ve kod tanımlayıcıları (`/app/finans/cari`, `hakedis`,
 * `danisman-kpi`, `gorunum=kanban`) DEĞİŞMEZ; yalnız kullanıcıya görünen metin.
 *
 * `old`: artık ekranda yazılmayan eski ad(lar). `use`: yerine yazılacak sade ad. `pattern`: sözleşme testinin
 * (`terminology-contract.test.ts`) `src/app/app/**`, `src/components/**`, `src/lib/nav-*.ts` ve pazarlama
 * metinlerinde aradığı desen. `pattern` yoksa terim yalnız rehberdir (bağlama göre birden çok karşılığı vardır).
 */
export type PlainLabel = { old: readonly string[]; use: string; pattern?: RegExp; note?: string };

export const PLAIN_LABELS = {
  kanban: { old: ["Kanban"], use: "Pano", pattern: /\bKanban\b/ },
  cari: {
    old: ["Cari", "cari hesap", "Cari ekstresi"],
    use: "Alacak ve borç",
    pattern: /\b[Cc]ari(?:ler|yi|ye|nin|den|lerde)?\b(?!-)/,
    note: "Bölüm adı 'Alacak ve borç'; karşı taraf 'kişi/firma'; ekstre 'hesap dökümü'.",
  },
  bizeBorclu: { old: ["Bize borçlu"], use: "Alacağımız", pattern: /\bBize borçlu\b/ },
  bizBorcluyuz: { old: ["Biz borçluyuz"], use: "Borcumuz", pattern: /\bBiz borçluyuz\b/ },
  hakedis: {
    old: ["Hakediş"],
    use: "Danışman ödemeleri",
    pattern: /\b[Hh]ak ?ediş/,
    note: "Danışmana ödenen pay 'danışman ödemesi'; kişisel sayfada 'kazanç'; mülk sahibi tarafı 'malik alacağı'.",
  },
  miniMuhasebe: { old: ["Mini muhasebe"], use: "Finans", pattern: /\bMini muhasebe\b/i, note: "Başlık olarak kaldırılır." },
  kpi: { old: ["KPI", "Danışman KPI Paneli", "Ekip karnesi"], use: "Karne", pattern: /\bKPI\b|\bEkip karnesi\b/, note: "Başlık: 'Danışman karnesi'." },
  izinMatrisi: { old: ["İzin matrisi"], use: "Yetkiler", pattern: /\bİzin matrisi\b/i, note: "Açıklama: 'Kim neyi görebilir'." },
  havuz: { old: ["Havuz ve atama"], use: "Portföy dağıtımı", pattern: /\bHavuz ve atama\b/i },
  bekleyenIlanlar: { old: ["Bekleyen ilanlar"], use: "Atanmamış portföyler", pattern: /\bBekleyen ilanlar\b/i },
  ilanAta: { old: ["ilan ata"], use: "Portföy dağıt", pattern: /\bilan ata\b/i },
  sunum: {
    old: ["Seçilenlerle sunum", "İlan paylaş", "WhatsApp taslağı"],
    use: "İlan gönder",
    pattern: /\bSeçilenlerle sunum\b|\bWhatsApp taslağı\b/i,
    note: "WhatsApp için 'WhatsApp'ta gönder'.",
  },
  randevular: { old: ["Randevular & yer gösterme"], use: "Randevular", pattern: /Randevular & yer gösterme/ },
  komisyonum: { old: ["Komisyonum"], use: "Kazancım", pattern: /\bKomisyonum\b/i },
  ciftKayit: { old: ["Çift kayıt kontrolü"], use: "Aynı kişiler", pattern: /\bÇift kayıt\b/i },
  adayPuani: {
    old: ["Aday puanı", "Aday skoru"],
    use: "Ciddiyet puanı",
    pattern: /\bAday (?:puanı|skoru)\b/i,
    note: "Sıcaklık kelimeleri `heatBadge` ile: Sıcak / İlgili / Soğuk / Uykuda.",
  },
  icgoru: { old: ["içgörü"], use: "öneri", pattern: /[İIi]çgörü/ },
  momentum: { old: ["momentumu kaybetme"], use: "ilgisi sıcakken", pattern: /\bmomentum/i },
  mukerrer: { old: ["Mükerrer"], use: "Aynı ödeme birden çok kez girilmiş olabilir", pattern: /\b[Mm]ükerrer\b/ },
  roi: { old: ["ROI"], use: "Getiri", pattern: /\bROI\b/ },
  nps: {
    old: ["NPS"],
    use: "Müşteri memnuniyeti",
    // Yalnız parantez içi açıklama "(NPS)" ve formül satırı "NPS = ..." kalabilir.
    pattern: /(?<!\()\bNPS\b(?!\s*=)/,
  },
  aiAsistan: { old: ["AI asistan"], use: "Yardımcı", pattern: /\bAI asistan/i },
  ofisKonsolu: { old: ["Ofis konsolu"], use: "(ofis adı)", pattern: /\bOfis konsolu\b/i },
  satisHunisi: { old: ["Satış hunisi"], use: "Müşteriden satışa", pattern: /\bSatış hunisi/i },
  takipDizileri: { old: ["Takip dizileri"], use: "Otomatik takip mesajları", pattern: /\bTakip dizi/i },
  acikHat: { old: ["Açık hat"], use: "Süren anlaşmalar", pattern: /\bAçık hat\b/i },
  lead: { old: ["Lead"], use: "Müşteri / gelen talep", pattern: /\bLead\b/ },
  aday: {
    old: ["Aday (gelen kişi, eşleşme adayı)"],
    use: "Müşteri / olası portföy",
    // "Danışman adayı" (işe alım) ve "Kiracı adayı" (kiracı başvurusu) gerçek kavramdır; ayarlar ve işe alım
    // ekranları sözleşme testinde ayrıca istisnadır.
    pattern: /(?<!(?:[Dd]anışman|[Kk]iracı) )\b[Aa]day/,
  },
} as const satisfies Record<string, PlainLabel>;

/** Sade sözlükte deseni olan (sözleşmeyle denetlenen) terimler. */
export const PLAIN_FORBIDDEN: readonly { term: string; pattern: RegExp; use: string }[] = Object.entries(PLAIN_LABELS as Record<string, PlainLabel>).flatMap(
  ([term, l]) => (l.pattern ? [{ term, pattern: l.pattern, use: l.use }] : []),
);

/**
 * Kendi kayıt bağlamında yasak kalıplar + sade sözlüğün kesin yasakları (sözleşme testi kendi dosyalarında tarar).
 * Kesin yasaklar (plan §2.6): Kanban, KPI, Lead, ilan ata, Mini muhasebe, momentum. "Aday" yasağı bağlama göredir
 * (ayarlar/işe alım dışı) ve `PLAIN_FORBIDDEN` ile görünür metinde denetlenir.
 */
export const FORBIDDEN_TERMS: readonly RegExp[] = [
  /\bfırsat/i,
  /\bYeni ilan\b/,
  /\bİlanın\b/,
  PLAIN_LABELS.kanban.pattern,
  PLAIN_LABELS.kpi.pattern,
  PLAIN_LABELS.lead.pattern,
  PLAIN_LABELS.ilanAta.pattern,
  PLAIN_LABELS.miniMuhasebe.pattern,
  PLAIN_LABELS.momentum.pattern,
];
