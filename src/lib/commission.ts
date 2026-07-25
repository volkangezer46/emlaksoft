/**
 * Komisyon hesabı — tek doğruluk kaynağı.
 *
 * NEDEN AYRI BİR MODÜL: KDV oranı `%20` olarak İKİ AYRI DOSYAYA sabit
 * yazılmıştı (`actions/deals.ts:205`, `actions/workflow.ts:65`). Oran
 * değiştiğinde ikisinin de bulunması gerekiyordu ve birini atlamak sessizce
 * yanlış fatura üretirdi. Varsayılan komisyon oranı (%3) ve 50/50 paylaşım da
 * aynı şekilde dağınıktı.
 *
 * KAPSAM SINIRI — ÖNEMLİ: Bu modül yalnızca ARİTMETİK yapıyor. Vergi
 * mevzuatı yorumlamıyor:
 *
 *   · KDV oranı bir GİRDİ (varsayılan %20 — 07/2023'ten beri genel oran).
 *   · Stopaj ve gelir vergisi GİRDİ olarak alınıyor, varsayılanı SIFIR.
 *     Bunlar danışmanın vergi statüsüne (ücretli / serbest meslek / şirket)
 *     ve sözleşme ilişkisine göre değişir; uygulamanın karar vermesi doğru
 *     olmaz. Kullanıcı kendi oranını girer.
 *
 * Arayüzde bunun mali müşavir yerine geçmediği açıkça yazılı.
 */

/** 07/2023'ten beri genel KDV oranı. Girdi olarak da geçilebilir. */
export const DEFAULT_VAT_RATE = 20;

/** Emlak komisyonunda yaygın oran; portföyde `commission_rate` boşsa kullanılır. */
export const DEFAULT_COMMISSION_RATE = 3;

export type CommissionInput = {
  /** Satış/kira bedeli. */
  amount: number;
  /** Komisyon oranı, yüzde (ör. 3 = %3). */
  rate?: number;
  /** KDV oranı, yüzde. */
  vatRate?: number;
  /**
   * Anlaşılan komisyon KDV DAHİL mi?
   *
   * Bu, sahada en sık karışan nokta: "100.000 TL komisyon" denildiğinde
   * müşteri KDV dahil, danışman hariç anlıyor. İkisi arasında %20 fark var.
   */
  vatIncluded?: boolean;
  /** Danışman payı, yüzde (kalanı ofis). */
  advisorShare?: number;
  /** Stopaj oranı, yüzde. Varsayılan 0 — bkz. modül başlığı. */
  withholdingRate?: number;
  /** Danışmandan kesilen diğer giderler (sabit tutar). */
  otherDeductions?: number;
};

export type CommissionBreakdown = {
  /** KDV hariç komisyon (matrah). */
  net: number;
  /** Hesaplanan KDV. */
  vat: number;
  /** Müşteriden tahsil edilecek toplam. */
  gross: number;
  /** Danışman payı (KDV hariç matrah üzerinden). */
  advisorGross: number;
  /** Ofis payı. */
  officeGross: number;
  /** Danışman payından kesilen stopaj. */
  withholding: number;
  /** Danışmanın eline geçen. */
  advisorNet: number;
  /** Kullanılan oranlar — arayüzde gösterilip doğrulanabilsin diye. */
  used: { rate: number; vatRate: number; advisorShare: number; withholdingRate: number };
};

/** Kuruşa yuvarla. Para hesabında ara sonuçların yuvarlanmaması şart. */
function kurus(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sayı değilse ya da negatifse yedek değere düşer. */
function pozitif(v: number | undefined, yedek: number): number {
  if (v == null || !Number.isFinite(v) || v < 0) return yedek;
  return v;
}

/**
 * Komisyon dökümü.
 *
 * Paylaşım KDV HARİÇ matrah üzerinden yapılıyor: KDV devlete gidiyor, ofis ya
 * da danışmanın geliri değil. KDV'yi paylaşıma dahil etmek her iki tarafın
 * payını da şişirir.
 */
export function calculateCommission(input: CommissionInput): CommissionBreakdown {
  const amount = pozitif(input.amount, 0);
  const rate = pozitif(input.rate, DEFAULT_COMMISSION_RATE);
  const vatRate = pozitif(input.vatRate, DEFAULT_VAT_RATE);
  // Pay 0-100 aralığında olmalı; dışarısı anlamsız.
  const advisorShare = Math.min(100, pozitif(input.advisorShare, 50));
  const withholdingRate = Math.min(100, pozitif(input.withholdingRate, 0));
  const otherDeductions = pozitif(input.otherDeductions, 0);

  const hesaplanan = amount * (rate / 100);

  /*
   * KDV dahil anlaşıldıysa hesaplanan tutar BRÜT'tür; matrahı geri çıkarmak
   * için 1 + oran'a bölünür. `100.000 / 1.20 = 83.333,33` — yaygın hata
   * `100.000 * 0.80 = 80.000` demek, bu YANLIŞ.
   */
  const net = input.vatIncluded ? kurus(hesaplanan / (1 + vatRate / 100)) : kurus(hesaplanan);
  const vat = kurus(net * (vatRate / 100));
  const gross = kurus(net + vat);

  const advisorGross = kurus(net * (advisorShare / 100));
  const officeGross = kurus(net - advisorGross);
  const withholding = kurus(advisorGross * (withholdingRate / 100));
  const advisorNet = kurus(Math.max(0, advisorGross - withholding - otherDeductions));

  return {
    net,
    vat,
    gross,
    advisorGross,
    officeGross,
    withholding,
    advisorNet,
    used: { rate, vatRate, advisorShare, withholdingRate },
  };
}

/**
 * `commissions.splits` alanı için satırlar.
 * `deals.ts` ve `workflow.ts` bunu ayrı ayrı kuruyordu.
 */
export function buildSplits(net: number, advisorShare = 50): { label: string; rate: number; amount: number }[] {
  const pay = Math.min(100, pozitif(advisorShare, 50));
  const danisman = kurus(net * (pay / 100));
  return [
    { label: "Danışman", rate: pay, amount: danisman },
    // Ofis payı çıkarma ile: iki ayrı çarpımın toplamı yuvarlama yüzünden
    // net'i tutturmayabilir (ör. %33/%67).
    { label: "Ofis", rate: kurus(100 - pay), amount: kurus(net - danisman) },
  ];
}
