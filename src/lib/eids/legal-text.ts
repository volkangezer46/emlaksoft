import { legalValue, type LegalValues } from "@/lib/legal-constants";

/**
 * EİDS İPTAL / SÜRE BİTİMİ VE CEZA METNİ — TEK KAYNAK (SAF; I/O ve tarih yok).
 *
 * Görev metni (EP4 eids_takedown), pano kartı, Yardım rehberi, İlan Kontrol > Yetki kılavuzu ve kurulum adımları bu
 * metni okur; React tarafı `src/components/eids/legal-note.tsx` (EidsLegalNote). Ceza tutarları `legal-constants`
 * (`eidsPenaltyMinTry` / `eidsPenaltyMaxTry`) içinden gelir ve TARİHLİ sabittir (DATED_LEGAL_KEYS): yılbaşında yönetici yeni
 * tutarı mevzuat panelinden (`legal_constants` geçmişi) girer; sunucu yüzeyleri `getEffectiveLegalValues()` okuyup `values`
 * geçirir (İlan Kontrol > Yetki, kurulum adımı, Yardım rehberi + SSS: `applyEffectiveEidsPenalty`). Koddaki satır tabandır.
 * Hukuki danışmanlık DEĞİLDİR; tutar ikincil kaynaktan, resmî metinden teyit edilmedi.
 */

export const EIDS_SENDER_ADDRESS = "eids.yetki@ticaret.gov.tr";
export const EIDS_MAIL_SUBJECT = "Elektronik İlan Doğrulama Sistemi (EİDS) Taşınmaz Yetkilendirme Hakkında";
/** Ticaret Bakanlığı çağrı merkezi (kılavuzdaki doğrulanmamış noktalar buradan teyit edilir). */
export const EIDS_CALL_CENTER = "444 8 482";
/** Yetki bitince / iptal edilince ilanın kaldırılması gereken süre (gün). */
export const EIDS_TAKEDOWN_DAYS = 3;
export const EIDS_LEGAL_BASIS = "Taşınmaz Ticareti Hakkında Yönetmelik md. 14/2-h ve 14/2-j";

const num = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);

/** "28.620 – 858.620 TL" (o gün yürürlükteki değerler verilirse onları kullanır). */
export function eidsPenaltyRangeText(values?: LegalValues | null): string {
  const min = legalValue("eidsPenaltyMinTry", values);
  const max = legalValue("eidsPenaltyMaxTry", values);
  return `${num(min)} – ${num(max)} TL`;
}

/**
 * Metinlerdeki ceza tutarı ifadesi ("idari para cezası 28.620 – 858.620 TL"), hangi yılın değeri olursa olsun. Mevzuat
 * tutarı ürün fiyatı değildir: fiyat denetimleri (FAQ_PRICE_PATTERN; AI SSS bağlamı ve yardım testleri) önce bunu ayıklar.
 */
const PENALTY_PHRASE_RE = /idari para cezası \d[\d.]* – \d[\d.]* TL/g;

export function stripEidsPenaltyAmounts(text: string): string {
  return text.replace(PENALTY_PHRASE_RE, "idari para cezası");
}

export type EidsLegalNoteContent = {
  /** Tek cümlelik özet (görev başlığı altı, pano kartı). */
  headline: string;
  /** Madde madde açıklama (kılavuz ve görev ayrıntısı). */
  points: string[];
  /** Kaynak satırı. */
  source: string;
};

export function eidsLegalNote(values?: LegalValues | null): EidsLegalNoteContent {
  const range = eidsPenaltyRangeText(values);
  return {
    headline: `Yetki iptal edilince ya da süresi bitince ilan ${EIDS_TAKEDOWN_DAYS} gün içinde tüm yayınlardan kaldırılmalıdır; ihlal başına idari para cezası ${range}.`,
    points: [
      "İptal ilanı kendiliğinden yayından düşürmez. Bakanlık rehberine göre yalnız yeni ilan girmeyi ve ilanın yenilenmesini engeller.",
      "Yetkisiz ilan vermek yasaktır (md. 14/2-j).",
      `Yetki bittiğinde ilan ${EIDS_TAKEDOWN_DAYS} gün içinde kaldırılmalıdır (md. 14/2-h): üye olduğunuz portallar, vitrin, paylaşım linkleri ve sosyal medya dahil.`,
      `İhlal başına idari para cezası ${range}. Aykırılık tekrarlanırsa yetki belgesi iptal edilebilir.`,
    ],
    source: `${EIDS_LEGAL_BASIS}. Tutar her yıl yeniden değerlenir; ikincil kaynaktan alınmıştır, resmî metinden teyit edilmedi. Hukuki danışmanlık değildir.`,
  };
}

/** Düz metin (görev notu, e-posta, bildirim gövdesi). */
export function eidsLegalNoteText(values?: LegalValues | null): string {
  const n = eidsLegalNote(values);
  return [n.headline, ...n.points.map((p) => `- ${p}`), `Kaynak: ${n.source}`].join("\n");
}
