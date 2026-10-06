/**
 * MEVZUAT SABİTLERİ — TEK KAYNAK.
 *
 * Koda gömülü yasal/mali sabitlerin (harç, KDV, komisyon tavanı, döner sermaye, vergi dilimleri,
 * eşikler) tamamı burada. `purchase-costs.ts`, `commission-cap.ts`, `commission.ts` ve satıcı net
 * hesaplayıcı (`seller-proceeds.ts`) değerlerini BURADAN okur; başka dosyada yasal sayı yazılmaz
 * (bkz. `legal-constants.test.ts`).
 *
 * Her sabit: değer + kaynak + doğrulama durumu + doğrulama tarihi.
 *  - `status: "verified"` yalnız `verifiedAt` (YYYY-MM-DD) doluysa geçerlidir; aksi hâlde
 *    kullanıcıya "Doğrulanmadı" rozetiyle gösterilir (`LegalStatusBadge`).
 *  - Bu çalışmada resmî metne (Resmî Gazete, GİB, TKGM) doğrudan erişilemedi; tüm sabitler
 *    `unverified` başlar. Sahip/mali müşavir kaynağı kontrol edip yalnız ilgili satırın
 *    `status` ve `verifiedAt` alanını günceller. Hukuki/mali danışmanlık DEĞİLDİR.
 *  - Sabit değişince yalnız bu dosya değişir; envanter: `docs/MEVZUAT_SABITLERI.md`.
 *
 * Saf modül: I/O ve tarih yok (zaman kuralı: `src/lib/clock.ts`).
 */

export type LegalUnit = "pct" | "try" | "usd" | "ha" | "count" | "months" | "years" | "ratio";
export type LegalStatus = "verified" | "unverified";

export type LegalConstant = {
  value: number;
  label: string;
  unit: LegalUnit;
  /** Kaynak iddiası (kanun/tebliğ/kurum) — resmî metinden doğrulanana kadar iddiadır. */
  source: string;
  sourceUrl?: string;
  status: LegalStatus;
  /** Doğrulama tarihi (YYYY-MM-DD). `verified` için zorunlu. */
  verifiedAt: string | null;
  note?: string;
};

const SEC_2026 = "İkincil kaynak (hukuk bürosu/haber sayfası), resmî metinden teyit edilmedi";

function c(
  value: number,
  label: string,
  unit: LegalUnit,
  source: string,
  extra: Partial<Pick<LegalConstant, "sourceUrl" | "note" | "status" | "verifiedAt">> = {},
): LegalConstant {
  return { value, label, unit, source, status: "unverified", verifiedAt: null, ...extra };
}

export const LEGAL_CONSTANTS = {
  // --- KDV ---
  vatGeneralPct: c(20, "Genel KDV oranı", "pct", "KDV Kanunu / Cumhurbaşkanı kararı (07/2023'ten beri %20)"),
  newBuildVatResidentialSmallPct: c(
    1,
    "Yeni bina KDV (net 150 m² ve altı konut)",
    "pct",
    "KDV Kanunu geçici hükümleri / KDV tarifesi",
  ),
  newBuildVatLargePct: c(20, "Yeni bina KDV (150 m² üstü konut / işyeri)", "pct", "KDV Kanunu geçici hükümleri / KDV tarifesi"),
  rentWithholdingPct: c(20, "İşyeri kirası stopajı", "pct", "GVK m.94"),

  // --- Komisyon (hizmet bedeli) ---
  saleCommissionCapPct: c(
    4,
    "Satış hizmet bedeli tavanı (KDV hariç, taraflar toplamı)",
    "pct",
    "Taşınmaz Ticareti Hakkında Yönetmelik (madde no resmî metinden doğrulanmadı)",
  ),
  rentCommissionCapMonths: c(
    1,
    "Kira hizmet bedeli tavanı (aylık kira katı)",
    "months",
    "Taşınmaz Ticareti Hakkında Yönetmelik",
  ),

  // --- Harç ve masraflar ---
  deedFeeTotalPct: c(
    4,
    "Tapu harcı toplam oranı (alıcı %2 + satıcı %2)",
    "pct",
    "492 s. Harçlar Kanunu, (4) sayılı tarife I/20-a",
    { note: "Her iki taraftan ayrı ayrı binde 20; toplam %4." },
  ),
  landRegistryServiceFeeTry: c(6_000, "Tapu döner sermaye hizmet bedeli", "try", "TKGM yıllık tarifesi", {
    note:
      "Her yıl değişir ve bölgeye göre oynar. Araştırmada 2.534 / 6.681 / 6.988 TL gibi çelişkili değerler görüldü; " +
      "6.000 TL yaklaşık varsayımdır. Güncel tutarı tapu müdürlüğünden teyit edin.",
  }),
  daskPerSqmTry: c(25, "DASK prim katsayısı (m² başına, orta risk, betonarme)", "try", "DASK tarifesi (yaklaşık tahmin)"),
  daskMinTry: c(900, "DASK asgari prim", "try", "DASK tarifesi (yaklaşık tahmin)"),
  daskMaxTry: c(6_000, "DASK azami prim", "try", "DASK tarifesi (yaklaşık tahmin)"),
  daskFallbackTry: c(2_500, "DASK yedek tahmin (m² bilinmiyorsa)", "try", "DASK tarifesi (yaklaşık tahmin)"),
  homeInsurancePerSqmTry: c(20, "Konut sigortası (m² başına)", "try", "Serbest tarife, piyasa tahmini"),
  homeInsuranceMinTry: c(800, "Konut sigortası asgari", "try", "Serbest tarife, piyasa tahmini"),
  homeInsuranceFallbackTry: c(2_000, "Konut sigortası yedek tahmin", "try", "Serbest tarife, piyasa tahmini"),
  appraisalFeeTry: c(9_000, "Ekspertiz (değerleme raporu) ücreti", "try", "SPK lisanslı değerleme tarifeleri (tahmin)"),
  loanAllocationFeePct: c(0.5, "Kredi tahsis ücreti tavanı (binde 5)", "pct", "BDDK ücret usul ve esasları"),
  mortgageRegistrationFeeTry: c(3_500, "İpotek tesis döner sermaye", "try", "TKGM (tahmin)"),
  maxLoanMonths: c(120, "Konut kredisi azami vade", "months", "BDDK"),
  maxLtvPct: c(90, "Konut kredisi azami kredi/değer oranı", "pct", "BDDK"),

  // --- Satıcı vergisi (değer artış kazancı) ---
  valueGainHoldingMonths: c(
    60,
    "Değer artış kazancı: elde tutma süresi (5 yıl)",
    "months",
    "GVK m.80 ve mükerrer 80 (taşınmazın edinmeden itibaren 5 yıl içinde satışı)",
  ),
  valueGainExemptionTry: c(150_000, "Değer artış kazancı yıllık istisnası (2026)", "try", SEC_2026, {
    sourceUrl: "https://musavirlerkulubu.com.tr/makale/2026-yili-gayrimenkullerin-5-yil-icinde-satisinda-gelir-vergisi-beyani-rehberi",
    note: "Her yıl yeniden belirlenir (GVK m.21 yeniden değerleme).",
  }),
  valueGainIndexThresholdPct: c(
    10,
    "Edinme bedeli endekslemesi: Yİ-ÜFE artış eşiği",
    "pct",
    "GVK mükerrer 80 (artış %10'u aşarsa endeksleme)",
    { note: "Endeksleme oranı kullanıcı girdisidir; resmî Yİ-ÜFE değeri TÜİK'ten alınır." },
  ),

  // --- Yabancıya satış / ikamet / vatandaşlık eşikleri ---
  residencePermitMinUsd: c(
    200_000,
    "Taşınmaz yoluyla ikamet izni: asgari gayrimenkul bedeli (16.10.2023 sonrası edinim)",
    "usd",
    "İkincil kaynak (hukuk bürosu); resmî metinden teyit edilmedi. Yabancılar ve Uluslararası Koruma Kanunu uygulaması",
    {
      sourceUrl: "https://www.kllegalconsultancy.com/articles/tasinmaz-yoluyla-ikamet-izninde-200000-dolar-siniri-2026-yilinda-yeni-kurallar-ve-ekspertiz-raporu",
      note: "Önceki eşikler 75.000 / 50.000 USD idi. SPK lisanslı ekspertiz raporu (yaklaşık 3 ay geçerli) aranır; güncel şartı Göç İdaresi'nden teyit edin.",
    },
  ),
  citizenshipMinUsd: c(400_000, "Taşınmaz yoluyla vatandaşlık: asgari bedel", "usd", "Türk Vatandaşlığı Kanunu uygulama yönetmeliği (ikincil kaynak)"),
  citizenshipHoldYears: c(3, "Vatandaşlık: tapuda satılmama şerhi süresi", "years", "Türk Vatandaşlığı Kanunu uygulama yönetmeliği (ikincil kaynak)"),
  foreignPersonMaxHectares: c(30, "Yabancı gerçek kişi başına ülke genelinde azami taşınmaz alanı", "ha", "Tapu Kanunu m.35 (ikincil kaynak)"),
  foreignDistrictQuotaPct: c(10, "Yabancıya satılabilecek ilçe yüzölçümü sınırı (yaygın uygulama)", "pct", "Tapu Kanunu m.35 (ikincil kaynak)"),

  // --- Değerli konut vergisi (yalnız bilgi uyarısı) ---
  dkvThresholdTry: c(17_711_000, "Değerli konut vergisi başlangıç eşiği (2026)", "try", SEC_2026, {
    sourceUrl: "https://www.alomaliye.com/2025/12/31/emlak-vergisi-kanunu-genel-tebligi-seri-no-88-2026-degerli-konut-vergisi/",
    note: "Emlak Vergisi Kanunu Genel Tebliği Seri 88 (RG 31.12.2025). Matrah emlak vergisi değeridir, satış bedeli değil.",
  }),
} as const satisfies Record<string, LegalConstant>;

export type LegalKey = keyof typeof LEGAL_CONSTANTS;

export type LegalBracket = { upTo: number | null; ratePct: number };

export type LegalBracketTable = {
  label: string;
  source: string;
  sourceUrl?: string;
  status: LegalStatus;
  verifiedAt: string | null;
  note?: string;
  brackets: LegalBracket[];
};

/** Gelir vergisi tarifesi (ücret dışı gelirler; 2026). Dilim üst sınırları kümülatif matrahtır. */
export const INCOME_TAX_BRACKETS: LegalBracketTable = {
  label: "Gelir vergisi tarifesi (2026)",
  source: "GVK m.103 ve yıllık yeniden değerleme / GİB tebliği",
  status: "unverified",
  verifiedAt: null,
  note: "Dilimler bu çalışmada resmî tebliğden okunmadı; GİB'den doğrulanana kadar tahmindir.",
  brackets: [
    { upTo: 158_000, ratePct: 15 },
    { upTo: 330_000, ratePct: 20 },
    { upTo: 800_000, ratePct: 27 },
    { upTo: 4_300_000, ratePct: 35 },
    { upTo: null, ratePct: 40 },
  ],
};

/** Değerli konut vergisi dilimleri (2026) — yalnız bilgi amaçlı. */
export const DKV_BRACKETS: LegalBracketTable = {
  label: "Değerli konut vergisi dilimleri (2026)",
  source: SEC_2026,
  sourceUrl: "https://www.alomaliye.com/2025/12/31/emlak-vergisi-kanunu-genel-tebligi-seri-no-88-2026-degerli-konut-vergisi/",
  status: "unverified",
  verifiedAt: null,
  note: "17.711.000 TL altı vergisiz; üstü kademeli.",
  brackets: [
    { upTo: 17_711_000, ratePct: 0 },
    { upTo: 26_567_000, ratePct: 0.3 },
    { upTo: 35_425_000, ratePct: 0.6 },
    { upTo: null, ratePct: 1 },
  ],
};

export function legalValue(key: LegalKey): number {
  return LEGAL_CONSTANTS[key].value;
}

/** Doğrulanmış sayılması için hem durum hem tarih gerekir. */
export function isLegalVerified(meta: { status: LegalStatus; verifiedAt: string | null }): boolean {
  return meta.status === "verified" && !!meta.verifiedAt && /^\d{4}-\d{2}-\d{2}$/.test(meta.verifiedAt);
}

export type LegalDisplay = {
  key: string;
  label: string;
  valueText: string;
  source: string;
  sourceUrl?: string;
  verified: boolean;
  verifiedAt: string | null;
  note?: string;
};

function valueText(v: number, unit: LegalUnit): string {
  const n = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(v);
  switch (unit) {
    case "pct":
      return `%${n}`;
    case "try":
      return `${n} ₺`;
    case "usd":
      return `${n} USD`;
    case "ha":
      return `${n} hektar`;
    case "months":
      return `${n} ay`;
    case "years":
      return `${n} yıl`;
    default:
      return n;
  }
}

export function describeLegal(key: LegalKey): LegalDisplay {
  const k = LEGAL_CONSTANTS[key] as LegalConstant;
  return {
    key,
    label: k.label,
    valueText: valueText(k.value, k.unit),
    source: k.source,
    sourceUrl: k.sourceUrl,
    verified: isLegalVerified(k),
    verifiedAt: k.verifiedAt,
    note: k.note,
  };
}

export function describeLegalMany(keys: readonly LegalKey[]): LegalDisplay[] {
  return keys.map(describeLegal);
}

export function describeBracketTable(key: "income_tax" | "dkv"): LegalDisplay {
  const t = key === "income_tax" ? INCOME_TAX_BRACKETS : DKV_BRACKETS;
  const text = t.brackets
    .map((b, i) => {
      const prev = i === 0 ? 0 : (t.brackets[i - 1]!.upTo ?? 0);
      const range =
        b.upTo == null ? `${valueText(prev, "try")} üstü` : `${valueText(prev, "try")} – ${valueText(b.upTo, "try")}`;
      return `${range}: %${b.ratePct}`;
    })
    .join(" · ");
  return {
    key,
    label: t.label,
    valueText: text,
    source: t.source,
    sourceUrl: t.sourceUrl,
    verified: isLegalVerified(t),
    verifiedAt: t.verifiedAt,
    note: t.note,
  };
}

/** Kademeli (marjinal) vergi: matrahı dilimlere böler. Saf; negatif/NaN matrah 0 sayılır. */
export function progressiveTax(base: number, table: LegalBracketTable = INCOME_TAX_BRACKETS): number {
  const amount = Number.isFinite(base) && base > 0 ? base : 0;
  let tax = 0;
  let lower = 0;
  for (const b of table.brackets) {
    const upper = b.upTo ?? Number.POSITIVE_INFINITY;
    if (amount > lower) tax += (Math.min(amount, upper) - lower) * (b.ratePct / 100);
    if (amount <= upper) break;
    lower = upper;
  }
  return Math.round((tax + Number.EPSILON) * 100) / 100;
}

/** Tüm kayıtlı sabitler (envanter/test/görünüm). */
export function allLegalConstants(): LegalDisplay[] {
  return [
    ...describeLegalMany(Object.keys(LEGAL_CONSTANTS) as LegalKey[]),
    describeBracketTable("income_tax"),
    describeBracketTable("dkv"),
  ];
}
