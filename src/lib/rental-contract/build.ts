/**
 * Kiralama kaydından kira sözleşmesi taslağı (SAF — sunucu ve istemci güvenle import eder).
 *
 * Metin YER TUTUCUDUR: hukuki danışmanlık değildir ve "hukuken geçerli e-imza" iddiası taşımaz (imza altyapısı SMS OTP'dir).
 * Ofis kendi onaylı şablonunu yükleyip `{kiraci}`, `{kira_bedeli}` gibi alanlarla kullanabilir (`fillRentalTokens`).
 * Artış maddesi: TÜFE (TBK m.344: yenileme döneminde bir önceki 12 aylık TÜFE ortalamasını aşamaz) | sabit yüzde | yok.
 */

export const INCREASE_BASES = [
  { value: "tufe", label: "TÜFE (12 aylık ortalama, TBK m.344)" },
  { value: "sabit", label: "Sabit yüzde (TÜFE sınırını aşamaz)" },
  { value: "yok", label: "Artış maddesi yok (süre boyunca sabit)" },
] as const;
export type IncreaseBasis = (typeof INCREASE_BASES)[number]["value"];

export function parseIncreaseBasis(raw: unknown): IncreaseBasis | null {
  const v = String(raw ?? "").trim();
  return INCREASE_BASES.some((b) => b.value === v) ? (v as IncreaseBasis) : null;
}

/** 0-100 arası, en çok iki ondalık; geçersiz = null. Boş girdi = null (alan yok). */
export function parseFixedPct(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  const t = String(raw ?? "").trim().replace(",", ".");
  if (!t) return { ok: true, value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { ok: false };
  const n = Number(t);
  return n >= 0 && n <= 100 ? { ok: true, value: n } : { ok: false };
}

export type RentalContractData = {
  landlordName: string | null;
  tenantName: string | null;
  propertyTitle: string | null;
  propertyAddress: string | null;
  monthlyRent: number | null;
  deposit: number | null;
  dueDay: number | null;
  startDate: string | null;
  endDate: string | null;
  officeName: string | null;
  increaseBasis: IncreaseBasis;
  fixedPct: number | null;
};

const BLANK = "___________________________";

const tl = (n: number | null) =>
  n == null ? BLANK : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

const dateTr = (iso: string | null) => {
  if (!iso) return "_____";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "_____";
};

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : BLANK);

export function increaseClauseText(basis: IncreaseBasis, fixedPct: number | null): string {
  if (basis === "sabit") {
    const pct = fixedPct == null ? "___" : `%${String(fixedPct).replace(".", ",")}`;
    return `Kira bedeli her kira yılı sonunda ${pct} oranında artırılır; ancak uygulanacak artış oranı, Türk Borçlar Kanunu m.344 uyarınca bir önceki kira yılındaki on iki aylık TÜFE ortalamasını aşamaz.`;
  }
  if (basis === "yok") {
    return "Kira bedeli sözleşme süresince sabittir. Kira döneminin yenilenmesinde yeni bedel taraflarca yazılı olarak kararlaştırılır; bu bedel, Türk Borçlar Kanunu m.344 uyarınca bir önceki kira yılındaki on iki aylık TÜFE ortalamasını aşamaz.";
  }
  return "Kira bedeli, kira döneminin yenilenmesinde Türk Borçlar Kanunu m.344 uyarınca bir önceki kira yılındaki on iki aylık TÜFE ortalamasını geçmemek üzere artırılır.";
}

export function buildRentalContractBody(d: RentalContractData): string {
  const lines = [
    "KONUT KİRA SÖZLEŞMESİ",
    "",
    `Kiraya Veren: ${text(d.landlordName)}`,
    `Kiracı:       ${text(d.tenantName)}`,
    `Kira Konusu:  ${text(d.propertyTitle)}`,
    `Adres:        ${text(d.propertyAddress)}`,
    `Aylık Kira:   ${tl(d.monthlyRent)}`,
    `Kira Süresi:  ${dateTr(d.startDate)} tarihinden ${d.endDate ? `${dateTr(d.endDate)} tarihine kadar` : "belirsiz süreli"}`,
    "",
    "MADDE 1 — Kira Bedeli ve Ödeme",
    `Aylık kira bedeli her ayın ${d.dueDay ?? "___"}. gününe kadar ödenir.`,
    "",
    "MADDE 2 — Depozito",
    d.deposit != null ? `Kiracı ${tl(d.deposit)} tutarında depozito öder; depozito sözleşme sonunda kiralananın hasarsız teslimi hâlinde iade edilir.` : "Depozito: ___________________________",
    "",
    "MADDE 3 — Tarafların Yükümlülükleri",
    "Kiracı kiralananı özenle kullanır, aidat dışındaki olağan kullanım giderlerini öder ve sözleşme sonunda hasarsız teslim eder. Kiraya veren kiralananı sözleşmeye uygun kullanıma hazır teslim eder.",
    "",
    "MADDE 4 — Kira Artışı",
    increaseClauseText(d.increaseBasis, d.fixedPct),
    "",
    "MADDE 5 — Demirbaşlar",
    "Teslim edilen demirbaşlar: ___________________________",
    "",
    d.officeName ? `Aracı emlak ofisi: ${d.officeName.trim()}` : null,
    "",
    "[TASLAK — bu metin ofis taslağıdır, hukuki danışmanlık değildir; imzadan önce kontrol edin.]",
    "",
    "İmzalar:",
    "Kiraya Veren: ___________________________  Tarih: _______",
    "Kiracı:       ___________________________  Tarih: _______",
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** Ofisin kendi şablonundaki `{alan}` yer tutucularını doldurur; bilinmeyen yer tutucu aynen korunur. */
export function fillRentalTokens(content: string, d: RentalContractData): string {
  const map: Record<string, string> = {
    kiraya_veren: text(d.landlordName),
    kiraci: text(d.tenantName),
    tasinmaz: text(d.propertyTitle),
    adres: text(d.propertyAddress),
    kira_bedeli: tl(d.monthlyRent),
    depozito: tl(d.deposit),
    vade_gunu: d.dueDay == null ? "___" : String(d.dueDay),
    baslangic: dateTr(d.startDate),
    bitis: d.endDate ? dateTr(d.endDate) : "belirsiz süreli",
    ofis: text(d.officeName),
    artis_maddesi: increaseClauseText(d.increaseBasis, d.fixedPct),
  };
  return content.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in map ? map[key]! : whole));
}

/** Sözleşme başlığı: "Kira Sözleşmesi — Portföy — Kiracı". */
export function rentalContractTitle(d: Pick<RentalContractData, "propertyTitle" | "tenantName">): string {
  return ["Kira Sözleşmesi", d.propertyTitle?.trim(), d.tenantName?.trim()].filter(Boolean).join(" — ").slice(0, 200);
}
