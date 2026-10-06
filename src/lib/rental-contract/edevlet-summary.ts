/**
 * e-Devlet "Dijital Kontrat – Kira Sözleşmesi" aktarım yardımcısı (SAF).
 *
 * e-Devlet'e otomatik veri GÖNDERİLMEZ (resmî API yok, kazıma yapılmaz). Bu özet, danışmanın e-Devlet formunu
 * doldururken kira kaydından kopyalayacağı alanları tek blokta toplar. TC kimlik no EmlakSoft'ta TUTULMAZ:
 * özet bunu açıkça "taraflardan alın" diye belirtir. Alan adları e-Devlet ekranından doğrulanmadı ("sıkça istenen").
 */

export const EDEVLET_GUIDE_URL = "https://www.turkiye.gov.tr/";
export const EDEVLET_GUIDE_LABEL = "e-Devlet Kapısı (\"Dijital Kontrat\" hizmetini arayın)";

export type EdevletRentalInput = {
  propertyCode: string | null;
  propertyTitle: string | null;
  addressLine: string | null;
  district: string | null;
  province: string | null;
  renterName: string | null;
  monthlyRent: number;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  deposit: number | null;
};

function tl(n: number): string {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n)} TL`;
}

function trDate(dayKey: string): string {
  const [y, m, d] = dayKey.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : dayKey;
}

/** Ay farkı (başlangıç → bitiş); bitiş yoksa null. */
export function leaseMonths(startDate: string, endDate: string | null): number | null {
  if (!endDate) return null;
  const [ys, ms, ds] = startDate.slice(0, 10).split("-").map(Number);
  const [ye, me, de] = endDate.slice(0, 10).split("-").map(Number);
  if (!ys || !ye) return null;
  let months = (ye - ys) * 12 + (me - ms);
  if (de < ds) months -= 1;
  return months > 0 ? months : null;
}

export type EdevletField = { label: string; value: string };

export function buildEdevletFields(input: EdevletRentalInput): EdevletField[] {
  const location = [input.addressLine, input.district, input.province].filter(Boolean).join(", ");
  const months = leaseMonths(input.startDate, input.endDate);
  const fields: EdevletField[] = [
    { label: "Taşınmaz adresi", value: location || "— (portföy adresini tamamlayın)" },
    { label: "Portföy", value: [input.propertyCode, input.propertyTitle].filter(Boolean).join(" · ") || "—" },
    { label: "Kiracı adı soyadı", value: input.renterName?.trim() || "—" },
    { label: "Aylık kira bedeli", value: tl(input.monthlyRent) },
    { label: "Ödeme günü", value: `Her ayın ${input.dueDay}. günü` },
    { label: "Başlangıç tarihi", value: trDate(input.startDate) },
    { label: "Bitiş tarihi", value: input.endDate ? trDate(input.endDate) : "Belirtilmemiş" },
    { label: "Süre", value: months ? `${months} ay` : "—" },
    { label: "Depozito", value: input.deposit != null && input.deposit > 0 ? tl(input.deposit) : "Yok / girilmemiş" },
    { label: "TC kimlik numaraları", value: "Taraflardan alın (EmlakSoft'ta tutulmaz)" },
  ];
  return fields;
}

export function buildEdevletCopyText(input: EdevletRentalInput): string {
  return [
    "e-Devlet Dijital Kontrat – Kira Sözleşmesi için bilgiler",
    ...buildEdevletFields(input).map((f) => `${f.label}: ${f.value}`),
  ].join("\n");
}
