/**
 * Alım maliyeti & konut kredisi hesapları — SAF fonksiyonlar (I/O yok, tarih yok).
 *
 * NEDEN AYRI MODÜL: Aynı hesap üç yerde görünüyor — panel hesaplayıcısı
 * (/app/hesaplayici), vitrin ilan detayındaki müşteri kaydırıcıları ve birim
 * testler. Oranların üç ayrı dosyada kopyalanması, mevzuat değişince birinin
 * unutulması demekti. TÜM ORANLAR AŞAĞIDAKİ TEK SABİT BLOĞUNDA.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ UYARI — MEVZUAT DEĞİŞİR.                                                 │
 * │ Aşağıdaki oran ve tutarlar 2026 başı itibarıyla yürürlükteki mevzuata ve │
 * │ piyasa ortalamalarına göre girilmiştir. Harç oranları Cumhurbaşkanı      │
 * │ kararıyla, döner sermaye/ekspertiz tutarları her yıl, sigorta primleri   │
 * │ tarife değişikliğiyle güncellenir. Çıktı YAKLAŞIK bilgilendirmedir;      │
 * │ resmi teklif, taahhüt ya da mali müşavirlik hizmeti DEĞİLDİR.            │
 * │ Güncelleme yeri: yalnızca `DEFAULT_RATES`.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * KAPSAM DIŞI (bilinçli): taşınma, tadilat/boya, aidat ve demirbaş, abonelik
 * (elektrik/su/doğalgaz) açılış bedelleri, emlak vergisi, mobilya. Bunlar
 * alıcıya göre uçtan uca değiştiği için "yaklaşık" bile üretmek yanıltıcı olur.
 */

// ---------------------------------------------------------------------------
// ORANLAR VE SABİTLER — kaynak + tarih notlarıyla
// ---------------------------------------------------------------------------

export type PurchaseCostRates = {
  /** Tapu (satış) harcı TOPLAM oranı. Kaynak: 492 s. Harçlar Kanunu, (4) sayılı
   *  tarife I/20-a — devir eden ve devir alandan AYRI AYRI binde 20, toplam %4.
   *  Kanunen alıcı payı %2'dir; piyasada tamamının alıcıya yüklendiği de olur
   *  (bkz. `deedFeeShare`). Matrah beyan edilen satış bedeli, ancak emlak vergisi
   *  değerinden düşük olamaz. Durum: 2026 başı. */
  deedFeeTotalPct: number;
  /** Tapu döner sermaye (TKGM hizmet bedeli) — işlem başına sabit. Her yıl
   *  yeniden belirlenir; 2026 başı yaklaşık değeri. Bölgeye göre birkaç yüz TL
   *  oynayabilir. */
  landRegistryServiceFeeTry: number;
  /** Emlak komisyonu oranı (tek taraf). Taşınmaz Ticareti Yönetmeliği m.20:
   *  satışta hizmet bedeli, satış bedelinin %4'ünü AŞAMAZ ve aksi
   *  kararlaştırılmadıkça taraflardan yarı yarıya alınır → alıcı tarafı için
   *  yaygın uygulama %2. Kullanıcı değiştirebilir. */
  commissionPct: number;
  /** KDV genel oranı — 2023/7346 s. karardan bu yana %20. Emlak komisyonu
   *  hizmet bedeli olduğu için KDV'ye tabidir. */
  vatPct: number;
  /** Kiralamada komisyon: kira bedelinin kaç aylık tutarı. Yönetmelik m.20:
   *  kiralamada hizmet bedeli bir aylık kira bedelini aşamaz. */
  rentCommissionMonths: number;

  /** DASK (Zorunlu Deprem Sigortası) yıllık primi — m² BAŞINA yaklaşık.
   *  NEDEN m² BAZLI: DASK primi resmi olarak "sigorta bedeli × tarife oranı"
   *  formülüyle hesaplanır; sigorta bedeli de m² × yapı tarzı birim maliyeti
   *  olduğundan prim m² ile DOĞRUSAL artar. Yani m² bazlı yaklaşım formülün
   *  şekliyle birebir uyumlu; belirsizlik sadece katsayıda (risk bölgesi 1-7 ve
   *  yapı tarzı). Buradaki katsayı betonarme yapı + orta risk bölgesi
   *  ortalamasıdır; 1. bölgede daha yüksek, 6-7. bölgede daha düşük çıkar.
   *  m² bilinmiyorsa `daskFallbackTry` kullanılır. */
  daskPerSqmTry: number;
  daskMinTry: number;
  /** DASK azami teminat limiti nedeniyle prim üstten sınırlıdır — büyük
   *  metrekarelerde doğrusal artış tavanda durur. */
  daskMaxTry: number;
  daskFallbackTry: number;

  /** İsteğe bağlı konut (yangın/hırsızlık/su baskını) sigortası yıllık primi,
   *  m² başına yaklaşık. Kredi kullanılıyorsa bankalar fiilen talep eder.
   *  DASK'tan farklı olarak serbest tarifelidir → daha kaba bir tahmindir. */
  homeInsurancePerSqmTry: number;
  homeInsuranceMinTry: number;
  homeInsuranceFallbackTry: number;

  /** Ekspertiz (gayrimenkul değerleme raporu) ücreti — yalnız kredi kullanılırsa.
   *  SPK lisanslı değerleme şirketi tarifesine göre değişir; 2026 başı yaklaşık
   *  konut ortalaması. */
  appraisalFeeTry: number;
  /** Kredi tahsis ücreti — yasal TAVAN, kredi tutarının binde 5'i.
   *  Kaynak: Finansal Tüketicilerden Alınacak Ücretlere İlişkin Usul ve Esaslar
   *  Hakkında Yönetmelik (BDDK). Banka daha azını da alabilir/almayabilir. */
  loanAllocationFeePct: number;
  /** İpotek tesis (tapu) işlemi için döner sermaye — kredi kullanılırsa.
   *  NOT: Konut finansmanı kapsamındaki ipotek işlemi HARÇTAN İSTİSNADIR
   *  (Harçlar Kanunu m.123/son), yani ayrıca %o oranlı ipotek harcı çıkmaz;
   *  yalnızca hizmet bedeli kalır. */
  mortgageRegistrationFeeTry: number;

  /** YENİ BİNA (müteahhitten ilk el) alımında satış bedeli üzerinden KDV.
   *  İkinci el konutta KDV YOKTUR (bu kalem yalnız `newBuild` işaretliyken çıkar).
   *  Net alanı 150 m²'ye kadar konut → %1; üzeri konut ve işyeri → %20
   *  (2023 sonrası tarife). Durum: 2026 başı. */
  newBuildVatResidentialSmallPct: number; // ≤150 m² konut
  newBuildVatLargePct: number; // >150 m² konut / işyeri
  /** İŞYERİ kiralamasında kiracının kestiği gelir vergisi STOPAJI (GVK m.94).
   *  Konut kirasında stopaj yoktur. Kiracı brütten keser, malike net öder. */
  rentWithholdingPct: number;
};

export const DEFAULT_RATES: PurchaseCostRates = {
  deedFeeTotalPct: 4,
  landRegistryServiceFeeTry: 6_000,
  commissionPct: 2,
  vatPct: 20,
  rentCommissionMonths: 1,

  daskPerSqmTry: 25,
  daskMinTry: 900,
  daskMaxTry: 6_000,
  daskFallbackTry: 2_500,

  homeInsurancePerSqmTry: 20,
  homeInsuranceMinTry: 800,
  homeInsuranceFallbackTry: 2_000,

  appraisalFeeTry: 9_000,
  loanAllocationFeePct: 0.5,
  mortgageRegistrationFeeTry: 3_500,

  newBuildVatResidentialSmallPct: 1,
  newBuildVatLargePct: 20,
  rentWithholdingPct: 20,
};

/** Konut kredisinde yasal azami vade (BDDK) — 120 ay. */
export const MAX_LOAN_MONTHS = 120;
export const MIN_LOAN_MONTHS = 12;

/** Kredi/değer (LTV) üst sınırı — konut kredisinde kredi tutarı, teminat
 *  gösterilen konutun değerinin bu yüzdesini aşamaz (BDDK sınırı; konut
 *  değerine göre kademelendiği için burada en geniş kademe kullanılmıştır). */
export const MAX_LOAN_TO_VALUE_PCT = 90;

/** Hesaplayıcı formlarının başlangıç değeri — piyasa değiştikçe kullanıcı
 *  kendisi günceller, bu yalnızca makul bir başlangıçtır (aylık %). */
export const DEFAULT_MONTHLY_RATE_PCT = 2.79;
export const DEFAULT_LOAN_MONTHS = 120;
export const DEFAULT_DOWN_PAYMENT_PCT = 25;

/**
 * KKDF / BSMV NOTU (kasıtlı olarak hesaba KATILMAZ):
 * Konut finansmanı kapsamındaki kredilerde KKDF kesintisi oranı %0'dır ve bu
 * krediler BSMV'den istisnadır (6802 s. Gider Vergileri Kanunu m.29/y). Yani
 * ihtiyaç kredisinden farklı olarak taksite eklenen vergi yükü yoktur —
 * taksit, saf annüite formülünden çıkar. Bu modül KONUT kredisi içindir;
 * ihtiyaç/taşıt kredisi için kullanılmamalıdır.
 */
export const TAX_FREE_HOUSING_LOAN_NOTE =
  "Konut kredilerinde KKDF %0 ve BSMV istisnası uygulanır — taksite ayrıca vergi eklenmez.";

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/** Kuruş hassasiyetine yuvarlar. Para hesabında float artıklarını temizler. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Negatif / NaN / sonsuz girdileri 0'a çeker — form alanları boş gelebilir. */
function pos(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Bankaların ilan ettiği aylık faizi nominal yıllığa çevirir (aylık × 12).
 *  Türkiye'de konut kredisi faizi aylık ilan edilir; yıllık maliyet oranı
 *  (YMO) ücretleri de içerdiği için farklıdır, burada hesaplanmaz. */
export function monthlyToAnnualPct(monthlyPct: number): number {
  return round2(monthlyPct * 12);
}

export function annualToMonthlyPct(annualPct: number): number {
  return annualPct / 12;
}

// ---------------------------------------------------------------------------
// Alım maliyeti
// ---------------------------------------------------------------------------

/** Tapu harcının taraflar arasında paylaşımı. */
export type DeedFeeShare =
  /** Kanuni durum: toplam %4'ün yarısı alıcıda (%2). */
  | "half"
  /** Piyasada sık: harcın tamamını alıcı öder (%4). */
  | "buyer";

export type PurchaseTransactionType = "sale" | "rent";

export type PurchaseCostInput = {
  /** Satılıkta satış bedeli, kiralıkta aylık kira bedeli. */
  price: number;
  transactionType?: PurchaseTransactionType;
  /** Peşinat tutarı (₺). `loanAmount` verilmezse buradan türetilir. */
  downPayment?: number | null;
  /** Kredi tutarı (₺). Verilirse peşinat = fiyat − kredi. */
  loanAmount?: number | null;
  /** Brüt m² — DASK ve konut sigortası tahmini için. Yoksa sabit tahmine düşer. */
  sqm?: number | null;
  deedFeeShare?: DeedFeeShare;
  /** Komisyon oranı (%). Verilmezse `DEFAULT_RATES.commissionPct`. */
  commissionPct?: number | null;
  vatPct?: number | null;
  includeDask?: boolean;
  includeHomeInsurance?: boolean;
  /** Yeni bina (müteahhitten ilk el) — satış bedeline KDV eklenir. İkinci elde false. */
  newBuild?: boolean;
  /** Taşınmaz cinsi — yeni bina KDV oranı ve işyeri kira stopajı için. */
  propertyKind?: "residential" | "commercial";
  /** Tek tek oran ezmek için (test / tenant özelleştirmesi). */
  rates?: Partial<PurchaseCostRates>;
};

export type PurchaseCostLine = {
  key: string;
  label: string;
  amount: number;
  /** Kalemin nereden geldiğini kullanıcıya açıklayan kısa metin. */
  note: string;
  /** Kredi kullanıldığı için eklenmiş kalem mi (UI'da gruplamak için). */
  loanRelated?: boolean;
};

export type PurchaseCostResult = {
  price: number;
  transactionType: PurchaseTransactionType;
  downPayment: number;
  loanAmount: number;
  /** Kredi / satış bedeli oranı (%) — LTV. */
  loanToValuePct: number;
  /** LTV yasal üst sınırı aşıyor mu (uyarı bandı için). */
  exceedsLoanToValue: boolean;
  lines: PurchaseCostLine[];
  /** Tüm kalemlerin toplamı (peşinat HARİÇ). */
  totalCosts: number;
  /** Peşinat + masraflar = cepten çıkan toplam. */
  cashOutOfPocket: number;
  /** Masrafların satış bedeline oranı (%) — "fiyatın üstüne ~%X" cümlesi için. */
  costsPctOfPrice: number;
  /** Hesaba katılmayan / istisna kalemlerin açıklamaları. */
  notes: string[];
};

/**
 * Alım (ya da kiralama) sırasında cepten çıkan kalemleri tek tek hesaplar.
 * Sıfır çıkan kalem listeye girmez — boş satır göstermek yerine kalem yok sayılır.
 */
export function computePurchaseCosts(input: PurchaseCostInput): PurchaseCostResult {
  const r: PurchaseCostRates = { ...DEFAULT_RATES, ...(input.rates ?? {}) };
  const tx: PurchaseTransactionType = input.transactionType ?? "sale";
  const price = pos(input.price);
  const sqm = pos(input.sqm);
  const vatPct = input.vatPct == null ? r.vatPct : Math.max(0, Number(input.vatPct) || 0);
  const commissionPct =
    input.commissionPct == null ? r.commissionPct : Math.max(0, Number(input.commissionPct) || 0);
  const vatMultiplier = 1 + vatPct / 100;

  // --- Peşinat / kredi çözümlemesi -----------------------------------------
  // Kiralamada kredi kavramı yok; satılıkta iki girdiden hangisi verildiyse
  // diğeri türetilir (ikisi de yoksa peşin alım varsayılır).
  let loanAmount = 0;
  let downPayment = 0;
  if (tx === "sale") {
    if (input.loanAmount != null) {
      loanAmount = clamp(pos(input.loanAmount), 0, price);
      downPayment = round2(price - loanAmount);
    } else if (input.downPayment != null) {
      downPayment = clamp(pos(input.downPayment), 0, price);
      loanAmount = round2(price - downPayment);
    } else {
      downPayment = price;
      loanAmount = 0;
    }
  }

  const lines: PurchaseCostLine[] = [];
  const notes: string[] = [];
  const add = (line: PurchaseCostLine) => {
    if (line.amount > 0) lines.push({ ...line, amount: round2(line.amount) });
  };

  if (tx === "sale") {
    // Tapu harcı — matrah satış bedeli.
    const buyerDeedPct = input.deedFeeShare === "buyer" ? r.deedFeeTotalPct : r.deedFeeTotalPct / 2;
    add({
      key: "deed_fee",
      label: "Tapu harcı (alıcı payı)",
      amount: (price * buyerDeedPct) / 100,
      note:
        input.deedFeeShare === "buyer"
          ? `Toplam %${r.deedFeeTotalPct} harcın tamamı alıcıda (taraflarca kararlaştırıldıysa).`
          : `Toplam %${r.deedFeeTotalPct} harcın yarısı alıcıda — kanuni paylaşım.`,
    });

    add({
      key: "land_registry_service",
      label: "Tapu döner sermaye hizmet bedeli",
      amount: r.landRegistryServiceFeeTry,
      note: "TKGM işlem başına sabit hizmet bedeli, her yıl güncellenir.",
    });

    add({
      key: "commission",
      label: `Emlak komisyonu (%${commissionPct} + KDV %${vatPct})`,
      amount: (price * commissionPct * vatMultiplier) / 100,
      note: "Taşınmaz Ticareti Yönetmeliği: satışta hizmet bedeli %4'ü aşamaz, aksi kararlaştırılmadıkça taraflardan yarı yarıya alınır.",
    });

    // Yeni bina (müteahhitten ilk el) → satış bedeli üzerinden KDV. İkinci elde yok.
    if (input.newBuild) {
      const isCommercial = input.propertyKind === "commercial";
      const newBuildVatPct = isCommercial
        ? r.newBuildVatLargePct
        : sqm && sqm <= 150
          ? r.newBuildVatResidentialSmallPct
          : r.newBuildVatLargePct;
      add({
        key: "new_build_vat",
        label: `Yeni bina KDV (%${newBuildVatPct})`,
        amount: (price * newBuildVatPct) / 100,
        note: isCommercial
          ? "İşyeri/ticari yeni bina alımında satış bedeline %20 KDV eklenir."
          : sqm && sqm <= 150
            ? "Net alanı 150 m²'ye kadar yeni konutta %1 KDV. İkinci el alımda KDV yoktur."
            : "150 m² üzeri yeni konutta %20 KDV. m² girilmezse üst oran varsayıldı.",
      });
    }
  } else {
    // Kiralama: hizmet bedeli en çok BİR aylık kira + KDV.
    add({
      key: "commission",
      label: `Kiralama komisyonu (${r.rentCommissionMonths} aylık kira + KDV %${vatPct})`,
      amount: price * r.rentCommissionMonths * vatMultiplier,
      note: "Taşınmaz Ticareti Yönetmeliği: kiralamada hizmet bedeli bir aylık kira bedelini aşamaz.",
    });
    notes.push("Depozito ve peşin ödenen ilk kira bu hesaba dâhil değildir.");
    // İşyeri kirasında gelir vergisi stopajı — kiracı brütten keser, malike net
    // öder. Kiracının cebinden ÇIKMAZ (kesip vergi dairesine yatırır) → toplam
    // maliyete eklenmez, bilgi notu olarak gösterilir.
    if (input.propertyKind === "commercial" && r.rentWithholdingPct > 0) {
      const monthlyWithholding = round2((price * r.rentWithholdingPct) / 100);
      notes.push(
        `İşyeri kirasında kiracı aylık %${r.rentWithholdingPct} gelir vergisi stopajı keser (~${nfTry.format(monthlyWithholding)} ₺/ay); malike NET ödenir, vergi dairesine yatırılır.`,
      );
    }
  }

  // --- Sigortalar ----------------------------------------------------------
  const wantsDask = input.includeDask ?? tx === "sale";
  if (wantsDask) {
    const dask = sqm
      ? clamp(sqm * r.daskPerSqmTry, r.daskMinTry, r.daskMaxTry)
      : r.daskFallbackTry;
    add({
      key: "dask",
      label: "DASK (zorunlu deprem sigortası) — yıllık",
      amount: dask,
      note: sqm
        ? `${sqm} m² üzerinden yaklaşık; gerçek prim risk bölgesi ve yapı tarzına göre değişir.`
        : "m² girilmediği için ortalama bir konut varsayıldı.",
    });
  }

  const wantsHomeInsurance = input.includeHomeInsurance ?? loanAmount > 0;
  if (wantsHomeInsurance) {
    const home = sqm
      ? Math.max(sqm * r.homeInsurancePerSqmTry, r.homeInsuranceMinTry)
      : r.homeInsuranceFallbackTry;
    add({
      key: "home_insurance",
      label: "Konut sigortası (isteğe bağlı) — yıllık",
      amount: home,
      note: "Serbest tarifeli; kredi kullanımında bankalar genellikle talep eder.",
      loanRelated: loanAmount > 0,
    });
  }

  // --- Kredi kaynaklı kalemler --------------------------------------------
  if (loanAmount > 0) {
    add({
      key: "appraisal",
      label: "Ekspertiz (değerleme raporu)",
      amount: r.appraisalFeeTry,
      note: "SPK lisanslı değerleme şirketi ücreti — kredi kullanımında zorunlu.",
      loanRelated: true,
    });
    add({
      key: "loan_allocation",
      label: `Kredi tahsis ücreti (%${r.loanAllocationFeePct})`,
      amount: (loanAmount * r.loanAllocationFeePct) / 100,
      note: "Yasal tavan kredi tutarının binde 5'idir; banka daha azını uygulayabilir.",
      loanRelated: true,
    });
    add({
      key: "mortgage_registration",
      label: "İpotek tesis işlem bedeli",
      amount: r.mortgageRegistrationFeeTry,
      note: "Konut finansmanı ipoteği harçtan istisnadır; yalnızca hizmet bedeli çıkar.",
      loanRelated: true,
    });
    notes.push(TAX_FREE_HOUSING_LOAN_NOTE);
  }

  notes.push("Taşınma, tadilat, aidat, abonelik açılışı ve emlak vergisi bu hesaba dâhil değildir.");

  const totalCosts = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const loanToValuePct = price > 0 ? round2((loanAmount / price) * 100) : 0;

  return {
    price,
    transactionType: tx,
    downPayment: round2(downPayment),
    loanAmount: round2(loanAmount),
    loanToValuePct,
    exceedsLoanToValue: tx === "sale" && loanToValuePct > MAX_LOAN_TO_VALUE_PCT,
    lines,
    totalCosts,
    cashOutOfPocket: round2(downPayment + totalCosts),
    costsPctOfPrice: price > 0 ? round2((totalCosts / price) * 100) : 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Kredi planı
// ---------------------------------------------------------------------------

export type LoanPlanInput = {
  amount: number;
  /** Yıllık nominal faiz (%). `monthlyRatePct` verilirse o öncelenir. */
  annualRatePct?: number | null;
  /** Aylık faiz (%) — bankaların ilan ettiği biçim. */
  monthlyRatePct?: number | null;
  months: number;
  /** `amortizationSchedule` kaç satır dönsün (varsayılan 12, 0 = kapalı). */
  scheduleRows?: number;
};

export type AmortizationRow = {
  /** Taksit sırası (1'den başlar). */
  no: number;
  payment: number;
  principal: number;
  interest: number;
  /** Taksit sonrası kalan anapara. */
  balance: number;
};

export type LoanPlanResult = {
  amount: number;
  months: number;
  monthlyRatePct: number;
  annualRatePct: number;
  /** Eşit (annüite) taksit tutarı. */
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  /** İlk 3 taksitin anapara/faiz kırılımı — "taksitin ne kadarı faiz" sorusu. */
  firstPayments: AmortizationRow[];
  /** İstenirse ilk N satırlık ödeme planı. */
  amortizationSchedule: AmortizationRow[];
  note: string;
};

/**
 * Eşit taksitli (annüite) konut kredisi planı.
 *
 *   taksit = A × i / (1 − (1+i)^−n)        i = aylık faiz, n = vade (ay)
 *   i = 0 ise doğrusal: taksit = A / n
 *
 * KKDF/BSMV eklenmez — konut kredisinde ikisi de yoktur
 * (bkz. `TAX_FREE_HOUSING_LOAN_NOTE`). Sonuç yaklaşıktır: bankanın gün sayısı
 * konvansiyonu, dosya masrafının krediye eklenmesi ve ödeme tarihi kaymaları
 * gerçek taksiti birkaç lira oynatabilir.
 */
export function computeLoanPlan(input: LoanPlanInput): LoanPlanResult {
  const amount = pos(input.amount);
  const months = Math.max(0, Math.round(Number(input.months) || 0));
  const monthlyRatePct =
    input.monthlyRatePct != null
      ? Math.max(0, Number(input.monthlyRatePct) || 0)
      : Math.max(0, annualToMonthlyPct(Number(input.annualRatePct) || 0));
  const i = monthlyRatePct / 100;

  const empty: LoanPlanResult = {
    amount,
    months,
    monthlyRatePct: round2(monthlyRatePct),
    annualRatePct: monthlyToAnnualPct(monthlyRatePct),
    monthlyPayment: 0,
    totalPayment: 0,
    totalInterest: 0,
    firstPayments: [],
    amortizationSchedule: [],
    note: TAX_FREE_HOUSING_LOAN_NOTE,
  };
  if (amount <= 0 || months <= 0) return empty;

  const rawPayment = i === 0 ? amount / months : (amount * i) / (1 - Math.pow(1 + i, -months));
  const monthlyPayment = round2(rawPayment);

  // Plan yuvarlanmış taksitle kurulur (banka ekstresi de öyle yapar); son
  // taksit, kalan anaparayı tam kapatacak şekilde düzeltilir. Böylece
  // anapara toplamı = kredi tutarı eşitliği kuruşu kuruşuna tutar.
  const rows: AmortizationRow[] = [];
  let balance = amount;
  let totalInterest = 0;
  let totalPayment = 0;
  for (let no = 1; no <= months; no++) {
    const interest = round2(balance * i);
    const isLast = no === months;
    let principal = round2(monthlyPayment - interest);
    if (isLast || principal > balance) principal = round2(balance);
    const payment = round2(principal + interest);
    balance = round2(balance - principal);
    totalInterest = round2(totalInterest + interest);
    totalPayment = round2(totalPayment + payment);
    rows.push({ no, payment, principal, interest, balance });
    if (balance <= 0 && !isLast) break; // erken kapanma (yuvarlama artığı)
  }

  const scheduleRows = input.scheduleRows == null ? 12 : Math.max(0, Math.round(input.scheduleRows));

  return {
    amount,
    months,
    monthlyRatePct: round2(monthlyRatePct),
    annualRatePct: monthlyToAnnualPct(monthlyRatePct),
    monthlyPayment,
    totalPayment,
    totalInterest,
    firstPayments: rows.slice(0, 3),
    amortizationSchedule: rows.slice(0, scheduleRows),
    note: TAX_FREE_HOUSING_LOAN_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Biçimlendirme (UI ortak)
// ---------------------------------------------------------------------------

const nfTry = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** Kuruşsuz ₺ — hesaplayıcı ekranlarında ortak biçim. */
export function formatTry(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${nfTry.format(Math.round(v))} ₺`;
}

/** Yaklaşıklık vurgusu — her çıktı ekranında görünmesi gereken tek cümle. */
export const APPROX_DISCLAIMER =
  "Bu tutarlar yaklaşık değerlerdir; resmi teklif veya taahhüt değildir. Harç, hizmet bedeli ve faiz oranları mevzuat ve banka koşullarına göre değişir.";
