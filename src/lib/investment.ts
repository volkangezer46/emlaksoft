/**
 * Yatırım getirisi — kira getirisi, nakit akışı ve 10 yıllık projeksiyon.
 * SAF fonksiyonlar: I/O yok, `Date.now()` yok, rastgelelik yok.
 *
 * NEDEN AYRI MODÜL: "Bu daireyi alsam kaç yılda kendini amorti eder, aylık
 * cebime ne kalır?" sorusu üç ekranda birden soruluyor — panel `/app/yatirim`,
 * vitrin ilan detayındaki müşteri kaydırıcıları ve birim testler. Oranların
 * kopyalanması, biri güncellenince diğerlerinin unutulması demekti.
 *
 * KREDİ HESABI BURADA YENİDEN YAZILMADI: taksit, kalan anapara ve faiz
 * kırılımı `purchase-costs.ts` içindeki `computeLoanPlan` (annüite) ile
 * hesaplanır; alım masrafları da `computePurchaseCosts` ile. Bu modül yalnız
 * KİRA tarafını ekler. Konut kredisinde KKDF/BSMV yoktur — bkz.
 * `TAX_FREE_HOUSING_LOAN_NOTE`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ UYARI — ÇIKTI YAKLAŞIKTIR, RESMİ TEKLİF DEĞİLDİR.                        │
 * │ Kira getirisi geleceğe dair VARSAYIMLARLA hesaplanır: kira artışı, değer │
 * │ artışı, boşluk süresi ve bakım gideri kişiden kişiye, yıldan yıla        │
 * │ değişir. Buradaki varsayılanlar piyasa ortalamasıdır; yatırım tavsiyesi, │
 * │ getiri taahhüdü ya da mali müşavirlik hizmeti DEĞİLDİR.                  │
 * │ Güncelleme yeri: yalnızca `INVESTMENT_DEFAULTS`.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import {
  computeLoanPlan,
  computePurchaseCosts,
  round2,
  type AmortizationRow,
} from "@/lib/purchase-costs";
import { getTufeRate, latestTufeMonth } from "@/lib/tufe";

// ---------------------------------------------------------------------------
// VARSAYILAN ORANLAR — hepsi tek blokta, gerekçeli
// ---------------------------------------------------------------------------

export type InvestmentDefaults = {
  /** Boşluk (vacancy) oranı %. Kiracı değişimi arasındaki boş süre + tahsil
   *  edilemeyen kira. Türkiye konut piyasasında ortalama kiracı 2-4 yıl
   *  oturur, arada 1-2 ay boşluk olur → yıllık ~%4-8. Ortası alındı. */
  vacancyPct: number;
  /** Bakım-onarım gideri, TAHSİL EDİLEN kiranın yüzdesi. Boya, tesisat,
   *  beyaz eşya, kiracı değişimi masrafı. Sektörde kabul gören aralık
   *  %5-15; yeni binada alt, eski binada üst uçtadır. Ortası alındı.
   *  NOT: aidat KAPSAM DIŞI — Türkiye'de aidatı çoğunlukla kiracı öder,
   *  malikin ödediği durumda kullanıcı bu oranı yükseltmeli. */
  maintenancePct: number;
  /** Mülk yönetimi komisyonu, tahsil edilen kiranın yüzdesi. Varsayılan %0:
   *  Türkiye'de konut malikleri genellikle kirayı kendileri tahsil eder.
   *  Emlak ofisine yönetim verildiyse yaygın aralık %5-10. */
  managementPct: number;
  /** Kira gelirinden kesilen vergi %. Varsayılan %0 — çünkü DOĞRU DEĞER
   *  KİŞİYE ÖZELDİR ve uydurmak yanıltıcı olur:
   *   • Konut kira gelirinde yıllık istisna tutarı vardır (GVK m.21) —
   *     istisnanın altındaki gelirden vergi çıkmaz.
   *   • Üstündeyse götürü (%15) veya gerçek gider yöntemi seçilir, kalan
   *     matrah %15-40 arası artan oranlı gelir vergisi dilimine girer.
   *   • İŞ YERİ kirasında ise kiracı %20 stopaj yapar (konutta stopaj yok).
   *  Bu yüzden oranı KULLANICI GİRER; UI'da bu not gösterilir. */
  taxPct: number;
  /** Emlak vergisi — binde. Emlak Vergisi Kanunu m.8: konutta binde 1,
   *  BÜYÜKŞEHİR belediye sınırları içinde bu oran %100 artırımlı → binde 2.
   *  Matrah rayiç (beyan) bedelidir, satış fiyatının altında kalır; burada
   *  temkinli davranılıp güncel değer üzerinden hesaplanır (üst sınır). */
  propertyTaxPerMille: number;
  /** Büyükşehirde uygulanacak binde oran. */
  propertyTaxPerMilleMetro: number;
  /** Yıllık kira artışı %. TBK m.344: konut kirasında yenileme artışı, bir
   *  önceki kira yılının TÜFE ON İKİ AYLIK ORTALAMASINI aşamaz — yani kira
   *  artışının tavanı fiilen enflasyondur. Bu yüzden varsayılan uydurulmaz,
   *  projede zaten bulunan `src/lib/tufe.ts` tablosunun EN GÜNCEL ayından
   *  okunur (kira yenileme radarı da aynı kaynağı kullanır). Kullanıcı
   *  kendi beklentisiyle değiştirebilir. */
  rentGrowthPct: number;
  /** Yıllık konut değer artışı %. Kira artışıyla AYNI kabul edildi (TÜFE):
   *  uzun dönemde konut fiyatlarının reel getirisi sıfıra yakın seyreder;
   *  enflasyonun üstünde bir değer artışı varsaymak toplam getiriyi
   *  şişirirdi. Temkinli taraf bilinçli olarak seçildi — piyasa beklentisi
   *  farklıysa kullanıcı girer. */
  priceGrowthPct: number;
  /** Kira verisi hiç yoksa aylık kira tahmini — fiyatın BİNDE kaçı.
   *  Binde 4 ≈ yıllık brüt %4,8 getiri ≈ 21 yıllık kira çarpanı; Türkiye
   *  konut piyasasında uzun dönem ortalamaya yakın bir başlangıçtır.
   *  UI'da mutlaka "tahmini" etiketiyle gösterilir. */
  rentEstimatePerMille: number;
  /** Projeksiyon ufku (yıl). */
  projectionYears: number;
};

/**
 * Kira/değer artışı varsayılanı — TÜFE 12 aylık ortalamasının en güncel ayı.
 * `tufe.ts` tablosu güncellendiğinde bu değer de kendiliğinden güncellenir;
 * ikinci bir yerde enflasyon oranı TUTMUYORUZ. Saf: tablo statik, saat okunmaz.
 */
export const DEFAULT_GROWTH_PCT = Math.round(getTufeRate(latestTufeMonth()) * 10) / 10;

/** Varsayılan artış oranının hangi TÜFE ayından geldiği — UI'da gösterilir. */
export const DEFAULT_GROWTH_SOURCE_MONTH = latestTufeMonth();

export const INVESTMENT_DEFAULTS: InvestmentDefaults = {
  vacancyPct: 5,
  maintenancePct: 10,
  managementPct: 0,
  taxPct: 0,
  propertyTaxPerMille: 1,
  propertyTaxPerMilleMetro: 2,
  rentGrowthPct: DEFAULT_GROWTH_PCT,
  priceGrowthPct: DEFAULT_GROWTH_PCT,
  rentEstimatePerMille: 4,
  projectionYears: 10,
};

/** Her yatırım çıktısının altında görünmesi gereken tek cümle. */
export const INVESTMENT_DISCLAIMER =
  "Bu hesap yaklaşıktır ve geleceğe dair varsayımlara dayanır; resmi teklif, getiri taahhüdü veya yatırım tavsiyesi değildir. Kira artışı, boşluk süresi, bakım gideri ve konut değeri gerçekte farklı gerçekleşebilir.";

/** Vergi alanının yanında gösterilecek açıklama — oranı neden kullanıcı girer. */
export const RENT_TAX_NOTE =
  "Konut kira gelirinde yıllık istisna tutarı vardır; istisnayı aşan kısım götürü ya da gerçek gider yönteminden sonra %15-40 arası artan oranlı gelir vergisine tabidir. İş yeri kirasında ayrıca %20 stopaj uygulanır. Oran kişiye özel olduğu için varsayılan %0'dır — kendi diliminizi girin.";

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/** Negatif / NaN / sonsuz girdiyi 0'a çeker — form alanları boş gelebilir. */
function pos(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Oran alanları: 0 geçerli, negatif ve NaN değil. */
function pct(n: number | null | undefined, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Yüzde alanlarını okunur biçime yuvarlar (iki basamak). */
function round2Pct(n: number): number {
  return Number.isFinite(n) ? round2(n) : 0;
}

/**
 * Kira verisi olmayan ilan için aylık kira TAHMİNİ.
 * Fiyat × binde N. Gerçek kira değil — UI'da "tahmini" etiketi zorunlu.
 */
export function estimateMonthlyRent(
  price: number,
  perMille: number = INVESTMENT_DEFAULTS.rentEstimatePerMille,
): number {
  const p = pos(price);
  if (p <= 0) return 0;
  return Math.round((p * pct(perMille, INVESTMENT_DEFAULTS.rentEstimatePerMille)) / 1000);
}

/** Aylık emlak vergisi karşılığı — yıllık tahakkuk 12'ye bölünür. */
export function monthlyPropertyTax(value: number, perMille: number): number {
  return round2((pos(value) * pct(perMille)) / 1000 / 12);
}

// ---------------------------------------------------------------------------
// 1) Kira getirisi (kredi HARİÇ — mülkün kendi verimliliği)
// ---------------------------------------------------------------------------

export type RentalYieldInput = {
  /** Alış/satış bedeli (₺). */
  price: number;
  /** Brüt aylık kira (₺). */
  monthlyRent: number;
  /** Yıllık işletme gideri toplamı (₺) — boşluk, bakım, yönetim, emlak
   *  vergisi, sigorta. Verilmezse net getiri = brüt getiri olur. */
  annualCostsTry?: number | null;
};

export type RentalYieldResult = {
  price: number;
  monthlyRent: number;
  /** 12 aylık brüt kira. */
  annualRent: number;
  annualCostsTry: number;
  /** Brüt kira getirisi % = yıllık kira / fiyat. */
  grossYieldPct: number;
  /** Net kira getirisi % = (yıllık kira − gider) / fiyat. */
  netYieldPct: number;
  /** KİRA ÇARPANI = fiyat / yıllık brüt kira. "Kaç yıllık kiraya alındı"
   *  sorusunun cevabı; brüt amorti süresidir. Düşük olması iyidir. */
  rentMultiplier: number;
  /** Giderler düşüldükten sonraki gerçek amorti süresi (yıl). Net kira
   *  sıfır ya da negatifse `null` — "hiç amorti etmez". */
  netPaybackYears: number | null;
  /** Giderler düşülmüş aylık net kira (kredi taksiti HARİÇ). */
  monthlyNet: number;
};

/**
 * Mülkün kendi kira verimliliği — kredi ve peşinat hesaba KATILMAZ.
 *
 *   brüt getiri  = (aylık kira × 12) / fiyat
 *   net getiri   = (aylık kira × 12 − yıllık gider) / fiyat
 *   kira çarpanı = fiyat / (aylık kira × 12)   →  brüt amorti yılı
 *
 * NEDEN KREDİSİZ: iki farklı daireyi karşılaştırırken finansman biçimi
 * gürültüdür; kaldıraçlı sonuç için `computeCashFlow` kullanılır.
 */
export function computeRentalYield(input: RentalYieldInput): RentalYieldResult {
  const price = pos(input.price);
  const monthlyRent = pos(input.monthlyRent);
  const annualCostsTry = pos(input.annualCostsTry);
  const annualRent = round2(monthlyRent * 12);
  const netAnnual = round2(annualRent - annualCostsTry);

  return {
    price,
    monthlyRent,
    annualRent,
    annualCostsTry,
    grossYieldPct: price > 0 ? round2Pct((annualRent / price) * 100) : 0,
    netYieldPct: price > 0 ? round2Pct((netAnnual / price) * 100) : 0,
    rentMultiplier: annualRent > 0 ? round2(price / annualRent) : 0,
    netPaybackYears: netAnnual > 0 && price > 0 ? round2(price / netAnnual) : null,
    monthlyNet: round2(netAnnual / 12),
  };
}

// ---------------------------------------------------------------------------
// 2) Aylık nakit akışı (kredi DÂHİL)
// ---------------------------------------------------------------------------

export type CashFlowInput = {
  price: number;
  /** Peşinat (₺). Kredi tutarı = fiyat − peşinat. */
  downPayment: number;
  /** Kredi vadesi (ay). 0 → peşin alım. */
  loanMonths: number;
  /** Yıllık nominal faiz (%). `monthlyRatePct` verilirse o öncelenir. */
  annualRatePct?: number | null;
  /** Aylık faiz (%) — bankaların ilan ettiği biçim. */
  monthlyRatePct?: number | null;
  /** Brüt aylık kira (₺). */
  monthlyRent: number;
  vacancyPct?: number | null;
  maintenancePct?: number | null;
  managementPct?: number | null;
  /** Kira geliri vergi oranı (%) — varsayılan 0, bkz. `RENT_TAX_NOTE`. */
  taxPct?: number | null;
  /** Emlak vergisi binde oranı. Verilmezse konut binde 1. */
  propertyTaxPerMille?: number | null;
};

export type CashFlowLine = {
  key: string;
  label: string;
  /** Aylık tutar (₺) — gider kalemleri POZİTİF yazılır, işaret UI'nın işi. */
  amount: number;
  note: string;
};

export type CashFlowResult = {
  price: number;
  downPayment: number;
  loanAmount: number;
  /** Annüite aylık taksit (kredi yoksa 0). */
  monthlyLoanPayment: number;
  loanMonths: number;
  /** Girilen brüt aylık kira. */
  monthlyRent: number;
  /** Boşluk düşülmüş, fiilen tahsil edilen aylık kira. */
  effectiveMonthlyRent: number;
  /** Aylık gider kalemleri (taksit HARİÇ). */
  expenseLines: CashFlowLine[];
  /** Gider kalemleri toplamı (taksit hariç, aylık). */
  monthlyExpenses: number;
  /** Tahsil edilen kira − giderler (taksit hariç) = NOI/ay. */
  monthlyNetOperating: number;
  /** NOI − taksit. Pozitifse cebe kalır, negatifse üstüne konur. */
  monthlyCashFlow: number;
  /** Nakit akışını sıfırlayan BRÜT aylık kira. Bunun altındaki kirada
   *  yatırımcı her ay cebinden para koyar. */
  breakEvenRent: number;
  /** Peşinata göre nakit getirisi % (cash-on-cash) = 12 × nakit akışı /
   *  başlangıç nakit. Kredi yoksa net kira getirisine yaklaşır. */
  cashOnCashPct: number;
  /** Yıllık işletme gideri toplamı — `computeRentalYield` girdisi olur. */
  annualOperatingCosts: number;
};

/**
 * Aylık nakit akışı: "kirayı aldım, taksidi ve giderleri ödedim, cebime ne kaldı?"
 *
 * GİDER TABANI: bakım / yönetim / vergi oranları TAHSİL EDİLEN (boşluk sonrası)
 * kira üzerinden uygulanır — daire boşken yönetim komisyonu da ödenmez, kira
 * geliri olmayınca vergisi de olmaz. Emlak vergisi ise kiradan bağımsızdır,
 * mülk değeri üzerinden sabit gider olarak eklenir.
 *
 *   tahsil = kira × (1 − boşluk)
 *   gider  = tahsil × (bakım + yönetim + vergi) + emlak vergisi
 *   akış   = tahsil − gider − taksit
 *
 * Başabaş kira, aynı denklemin kira için çözülmüş hâlidir:
 *   başabaş = (emlak vergisi + taksit) / [(1 − boşluk) × (1 − bakım − yönetim − vergi)]
 */
export function computeCashFlow(input: CashFlowInput): CashFlowResult {
  const price = pos(input.price);
  const downPayment = clamp(pos(input.downPayment), 0, price);
  const loanAmount = round2(price - downPayment);
  const loanMonths = Math.max(0, Math.round(Number(input.loanMonths) || 0));
  const monthlyRent = pos(input.monthlyRent);

  const vacancyPct = clamp(pct(input.vacancyPct, INVESTMENT_DEFAULTS.vacancyPct), 0, 100);
  const maintenancePct = pct(input.maintenancePct, INVESTMENT_DEFAULTS.maintenancePct);
  const managementPct = pct(input.managementPct, INVESTMENT_DEFAULTS.managementPct);
  const taxPct = pct(input.taxPct, INVESTMENT_DEFAULTS.taxPct);
  const propertyTaxPerMille = pct(
    input.propertyTaxPerMille,
    INVESTMENT_DEFAULTS.propertyTaxPerMille,
  );

  // Taksit — purchase-costs'taki annüite motoru (yeniden kullanım, kopya yok).
  const loan = computeLoanPlan({
    amount: loanAmount,
    months: loanMonths,
    annualRatePct: input.annualRatePct ?? null,
    monthlyRatePct: input.monthlyRatePct ?? null,
    scheduleRows: 0,
  });
  const monthlyLoanPayment = loan.monthlyPayment;

  const effectiveMonthlyRent = round2((monthlyRent * (100 - vacancyPct)) / 100);
  const vacancyLoss = round2(monthlyRent - effectiveMonthlyRent);
  const maintenance = round2((effectiveMonthlyRent * maintenancePct) / 100);
  const management = round2((effectiveMonthlyRent * managementPct) / 100);
  const rentTax = round2((effectiveMonthlyRent * taxPct) / 100);
  const propertyTax = monthlyPropertyTax(price, propertyTaxPerMille);

  const expenseLines: CashFlowLine[] = [];
  const add = (line: CashFlowLine) => {
    if (line.amount > 0) expenseLines.push(line);
  };

  add({
    key: "vacancy",
    label: `Boşluk kaybı (%${vacancyPct})`,
    amount: vacancyLoss,
    note: "Kiracı değişimi arasındaki boş süre ve tahsil edilemeyen kira karşılığı.",
  });
  add({
    key: "maintenance",
    label: `Bakım-onarım (%${maintenancePct})`,
    amount: maintenance,
    note: "Boya, tesisat, beyaz eşya ve kiracı değişimi masrafı — tahsil edilen kira üzerinden.",
  });
  add({
    key: "management",
    label: `Mülk yönetimi (%${managementPct})`,
    amount: management,
    note: "Kirayı emlak ofisi tahsil/takip ediyorsa alınan komisyon.",
  });
  add({
    key: "rent_tax",
    label: `Kira geliri vergisi (%${taxPct})`,
    amount: rentTax,
    note: RENT_TAX_NOTE,
  });
  add({
    key: "property_tax",
    label: `Emlak vergisi (binde ${propertyTaxPerMille})`,
    amount: propertyTax,
    note: "Yıllık tahakkukun aylık karşılığı; büyükşehirde oran binde 2'dir. Matrah rayiç bedeldir, burada temkinli olarak güncel değer kullanıldı.",
  });

  const monthlyExpenses = round2(expenseLines.reduce((s, l) => s + l.amount, 0));
  // NOI: boşluk zaten `effectiveMonthlyRent` içinde düşüldü, tekrar düşmeyiz.
  const monthlyNetOperating = round2(
    effectiveMonthlyRent - maintenance - management - rentTax - propertyTax,
  );
  const monthlyCashFlow = round2(monthlyNetOperating - monthlyLoanPayment);

  // Başabaş kira — payda sıfır/negatifse (gider oranları toplamı %100'ü aşmış)
  // hiçbir kira yetmez; 0 döneriz ve UI "hesaplanamaz" gösterir.
  const retention = ((100 - vacancyPct) / 100) * ((100 - maintenancePct - managementPct - taxPct) / 100);
  const breakEvenRent = retention > 0 ? round2((propertyTax + monthlyLoanPayment) / retention) : 0;

  // Cash-on-cash: peşinat + alım masrafları değil, SADECE peşinat üzerinden.
  // Alım masraflarını da içeren sürümü `projectYears` hesaplar (initialCash).
  const cashOnCashPct =
    downPayment > 0 ? round2Pct(((monthlyCashFlow * 12) / downPayment) * 100) : 0;

  return {
    price,
    downPayment,
    loanAmount,
    monthlyLoanPayment,
    loanMonths,
    monthlyRent,
    effectiveMonthlyRent,
    expenseLines,
    monthlyExpenses,
    monthlyNetOperating,
    monthlyCashFlow,
    breakEvenRent,
    cashOnCashPct,
    annualOperatingCosts: round2(monthlyExpenses * 12),
  };
}

// ---------------------------------------------------------------------------
// 3) 10 yıllık projeksiyon
// ---------------------------------------------------------------------------

export type ProjectionInput = CashFlowInput & {
  /** Yıllık kira artışı (%). Varsayılan `INVESTMENT_DEFAULTS.rentGrowthPct`. */
  rentGrowthPct?: number | null;
  /** Yıllık konut değer artışı (%). */
  priceGrowthPct?: number | null;
  /** Kaç yıl projekte edilsin (varsayılan 10). */
  years?: number | null;
  /** Başlangıç nakdine tapu harcı/komisyon/ekspertiz gibi ALIM MASRAFLARI
   *  eklensin mi? Varsayılan true — gerçek amorti süresi masrafları da
   *  içerir. Hesap `computePurchaseCosts` ile yapılır (kopya yok). */
  includePurchaseCosts?: boolean;
  /** Alım masrafı hesabı için brüt m² (DASK/sigorta tahmini). */
  sqm?: number | null;
};

export type ProjectionYear = {
  /** 1'den başlar. */
  year: number;
  /** O yılın brüt aylık kirası (artış uygulanmış). */
  monthlyRent: number;
  /** O yıl fiilen tahsil edilen kira (boşluk düşülmüş, 12 ay). */
  rentIncome: number;
  /** O yılın işletme gideri (bakım+yönetim+vergi+emlak vergisi). */
  expenses: number;
  /** O yıl ödenen kredi taksitleri toplamı (vade bittiyse 0). */
  debtService: number;
  /** rentIncome − expenses − debtService. */
  netCash: number;
  /** Yıl sonu kalan kredi anaparası. */
  remainingPrincipal: number;
  /** Yıl sonu tahmini konut değeri. */
  estimatedValue: number;
  /** 1. yıldan bu yıla kadar toplam net nakit. */
  cumulativeCash: number;
  /** Yıl sonu özsermaye = tahmini değer − kalan borç. */
  equity: number;
  /** (Özsermaye + kümülatif nakit) − başlangıç nakdi. */
  totalReturn: number;
};

export type ProjectionResult = {
  years: ProjectionYear[];
  /** Peşinat + (istenirse) alım masrafları = cepten çıkan başlangıç nakdi. */
  initialCash: number;
  /** Başlangıç nakdine dâhil edilen alım masrafı toplamı. */
  purchaseCosts: number;
  rentGrowthPct: number;
  priceGrowthPct: number;
  /** Kümülatif nakdin başlangıç nakdini ilk kez karşıladığı yıl — "kaç yılda
   *  kendini amorti eder". Ufuk içinde olmuyorsa null. */
  cashPaybackYear: number | null;
  /** Nakit akışının ilk kez artıya döndüğü yıl (kredi bitişi burada görünür). */
  firstPositiveCashYear: number | null;
  /** Son yıl sonundaki toplam getiri (₺) ve başlangıç nakdine oranı (%). */
  totalReturn: number;
  totalReturnPct: number;
  /** Yıllık bileşik getiri yaklaşımı (%) — `IRR_METHOD_NOTE`. Hesaplanamazsa null. */
  approxIrrPct: number | null;
};

/**
 * IRR YÖNTEMİ (yaklaşık) — nasıl hesaplandığı:
 *
 * Nakit akışı serisi kurulur:
 *   t=0  : −başlangıç nakdi (peşinat + alım masrafları)
 *   t=1..n: o yılın net nakdi (kira − gider − taksit)
 *   t=n  : ÜSTÜNE son yıl özsermayesi (tahmini değer − kalan borç) eklenir,
 *          yani n. yıl sonunda satıldığı VARSAYILIR.
 *
 * Sonra NPV(r)=0 denklemi İKİYE BÖLME (bisection) ile çözülür: NPV(r) faiz
 * oranında monoton azaldığı için, işaret değiştiren [-%99, +%1000] aralığında
 * 200 adımda kuruş altı hassasiyete iner. Newton yerine bisection seçildi:
 * türev gerektirmez, ıraksamaz, saf ve deterministiktir.
 *
 * YAKLAŞIKLIĞIN KAYNAĞI (matematik değil, varsayım):
 *  • Nakit akışları YIL SONUNDA tek seferde alınmış sayılır (gerçekte aylık) —
 *    bu, gerçek IRR'yi bir miktar OLDUĞUNDAN DÜŞÜK gösterir, yani temkinlidir.
 *  • n. yılda satış varsayılır ama SATIŞ MASRAFI (komisyon, harç, varsa değer
 *    artışı kazancı vergisi) düşülmez → bu yönde bir miktar İYİMSERDİR.
 *  • Serinin işareti birden fazla kez değişirse (uzun negatif nakit akışı)
 *    IRR matematiksel olarak tek olmayabilir; bisection ilk kökü bulur.
 * Bu yüzden çıktı "yaklaşık yıllık getiri" olarak sunulur, kesin IRR değil.
 */
export const IRR_METHOD_NOTE =
  "Yaklaşık yıllık bileşik getiri: yıl sonu nakit akışları ve son yıl sonunda satış varsayımıyla NPV=0 kökü (ikiye bölme yöntemi). Satış masrafı ve değer artışı kazancı vergisi düşülmemiştir.";

/** NPV — `rate` yıllık iskonto oranı (ondalık). flows[0] = t0. */
function npv(rate: number, flows: number[]): number {
  let sum = 0;
  for (let t = 0; t < flows.length; t++) sum += flows[t] / Math.pow(1 + rate, t);
  return sum;
}

/**
 * NPV=0 kökü — ikiye bölme. Aralıkta işaret değişimi yoksa null.
 * Alt sınır −%99 (tam kayıp), üst sınır +%1000 (uç senaryo).
 */
export function approximateIrr(flows: number[]): number | null {
  if (flows.length < 2) return null;
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if (fLo > 0 === fHi > 0) return null; // işaret değişmiyor → kök yok

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (fMid === 0) return mid;
    if (fLo > 0 === fMid > 0) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
      fHi = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Yıl yıl projeksiyon (varsayılan 10 yıl).
 *
 * KREDİ: `computeLoanPlan` tam ödeme planını üretir; her yılın taksit toplamı
 * ve yıl sonu kalan anaparası bu plandan OKUNUR (yeniden türetilmez). Vade
 * projeksiyon ufkundan kısaysa kredi bittiği yıl taksit düşer ve nakit akışı
 * sıçrar — tablo bunu doğrudan gösterir.
 *
 * KİRA: her yıl `(1+artış)` ile büyür. Boşluk/bakım/yönetim/vergi oranları
 * sabit kalır (oran oldukları için kirayla birlikte kendiliğinden büyürler).
 * Emlak vergisi ise O YILIN tahmini değeri üzerinden hesaplanır — matrah
 * değerle birlikte artar.
 */
export function projectYears(input: ProjectionInput): ProjectionResult {
  const base = computeCashFlow(input);
  const years = clamp(Math.round(Number(input.years) || INVESTMENT_DEFAULTS.projectionYears), 1, 30);
  const rentGrowthPct = pct(input.rentGrowthPct, INVESTMENT_DEFAULTS.rentGrowthPct);
  const priceGrowthPct = pct(input.priceGrowthPct, INVESTMENT_DEFAULTS.priceGrowthPct);

  const vacancyPct = clamp(pct(input.vacancyPct, INVESTMENT_DEFAULTS.vacancyPct), 0, 100);
  const maintenancePct = pct(input.maintenancePct, INVESTMENT_DEFAULTS.maintenancePct);
  const managementPct = pct(input.managementPct, INVESTMENT_DEFAULTS.managementPct);
  const taxPct = pct(input.taxPct, INVESTMENT_DEFAULTS.taxPct);
  const propertyTaxPerMille = pct(
    input.propertyTaxPerMille,
    INVESTMENT_DEFAULTS.propertyTaxPerMille,
  );

  // --- Alım masrafları: purchase-costs motoru (kopya yok) -------------------
  const includeCosts = input.includePurchaseCosts !== false;
  const purchaseCosts = includeCosts
    ? computePurchaseCosts({
        price: base.price,
        downPayment: base.downPayment,
        sqm: input.sqm ?? null,
      }).totalCosts
    : 0;
  const initialCash = round2(base.downPayment + purchaseCosts);

  // --- Kredi planı: yıl bazında taksit toplamı ve kalan anapara -------------
  const plan = computeLoanPlan({
    amount: base.loanAmount,
    months: base.loanMonths,
    annualRatePct: input.annualRatePct ?? null,
    monthlyRatePct: input.monthlyRatePct ?? null,
    scheduleRows: base.loanMonths,
  });
  const schedule: AmortizationRow[] = plan.amortizationSchedule;

  const rows: ProjectionYear[] = [];
  let cumulativeCash = 0;
  let cashPaybackYear: number | null = null;
  let firstPositiveCashYear: number | null = null;

  for (let y = 1; y <= years; y++) {
    const growth = Math.pow(1 + rentGrowthPct / 100, y - 1);
    const monthlyRent = round2(base.monthlyRent * growth);
    const collected = round2(((monthlyRent * (100 - vacancyPct)) / 100) * 12);

    const estimatedValue = round2(base.price * Math.pow(1 + priceGrowthPct / 100, y));
    // Emlak vergisi o yılın değeri üzerinden (matrah değerle birlikte artar).
    const propertyTaxYear = round2((estimatedValue * propertyTaxPerMille) / 1000);
    const expenses = round2(
      (collected * (maintenancePct + managementPct + taxPct)) / 100 + propertyTaxYear,
    );

    // Bu yıla düşen taksitler: plandaki (y−1)*12+1 … y*12 arası satırlar.
    const from = (y - 1) * 12;
    const to = y * 12;
    const slice = schedule.slice(from, to);
    const debtService = round2(slice.reduce((s, r) => s + r.payment, 0));
    const lastRow = schedule.length > 0 ? schedule[Math.min(to, schedule.length) - 1] : null;
    const remainingPrincipal = lastRow ? round2(lastRow.balance) : 0;

    const netCash = round2(collected - expenses - debtService);
    cumulativeCash = round2(cumulativeCash + netCash);
    const equity = round2(estimatedValue - remainingPrincipal);

    if (firstPositiveCashYear === null && netCash > 0) firstPositiveCashYear = y;
    if (cashPaybackYear === null && cumulativeCash >= initialCash) cashPaybackYear = y;

    rows.push({
      year: y,
      monthlyRent,
      rentIncome: collected,
      expenses,
      debtService,
      netCash,
      remainingPrincipal,
      estimatedValue,
      cumulativeCash,
      equity,
      totalReturn: round2(equity + cumulativeCash - initialCash),
    });
  }

  const last = rows[rows.length - 1];
  const flows = [-initialCash, ...rows.map((r) => r.netCash)];
  if (last) flows[flows.length - 1] = round2(flows[flows.length - 1] + last.equity);
  const irr = approximateIrr(flows);

  return {
    years: rows,
    initialCash,
    purchaseCosts,
    rentGrowthPct,
    priceGrowthPct,
    cashPaybackYear,
    firstPositiveCashYear,
    totalReturn: last ? last.totalReturn : 0,
    totalReturnPct: last && initialCash > 0 ? round2Pct((last.totalReturn / initialCash) * 100) : 0,
    approxIrrPct: irr === null ? null : round2Pct(irr * 100),
  };
}

// ---------------------------------------------------------------------------
// Biçimlendirme (UI ortak)
// ---------------------------------------------------------------------------

const nfPct = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** `%5,4` — yatırım ekranlarındaki ortak yüzde biçimi. */
export function formatPct(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `%${nfPct.format(v)}`;
}

/** `21,4 yıl` — amorti süresi. Hiç amorti etmiyorsa açık cümle. */
export function formatYears(n: number | null | undefined): string {
  const v = Number(n);
  if (n === null || n === undefined || !Number.isFinite(v) || v <= 0) return "Amorti etmiyor";
  return `${nfPct.format(v)} yıl`;
}
