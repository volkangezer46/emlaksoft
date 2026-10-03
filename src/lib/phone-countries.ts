/**
 * Telefon ülke verisi (saf veri, React'siz). Varsayılan ülke Türkiye'dir.
 *
 * - `dial`: ülke arama kodu (+'sız). KKTC (+90 392) Türkiye ile aynı kodu paylaştığı için ayrı satır yoktur.
 * - `min`/`max`: ULUSAL numara uzunluğu (ülke kodu ve baştaki trunk 0 HARİÇ).
 * - `example`: ulusal biçimde örnek (placeholder).
 * - Paylaşılan kodlar: +1 (ABD/Kanada) ve +7 (Rusya/Kazakistan). E.164'ten ülke bulunurken
 *   +1 -> ABD, +7 -> Rusya (Kazakistan numaraları 6/7 ile başlar -> KZ) seçilir; yalnız görsel ayrımdır.
 */

export type PhoneCountry = {
  iso: string;
  ad: string;
  dial: string;
  flag: string;
  example: string;
  min: number;
  max: number;
};

/** ISO-3166 alpha-2 -> bayrak emoji (regional indicator). */
export function flagEmoji(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

// [iso, Türkçe ad, arama kodu, örnek ulusal numara, min, max]
const RAW: ReadonlyArray<readonly [string, string, string, string, number, number]> = [
  ["TR", "Türkiye", "90", "532 123 45 67", 10, 10],
  ["DE", "Almanya", "49", "151 2345 6789", 7, 13],
  ["NL", "Hollanda", "31", "6 12345678", 9, 9],
  ["FR", "Fransa", "33", "6 12 34 56 78", 9, 9],
  ["GB", "Birleşik Krallık", "44", "7400 123456", 9, 10],
  ["US", "Amerika Birleşik Devletleri", "1", "212 555 1234", 10, 10],
  ["CA", "Kanada", "1", "416 555 1234", 10, 10],
  ["RU", "Rusya", "7", "912 345 67 89", 10, 10],
  ["AZ", "Azerbaycan", "994", "50 123 45 67", 9, 9],
  ["SA", "Suudi Arabistan", "966", "51 234 5678", 9, 9],
  ["AE", "Birleşik Arap Emirlikleri", "971", "50 123 4567", 8, 9],
  ["QA", "Katar", "974", "3312 3456", 8, 8],
  ["KW", "Kuveyt", "965", "500 12345", 8, 8],
  ["UA", "Ukrayna", "380", "50 123 4567", 9, 9],
  ["IR", "İran", "98", "912 345 6789", 10, 10],
  ["IQ", "Irak", "964", "790 123 4567", 10, 10],
  ["SY", "Suriye", "963", "944 567 890", 8, 9],
  ["BG", "Bulgaristan", "359", "48 123 456", 8, 9],
  ["GR", "Yunanistan", "30", "691 234 5678", 10, 10],
  ["RO", "Romanya", "40", "712 345 678", 9, 9],
  ["GE", "Gürcistan", "995", "555 12 34 56", 9, 9],
  ["KZ", "Kazakistan", "7", "771 123 4567", 10, 10],
  ["CN", "Çin", "86", "131 2345 6789", 11, 11],
  ["JP", "Japonya", "81", "90 1234 5678", 9, 10],
  ["AT", "Avusturya", "43", "664 123456", 7, 13],
  ["BE", "Belçika", "32", "470 12 34 56", 8, 9],
  ["CH", "İsviçre", "41", "78 123 45 67", 9, 9],
  ["IT", "İtalya", "39", "312 345 6789", 6, 12],
  ["ES", "İspanya", "34", "612 34 56 78", 9, 9],
  ["PT", "Portekiz", "351", "912 345 678", 9, 9],
  ["IE", "İrlanda", "353", "85 123 4567", 7, 11],
  ["LU", "Lüksemburg", "352", "628 123 456", 6, 11],
  ["SE", "İsveç", "46", "70 123 45 67", 7, 13],
  ["NO", "Norveç", "47", "412 34 567", 8, 8],
  ["DK", "Danimarka", "45", "32 12 34 56", 8, 8],
  ["FI", "Finlandiya", "358", "41 2345678", 5, 12],
  ["IS", "İzlanda", "354", "611 1234", 7, 9],
  ["PL", "Polonya", "48", "512 345 678", 9, 9],
  ["CZ", "Çekya", "420", "601 123 456", 9, 9],
  ["SK", "Slovakya", "421", "912 123 456", 9, 9],
  ["HU", "Macaristan", "36", "20 123 4567", 8, 9],
  ["HR", "Hırvatistan", "385", "91 234 5678", 8, 9],
  ["SI", "Slovenya", "386", "31 234 567", 8, 8],
  ["RS", "Sırbistan", "381", "60 1234567", 8, 9],
  ["BA", "Bosna-Hersek", "387", "61 123 456", 8, 8],
  ["ME", "Karadağ", "382", "67 622 901", 8, 8],
  ["AL", "Arnavutluk", "355", "66 123 4567", 8, 9],
  ["MK", "Kuzey Makedonya", "389", "72 345 678", 8, 8],
  ["XK", "Kosova", "383", "44 123 456", 8, 9],
  ["LT", "Litvanya", "370", "612 34567", 8, 8],
  ["LV", "Letonya", "371", "21 234 567", 8, 8],
  ["EE", "Estonya", "372", "5123 4567", 7, 8],
  ["BY", "Belarus", "375", "29 123 45 67", 9, 9],
  ["MD", "Moldova", "373", "621 12 345", 8, 8],
  ["AM", "Ermenistan", "374", "77 123456", 8, 8],
  ["UZ", "Özbekistan", "998", "90 123 45 67", 9, 9],
  ["TM", "Türkmenistan", "993", "65 123456", 8, 8],
  ["KG", "Kırgızistan", "996", "700 123 456", 9, 9],
  ["TJ", "Tacikistan", "992", "917 12 3456", 9, 9],
  ["AF", "Afganistan", "93", "70 123 4567", 9, 9],
  ["PK", "Pakistan", "92", "301 2345678", 10, 10],
  ["IN", "Hindistan", "91", "81234 56789", 10, 10],
  ["BD", "Bangladeş", "880", "1812 345678", 10, 10],
  ["EG", "Mısır", "20", "100 123 4567", 9, 10],
  ["LY", "Libya", "218", "91 234 5678", 8, 9],
  ["TN", "Tunus", "216", "20 123 456", 8, 8],
  ["DZ", "Cezayir", "213", "551 23 45 67", 8, 9],
  ["MA", "Fas", "212", "650 123456", 9, 9],
  ["LB", "Lübnan", "961", "71 123 456", 7, 8],
  ["JO", "Ürdün", "962", "7 9012 3456", 8, 9],
  ["IL", "İsrail", "972", "50 123 4567", 8, 9],
  ["PS", "Filistin", "970", "599 123 456", 8, 9],
  ["OM", "Umman", "968", "9212 3456", 8, 8],
  ["BH", "Bahreyn", "973", "3600 1234", 8, 8],
  ["YE", "Yemen", "967", "712 345 678", 7, 9],
  ["CY", "Kıbrıs (Rum Kesimi)", "357", "96 123456", 8, 8],
  ["MT", "Malta", "356", "9696 1234", 8, 8],
  ["AU", "Avustralya", "61", "412 345 678", 9, 9],
  ["NZ", "Yeni Zelanda", "64", "21 123 4567", 8, 10],
  ["BR", "Brezilya", "55", "11 91234 5678", 10, 11],
  ["MX", "Meksika", "52", "55 1234 5678", 10, 10],
  ["AR", "Arjantin", "54", "11 2345 6789", 10, 11],
  ["KR", "Güney Kore", "82", "10 1234 5678", 8, 10],
  ["SG", "Singapur", "65", "8123 4567", 8, 8],
  ["MY", "Malezya", "60", "12 345 6789", 8, 10],
  ["TH", "Tayland", "66", "81 234 5678", 8, 9],
  ["ID", "Endonezya", "62", "812 3456 7890", 8, 12],
  ["PH", "Filipinler", "63", "917 123 4567", 10, 10],
  ["VN", "Vietnam", "84", "91 234 56 78", 9, 10],
  ["ZA", "Güney Afrika", "27", "71 123 4567", 9, 9],
  ["NG", "Nijerya", "234", "802 123 4567", 8, 10],
];

export const DEFAULT_PHONE_COUNTRY = "TR";

function toCountry(r: (typeof RAW)[number]): PhoneCountry {
  return { iso: r[0], ad: r[1], dial: r[2], flag: flagEmoji(r[0]), example: r[3], min: r[4], max: r[5] };
}

/** Türkiye en üstte, kalanlar Türkçe alfabetik. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  toCountry(RAW[0]),
  ...RAW.slice(1)
    .map(toCountry)
    .sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
];

const BY_ISO = new Map(PHONE_COUNTRIES.map((c) => [c.iso, c]));

export function getPhoneCountry(iso: string | null | undefined): PhoneCountry | undefined {
  return iso ? BY_ISO.get(iso.toUpperCase()) : undefined;
}

// dial -> öncelikli ülke (+1 -> US, +7 -> RU; CA ve KZ yalnız seçiciyle/özel kuralla)
const PRIMARY_BY_DIAL = new Map<string, PhoneCountry>();
for (const c of PHONE_COUNTRIES) {
  if (c.iso === "CA" || c.iso === "KZ") continue;
  if (!PRIMARY_BY_DIAL.has(c.dial)) PRIMARY_BY_DIAL.set(c.dial, c);
}

/**
 * Rakam dizisinin (ülke koduyla başlayan, '+'sız) başındaki arama kodunu bulur (en uzun eşleşme).
 * Tabloda olmayan kod için undefined.
 */
export function matchPhoneCountry(digits: string): PhoneCountry | undefined {
  for (const len of [3, 2, 1]) {
    if (digits.length < len) continue;
    const hit = PRIMARY_BY_DIAL.get(digits.slice(0, len));
    if (hit) {
      if (hit.dial === "7" && /^7[67]/.test(digits)) return BY_ISO.get("KZ");
      return hit;
    }
  }
  return undefined;
}
