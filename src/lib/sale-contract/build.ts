/**
 * Anlaşmadan / kabul edilen tekliften sözleşme taslağı (SP3) — SAF (sunucu ve istemci güvenle import eder).
 *
 * İki hazır taslak: kapora sözleşmesi ve aracılık (yetki) sözleşmesi. Metin YER TUTUCUDUR: hukuki danışmanlık değildir,
 * ofis kendi onaylı şablonunu `{alici}`, `{satici}`, `{satis_bedeli}`, `{kapora_tutari}` gibi alanlarla kullanabilir
 * (`fillDealTokens`). Bilinmeyen alan boş çizgiyle kalır; uydurma değer yazılmaz.
 */

export const DEAL_CONTRACT_KINDS = [
  { value: "kapora", label: "Kapora sözleşmesi", contractType: "kapora" },
  { value: "aracilik", label: "Aracılık sözleşmesi", contractType: "sozlesme" },
] as const;
export type DealContractKind = (typeof DEAL_CONTRACT_KINDS)[number]["value"];

export function parseDealContractKind(raw: unknown): DealContractKind {
  return raw === "aracilik" ? "aracilik" : "kapora";
}

export type DealContractData = {
  dealType: "sale" | "rent";
  /** Alıcı / kiracı adayı. */
  buyerName: string | null;
  /** Satıcı / kiraya veren (malik). */
  sellerName: string | null;
  propertyTitle: string | null;
  propertyCode: string | null;
  propertyAddress: string | null;
  /** Satış bedeli ya da aylık kira. */
  price: number | null;
  depositAmount: number | null;
  paymentMethodLabel: string | null;
  deedDate: string | null;
  officeName: string | null;
  /** Kapora ödeme vadesinin son günü (YYYY-MM-DD) — teklif geçerlilik tarihinden gelir. */
  validUntil: string | null;
  creditContingency: boolean;
};

const BLANK = "___________________________";

const tl = (n: number | null) =>
  n == null || !Number.isFinite(n) ? BLANK : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

const dateTr = (iso: string | null) => {
  if (!iso) return "_____";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "_____";
};

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : BLANK);

function propertyLine(d: DealContractData): string {
  const name = [d.propertyTitle, d.propertyCode ? `(${d.propertyCode})` : null].filter(Boolean).join(" ");
  return text(name || null);
}

export function dealContractTitle(kind: DealContractKind, d: DealContractData): string {
  const who = d.buyerName?.trim();
  const base = kind === "kapora" ? (d.dealType === "rent" ? "Kiralık Kapora Sözleşmesi" : "Kapora Sözleşmesi") : "Aracılık Sözleşmesi";
  return who ? `${base} — ${who}` : base;
}

export function buildKaporaBody(d: DealContractData): string {
  const rent = d.dealType === "rent";
  const buyerRole = rent ? "Kiracı Adayı" : "Alıcı";
  const sellerRole = rent ? "Kiraya Veren" : "Satıcı";
  const priceLabel = rent ? "Aylık Kira Bedeli" : "Satış Bedeli";
  const lines = [
    rent ? "KİRALIK TAŞINMAZ KAPORA SÖZLEŞMESİ" : "TAŞINMAZ SATIŞI KAPORA (CAYMA AKÇESİ) SÖZLEŞMESİ",
    "",
    `${sellerRole}: ${text(d.sellerName)}`,
    `${buyerRole}: ${text(d.buyerName)}`,
    `Taşınmaz:    ${propertyLine(d)}`,
    `Adres:       ${text(d.propertyAddress)}`,
    `${priceLabel}: ${tl(d.price)}`,
    `Kapora:      ${tl(d.depositAmount)}`,
    ...(rent ? [] : [`Ödeme Şekli: ${text(d.paymentMethodLabel)}`]),
    "",
    "MADDE 1 — Konu",
    rent
      ? `${buyerRole}, yukarıda yazılı taşınmazı belirtilen aylık bedelle kiralamak üzere ${sellerRole}'ye kapora ödemiştir.`
      : `${buyerRole}, yukarıda yazılı taşınmazı belirtilen bedelle satın almak üzere ${sellerRole}'ye kapora ödemiştir.`,
    "",
    "MADDE 2 — Kaporanın Niteliği",
    `Ödenen kapora ${rent ? "ilk kira bedeline / depozitoya" : "satış bedeline"} mahsup edilir. ${buyerRole} sözleşmeden haklı bir sebep olmaksızın cayarsa kapora ${sellerRole}'de kalır; ${sellerRole} cayarsa kaporayı iade eder ve Türk Borçlar Kanunu m.178 hükümleri uygulanır.`,
    "",
    rent ? "MADDE 3 — Kira Sözleşmesi" : "MADDE 3 — Tapu Devri",
    rent
      ? `Kira sözleşmesi en geç ${dateTr(d.deedDate)} tarihine kadar imzalanır; taşınmaz bu tarihte teslim edilir.`
      : `Tapu devri en geç ${dateTr(d.deedDate)} tarihinde ilgili Tapu Müdürlüğü'nde yapılır. Kalan bedel tapu devri sırasında ödenir.`,
    ...(rent || !d.creditContingency
      ? []
      : [
          "",
          "MADDE 4 — Kredi Şartı",
          `Satın alma bedelinin bir kısmı konut kredisiyle ödenecektir. Kredi, banka tarafından ${dateTr(d.validUntil)} tarihine kadar onaylanmazsa taraflar kaporanın iadesi ile sözleşmeden cayabilir.`,
        ]),
    "",
    `MADDE ${rent || !d.creditContingency ? 4 : 5} — Aracı`,
    `Bu işlemde aracılık hizmeti ${text(d.officeName)} tarafından verilmiştir.`,
    "",
    "İmzalar:",
    `${sellerRole}: ___________________________  Tarih: _______`,
    `${buyerRole}: ___________________________  Tarih: _______`,
    `Aracı: ___________________________  Tarih: _______`,
  ];
  return lines.join("\n");
}

export function buildAracilikBody(d: DealContractData): string {
  const rent = d.dealType === "rent";
  const lines = [
    rent ? "TAŞINMAZ KİRALAMA ARACILIK SÖZLEŞMESİ" : "TAŞINMAZ ALIM-SATIM ARACILIK SÖZLEŞMESİ",
    "",
    `Aracı (Emlak Ofisi): ${text(d.officeName)}`,
    `Hizmet Alan (${rent ? "Kiracı adayı" : "Alıcı"}): ${text(d.buyerName)}`,
    `Taşınmaz: ${propertyLine(d)}`,
    `Adres: ${text(d.propertyAddress)}`,
    `${rent ? "Aylık kira bedeli" : "Satış bedeli"}: ${tl(d.price)}`,
    "",
    "MADDE 1 — Konu",
    `Aracı, Taşınmaz Ticareti Hakkında Yönetmelik kapsamında yukarıda yazılı taşınmazın ${rent ? "kiralanması" : "satın alınması"} için hizmet alana aracılık ve danışmanlık hizmeti verir.`,
    "",
    "MADDE 2 — Hizmet Bedeli",
    rent
      ? "İşlem gerçekleştiğinde hizmet bedeli, taraflarca kararlaştırılan tutar olarak ödenir (yönetmelikteki üst sınır gözetilir): ___________________________ + KDV."
      : "İşlem gerçekleştiğinde hizmet bedeli, taraflarca kararlaştırılan oran üzerinden ödenir (yönetmelikteki üst sınır gözetilir): % _____ + KDV.",
    "",
    "MADDE 3 — Süre",
    `Bu sözleşme imza tarihinden itibaren ${dateTr(d.validUntil)} tarihine kadar geçerlidir.`,
    "",
    "MADDE 4 — Kişisel Veriler",
    "Taraflar, kişisel verilerin 6698 sayılı KVKK kapsamında yalnız bu işlem için işleneceğini kabul eder.",
    "",
    "İmzalar:",
    "Aracı: ___________________________  Tarih: _______",
    "Hizmet Alan: ___________________________  Tarih: _______",
  ];
  return lines.join("\n");
}

export function buildDealContractBody(kind: DealContractKind, d: DealContractData): string {
  return kind === "aracilik" ? buildAracilikBody(d) : buildKaporaBody(d);
}

/** Ofis şablonundaki anlaşma alanlarını doldurur; bilinmeyen alan boş çizgiyle kalır. */
export function fillDealTokens(template: string, d: DealContractData): string {
  const map: Record<string, string> = {
    alici: text(d.buyerName),
    kiraci: text(d.buyerName),
    satici: text(d.sellerName),
    kiraya_veren: text(d.sellerName),
    tasinmaz: propertyLine(d),
    adres: text(d.propertyAddress),
    satis_bedeli: tl(d.price),
    kira_bedeli: tl(d.price),
    kapora_tutari: tl(d.depositAmount),
    odeme_sekli: text(d.paymentMethodLabel),
    tapu_tarihi: dateTr(d.deedDate),
    ofis: text(d.officeName),
  };
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in map ? map[key] : whole));
}
